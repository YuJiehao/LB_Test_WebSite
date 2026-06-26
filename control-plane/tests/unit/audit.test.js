'use strict';

jest.mock('../../src/config', () => ({
  AUDIT_BUFFER_SIZE: 200,
}));

const { recordAudit, getAudit, resetAudit } = require('../../src/events/audit');

describe('Audit ring buffer', () => {
  beforeEach(() => {
    resetAudit();
  });

  test('recordAudit(entry) adds to buffer and getAudit returns it', () => {
    const entry = { action: 'fault.apply', target: { type: 'all' }, mode: 'http_500' };
    recordAudit(entry);

    const result = getAudit();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'fault.apply',
      target: { type: 'all' },
      mode: 'http_500',
    });
  });

  test('getAudit(limit) returns at most `limit` most recent entries', () => {
    // Insert 10 entries, request limit=3
    for (let i = 0; i < 10; i++) {
      recordAudit({ action: 'test', index: i });
    }

    const result = getAudit(3);
    expect(result).toHaveLength(3);
    // Most recent entries: indices 9, 8, 7
    expect(result[0].index).toBe(9);
    expect(result[1].index).toBe(8);
    expect(result[2].index).toBe(7);
  });

  test('buffer caps at 200 — the 201st evicts the oldest', () => {
    // Insert 201 entries
    for (let i = 0; i < 201; i++) {
      recordAudit({ action: 'test', index: i });
    }

    const result = getAudit();
    expect(result).toHaveLength(200);
    // The oldest kept entry is index 1 (index 0 was evicted)
    expect(result[result.length - 1].index).toBe(1);
    expect(result[0].index).toBe(200);
  });
});
