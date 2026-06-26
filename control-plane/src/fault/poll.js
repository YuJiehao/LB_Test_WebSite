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

const { listPods } = require('../k8s/pods');
const { listFaultStateConfigMaps, patchFaultState } = require('../k8s/configmaps');

const POD_APP_LABEL = 'app=load-balancer-test';
const DEFAULT_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 60000;

/**
 * Compute exponential backoff delay from consecutive failures.
 *
 * Sequence: 1→1s, 2→2s, 3→4s, 4→8s, 5→16s, 6→32s, 7+→60s.
 *
 * @param {number} failures - Consecutive failure count (>= 1).
 * @returns {number} Delay in milliseconds (capped at `MAX_BACKOFF_MS`).
 */
function backoffDelay(failures) {
  return Math.min(1000 * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
}

/**
 * Start the background state-observation loop.
 *
 * Every `ctx.intervalMs` (default 3s) the loop:
 *  1. Fetches the current Pod list and ConfigMap set.
 *  2. Polls each Pod's `/api/fault` endpoint (skipping Pods still in
 *     exponential backoff from a prior unreachable poll).
 *  3. Compares actual (Pod memory) state against desired (ConfigMap) state
 *     via {@link detectDrift}.
 *  4. When drift is detected, patches the ConfigMap to match the actual
 *     state with `updatedBy: "reconciled:<field>"` so future comparisons
 *     suppress the alert.
 *  5. Unreachable Pods are tracked with exponential backoff (capped at 60s).
 *     Once a Pod responds successfully its backoff is reset.
 *
 * The first tick runs immediately (no initial delay). The returned `stop`
 * handle cancels the next scheduled tick and prevents any in-flight tick
 * from scheduling a new one.
 *
 * @param {{client: object, namespace: string, intervalMs?: number}} ctx
 *   Runtime context. `client` (K8s API client) and `namespace` are required.
 *   `intervalMs` defaults to `DEFAULT_INTERVAL_MS` (3000ms).
 * @returns {{stop: () => void}} Handle to shut down the loop.
 */
function startPollingLoop(ctx) {
  const intervalMs = ctx.intervalMs || DEFAULT_INTERVAL_MS;
  // Allow tests to inject mock implementations via ctx._pollPod / ctx._detectDrift.
  const _pollPod = ctx._pollPod || pollPod;
  const _detectDrift = ctx._detectDrift || detectDrift;
  const backoff = new Map(); // podName → {failures, nextRetryAt}
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;

    try {
      const pods = await listPods(ctx.client, POD_APP_LABEL, ctx.namespace);
      const configMaps = await listFaultStateConfigMaps(ctx.client, ctx.namespace);
      const cmByPod = new Map(configMaps.map((cm) => [cm.podName, cm]));
      const now = Date.now();

      for (const pod of pods) {
        if (!pod || typeof pod.name !== 'string') continue;

        // Honour backoff window.
        const bs = backoff.get(pod.name);
        if (bs && bs.nextRetryAt > now) continue;

        const actual = await _pollPod(pod);
        if (!actual.reachable) {
          const failures = (bs ? bs.failures : 0) + 1;
          backoff.set(pod.name, { failures, nextRetryAt: now + backoffDelay(failures) });
          continue;
        }

        // Pod responded — reset backoff.
        if (bs) backoff.delete(pod.name);

        const desired = cmByPod.get(pod.name);
        if (!desired) continue; // No ConfigMap for this Pod — skip.

        const drift = _detectDrift(desired, actual);
        if (drift.drift) {
          await patchFaultState(ctx.client, ctx.namespace, pod.name, {
            mode: actual.mode,
            slowDelayMs: actual.slowDelayMs,
            updatedAt: new Date().toISOString(),
            updatedBy: `reconciled:${drift.field}`,
          });
        }
      }
    } catch (_err) {
      // Swallow errors in a single tick — the loop must keep running.
      // A future observability hook (event bus) would surface this.
    }

    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  }

  // First tick fires immediately.
  tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = { pollPod, fetchWithTimeout, detectDrift, startPollingLoop, backoffDelay };
