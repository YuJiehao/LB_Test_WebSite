const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const os = require("os");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// 信任所有反向代理（F5/Nginx/Ingress）的 X-Forwarded-For 头
// 这样 `req.ip` 才能拿到真实客户端 IP，而不是负载均衡器的 IP
app.set("trust proxy", true);

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ========================================================================
// ⚠️ /health MUST be declared BEFORE session / cookie / body-parser middleware.
// This prevents F5 monitor probes from creating spurious sessions and
// avoids Set-Cookie headers that could interfere with F5's recv matching.
// ========================================================================

const FAULT_MODES = [
    "none",
    "http_500",
    "http_503",
    "slow",
    "wrong_body",
    "reset",
];
const faultState = {
    mode: "none",
    slowDelayMs: 60000, // 60s, far beyond typical F5 monitor timeout (16s)
    updatedAt: null,
    updatedBy: null,
};

// Health check endpoint for F5 HTTP monitor — runs with ZERO middleware overhead.
// F5 sends: GET /health HTTP/1.1\r\nHost: <vhost>\r\nConnection: close\r\n\r\n
// F5 expects: status 200 + body containing "HEALTHY"
app.get("/health", (req, res) => {
    const mode = faultState.mode;
    const clientIP = req.ip || req.socket?.remoteAddress || "?";
    console.log(
        `[HEALTH] mode=${mode} client=${clientIP} time=${getBeijingTime()}`,
    );

    // Explicit Connection: close — ensure F5 gets a clean, header-only-free response
    res.set("Connection", "close");

    if (mode === "http_500") {
        return res.status(500).type("text/plain").send("ERROR-INJECTED\n");
    }
    if (mode === "http_503") {
        return res.status(503).type("text/plain").send("ERROR-INJECTED\n");
    }
    if (mode === "wrong_body") {
        // 200 status but body lacks "HEALTHY" — F5 Receive String check fails
        return res.status(200).type("text/plain").send("UNHEALTHY-INJECTED\n");
    }
    if (mode === "reset") {
        // Destroy socket immediately → TCP RST → F5 sees connection failure (most reliable)
        req.socket.destroy();
        return;
    }
    if (mode === "slow") {
        // Keep connection open past F5 timeout (16s) → F5 marks member DOWN
        const delay = faultState.slowDelayMs;
        setTimeout(() => {
            try {
                if (!res.headersSent && !req.socket.destroyed) {
                    res.status(200).type("text/plain").send("HEALTHY\n");
                }
            } catch (e) {
                /* socket already gone */
            }
        }, delay);
        return;
    }
    // healthy
    res.status(200).type("text/plain").send("HEALTHY\n");
});

// ========================================================================
// Middleware (applied AFTER /health so probes skip all of this)
// ========================================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "load-balancer-test-secret",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false,
            maxAge: 30 * 60 * 1000, // 30 minutes
        },
        name: "JSESSIONID",
    }),
);

app.use(express.static(path.join(__dirname, "public")));

// ========================================================================
// Helper functions
// ========================================================================

// Get server external IPv4 address (skip loopback / internal)
function getServerIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}

// Beijing time formatter
function getBeijingTime() {
    return new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

// SSE clients subscribed to fault state changes / connection events
const faultStateSubscribers = new Set();

// Active WebSocket clients: ws -> { timer, interval, id }
// Used to pause/resume server-side tick when fault is injected.
const wsClients = new Map();

function pauseWsTicks() {
    for (const [ws, info] of wsClients) {
        if (info.timer) {
            clearInterval(info.timer);
            info.timer = null;
        }
        try {
            ws.send(
                JSON.stringify({
                    type: "fault",
                    action: "pause",
                    mode: faultState.mode,
                    serverIP: getServerIP(),
                }),
            );
        } catch (e) {
            /* socket may be gone */
        }
    }
    console.log(
        `[WS] Ticks paused for ${wsClients.size} clients (mode=${faultState.mode})`,
    );
}

function resumeWsTicks() {
    for (const [ws, info] of wsClients) {
        if (ws.readyState !== ws.OPEN) continue;
        info.timer = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                const payload = {
                    type: "tick",
                    id: info.id,
                    seq: ++ws._messageCount,
                    serverIP: getServerIP(),
                    time: getBeijingTime(),
                };
                try {
                    ws.send(JSON.stringify(payload));
                } catch (e) {}
            }
        }, info.interval);
        try {
            ws.send(
                JSON.stringify({
                    type: "fault",
                    action: "resume",
                    serverIP: getServerIP(),
                }),
            );
        } catch (e) {}
    }
    console.log(`[WS] Ticks resumed for ${wsClients.size} clients`);
}

