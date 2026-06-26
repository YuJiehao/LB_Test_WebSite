'use strict';

/**
 * App-side ConfigMap watch via K8s informer pattern.
 *
 * Watches the Pod's own `fault-state-<podName>` ConfigMap and calls
 * `onChange({mode, slowDelayMs})` on every MODIFIED event.
 *
 * Reconnects with exponential backoff on watch failure (e.g. API server
 * restart, network blip).
 */

const { KubeConfig, CoreV1Api, Watch } = require('@kubernetes/client-node');

/**
 * Watch the Pod's fault-state ConfigMap for changes.
 *
 * The watcher runs indefinitely until `stop()` is called on the returned
 * handle. On watch failure (connection closed, timeout, error), the
 * watcher reconnects with exponential backoff up to 30s.
 *
 * @param {string} podName — The Pod name (e.g. from `POD_NAME` env var).
 * @param {CoreV1Api} [k8sClient] — Optional pre-built client.
 * @param {function({mode: string, slowDelayMs: number}): void} onChange —
 *   Called whenever the ConfigMap `data` changes.
 * @returns {{stop: () => void}} Handle to stop watching.
 */
function watchFaultState(podName, k8sClient, onChange) {
  const namespace = process.env.NAMESPACE || 'default';
  const name = `fault-state-${podName}`;

  let client = k8sClient;
  let kubeConfig = null; // kept for Watch constructor (needs KubeConfig, not CoreV1Api)
  let stopped = false;
  let failures = 0;

  async function connect() {
    if (stopped) return;

    // Lazy client creation.
    if (!client) {
      kubeConfig = new KubeConfig();
      kubeConfig.loadFromCluster();
      client = kubeConfig.makeApiClient(CoreV1Api);
    }

    try {
      // Watch constructor requires a KubeConfig instance for
      // getCurrentCluster() / applyToRequest(), not a CoreV1Api.
      const watch = new Watch(kubeConfig);
      const path = `/api/v1/namespaces/${namespace}/configmaps`;

      // List once to get the initial resourceVersion, then watch from there.
      // `@kubernetes/client-node@0.22.3` uses positional args and wraps the
      // response as `{response, body}`; pass args in the documented order
      // and read the resourceVersion from `body.metadata`.
      const listResp = await client.listNamespacedConfigMap(
        namespace,         // namespace (required)
        undefined,         // pretty
        undefined,         // allowWatchBookmarks
        undefined,         // _continue
        `metadata.name=${name}`, // fieldSelector
        undefined,         // labelSelector
        undefined          // limit
      );
      const listBody = (listResp && listResp.body) || listResp || {};
      const resourceVersion =
        listBody.metadata && listBody.metadata.resourceVersion;

      const req = await watch.watch(
        path,
        { resourceVersion },
        (type, apiObj) => {
          if (stopped) return;
          if (type !== 'MODIFIED') return;
          if (!apiObj || !apiObj.data) return;
          onChange({
            mode: apiObj.data.mode || 'none',
            slowDelayMs: parseInt(apiObj.data.slowDelayMs, 10) || 0,
          });
        },
        () => {
          // Done callback — watch ended, reconnect.
          if (!stopped) {
            failures = 0; // Normal close, reset backoff.
            connect();
          }
        }
      );

      // Store the watch request so we can abort it on stop().
      return req;
    } catch (err) {
      if (stopped) return;
      failures++;
      const delay = Math.min(1000 * Math.pow(2, failures - 1), 30000);
      setTimeout(connect, delay);
    }
  }

  connect();

  return {
    stop() {
      stopped = true;
    },
  };
}

module.exports = { watchFaultState };
