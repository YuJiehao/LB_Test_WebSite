'use strict';

/**
 * Single source of truth for K8s label conventions used by the
 * control plane and its target workloads.
 *
 * Kept as a tiny constants module so the label strings cannot drift
 * between `configmaps.js`, `pods.js`, the polling loop, the reconcile
 * path, and the K8s manifest templates. Tests that need to assert
 * "the right selector was used" import from here.
 *
 * YAGNI: when a real second label appears (e.g. `region=cn-east-1` for
 * a multi-region rollout), add it here. Don't pre-declare labels no
 * caller is asking for.
 */

/**
 * Label applied to every fault-state ConfigMap. Format: `key=value` so
 * the constant can be passed directly as `labelSelector` to the K8s
 * API.
 *
 * @type {string}
 */
const FAULT_STATE_LABEL = 'role=fault-state';

/**
 * Label key for the `role` half of FAULT_STATE_LABEL. Kept separate
 * so client-side filtering (which compares against the key, not the
 * full selector string) does not need to parse the string.
 *
 * @type {string}
 */
const ROLE_KEY = 'role';

/**
 * Value paired with ROLE_KEY on fault-state ConfigMaps.
 *
 * @type {string}
 */
const FAULT_STATE_VALUE = 'fault-state';

/**
 * Prefix used to derive a fault-state ConfigMap name from a Pod name.
 * Per the design doc: every LB_Test_WebSite Pod has a companion
 * ConfigMap named `fault-state-<pod-name>`.
 *
 * @type {string}
 */
const FAULT_STATE_NAME_PREFIX = 'fault-state-';

module.exports = {
  FAULT_STATE_LABEL,
  ROLE_KEY,
  FAULT_STATE_VALUE,
  FAULT_STATE_NAME_PREFIX,
};