// Broadcast fault state change to all subscribers
function broadcastFaultState() {
    const payload = JSON.stringify({
        type: "fault_state",
        state: getFaultPublicState(),
    });
    for (const res of faultStateSubscribers) {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch (e) {
            faultStateSubscribers.delete(res);
        }
    }
}

function getFaultPublicState() {
    return {
        mode: faultState.mode,
        slowDelayMs: faultState.slowDelayMs,
        updatedAt: faultState.updatedAt,
        updatedBy: faultState.updatedBy,
        serverIP: getServerIP(),
    };
}

function setFaultMode(mode, updatedBy) {
    if (!FAULT_MODES.includes(mode)) {
        return { ok: false, error: `invalid mode: ${mode}` };
    }
    faultState.mode = mode;
    faultState.updatedAt = getBeijingTime();
    faultState.updatedBy = updatedBy || "unknown";
    broadcastFaultState();
    // Pause/resume WebSocket server-side ticks based on fault mode
    if (mode === "none") {
        resumeWsTicks();
    } else {
        pauseWsTicks();
    }
    return { ok: true, state: getFaultPublicState() };
}

// ========================================================================
// Long connection bookkeeping
// ========================================================================
const connStats = {
    websocket: 0,
    sse: 0,
    longPoll: 0,
};
const connectionLog = []; // recent connection events, capped
const MAX_LOG = 200;

function recordConnEvent(type, action, meta) {
    const evt = {
        type,
        action,
        serverIP: getServerIP(),
        time: getBeijingTime(),
        ...meta,
    };
    connectionLog.unshift(evt);
    if (connectionLog.length > MAX_LOG) connectionLog.length = MAX_LOG;
    // 没有订阅者时直接返回，省掉 JSON.stringify 的开销
    if (faultStateSubscribers.size === 0) return;
    const payload = JSON.stringify({ type: "conn_event", event: evt });
    for (const res of faultStateSubscribers) {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch (e) {
            faultStateSubscribers.delete(res);
        }
    }
}

// 广播当前连接统计（仅在有订阅者时执行序列化）
function broadcastConnStats() {
    if (faultStateSubscribers.size === 0) return;
    const payload = JSON.stringify({
        type: "conn_stats",
        stats: {
            websocket: connStats.websocket,
            sse: connStats.sse,
            longPoll: connStats.longPoll,
        },
    });
    for (const res of faultStateSubscribers) {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch (e) {
            faultStateSubscribers.delete(res);
        }
    }
}

// ========================================================================
// Routes - home & session
// ========================================================================

app.get("/", (req, res) => {
    const serverIP = getServerIP();
    const currentTime = getBeijingTime();
    const clientIP =
        req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const xForwardedFor = req.headers["x-forwarded-for"];
    const userAgent = req.headers["user-agent"];

    res.render("index", {
        serverIP,
        currentTime,
        clientIP,
        xForwardedFor,
        userAgent,
        sessionId: req.sessionID,
        isLoggedIn: req.session.isLoggedIn || false,
        username: req.session.username || null,
        faultMode: faultState.mode,
        connStats,
    });
});

app.get("/login", (req, res) => {
    res.render("login", {
        sessionId: req.sessionID,
        error: null,
    });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (username && password) {
        req.session.isLoggedIn = true;
        req.session.username = username;
        req.session.loginTime = getBeijingTime();
        req.session.serverIP = getServerIP();

        res.redirect("/session-test");
    } else {
        res.render("login", {
            sessionId: req.sessionID,
            error: "Please enter both username and password",
        });
    }
});

app.get("/session-test", (req, res) => {
    const serverIP = getServerIP();
    const currentTime = getBeijingTime();
    const clientIP =
        req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

    const sessionPersistent = req.session.isLoggedIn === true;
    const sessionServer = req.session.serverIP;
    const currentServer = serverIP;
    const serverMatches = sessionServer === currentServer;

    res.render("session-test", {
        sessionId: req.sessionID,
        isLoggedIn: req.session.isLoggedIn || false,
        username: req.session.username || null,
        loginTime: req.session.loginTime || null,
        sessionServer,
        currentServer,
        serverMatches,
        sessionPersistent,
        currentTime,
        clientIP,
        cookies: req.cookies,
        headers: req.headers,
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Session destroy error:", err);
        }
        res.clearCookie("JSESSIONID");
        res.redirect("/");
    });
});

// ========================================================================
// Fault injection admin
// ========================================================================

