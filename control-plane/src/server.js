const express = require('express');
const { PORT, NAMESPACE } = require('./config');
const { mountRoutes } = require('./api/routes');
const { loadK8sClient } = require('./k8s/client');

const app = express();

app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('OK');
});

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
