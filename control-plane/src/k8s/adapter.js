'use strict';

/**
 * Thin compatibility adapter for `@kubernetes/client-node@0.22.3`.
 *
 * The library in 0.22.x uses:
 *   1. **Positional** parameters (e.g. `listNamespacedPod(namespace, pretty,
 *      ..., labelSelector, ...)`) — NOT named-parameter objects.
 *   2. **Wrapped** responses (`{ response: {statusCode, headers}, body: {...} }`)
 *      — NOT bare objects where `body.items` is at the top level.
 *
 * The rest of the control plane is written against a later API style where
 * the call takes `{namespace, labelSelector}` and returns `{items}` directly.
 * This adapter bridges the gap so call sites stay readable and unit tests
 * can keep mocking the high-level shape (`{items: [...]}`) — the adapter
 * falls back to `r.items` when `r.body.items` is missing.
 *
 * YAGNI: only the methods actually used by the control plane are wrapped.
 * Add a wrapper here as new methods are introduced.
 */

/**
 * Unwrap a `{response, body}` envelope or accept a bare object.
 *
 * Real `@kubernetes/client-node@0.22.3` returns `{response, body: {...}}`
 * where `body` carries the parsed payload. Older code paths (and test
 * mocks) may return the payload directly. This helper picks the right one.
 *
 * @param {object} r
 * @returns {object} the payload object
 */
function unwrap(r) {
  if (!r) return {};
  if (r.body && typeof r.body === 'object') return r.body;
  return r;
}

/**
 * Call `listNamespacedPod` with positional args and unwrap the response.
 *
 * @param {{pods: {listNamespacedPod: Function}}} client
 * @param {string} namespace
 * @param {string} [labelSelector]
 * @returns {Promise<Array>} the `items` array (possibly empty)
 */
async function listPods(client, namespace, labelSelector) {
  const r = await client.pods.listNamespacedPod(
    namespace,         // namespace (required)
    undefined,         // pretty
    undefined,         // allowWatchBookmarks
    undefined,         // _continue
    undefined,         // fieldSelector
    labelSelector,     // labelSelector
    undefined,         // limit
    undefined,         // resourceVersion
    undefined,         // resourceVersionMatch
    undefined,         // sendInitialEvents
    undefined,         // timeoutSeconds
    undefined          // watch
  );
  const body = unwrap(r);
  return (body && body.items) || [];
}

/**
 * Call `listNamespacedConfigMap` with positional args and unwrap the response.
 *
 * @param {{configMaps: {listNamespacedConfigMap: Function}}} client
 * @param {string} namespace
 * @param {string} [labelSelector]
 * @returns {Promise<Array>} the `items` array (possibly empty)
 */
async function listConfigMaps(client, namespace, labelSelector) {
  const r = await client.configMaps.listNamespacedConfigMap(
    namespace,
    undefined,         // pretty
    undefined,         // allowWatchBookmarks
    undefined,         // _continue
    undefined,         // fieldSelector
    labelSelector,
    undefined,         // limit
    undefined,         // resourceVersion
    undefined,         // resourceVersionMatch
    undefined,         // sendInitialEvents
    undefined,         // timeoutSeconds
    undefined          // watch
  );
  const body = unwrap(r);
  return (body && body.items) || [];
}

/**
 * Call `createNamespacedConfigMap` with positional args and return the
 * created ConfigMap body.
 *
 * @param {{configMaps: {createNamespacedConfigMap: Function}}} client
 * @param {string} namespace
 * @param {object} body  The ConfigMap payload (apiVersion/kind/metadata/data).
 * @returns {Promise<object>} the created ConfigMap
 */
async function createConfigMap(client, namespace, body) {
  const r = await client.configMaps.createNamespacedConfigMap(
    namespace,         // namespace (required)
    body,              // body
    undefined,         // pretty
    undefined,         // dryRun
    undefined,         // fieldManager
    undefined,         // fieldValidation
    { headers: { 'Content-Type': 'application/json' } }
  );
  return unwrap(r);
}

/**
 * Call `readNamespacedConfigMap` with positional args.
 *
 * @param {{configMaps: {readNamespacedConfigMap: Function}}} client
 * @param {string} namespace
 * @param {string} name
 * @returns {Promise<object>} the ConfigMap body
 */
async function readConfigMap(client, namespace, name) {
  const r = await client.configMaps.readNamespacedConfigMap(
    name,              // name (required)  — note: comes BEFORE namespace in 0.22.x
    namespace,         // namespace (required)
    undefined          // pretty
  );
  return unwrap(r);
}

/**
 * Call `patchNamespacedConfigMap` with positional args.
 *
 * @param {{configMaps: {patchNamespacedConfigMap: Function}}} client
 * @param {string} namespace
 * @param {string} name
 * @param {object} body  The patch payload.
 * @param {object} [opts]
 * @param {string} [opts.contentType]  Defaults to `application/merge-patch+json`.
 * @returns {Promise<object>} the updated ConfigMap body
 */
async function patchConfigMap(client, namespace, name, body, opts) {
  const contentType = (opts && opts.contentType) || 'application/merge-patch+json';
  const r = await client.configMaps.patchNamespacedConfigMap(
    name,              // name (required)  — note: comes BEFORE namespace in 0.22.x
    namespace,         // namespace (required)
    body,              // body
    undefined,         // pretty
    undefined,         // dryRun
    undefined,         // fieldManager
    undefined,         // fieldValidation
    undefined,         // force
    { headers: { 'Content-Type': contentType } }
  );
  return unwrap(r);
}

module.exports = {
  listPods,
  listConfigMaps,
  createConfigMap,
  readConfigMap,
  patchConfigMap,
};
