'use strict';

const { KubeConfig, CoreV1Api } = require('@kubernetes/client-node');

/**
 * Build a Kubernetes API client using in-cluster configuration.
 *
 * Must be called from inside a Pod that has a service-account token mounted
 * at /var/run/secrets/kubernetes.io/serviceaccount/token (the default when
 * `automountServiceAccountToken: true`).
 *
 * The returned object exposes two namespaces:
 *   - `pods`:        CoreV1Api — used to list/get/delete Pods (Phase 3).
 *   - `configMaps`:  CoreV1Api — used to read the LB config ConfigMap (Phase 2).
 *
 * Both namespaces share the same CoreV1Api instance because both Pod and
 * ConfigMap resources live in the core/v1 API group.
 *
 * @returns {{ pods: CoreV1Api, configMaps: CoreV1Api }}
 */
function loadK8sClient() {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  const core = kc.makeApiClient(CoreV1Api);
  return {
    pods: core,
    configMaps: core,
  };
}

module.exports = { loadK8sClient };