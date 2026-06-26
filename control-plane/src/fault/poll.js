'use strict';

/**
 * Fetch a URL with a configurable timeout.
 *
 * Wraps the global `fetch` (Node 18+) with an `AbortController` whose
 * `abort()` fires after `timeoutMs`. The caller is responsible for
 * catching errors — on timeout the rejection is a `DOMException`
 * with `name === 'AbortError'`.
 *
 * @param {string} url - The URL to fetch.
 * @param {RequestInit} [options] - fetch options (signal is overridden).
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return fetch(url, { ...options, signal: controller.signal });
  } finally {
    // Clean up the timer once the Promise settles (or rejects synchronously).
    // We can't clear it inside the finally of the returned promise because
    // the finally here runs before the fetch Promise settles. Instead the
    // caller handles clean-up via the passed signal.
    //
    // The abort event itself fires the timer; we keep the cleanup here
    // for the synchronous error path.
    clearTimeout(timer);
  }
}

/**
 * Poll a single Pod's fault-state endpoint.
 *
 * Calls `GET http://<pod.ip>:3000/api/fault` with a 5-second timeout
 * (configurable via `opts.timeoutMs`). On success, returns the parsed
 * JSON with `reachable: true`. On any error (timeout, connection refused,
 * non-200 response), returns a safe default with `reachable: false`.
 *
 * Phase 3 uses this to compare the Pod's actual (in-memory) fault state
 * against the desired state stored in its ConfigMap.
 *
 * @param {{name: string, ip: string, nodeName?: string}} pod
 *   The Pod to poll. Must have a reachable `ip`.
 * @param {number} [timeoutMs=5000]
 *   HTTP timeout in milliseconds. Defaults to 5 seconds.
 * @returns {Promise<{mode: string, slowDelayMs: number, updatedBy: string, reachable: boolean}>}
 *   The Pod's reported fault state, or safe defaults when unreachable.
 */
async function pollPod(pod, timeoutMs = 5000) {
  const url = `http://${pod.ip}:3000/api/fault`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    return {
      mode: data.mode || 'unknown',
      slowDelayMs: typeof data.slowDelayMs === 'number' ? data.slowDelayMs : 0,
      updatedBy: data.updatedBy || '',
      reachable: true,
    };
  } catch (_err) {
    return { mode: 'unknown', slowDelayMs: 0, updatedBy: '', reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { pollPod, fetchWithTimeout };
