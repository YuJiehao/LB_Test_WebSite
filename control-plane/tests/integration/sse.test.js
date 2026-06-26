'use strict';

const http = require('http');
const express = require('express');
const { bus } = require('../../src/events/bus');
const { createSseHandler } = require('../../src/events/sse');

/**
 * Simple inline SSE client.
 *
 * Connects to the given SSE URL, collects events and pings, and resolves
 * after `maxEvents` events are received, or after `timeout` ms.
 *
 * @param {string} url
 * @param {{maxEvents?: number, timeout?: number}} opts
 * @returns {Promise<{events: Array<{event: string, data: string}>, pings: number, timedOut: boolean}>}
 */
function connectSse(url, opts = {}) {
  const maxEvents = opts.maxEvents || 5;
  const timeout = opts.timeout || 2000;

  return new Promise((resolve, reject) => {
    const result = { events: [], pings: 0, timedOut: false };

    const req = http.get(url, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // SSE frames end with \n\n
        const frames = buffer.split('\n\n');
        buffer = frames.pop(); // keep incomplete frame

        for (const frame of frames) {
          if (frame.startsWith(':')) {
            // Comment/ping frame. ":ok" and ":ping" are both pings.
            // Count any comment line; the ":ok\n\n" initial frame may arrive
            // separately or together with other data.
            result.pings++;
          } else {
            const eventMatch = frame.match(/^event: (.+)$/m);
            const dataMatch = frame.match(/^data: (.+)$/m);
            if (dataMatch) {
              result.events.push({
                event: eventMatch ? eventMatch[1] : null,
                data: dataMatch[1],
              });
            }
          }
        }

        if (maxEvents > 0 && result.events.length >= maxEvents) {
          req.destroy();
          resolve(result);
        }
      });

      res.on('end', () => {
        resolve(result);
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.message.includes('destroy')) {
        resolve(result);
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      req.destroy();
      result.timedOut = true;
      resolve(result);
    }, timeout);
  });
}

describe('GET /api/events (SSE)', () => {
  let app;
  let server;
  let port;

  beforeAll((done) => {
    app = express();
    // Use a short keepalive interval for testing
    app.get('/api/events', createSseHandler(bus, { keepaliveIntervalMs: 200 }));
    server = app.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('returns Content-Type: text/event-stream', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/api/events`, (res) => {
        resolve(res);
        res.destroy();
      }).on('error', reject);
      // Short timeout
      setTimeout(() => {
        reject(new Error('Timeout getting headers'));
      }, 1000);
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['connection']).toBe('keep-alive');
  });

  test('client receives an event after bus.emit(pod_state_change)', async () => {
    const client = connectSse(`http://localhost:${port}/api/events`, { maxEvents: 1, timeout: 3000 });

    // Give the connection a moment to establish
    await new Promise((r) => setTimeout(r, 200));

    bus.emit('pod_state_change', { pod: 'web-0', mode: 'http_500' });

    const result = await client;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe('pod_state_change');
    expect(JSON.parse(result.events[0].data)).toEqual({
      pod: 'web-0',
      mode: 'http_500',
    });
  });

  test('keep-alive ping is sent at the configured interval', async () => {
    const INTERVAL = 200;
    // Connect and wait for 3 intervals = ~600ms
    const client = connectSse(`http://localhost:${port}/api/events`, {
      maxEvents: 0,
      timeout: 3000,
    });

    // Wait for enough pings (the initial :ok + 3 pings)
    // We count all comment lines
    await new Promise((r) => setTimeout(r, INTERVAL * 4));

    const result = await client;
    // At least the initial :ok + 3 pings over 3 intervals
    expect(result.pings).toBeGreaterThanOrEqual(4);
  });
});
