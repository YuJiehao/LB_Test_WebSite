'use strict';

const { listPods: listPodsAdapter } = require('./adapter');

/**
 * Map a `V1Pod` API object to the plain record the rest of the control
 * plane consumes.
 *
 * @param {{ metadata?: { name?: string, labels?: object }, spec?: { nodeName?: string }, status?: { podIP?: string } }} apiPod
 *   A `V1Pod` (or a faithful subset thereof — tests use plain objects).
 * @returns {{name: string, ip: string, nodeName: string, labels: object}}
 */
function toPlainPod(apiPod) {
  return {
    name: apiPod.metadata.name,
    ip: apiPod.status.podIP,
    nodeName: apiPod.spec.nodeName,
    labels: (apiPod.metadata && apiPod.metadata.labels) || {},
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
  // Delegates to the v0.22.3-compat adapter that handles positional args
  // and the {response, body} envelope.
  const items = await listPodsAdapter(client, namespace, labelSelector);
  return items.map(toPlainPod);
}

module.exports = { listPods, toPlainPod };
