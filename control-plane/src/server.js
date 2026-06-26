const express = require('express');
const { PORT, NAMESPACE } = require('./config');
const { mountRoutes } = require('./api/routes');
const { loadK8sClient } = require('./k8s/client');
const { basicAuthMiddleware } = require('./auth');

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
  try {
    const client = loadK8sClient();
    mountRoutes(app, { client, namespace: NAMESPACE });
    console.log(`control-plane: K8s client loaded, routes mounted (namespace=${NAMESPACE})`);
  } catch (err) {
    console.warn(`control-plane: K8s client not available — routes not mounted (${err.message})`);
  }
  app.listen(PORT, () => {
    console.log(`control-plane listening on port ${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, mountRoutes, start };
