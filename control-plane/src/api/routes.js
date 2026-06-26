'use strict';

const express = require('express');
const { applyFault } = require('../fault/apply');
const { listPods } = require('../k8s/pods');

const POD_APP_LABEL = 'app=load-balancer-test';

const VALID_MODES = ['none', 'http_500', 'http_503', 'slow', 'wrong_body', 'reset'];
const VALID_TARGET_TYPES = ['all', 'single', 'selector', 'canary'];

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
//  Route mounting
// ---------------------------------------------------------------------------

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
