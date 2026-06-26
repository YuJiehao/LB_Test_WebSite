'use strict';

/**
 * App-side ConfigMap read on startup.
 *
 * Called before `server.listen()` in app.js to load the Pod's initial
 * fault state from its `fault-state-<podName>` ConfigMap.
 *
 * YAGNI: only the Pod's OWN ConfigMap is read — the app has no reason
 * to read other Pods' state.
 */

const { KubeConfig, CoreV1Api } = require('@kubernetes/client-node');

/**
 * Build a K8s API client using in-cluster configuration.
 *
 * @returns {CoreV1Api}
 * @throws {Error} If not running inside a cluster.
 */
function loadK8sClient() {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(CoreV1Api);
}

/**
 * Read the Pod's fault-state ConfigMap at startup.
 *
 * @param {string} podName — The Pod name (e.g. from `POD_NAME` env var).
 * @param {CoreV1Api} [k8sClient] — Optional pre-built client; creates one if omitted.
 * @returns {Promise<{mode: string, slowDelayMs: number} | null>}
 *   The fault state, or `null` if the ConfigMap does not exist.
 */
async function loadInitialFaultState(podName, k8sClient) {
  const client = k8sClient || loadK8sClient();
  const namespace = process.env.NAMESPACE || 'default';
  const name = `fault-state-${podName}`;

  try {
    // `@kubernetes/client-node@0.22.3` uses positional args and wraps the
    // response as `{response, body}`. The 0.22.x positional order for
    // `readNamespacedConfigMap` is (name, namespace, pretty, options).
    const response = await client.readNamespacedConfigMap(
      name,              // name (required)
      namespace,         // namespace (required)
      undefined          // pretty
    );
    const body = (response && response.body) || response || {};
    const data = (body && body.data) || {};
    return {
      mode: data.mode || 'none',
      slowDelayMs: parseInt(data.slowDelayMs, 10) || 0,
    };
  } catch (err) {
    if (err && (err.statusCode === 404 || err.response?.statusCode === 404)) {
      return null; // ConfigMap not found — app uses defaults
    }
    throw err;
  }
}

module.exports = { loadInitialFaultState, loadK8sClient };
