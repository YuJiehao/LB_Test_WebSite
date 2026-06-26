'use strict';

const KEEPALIVE_INTERVAL_MS = 20000; // 20s

// Event types that the SSE endpoint broadcasts. Exported so other modules
// can reference the canonical list (e.g., for audit replay or documentation).
const SSE_EVENT_TYPES = ['pod_state_change', 'drift_detected', 'audit_event'];

/**
 * Create an Express middleware that serves a Server-Sent Events endpoint.
 *
 * The handler subscribes to known bus events and forwards them as SSE frames
 * (`event:` / `data:` lines). A keep-alive comment (`:ping`) is written every
 * 20 seconds. Dead subscribers are detected on write failure and cleaned up
 * immediately (removes bus listeners, clears the ping timer).
 *
 * @param {{ on: Function, off: Function }} bus - Internal event bus instance.
 * @param {{ keepaliveIntervalMs?: number }} [opts] - Optional overrides.
 * @returns {import('express').RequestHandler}
 */
function createSseHandler(bus, opts = {}) {
  const keepaliveMs = opts.keepaliveIntervalMs || KEEPALIVE_INTERVAL_MS;

  return function sseHandler(req, res) {
    let dead = false;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Local helper: write to the socket, mark dead and clean up on failure
    function safeWrite(chunk) {
      if (dead) return;
      try {
        res.write(chunk);
      } catch (_) {
        cleanup();
      }
    }

    // Flush headers immediately
    safeWrite(':ok\n\n');

    // Keep-alive ping
    const pingTimer = setInterval(() => {
      safeWrite(':ping\n\n');
    }, keepaliveMs);

    // Subscribe to known event types
    const handlers = [];

    for (const evt of SSE_EVENT_TYPES) {
      const wrappedHandler = (payload) => {
        safeWrite(`event: ${evt}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      bus.on(evt, wrappedHandler);
      handlers.push({ evt, wrappedHandler });
    }

    // Cleanup on client disconnect
    function cleanup() {
      if (dead) return;
      dead = true;
      clearInterval(pingTimer);
      for (const { evt, wrappedHandler } of handlers) {
        bus.off(evt, wrappedHandler);
      }
    }

    req.on('close', cleanup);
    res.on('close', cleanup);
  };
}

module.exports = { createSseHandler, KEEPALIVE_INTERVAL_MS, SSE_EVENT_TYPES };
