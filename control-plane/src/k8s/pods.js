'use strict';

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
  return items.map((apiPod) => ({
    name: apiPod.metadata.name,
    ip: apiPod.status.podIP,
    nodeName: apiPod.spec.nodeName,
  }));
}

module.exports = { listPods };
