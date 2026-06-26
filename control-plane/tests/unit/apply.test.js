'use strict';

/**
 * Unit tests for src/fault/apply.js#applyFault
 *
 * Mocks selectTargets, getFaultStateConfigMap and patchFaultState at
 * module boundaries so the orchestrator logic — target selection,
 * concurrency control, partial-failure aggregation, and empty-target
 * handling — can be exercised without a live cluster.
 */

jest.mock('../../src/fault/targets', () => ({
  selectTargets: jest.fn(),
}));

jest.mock('../../src/k8s/configmaps', () => ({
  patchFaultState: jest.fn(),
  getFaultStateConfigMap: jest.fn(),
}));

const { applyFault } = require('../../src/fault/apply');
const { selectTargets } = require('../../src/fault/targets');
const { patchFaultState, getFaultStateConfigMap } = require('../../src/k8s/configmaps');

describe('applyFault()', () => {
  const NAMESPACE = 'default';
  const MODE = 'http_500';
  const SLOW_DELAY_MS = 0;
  const TIMEOUT_MS = 5000;
  const CTX = {
    client: {},
    namespace: NAMESPACE,
    pods: [
      { name: 'test-0', ip: '10.0.0.1', nodeName: 'node-a' },
      { name: 'test-1', ip: '10.0.0.2', nodeName: 'node-b' },
    ],
    updatedBy: 'admin@lb-test',
  };
  const TARGET = { type: 'all' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function podFixture(name) {
    return { name, ip: '10.0.0.1', nodeName: 'node-x' };
  }

  function cmFixture(podName) {
    return {
      name: 'fault-state-' + podName,
      podName,
      mode: 'none',
      slowDelayMs: 0,
      resourceVersion: '1',
    };
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  test('happy path: selects targets and patches all of them', async () => {
    const pods = [podFixture('web-0'), podFixture('web-1'), podFixture('web-2')];
    selectTargets.mockResolvedValue(pods);
    getFaultStateConfigMap.mockResolvedValue(cmFixture('ignored'));
    patchFaultState.mockImplementation((_client, _ns, podName) =>
      Promise.resolve({
        name: 'fault-state-' + podName,
        podName,
        mode: MODE,
        slowDelayMs: SLOW_DELAY_MS,
        resourceVersion: '2',
      })
    );

    const result = await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    expect(result).toEqual({
      applied: expect.arrayContaining(['web-0', 'web-1', 'web-2']),
      skipped: [],
      errors: [],
    });
    expect(result.applied).toHaveLength(3);
    expect(selectTargets).toHaveBeenCalledTimes(1);
    expect(selectTargets).toHaveBeenCalledWith(TARGET, CTX.pods, CTX);
    expect(patchFaultState).toHaveBeenCalledTimes(3);
    expect(patchFaultState).toHaveBeenCalledWith(
      CTX.client,
      NAMESPACE,
      expect.any(String),
      expect.objectContaining({ mode: MODE, slowDelayMs: SLOW_DELAY_MS, updatedBy: 'admin@lb-test' }),
      { timeoutMs: TIMEOUT_MS }
    );
  });

  test('concurrency: runs max 5 patches at a time with 10 pods', async () => {
    const pods = Array.from({ length: 10 }, (_, i) => podFixture('pod-' + i));
    selectTargets.mockResolvedValue(pods);
    getFaultStateConfigMap.mockResolvedValue(cmFixture('ignored'));

    let inFlight = 0;
    let maxConcurrent = 0;

    patchFaultState.mockImplementation((_client, _ns, podName) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      return new Promise((resolve) => {
        setImmediate(() => {
          inFlight--;
          resolve({
            name: 'fault-state-' + podName,
            podName,
            mode: MODE,
            slowDelayMs: SLOW_DELAY_MS,
            resourceVersion: '2',
          });
        });
      });
    });

    const result = await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    expect(maxConcurrent).toBeLessThanOrEqual(5);
    expect(result.applied).toHaveLength(10);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test('partial failure: 1 pod throws, result includes errors[]', async () => {
    const pods = [podFixture('web-0'), podFixture('web-1'), podFixture('web-2')];
    selectTargets.mockResolvedValue(pods);
    getFaultStateConfigMap.mockResolvedValue(cmFixture('ignored'));

    patchFaultState
      .mockRejectedValueOnce(new Error('patch failed for web-0'))
      .mockResolvedValueOnce({
        name: 'fault-state-web-1',
        podName: 'web-1',
        mode: MODE,
        slowDelayMs: SLOW_DELAY_MS,
        resourceVersion: '2',
      })
      .mockResolvedValueOnce({
        name: 'fault-state-web-2',
        podName: 'web-2',
        mode: MODE,
        slowDelayMs: SLOW_DELAY_MS,
        resourceVersion: '2',
      });

    const result = await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    // Since concurrency is 5 all 3 start together; call order is
    // deterministic (iteration order), so web-0 is the first call and
    // it rejects immediately.
    expect(result.applied).toEqual(expect.arrayContaining(['web-1', 'web-2']));
    expect(result.applied).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].podName).toBe('web-0');
    expect(result.errors[0].error).toMatch(/patch failed for web-0/);
    expect(result.skipped).toEqual([]);
  });

  test('empty targets: selectTargets returns [] -> empty result', async () => {
    selectTargets.mockResolvedValue([]);

    const result = await applyFault(TARGET, MODE, SLOW_DELAY_MS, CTX);

    expect(result).toEqual({ applied: [], skipped: [], errors: [] });
    expect(selectTargets).toHaveBeenCalledTimes(1);
    expect(patchFaultState).not.toHaveBeenCalled();
    expect(getFaultStateConfigMap).not.toHaveBeenCalled();
  });
});
