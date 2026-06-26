'use strict';

const { hashCode } = require('../util/hash');
const { listPods: listPodsAdapter } = require('../k8s/adapter');

/**
 * Select the Pods that a fault operation should target.
 *
 * Four target shapes are supported:
 *   - { type: 'all' }                       — every Pod in `pods`
 *   - { type: 'single', pod: '<name>' }     — the named Pod if present
 *   - { type: 'selector', selector: '<k=v[,...]>' }
 *                                            — pods matching the label
 *                                              selector; the API is
 *                                              called once and the
 *                                              result is filtered
 *                                              client-side as a safety
 *                                              net.
 *   - { type: 'canary', percent: <0..100> }  — deterministic hash-based
 *                                              subset selection.
 *
 * Selector mode talks to the cluster via `ctx.client.pods.listNamespacedPod`.
 * Callers that already hold a cached Pod list may pass `ctx.pods` to skip
 * the API call; the client-side filter still runs.
 *
 * The function returns plain `{name, ip, nodeName}` records, identical
 * to `listPods()`, so downstream code does not need to map again.
 *
 * @param {{type: string, [k: string]: any}} target - The target spec.
 * @param {Array<{name: string, ip: string, nodeName: string}>} pods -
 *   The Pod universe to select from (also used by `canary`).
 * @param {{client?: object, namespace?: string, pods?: Array}} [ctx] -
 *   Required for `selector` (either `client` or `pods`); ignored for
 *   the other modes.
 * @returns {Array<{name: string, ip: string, nodeName: string}>}
 *   Matching pods (may be empty). May return a Promise when the
 *   selector path is used.
 */
function selectTargets(target, pods, ctx) {
  if (!target || typeof target.type !== 'string') {
    return [];
  }

  switch (target.type) {
    case 'all':
      return Array.isArray(pods) ? pods.slice() : [];

    case 'single':
      if (!Array.isArray(pods) || typeof target.pod !== 'string') return [];
      return pods.filter((p) => p && p.name === target.pod);

    case 'canary': {
      if (!Array.isArray(pods)) return [];
      const percent = Number.isFinite(target.percent) ? target.percent : 0;
      if (percent <= 0) return [];
      if (percent >= 100) return pods.slice();
      return pods.filter((p) => {
        const bucket = ((hashCode(p.name) % 100) + 100) % 100;
        return bucket < percent;
      });
    }

    case 'selector':
      return resolveSelector(target, ctx);

    default:
      return [];
  }
}

/**
 * Resolve a `selector` target by either consuming `ctx.pods` directly
 * or issuing one `listNamespacedPod` call and mapping the response.
 *
 * Always re-applies the label filter client-side as a defensive guard
 * — server-side selectors are authoritative, but unit tests and any
 * future caller that pre-filters with a wider selector still get the
 * right answer.
 *
 * @param {{selector: string}} target
 * @param {{client?: {pods: {listNamespacedPod: Function}}, namespace?: string, pods?: Array}} ctx
 * @returns {Promise<Array<{name: string, ip: string, nodeName: string}>>}
 */
async function resolveSelector(target, ctx) {
  const selector = target.selector;
  const namespace = ctx && ctx.namespace;
  let apiPods;
  if (ctx && Array.isArray(ctx.pods)) {
    apiPods = ctx.pods;
  } else if (ctx && ctx.client && ctx.client.pods && typeof ctx.client.pods.listNamespacedPod === 'function') {
    // Adapter handles positional args + {response, body} envelope for
    // @kubernetes/client-node@0.22.3.
    apiPods = await listPodsAdapter(ctx.client, namespace, selector);
  } else {
    return [];
  }
  return filterBySelector(apiPods, selector);
}

/**
 * Parse a `k=v,k=v` label-selector string into a predicate that
 * returns true when an item's `metadata.labels` matches every
 * key/value pair.
 *
 * @param {string} selector
 * @returns {(apiPod: any) => boolean}
 */
function buildSelectorPredicate(selector) {
  const pairs = String(selector)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((kv) => {
      const idx = kv.indexOf('=');
      if (idx <= 0) return null;
      return { key: kv.slice(0, idx), value: kv.slice(idx + 1) };
    })
    .filter(Boolean);

  if (pairs.length === 0) return () => true;
  const map = new Map(pairs.map((p) => [p.key, p.value]));
  return (apiPod) => {
    const labels = apiPod && apiPod.metadata && apiPod.metadata.labels;
    if (!labels) return false;
    for (const [k, v] of map) {
      if (labels[k] !== v) return false;
    }
    return true;
  };
}

function filterBySelector(apiPods, selector) {
  const pred = buildSelectorPredicate(selector);
  return apiPods.filter(pred).map((apiPod) => ({
    name: apiPod.metadata.name,
    ip: apiPod.status && apiPod.status.podIP,
    nodeName: apiPod.spec && apiPod.spec.nodeName,
  }));
}

module.exports = {
  selectTargets,
  buildSelectorPredicate,
  filterBySelector,
};