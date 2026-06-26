'use strict';

/**
 * Stable integer hash for a string (Java's `String.hashCode` flavor).
 *
 * Used by canary target selection so the same pod name always lands in
 * the same bucket across requests — required for canary to be a
 * meaningful, reproducible subset.
 *
 * Returns a signed 32-bit integer. Not cryptographic; intended only
 * for deterministic bucketing.
 *
 * @param {string} str
 * @returns {number}
 */
function hashCode(str) {
  let hash = 0;
  if (typeof str !== 'string' || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

module.exports = { hashCode };