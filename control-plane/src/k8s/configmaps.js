'use strict';

const {
  FAULT_STATE_LABEL,
  ROLE_KEY,
  FAULT_STATE_VALUE,
  FAULT_STATE_NAME_PREFIX,
} = require('./labels');

function parseInt0(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a `V1ConfigMap` API object to the plain record the rest of the
 * control plane consumes.
 *
 * Only the fields Phase 3 / 4 actually need are extracted:
 *   - `name`             — ConfigMap name (`fault-state-<pod-name>`)
 *   - `podName`          — `<pod-name>` parsed from the name and the
 *                          `pod` label (label takes precedence; falls
 *                          back to name-prefix-strip)
 *   - `mode`             — fault mode string (`none|http_500|http_503|...`)
 *   - `slowDelayMs`      — slow-mode delay, parsed as int (0 if absent)
 *   - `resourceVersion`  — for optimistic-locking on patch (Task 2.2)
 *
 * YAGNI: status, binaryData, ownerRefs, etc. are not carried forward
 * until a real consumer asks for them.
 *
 * @param {{ metadata?: { name?: string, labels?: { [k: string]: string }, resourceVersion?: string }, data?: { [k: string]: string } }} apiCm
 *   A `V1ConfigMap` (or a faithful subset thereof — tests use plain objects).
 * @returns {{name: string, podName: string, mode: string, slowDelayMs: number, resourceVersion: string}}
 */
function toPlainConfigMap(apiCm) {
  const meta = apiCm.metadata || {};
  const data = apiCm.data || {};
  const labels = meta.labels || {};
  const podName =
    labels.pod ||
    (typeof meta.name === 'string' && meta.name.startsWith(FAULT_STATE_NAME_PREFIX)
      ? meta.name.slice(FAULT_STATE_NAME_PREFIX.length)
      : meta.name);
  return {
    name: meta.name,
    podName,
    mode: data.mode || 'none',
    slowDelayMs: data.slowDelayMs !== undefined ? parseInt0(data.slowDelayMs) : 0,
    resourceVersion: meta.resourceVersion,
  };
}

/**
 * List all fault-state ConfigMaps in `namespace`, mapped to the plain
 * record shape Phase 3 / 4 consumes.
 *
 * Filtering happens server-side via `labelSelector=role=fault-state`
 * (the RBAC scope from Phase 7), so the response only contains
 * ConfigMaps that belong to the LB_Test_WebSite fleet. The mapping
 * tolerates an empty / missing `response.items` (returns `[]`).
 *
 * @param {{ configMaps: { listNamespacedConfigMap: Function } }} client
 *   The result of `loadK8sClient()`; only the `configMaps` namespace is used.
 * @param {string} namespace - The namespace to list ConfigMaps from.
 * @returns {Promise<Array<{name: string, podName: string, mode: string, slowDelayMs: number, resourceVersion: string}>>}
 */
async function listFaultStateConfigMaps(client, namespace) {
  const response = await client.configMaps.listNamespacedConfigMap({
    namespace,
    labelSelector: FAULT_STATE_LABEL,
  });
  const items = (response && response.items) || [];
  // The K8s API filters by labelSelector server-side, but the unit-test
  // mock and any future ad-hoc listing paths may not — apply a defensive
  // client-side filter so this function is the single source of truth for
  // "which ConfigMaps count as fault state".
  return items
    .filter((cm) => cm && cm.metadata && cm.metadata.labels && cm.metadata.labels[ROLE_KEY] === FAULT_STATE_VALUE)
    .map(toPlainConfigMap);
}

/**
 * Read the fault-state ConfigMap for a single Pod.
 *
 * Returns `null` when the ConfigMap does not exist (the API rejects
 * with a 404) so callers can distinguish "no fault applied yet" from
 * "cluster unreachable". Any other rejection is rethrown so the caller
 * can surface the failure to its error-handling middleware.
 *
 * @param {{ configMaps: { readNamespacedConfigMap: Function } }} client
 *   The result of `loadK8sClient()`; only the `configMaps` namespace is used.
 * @param {string} namespace - The namespace the Pod lives in.
 * @param {string} podName - The Pod name (the ConfigMap is named
 *   `fault-state-<podName>`).
 * @returns {Promise<{name: string, podName: string, mode: string, slowDelayMs: number, resourceVersion: string} | null>}
 */
async function getFaultStateConfigMap(client, namespace, podName) {
  const name = FAULT_STATE_NAME_PREFIX + podName;
  try {
    const apiCm = await client.configMaps.readNamespacedConfigMap({
      namespace,
      name,
    });
    return toPlainConfigMap(apiCm);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.response?.statusCode === 404)) {
      return null;
    }
    throw err;
  }
}

module.exports = {
  listFaultStateConfigMaps,
  getFaultStateConfigMap,
  toPlainConfigMap,
  FAULT_STATE_LABEL,
  FAULT_STATE_NAME_PREFIX,
};
