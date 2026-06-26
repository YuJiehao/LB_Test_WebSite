'use strict';

const path = require('path');
const os = require('os');
const express = require('express');
const { applyFault } = require('../fault/apply');
const { listPods } = require('../k8s/pods');
const { listFaultStateConfigMaps } = require('../k8s/configmaps');
const { createSseHandler } = require('../events/sse');
const { bus } = require('../events/bus');

const POD_APP_LABEL = 'app=load-balancer-test';

const VALID_MODES = ['none', 'http_500', 'http_503', 'slow', 'wrong_body', 'reset'];
const VALID_TARGET_TYPES = ['all', 'single', 'selector', 'canary'];

const PKG = require(path.resolve(__dirname, '../../package.json'));

// ---------------------------------------------------------------------------
//  Boot-time helpers
// ---------------------------------------------------------------------------

/**
 * Format seconds into a human-readable uptime string.
 *
 * @param {number} seconds - elapsed seconds
 * @returns {string} e.g. "2h 13m", "45m 12s", "9s"
 */
function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${secs}s`;
  return `${secs}s`;
}

// ---------------------------------------------------------------------------
//  Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a target sub-object for per-type required fields.
 *
 * @param {{type: string, [k: string]: any}} target
 * @returns {{valid: true} | {valid: false, error: string}}
 */
function validateTarget(target) {
  if (!VALID_TARGET_TYPES.includes(target.type)) {
    return {
      valid: false,
      error: `Invalid target.type. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
    };
  }

  if (target.type === 'single') {
    if (typeof target.pod !== 'string' || target.pod.length === 0) {
      return { valid: false, error: 'target.pod is required for single target' };
    }
  }

  if (target.type === 'selector') {
    if (typeof target.selector !== 'string' || target.selector.length === 0) {
      return { valid: false, error: 'target.selector is required for selector target' };
    }
  }

  if (target.type === 'canary') {
    if (typeof target.percent !== 'number' || target.percent < 0 || target.percent > 100) {
      return { valid: false, error: 'target.percent (0-100) is required for canary target' };
    }
  }

  return { valid: true };
}

/**
 * Validate a full apply request body.
 *
 * Checks that both `mode` and `target` / `target.type` are present and
 * legal, then delegates per-type target field rules to {@link validateTarget}.
 *
 * @param {{target?: {type?: string, [k: string]: any}, mode?: string}} body
 * @returns {{valid: true} | {valid: false, error: string}}
 */
function validateApplyBody(body) {
  const { target, mode } = body || {};

  if (!mode || !VALID_MODES.includes(mode)) {
    return {
      valid: false,
      error: `Invalid or missing mode. Must be one of: ${VALID_MODES.join(', ')}`,
    };
  }

  if (!target || !target.type) {
    return { valid: false, error: 'Missing target or target.type' };
  }

  return validateTarget(target);
}

// ---------------------------------------------------------------------------
//  Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware that sets res.locals.appInfo for all EJS templates (footer etc.).
 */
function appInfoMiddleware(req, res, next) {
  res.locals.appInfo = {
    name: PKG.name,
    version: PKG.version,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    hostname: os.hostname(),
    uptime: formatUptime(process.uptime()),
  };
  next();
}

// ---------------------------------------------------------------------------
//  Route mounting
// ---------------------------------------------------------------------------

/**
 * Mount all control-plane routes on an Express app.
 *
 * Sets up the EJS view engine, static file serving, app-information
 * middleware, the dashboard page, the fault-apply REST endpoints, and
 * the real-time SSE event stream.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {{client: object, namespace: string}} opts
 *   K8s client handle and target namespace.
 */
function mountRoutes(app, opts) {
  const { client, namespace } = opts;

  // ---- View engine & static files ----------------------------------------
  app.set('view engine', 'ejs');
  app.set('views', path.resolve(__dirname, '../../views'));
  // Serve shared static assets from the root app's public/ directory
  app.use(express.static(path.resolve(__dirname, '../../../public')));

  // ---- App-info middleware for EJS templates ------------------------------
  app.use(appInfoMiddleware);

  // ---- JSON body parser for API routes ------------------------------------
  app.use(express.json());

  // Extract actor from request (placeholder until Basic Auth in Phase 6)
  function extractActor(req) {
    return req.headers['x-actor'] || req.body.actor || 'system';
  }

  // -----------------------------------------------------------------------
  //  GET /  Dashboard
  // -----------------------------------------------------------------------
  app.get('/', async (req, res) => {
    try {
      let pods = [];
      try {
        const rawPods = await listPods(client, POD_APP_LABEL, namespace);
        const configMaps = await listFaultStateConfigMaps(client, namespace);

        pods = rawPods.map((pod) => {
          const cm = configMaps.find((c) => c.podName === pod.name);
          return {
            name: pod.name,
            ip: pod.ip,
            nodeName: pod.nodeName,
            mode: cm ? cm.mode : 'none',
            slowDelayMs: cm ? cm.slowDelayMs : 0,
            resourceVersion: cm ? cm.resourceVersion : null,
          };
        });
      } catch (_) {
        // K8s not available — render empty dashboard
      }

      res.render('dashboard', {
        title: 'LB Fault Control Plane',
        active: '',
        serverIP: '',
        pods,
        labelSelector: POD_APP_LABEL,
      });
    } catch (err) {
      res.status(500).type('text/plain').send(err.message);
    }
  });

  // -----------------------------------------------------------------------
  //  GET /api/events  SSE stream
  // -----------------------------------------------------------------------
  app.get('/api/events', createSseHandler(bus));

  // -----------------------------------------------------------------------
  //  POST /api/fault/apply
  // -----------------------------------------------------------------------
  app.post('/api/fault/apply', async (req, res) => {
    try {
      const validation = validateApplyBody(req.body);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const { target, mode, slowDelayMs = 0 } = req.body;

      const pods = await listPods(client, POD_APP_LABEL, namespace);
      const result = await applyFault(target, mode, slowDelayMs, {
        client,
        namespace,
        pods,
        actor: extractActor(req),
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  // -----------------------------------------------------------------------
  //  POST /api/fault/reset
  // -----------------------------------------------------------------------
  app.post('/api/fault/reset', async (req, res) => {
    try {
      const pods = await listPods(client, POD_APP_LABEL, namespace);
      const result = await applyFault({ type: 'all' }, 'none', 0, {
        client,
        namespace,
        pods,
        actor: extractActor(req),
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });
}

module.exports = { mountRoutes };
