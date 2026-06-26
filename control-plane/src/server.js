const express = require('express');
const { PORT, NAMESPACE } = require('./config');
const { mountRoutes } = require('./api/routes');
const { loadK8sClient } = require('./k8s/client');
const { basicAuthMiddleware } = require('./auth');
const { reconcileOnStartup } = require('./k8s/configmaps');
const { startPollingLoop } = require('./fault/poll');
const { bus } = require('./events/bus');

const app = express();

// Health check — intentionally before auth middleware so K8s probes
// (which hit the Pod directly, not through the Ingress) can pass.
app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('OK');
});

// HTTP Basic Authentication (defense-in-depth).
// When BASIC_AUTH_USER env is not set, the middleware is a no-op (dev mode).
app.use(basicAuthMiddleware);

async function start() {
  let client;
  let pollingLoop;

  try {
    client = loadK8sClient();
    mountRoutes(app, { client, namespace: NAMESPACE });
    console.log(`control-plane: K8s client loaded, routes mounted (namespace=${NAMESPACE})`);
  } catch (err) {
    console.warn(`control-plane: K8s client not available — routes not mounted (${err.message})`);
  }

  // Reconcile ConfigMaps: ensure every Pod has a fault-state ConfigMap.
  if (client) {
    try {
      const result = await reconcileOnStartup(client, NAMESPACE);
      console.log(
        `control-plane: reconcile complete — created=${result.created.length} skipped=${result.skipped.length} errors=${result.errors.length}`
      );
      if (result.errors.length > 0) {
        console.warn(`control-plane: reconcile errors: ${JSON.stringify(result.errors)}`);
      }
    } catch (err) {
      console.warn(`control-plane: reconcile failed (${err.message}) — continuing`);
    }

    // Start background drift-detection polling loop.
    pollingLoop = startPollingLoop({ client, namespace: NAMESPACE, bus });
    console.log(`control-plane: drift-detection polling loop started`);
  }

  const server = app.listen(PORT, () => {
    console.log(`control-plane listening on port ${PORT}`);
  });

  // Graceful shutdown on SIGTERM/SIGINT.
  const shutdown = (signal) => {
    console.log(`control-plane: received ${signal}, shutting down gracefully`);
    if (pollingLoop) pollingLoop.stop();
    server.close(() => {
      console.log('control-plane: server closed');
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs.
    setTimeout(() => {
      console.warn('control-plane: forced shutdown after 10s');
      process.exit(1);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start();
}

module.exports = { app, mountRoutes, start };
