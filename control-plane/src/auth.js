'use strict';

/**
 * Express middleware enforcing HTTP Basic Authentication.
 *
 * Reads credentials from environment variables:
 *   - `BASIC_AUTH_USER` — required to activate auth
 *   - `BASIC_AUTH_PASS` — corresponding password
 *
 * When `BASIC_AUTH_USER` is not set, the middleware is a no-op (dev mode).
 * When set, every request must carry a valid `Authorization: Basic …` header
 * matching the configured credentials, or the middleware responds 401 with
 * a `WWW-Authenticate` header.
 *
 * @returns {import('express').RequestHandler}
 */
function basicAuthMiddleware(req, res, next) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS || '';

  // Dev mode — no auth required
  if (!user) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="LB Fault Control Plane"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  const base64 = authHeader.slice(6).trim();
  let decoded;

  try {
    decoded = Buffer.from(base64, 'base64').toString('utf-8');
  } catch (_) {
    res.set('WWW-Authenticate', 'Basic realm="LB Fault Control Plane"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    res.set('WWW-Authenticate', 'Basic realm="LB Fault Control Plane"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  const requestUser = decoded.slice(0, colonIdx);
  const requestPass = decoded.slice(colonIdx + 1);

  if (requestUser !== user || requestPass !== pass) {
    res.set('WWW-Authenticate', 'Basic realm="LB Fault Control Plane"');
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  next();
}

module.exports = { basicAuthMiddleware };
