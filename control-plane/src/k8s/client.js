'use strict';

const { KubeConfig, CoreV1Api } = require('@kubernetes/client-node');

/**
 * Build a Kubernetes API client using in-cluster configuration.
 *
 * Must be called from inside a Pod that has a service-account token mounted
 * at `/var/run/secrets/kubernetes.io/serviceaccount/token` (the default when
 * `automountServiceAccountToken: true` is set on the Pod/SA).
 *
 * The returned object exposes two resource namespaces, each backed by a
 * {@link CoreV1Api} instance:
 *   - `pods`        — used to list/get/delete Pods (Phase 3).
 *   - `configMaps`  — used to read the LB config ConfigMap (Phase 2).
 *
 * Both namespaces share the same `CoreV1Api` because both Pod and ConfigMap
 * resources live in the `core/v1` API group.
 *
 * @returns {{ pods: CoreV1Api, configMaps: CoreV1Api }} API client with
 *   `pods` and `configMaps` namespaces.
 * @throws {Error} If the in-cluster config cannot be loaded (e.g. the Pod
 *   is not running inside a cluster, or the service-account token is
 *   missing/invalid). The original `KubeConfig` error is wrapped with
 *   context to make the failure mode obvious in logs.
 */
function loadK8sClient() {
  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
  } catch (err) {
    throw new Error(
      'Failed to load in-cluster Kubernetes config. ' +
        'Ensure the Pod is running inside a cluster with a mounted ' +
        'service-account token at ' +
        '/var/run/secrets/kubernetes.io/serviceaccount/. ' +
        `Underlying error: ${err.message}`,
    );
  }
  const core = kc.makeApiClient(CoreV1Api);
  return {
    pods: core,
    configMaps: core,
  };
}

module.exports = { loadK8sClient };