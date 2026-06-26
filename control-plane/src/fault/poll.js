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
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Poll a single Pod's fault-state endpoint.
 *
 * Calls `GET http://<pod.ip>:3000/api/fault` with a 5-second timeout
 * (configurable via `timeoutMs`). On success, returns the parsed
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
  try {
    const res = await fetchWithTimeout(url, {}, timeoutMs);
    const data = await res.json();
    return {
      mode: data.mode || 'unknown',
      slowDelayMs: typeof data.slowDelayMs === 'number' ? data.slowDelayMs : 0,
      updatedBy: data.updatedBy || '',
      reachable: true,
    };
  } catch (_err) {
    return { mode: 'unknown', slowDelayMs: 0, updatedBy: '', reachable: false };
  }
}

/**
 * Compare desired (ConfigMap) state against actual (Pod memory) state.
 *
 * Pure function — no I/O. Returns `{drift: true, field}` when the two
 * states differ in `mode` or `slowDelayMs` (checked in order). Returns
 * `{drift: false}` when they match.
 *
 * Special case: if `actual.updatedBy` starts with `"reconciled:"`, the
 * change was made by the control plane's own reconciliation loop — this
 * is NOT drift (suppresses oscillation).
 *
 * @param {{mode: string, slowDelayMs: number, updatedBy?: string}} desired
 *   The fault state from the ConfigMap.
 * @param {{mode: string, slowDelayMs: number, updatedBy?: string}} actual
 *   The fault state reported by the Pod's /api/fault endpoint.
 * @returns {{drift: true, field: string} | {drift: false}}
 *   Drift verdict and the mismatched field (when drift is true).
 */
function detectDrift(desired, actual) {
  // Self-reconciliation suppression: if the control plane already
  // reconciled this change, don't flag it as drift again.
  if (actual.updatedBy && actual.updatedBy.startsWith('reconciled:')) {
    return { drift: false };
  }

  if (desired.mode !== actual.mode) {
    return { drift: true, field: 'mode' };
  }

  if (desired.slowDelayMs !== actual.slowDelayMs) {
    return { drift: true, field: 'slowDelayMs' };
  }

  return { drift: false };
}

module.exports = { pollPod, fetchWithTimeout, detectDrift };