// Admin UI page
app.get("/admin/fault", (req, res) => {
    res.render("fault-admin", {
        serverIP: getServerIP(),
        currentTime: getBeijingTime(),
        modes: FAULT_MODES,
        state: getFaultPublicState(),
        connStats,
        connectionLog: connectionLog.slice(0, 50),
    });
});

// JSON API: get current fault state
app.get("/api/fault", (req, res) => {
    res.json(getFaultPublicState());
});

// JSON API: set fault mode / slow delay
// Body: { mode?: "none"|"http_500"|"http_503"|"slow"|"wrong_body", slowDelayMs?: number }
// - If `mode` is provided, the fault mode is changed (broadcasts to subscribers).
// - If only `slowDelayMs` is provided, only the slow delay is updated and no
//   mode change happens (does NOT broadcast — clients still see the same mode).
//   This lets admins tune the slow delay without accidentally injecting a fault.
app.post("/api/fault", (req, res) => {
    const { mode, slowDelayMs } = req.body || {};

    // Update slowDelayMs FIRST so any subsequent mode broadcast reflects the new value.
    let delayUpdated = false;
    if (typeof slowDelayMs === "number" && slowDelayMs >= 0) {
        faultState.slowDelayMs = slowDelayMs;
        delayUpdated = true;
    }

    // mode is optional — only act on it when present
    if (mode !== undefined) {
        const result = setFaultMode(mode, req.ip || "unknown");
        if (!result.ok) {
            return res.status(400).json(result);
        }
        console.log(
            `[FAULT] mode=${faultState.mode} slowDelayMs=${faultState.slowDelayMs} by=${faultState.updatedBy}`,
        );
        return res.json(result);
    }

    // Only delay updated — return current public state without broadcast
    if (delayUpdated) {
        console.log(
            `[FAULT] slowDelayMs=${faultState.slowDelayMs} by=${req.ip || "unknown"} (mode unchanged: ${faultState.mode})`,
        );
        return res.json({
            ok: true,
            state: getFaultPublicState(),
            delayOnly: true,
        });
    }

    return res
        .status(400)
        .json({ ok: false, error: "no mode or slowDelayMs provided" });
});

// SSE stream of fault state + connection events
app.get("/api/fault/stream", (req, res) => {
    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    faultStateSubscribers.add(res);

    // send current snapshot immediately (fault state + initial conn stats)
    res.write(
        `data: ${JSON.stringify({ type: "fault_state", state: getFaultPublicState() })}\n\n`,
    );
    res.write(
        `data: ${JSON.stringify({
            type: "conn_stats",
            stats: {
                websocket: connStats.websocket,
                sse: connStats.sse,
                longPoll: connStats.longPoll,
            },
        })}\n\n`,
    );

    // keep-alive ping every 20s to keep the connection open through F5
    const ping = setInterval(() => {
        try {
            res.write(": ping\n\n");
        } catch (e) {
            clearInterval(ping);
        }
    }, 20000);

    req.on("close", () => {
        clearInterval(ping);
        faultStateSubscribers.delete(res);
    });
});

// ========================================================================
// Long-connection page
// ========================================================================

app.get("/long-connection", (req, res) => {
    res.render("long-connection", {
        serverIP: getServerIP(),
        currentTime: getBeijingTime(),
        sessionId: req.sessionID,
        faultMode: faultState.mode,
    });
});

app.get("/api/connection-stats", (req, res) => {
    res.json({
        serverIP: getServerIP(),
        ...connStats,
    });
});

// ========================================================================
// Long polling endpoint
// ========================================================================
// A request to /long-poll will block on the server side for up to
// `?wait=<ms>` milliseconds (default 30000) and then respond. This
// keeps the HTTP connection open and stresses the F5 connection
// persistence / OneConnect features.
app.get("/long-poll", (req, res) => {
    const wait = Math.min(parseInt(req.query.wait, 10) || 30000, 120000);
    connStats.longPoll++;
    broadcastConnStats();
    const startTime = Date.now();
    const clientIP = req.ip || req.connection.remoteAddress;

    recordConnEvent("longPoll", "open", { clientIP, wait });

    const timer = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        res.json({
            type: "long-poll",
            serverIP: getServerIP(),
            clientIP,
            requestedWait: wait,
            elapsed,
            time: getBeijingTime(),
            msg: "long poll completed",
        });
        connStats.longPoll = Math.max(0, connStats.longPoll - 1);
        broadcastConnStats();
        recordConnEvent("longPoll", "close", { clientIP, elapsed });
    }, wait);

    req.on("close", () => {
        if (!res.writableEnded) {
            clearTimeout(timer);
            connStats.longPoll = Math.max(0, connStats.longPoll - 1);
            broadcastConnStats();
            recordConnEvent("longPoll", "abort", {
                clientIP,
                elapsed: Date.now() - startTime,
            });
        }
    });
});

