'use strict';

const { selectTargets } = require('./targets');
const { patchFaultState, getFaultStateConfigMap } = require('../k8s/configmaps');

// Forward-looking audit integration. Uncomment when src/events/audit.js
// is implemented; the try/catch in applyFault keeps the call safe.
// const { recordAudit } = require('../events/audit');

/**
 * Create a concurrency-limited runner.
 *
 * Accepts a function `fn` and queues it; at most `limit` functions run
 * simultaneously. Resolves with the return value of `fn` once it completes.
 *
 * @param {number} limit - Maximum concurrent tasks (must be >= 1).
 * @returns {{ run: (fn: () => Promise<any>) => Promise<any> }}
 */
function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  function dequeue() {
    if (queue.length === 0 || active >= limit) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(() => fn())
      .then(
        (val) => {
          active--;
          resolve(val);
          dequeue();
        },
        (err) => {
          active--;
          reject(err);
          dequeue();
        }
      );
  }

  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        dequeue();
      });
    },
  };
}

/**
 * Apply a fault to a set of target Pods.
 *
 * Orchestrates the full apply workflow:
 *  1. Select target Pods via {@link selectTargets}.
 *  2. For each target Pod, check whether a fault-state ConfigMap exists
 *     (via {@link getFaultStateConfigMap}). If not (404 / null), the Pod
 *     is **skipped** — this should not happen after a successful `reconcileOnStartup`
 *     but is handled defensively.
 *  3. Call {@link patchFaultState} with the new state for each Pod that has
 *     a ConfigMap.
 *  4. All patch operations run in parallel, capped at **5 concurrent** calls
 *     via an inline semaphore.
 *  5. Results are aggregated into `{applied, skipped, errors}`. The function
 *     **never throws** — individual ConfigMap read or patch failures are
 *     captured in `errors[]`.
 *
 * @param {{type: string, [k: string]: any}} target
 *   The target spec passed through to {@link selectTargets}.
 * @param {string} mode
 *   The fault mode (e.g. `'none'`, `'http_500'`, `'http_503'`, `'slow'`,
 *   `'wrong_body'`, `'reset'`).
 * @param {number} slowDelayMs
 *   Delay in milliseconds for the `'slow'` mode (ignored for other modes).
 * @param {{client: object, namespace: string, pods: Array, updatedBy?: string, timeoutMs?: number}} ctx
 *   Runtime context. `client` and `namespace` are required. `pods` is the
 *   Pod list passed to target selection. `updatedBy` defaults to `'control-plane'`.
 *   `timeoutMs` (default 5000) is passed to each `patchFaultState` call.
 * @returns {Promise<{applied: string[], skipped: string[], errors: Array<{podName: string, error: string}>}>}
 *   Aggregated per-Pod outcome. The function does NOT throw on individual
 *   patch failures; those appear in `errors`.
 */
async function applyFault(target, mode, slowDelayMs, ctx) {
  const state = {
    mode,
    slowDelayMs,
    updatedAt: new Date().toISOString(),
    updatedBy: ctx.updatedBy || 'control-plane',
  };

  const targetPods = await selectTargets(target, ctx.pods, ctx);

  const applied = [];
  const skipped = [];
  const errors = [];

  const semaphore = createSemaphore(5);
  const timeoutMs = ctx.timeoutMs || 5000;

  const tasks = targetPods.map((pod) =>
    semaphore.run(async () => {
      try {
        const cm = await getFaultStateConfigMap(ctx.client, ctx.namespace, pod.name);
        if (!cm) {
          skipped.push(pod.name);
          return;
        }

        await patchFaultState(ctx.client, ctx.namespace, pod.name, state, {
          timeoutMs,
        });
        applied.push(pod.name);
      } catch (err) {
        errors.push({ podName: pod.name, error: err.message || String(err) });
      }
    })
  );

  await Promise.all(tasks);

  // Forward-looking audit wiring. The import above is commented out until
  // src/events/audit.js exists; the try/catch makes this safe to uncomment
  // at any time without breaking the apply path.
  try {
    // recordAudit('fault.apply', {
    //   target, mode, slowDelayMs,
    //   podCount: targetPods.length,
    //   applied: applied.length,
    //   skipped: skipped.length,
    //   errors: errors.length,
    // });
  } catch (_) {
    // audit module not yet available — non-functional placeholder
  }

  return { applied, skipped, errors };
}

module.exports = { applyFault };
