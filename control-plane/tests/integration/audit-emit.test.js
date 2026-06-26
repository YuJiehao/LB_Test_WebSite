'use strict';

/**
 * Integration tests for audit emission from applyFault.
 *
 * Verifies that when applyFault is invoked:
 * 1. recordAudit is called with the correct entry shape
 * 2. An audit_event is emitted on the internal bus
 */

jest.mock('../../src/fault/targets', () => ({
  selectTargets: jest.fn(),
}));

jest.mock('../../src/k8s/configmaps', () => ({
  patchFaultState: jest.fn(),
  getFaultStateConfigMap: jest.fn(),
}));

// Mock audit module so we can spy on recordAudit calls
const mockRecordAudit = jest.fn();
jest.mock('../../src/events/audit', () => ({
  recordAudit: mockRecordAudit,
  getAudit: jest.fn(() => []),
  resetAudit: jest.fn(),
}));

const { bus } = require('../../src/events/bus');
const { applyFault } = require('../../src/fault/apply');
const { selectTargets } = require('../../src/fault/targets');
const { patchFaultState, getFaultStateConfigMap } = require('../../src/k8s/configmaps');

describe('applyFault audit emission', () => {
  const NAMESPACE = 'default';
  const MODE = 'http_500';
  const SLOW_DELAY_MS = 0;
  const CTX = {
    client: {},
    namespace: NAMESPACE,
    pods: [
      { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' },
    ],
  };
  const TARGET = { type: 'all' };

  beforeEach(() => {
    jest.clearAllMocks();
    selectTargets.mockResolvedValue(CTX.pods);
    getFaultStateConfigMap.mockResolvedValue({
      name: 'fault-state-web-0',
      podName: 'web-0',
      mode: 'none',
      slowDelayMs: 0,
      resourceVersion: '1',
    });
    patchFaultState.mockResolvedValue({
      name: 'fault-state-web-0',
      podName: 'web-0',
      mode: MODE,
      slowDelayMs: SLOW_DELAY_MS,
      resourceVersion: '2',
    });
  });

  test('recordAudit is called with correct shape on successful apply', async () => {
    await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);

    const entry = mockRecordAudit.mock.calls[0][0];
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('actor');
    expect(entry).toHaveProperty('action', 'fault.apply');
    expect(entry).toHaveProperty('target', TARGET);
    expect(entry).toHaveProperty('mode', MODE);
    expect(entry).toHaveProperty('result');
    expect(entry.result).toMatchObject({
      applied: ['web-0'],
      skipped: [],
      errors: [],
    });
    // Verify timestamp is ISO format
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  test('bus emits audit_event after successful apply', async () => {
    const emittedEvents = [];
    const handler = (payload) => {
      emittedEvents.push(payload);
    };
    bus.on('audit_event', handler);

    await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toHaveProperty('action', 'fault.apply');
    expect(emittedEvents[0].result.applied).toContain('web-0');

    bus.off('audit_event', handler);
  });

  test('recordAudit and bus emit are called even when some patches fail', async () => {
    const pods = [
      { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' },
      { name: 'web-1', ip: '10.0.0.2', nodeName: 'node-b' },
    ];
    selectTargets.mockResolvedValue(pods);
    getFaultStateConfigMap.mockResolvedValue({
      name: 'fault-state-x',
      podName: 'x',
      mode: 'none',
      slowDelayMs: 0,
      resourceVersion: '1',
    });
    patchFaultState
      .mockResolvedValueOnce({
        name: 'fault-state-web-0',
        podName: 'web-0',
        mode: MODE,
        slowDelayMs: SLOW_DELAY_MS,
        resourceVersion: '2',
      })
      .mockRejectedValueOnce(new Error('patch failed'));

    const emittedEvents = [];
    const handler = (payload) => emittedEvents.push(payload);
    bus.on('audit_event', handler);

    const result = await applyFault(TARGET, MODE, SLOW_DELAY_MS, { ...CTX, pods });

    // recordAudit was called
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const entry = mockRecordAudit.mock.calls[0][0];
    expect(entry.result.applied).toEqual(['web-0']);
    expect(entry.result.errors).toHaveLength(1);
    expect(entry.result.errors[0].podName).toBe('web-1');

    // Bus emitted the event
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].result.errors[0].podName).toBe('web-1');

    bus.off('audit_event', handler);
  });
});
