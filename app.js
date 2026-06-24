const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const os = require("os");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Session configuration
app.use(
    session({
        secret: "load-balancer-test-secret",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false,
            maxAge: 30 * 60 * 1000, // 30 minutes
        },
        name: "JSESSIONID",
    }),
);

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Static files
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

// ========================================================================
// Fault injection state (in-memory, per-Pod)
// ========================================================================
// Each Pod keeps its own state, so F5's HTTP monitor can detect individual
// Pod failures and trigger the "action on service down" feature.
//
// Modes:
//   none         - healthy: return 200 with body containing "OK"
//   http_500     - return HTTP 500 Internal Server Error
//   http_503     - return HTTP 503 Service Unavailable
//   slow         - sleep for `slowDelayMs` before responding
//                  (longer than F5 monitor timeout => mark down)
//   wrong_body   - return 200 but body does NOT contain "OK"
//                  (F5 HTTP monitor "Receive String" won't match => mark down)
const FAULT_MODES = ["none", "http_500", "http_503", "slow", "wrong_body"];
const faultState = {
    mode: "none",
    slowDelayMs: 60000, // 60s, far beyond typical F5 monitor timeout (16s)
    updatedAt: null,
    updatedBy: null,
};

// SSE clients subscribed to fault state changes / connection events
const faultStateSubscribers = new Set();

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
    // also push to subscribers
    const payload = JSON.stringify({ type: "conn_event", event: evt });
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
// Health check endpoint for F5 HTTP monitor
// ========================================================================
// F5's HTTP monitor will GET this path. The monitor is typically configured
// to expect status 200 and to look for a specific "Receive String" (e.g.
// "OK") in the response body.
//
// Fault modes:
//   none       -> 200 + body contains "OK"
//   http_500   -> 500 (status mismatch => mark down)
//   http_503   -> 503 (status mismatch => mark down)
//   slow       -> 200, but sleeps `slowDelayMs` first (timeout => mark down)
//   wrong_body -> 200 but body has no "OK" (Receive String mismatch => mark down)
app.get("/health", (req, res) => {
    const mode = faultState.mode;

    if (mode === "http_500") {
        return res
            .status(500)
            .type("text/plain")
            .send("Internal Server Error (injected)\n");
    }
    if (mode === "http_503") {
        return res
            .status(503)
            .type("text/plain")
            .send("Service Unavailable (injected)\n");
    }
    if (mode === "slow") {
        // do NOT respond; F5 monitor will time out and mark the member down
        const delay = faultState.slowDelayMs;
        setTimeout(() => {
            try {
                if (!res.headersSent) {
                    res.status(200).type("text/plain").send("OK\n");
                }
            } catch (e) {
                /* socket closed */
            }
        }, delay);
        return;
    }
    if (mode === "wrong_body") {
        // status is fine, body won't contain "OK", so Receive String check fails
        return res.status(200).type("text/plain").send("UNHEALTHY-INJECTED\n");
    }
    // healthy
    res.status(200).type("text/plain").send("OK\n");
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

// JSON API: set fault mode
// Body: { mode: "none"|"http_500"|"http_503"|"slow"|"wrong_body", slowDelayMs?: number }
app.post("/api/fault", (req, res) => {
    const { mode, slowDelayMs } = req.body || {};
    // Update slowDelayMs FIRST so the broadcast below reflects the new value.
    if (typeof slowDelayMs === "number" && slowDelayMs >= 0) {
        faultState.slowDelayMs = slowDelayMs;
    }
    const result = setFaultMode(mode, req.ip || "unknown");
    if (!result.ok) {
        return res.status(400).json(result);
    }
    console.log(
        `[FAULT] mode=${faultState.mode} slowDelayMs=${faultState.slowDelayMs} by=${faultState.updatedBy}`,
    );
    res.json(result);
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

    // send current snapshot immediately
    res.write(
        `data: ${JSON.stringify({ type: "fault_state", state: getFaultPublicState() })}\n\n`,
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
        connStats.longPoll--;
        recordConnEvent("longPoll", "close", { clientIP, elapsed });
    }, wait);

    req.on("close", () => {
        if (!res.writableEnded) {
            clearTimeout(timer);
            connStats.longPoll = Math.max(0, connStats.longPoll - 1);
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
    const clientIP = req.socket.remoteAddress;
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
    const timer = setInterval(() => {
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
        clearInterval(timer);
        connStats.websocket = Math.max(0, connStats.websocket - 1);
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