// ========================================================================
// SSE endpoint
// ========================================================================
app.get("/sse", (req, res) => {
    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    connStats.sse++;
    broadcastConnStats();
    const clientIP = req.ip || req.connection.remoteAddress;
    const interval = Math.max(500, parseInt(req.query.interval, 10) || 1000);
    recordConnEvent("sse", "open", { clientIP, interval });

    let counter = 0;
    const send = () => {
        counter++;
        const payload = {
            type: "sse",
            seq: counter,
            serverIP: getServerIP(),
            clientIP,
            time: getBeijingTime(),
        };
        try {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (e) {
            /* socket closed */
        }
    };

    // initial event
    send();
    const timer = setInterval(send, interval);

    req.on("close", () => {
        clearInterval(timer);
        connStats.sse = Math.max(0, connStats.sse - 1);
        broadcastConnStats();
        recordConnEvent("sse", "close", { clientIP, totalEvents: counter });
    });
});

// ========================================================================
// HTTP & WebSocket server
// ========================================================================
const server = http.createServer(app);

// WebSocket server: upgrade requests on /ws
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
    connStats.websocket++;
    broadcastConnStats();
    // 统一用 req.ip（已配置 trust proxy），回退到 socket 地址
    const clientIP = req.ip || req.socket.remoteAddress;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ws._id = id;
    ws._clientIP = clientIP;
    ws._connectedAt = getBeijingTime();
    ws._pongCount = 0;
    ws._messageCount = 0;

    recordConnEvent("websocket", "open", { clientIP, id });

    const hello = {
        type: "welcome",
        id,
        serverIP: getServerIP(),
        clientIP,
        connectedAt: ws._connectedAt,
        message:
            "WebSocket connected. Send any message; the server will echo + reply periodically.",
    };
    ws.send(JSON.stringify(hello));

    // periodic server -> client heartbeat / data push
    const interval = Math.max(
        500,
        parseInt(
            new URL(req.url, "http://x").searchParams.get("interval"),
            10,
        ) || 2000,
    );
    const tickInfo = { timer: null, interval, id };
    wsClients.set(ws, tickInfo);

    // Only start tick timer if no fault is injected
    if (faultState.mode === "none") {
        tickInfo.timer = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                const payload = {
                    type: "tick",
                    id,
                    seq: ++ws._messageCount,
                    serverIP: getServerIP(),
                    time: getBeijingTime(),
                };
                try {
                    ws.send(JSON.stringify(payload));
                } catch (e) {
                    /* ignore */
                }
            }
        }, interval);
    }

    ws.on("message", (raw) => {
        ws._messageCount++;
        const reply = {
            type: "echo",
            id,
            seq: ws._messageCount,
            serverIP: getServerIP(),
            receivedAt: getBeijingTime(),
            echoLength: raw.length,
            echoPreview:
                raw.length > 200
                    ? raw.slice(0, 200).toString() + "..."
                    : raw.toString(),
        };
        try {
            ws.send(JSON.stringify(reply));
        } catch (e) {
            /* ignore */
        }
    });

    ws.on("pong", () => {
        ws._pongCount++;
    });

    ws.on("close", (code, reason) => {
        if (tickInfo.timer) clearInterval(tickInfo.timer);
        wsClients.delete(ws);
        connStats.websocket = Math.max(0, connStats.websocket - 1);
        broadcastConnStats();
        recordConnEvent("websocket", "close", {
            clientIP,
            id,
            code,
            reason: reason ? reason.toString() : "",
            messages: ws._messageCount,
        });
    });

    ws.on("error", (err) => {
        console.error("[WS] error", err.message);
    });
});

server.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/ws")) {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    } else {
        socket.destroy();
    }
});

// ========================================================================
// Start
// ========================================================================
server.listen(PORT, () => {
    console.log(`Load Balancer Test Site running on port ${PORT}`);
    console.log(`Server IP: ${getServerIP()}`);
    console.log(`WebSocket:  ws://<host>:${PORT}/ws`);
    console.log(`SSE:        http://<host>:${PORT}/sse`);
    console.log(`Long poll:  http://<host>:${PORT}/long-poll`);
    console.log(
        `Health:     http://<host>:${PORT}/health   (F5 monitor target)`,
    );
    console.log(`Fault admin:http://<host>:${PORT}/admin/fault`);
});
