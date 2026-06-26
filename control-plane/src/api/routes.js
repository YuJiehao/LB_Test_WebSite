'use strict';

const express = require('express');
const { applyFault } = require('../fault/apply');
const { listPods } = require('../k8s/pods');

const POD_APP_LABEL = 'app=load-balancer-test';

const VALID_MODES = ['none', 'http_500', 'http_503', 'slow', 'wrong_body', 'reset'];
const VALID_TARGET_TYPES = ['all', 'single', 'selector', 'canary'];

/**
 * Mount fault-apply REST routes on an Express app.
 *
 * @param {import('express').Express} app - Express application instance.
 * @param {{client: object, namespace: string}} opts
 *   K8s client handle and target namespace.
 */
function mountRoutes(app, opts) {
  const { client, namespace } = opts;

  app.use(express.json());

  // -----------------------------------------------------------------------
  //  POST /api/fault/apply
  // -----------------------------------------------------------------------
  app.post('/api/fault/apply', async (req, res) => {
    try {
      const { target, mode, slowDelayMs = 0 } = req.body || {};

      // -- validation -----------------------------------------------------

      if (!mode || !VALID_MODES.includes(mode)) {
        return res.status(400).json({
          error: `Invalid or missing mode. Must be one of: ${VALID_MODES.join(', ')}`,
        });
      }

      if (!target || !target.type) {
        return res.status(400).json({ error: 'Missing target or target.type' });
      }

      if (!VALID_TARGET_TYPES.includes(target.type)) {
        return res.status(400).json({
          error: `Invalid target.type. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
        });
      }

      if (target.type === 'single') {
        if (typeof target.pod !== 'string' || target.pod.length === 0) {
          return res.status(400).json({ error: 'target.pod is required for single target' });
        }
      }

      if (target.type === 'selector') {
        if (typeof target.selector !== 'string' || target.selector.length === 0) {
          return res.status(400).json({ error: 'target.selector is required for selector target' });
        }
      }

      if (target.type === 'canary') {
        if (typeof target.percent !== 'number' || target.percent < 0 || target.percent > 100) {
          return res.status(400).json({ error: 'target.percent (0-100) is required for canary target' });
        }
      }

      // -- execute --------------------------------------------------------

      const pods = await listPods(client, POD_APP_LABEL, namespace);
      const result = await applyFault(target, mode, slowDelayMs, {
        client,
        namespace,
        pods,
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
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });
}

module.exports = { mountRoutes };
