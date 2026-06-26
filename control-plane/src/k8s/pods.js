'use strict';

/**
 * Map a `V1Pod` API object to the plain `{name, ip, nodeName}` record
 * the rest of the control plane consumes.
 *
 * Only the three fields Phase 3 actually needs are extracted — YAGNI
 * says we don't carry status, containers, owner refs, etc. until a real
 * consumer asks for them.
 *
 * @param {{ metadata?: { name?: string }, spec?: { nodeName?: string }, status?: { podIP?: string } }} apiPod
 *   A `V1Pod` (or a faithful subset thereof — tests use plain objects).
 * @returns {{name: string, ip: string, nodeName: string}}
 */
function toPlainPod(apiPod) {
  return {
    name: apiPod.metadata.name,
    ip: apiPod.status.podIP,
    nodeName: apiPod.spec.nodeName,
  };
}

/**
 * List all Pods in `namespace` matching `labelSelector`, mapped to a
 * plain shape suitable for UI consumption.
 *
 * @param {{ pods: { listNamespacedPod: Function } }} client - The result of
 *   loadK8sClient(); only the `pods` namespace is used.
 * @param {string} labelSelector - A Kubernetes label selector expression
 *   (e.g. `"app=test"`).
 * @param {string} namespace - The namespace to list Pods from.
 * @returns {Promise<Array<{name: string, ip: string, nodeName: string}>>}
 *   Plain pod records (only the fields Phase 3 actually needs).
 */
async function listPods(client, labelSelector, namespace) {
  const response = await client.pods.listNamespacedPod({
    namespace,
    labelSelector,
  });
  const items = (response && response.items) || [];
  return items.map(toPlainPod);
}

module.exports = { listPods, toPlainPod };
