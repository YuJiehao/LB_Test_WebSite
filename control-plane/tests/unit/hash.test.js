'use strict';

/**
 * Unit tests for src/util/hash.js
 *
 * The hash is the foundation of deterministic canary selection, so
 * these are kept tiny but cover the contract:
 *   - deterministic: same input → same output
 *   - non-empty input → non-zero output (sanity)
 *   - empty / non-string input → 0 (documented default)
 */

describe('hashCode()', () => {
  const { hashCode } = require('../../src/util/hash');

  test('is deterministic for the same input', () => {
    expect(hashCode('web-0')).toBe(hashCode('web-0'));
    expect(hashCode('lb-test-web-1')).toBe(hashCode('lb-test-web-1'));
  });

  test('returns 0 for empty / non-string input', () => {
    expect(hashCode('')).toBe(0);
    expect(hashCode(null)).toBe(0);
    expect(hashCode(undefined)).toBe(0);
    expect(hashCode(123)).toBe(0);
  });

  test('returns an integer for typical inputs', () => {
    const h = hashCode('web-2');
    expect(Number.isInteger(h)).toBe(true);
  });
});