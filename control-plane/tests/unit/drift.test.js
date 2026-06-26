'use strict';

/**
 * Unit tests for detectDrift — pure function comparing desired (ConfigMap)
 * state against actual (Pod memory) state.
 */

describe('detectDrift()', () => {
  const MATCH = { mode: 'http_500', slowDelayMs: 4000, updatedBy: 'control-plane' };

  test('returns {drift: true, field: "mode"} when modes differ', () => {
    const { detectDrift } = require('../../src/fault/poll');
    const actual = { ...MATCH, mode: 'none' };
    expect(detectDrift(MATCH, actual)).toEqual({ drift: true, field: 'mode' });
  });

  test('returns {drift: true, field: "slowDelayMs"} when slowDelayMs differ', () => {
    const { detectDrift } = require('../../src/fault/poll');
    const actual = { ...MATCH, slowDelayMs: 8000 };
    expect(detectDrift(MATCH, actual)).toEqual({ drift: true, field: 'slowDelayMs' });
  });

  test('returns {drift: false} when mode and slowDelayMs match', () => {
    const { detectDrift } = require('../../src/fault/poll');
    expect(detectDrift(MATCH, { ...MATCH })).toEqual({ drift: false });
  });

  test('returns {drift: false} when actual updatedBy starts with "reconciled:"', () => {
    const { detectDrift } = require('../../src/fault/poll');
    // Pod has a different mode, but the change was authored by the control
    // plane's own reconciliation — not an external actor. Drift detection
    // must suppress the alert so the loop doesn't oscillate.
    const actual = { mode: 'reset', slowDelayMs: 0, updatedBy: 'reconciled:drift-fix' };
    expect(detectDrift(MATCH, actual)).toEqual({ drift: false });
  });

  test('returns {drift: true} when updatedBy is "control-plane" but fields differ', () => {
    const { detectDrift } = require('../../src/fault/poll');
    // The control-plane itself changed the Pod (via direct HTTP), but the
    // mode no longer matches the ConfigMap desired state — still drift.
    const actual = { mode: 'http_503', slowDelayMs: MATCH.slowDelayMs, updatedBy: 'control-plane' };
    expect(detectDrift(MATCH, actual)).toEqual({ drift: true, field: 'mode' });
  });
});
