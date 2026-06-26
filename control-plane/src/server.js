const express = require('express');
const { PORT } = require('./config');
const { mountRoutes } = require('./api/routes');

const app = express();

app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('OK');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`control-plane listening on port ${PORT}`);
  });
}

module.exports = { app };