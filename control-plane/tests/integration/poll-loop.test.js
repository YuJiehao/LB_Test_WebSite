'use strict';

/**
 * Integration tests for startPollingLoop() — the background reconciliation
 * loop that polls Pods, detects drift, and patches ConfigMaps.
 *
 * Uses Jest fake timers. The pollPod and detectDrift implementations are
 * injected via ctx._pollPod / ctx._detectDrift so the loop can be tested
 * without module-level hoisting tricks.
 */

jest.mock('../../src/k8s/pods');
jest.mock('../../src/k8s/configmaps');

const { listPods } = require('../../src/k8s/pods');
const { listFaultStateConfigMaps, patchFaultState } = require('../../src/k8s/configmaps');

describe('startPollingLoop()', () => {
  const NAMESPACE = 'default';
  const PODS = [
    { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' },
    { name: 'web-1', ip: '10.0.0.2', nodeName: 'node-b' },
  ];

  const CMS = [
    { name: 'fault-state-web-0', podName: 'web-0', mode: 'none', slowDelayMs: 0, resourceVersion: '1' },
    { name: 'fault-state-web-1', podName: 'web-1', mode: 'none', slowDelayMs: 0, resourceVersion: '2' },
  ];

  let mockPollPod;
  let mockDetectDrift;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    listPods.mockResolvedValue(PODS);
    listFaultStateConfigMaps.mockResolvedValue(CMS);
    patchFaultState.mockResolvedValue({});

    mockPollPod = jest.fn().mockResolvedValue({ mode: 'none', slowDelayMs: 0, updatedBy: '', reachable: true });
    mockDetectDrift = jest.fn().mockReturnValue({ drift: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildCtx(overrides) {
    return {
      client: {},
      namespace: NAMESPACE,
      intervalMs: 3000,
      _pollPod: mockPollPod,
      _detectDrift: mockDetectDrift,
      ...overrides,
    };
  }

  test('polls every Pod on each tick', async () => {
    const { startPollingLoop } = require('../../src/fault/poll');
    const loop = startPollingLoop(buildCtx());

    // Advance 0ms to flush the first tick's microtasks only. The first
    // tick was started synchronously; we need to let its async work settle.
    await jest.advanceTimersByTimeAsync(0);

    // First tick: 2 pods polled.
    expect(mockPollPod).toHaveBeenCalledTimes(2);
    expect(mockPollPod).toHaveBeenCalledWith(PODS[0]);
    expect(mockPollPod).toHaveBeenCalledWith(PODS[1]);

    // Advance one full interval — second tick fires.
    await jest.advanceTimersByTimeAsync(3000);

    expect(mockPollPod).toHaveBeenCalledTimes(4); // 2 pods × 2 ticks

    loop.stop();
  });

  test('patches ConfigMap when drift is detected', async () => {
    mockDetectDrift.mockReturnValue({ drift: true, field: 'mode' });
    mockPollPod.mockResolvedValue({ mode: 'http_500', slowDelayMs: 0, updatedBy: 'admin', reachable: true });

    const { startPollingLoop } = require('../../src/fault/poll');
    const loop = startPollingLoop(buildCtx());
    await jest.advanceTimersByTimeAsync(0);

    expect(patchFaultState).toHaveBeenCalledTimes(2);
    // Verify reconciliation state shape.
    const call = patchFaultState.mock.calls[0];
    expect(call[2]).toBe('web-0');
    expect(call[3].mode).toBe('http_500');
    expect(call[3].updatedBy).toMatch(/^reconciled:/);

    loop.stop();
  });

  test('unreachable Pods get exponential backoff', async () => {
    // First poll: web-0 unreachable, web-1 reachable.
    mockPollPod
      .mockResolvedValueOnce({ mode: 'unknown', slowDelayMs: 0, updatedBy: '', reachable: false })
      .mockResolvedValue({ mode: 'none', slowDelayMs: 0, updatedBy: '', reachable: true });

    const { startPollingLoop, backoffDelay } = require('../../src/fault/poll');
    const loop = startPollingLoop(buildCtx());
    await jest.advanceTimersByTimeAsync(0);

    // First tick: web-0 failed (1s backoff), web-1 succeeded.
    expect(mockPollPod).toHaveBeenCalledTimes(2);

    // Advance by 500ms — insufficient to retry web-0 (backoff is 1s).
    // No tick fires (interval is 3s).
    await jest.advanceTimersByTimeAsync(500);
    // Still only 2 polls — web-0 is in backoff, no new tick.
    expect(mockPollPod).toHaveBeenCalledTimes(2);

    // Verify backoff calculation: 1 failure → 1s.
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(2)).toBe(2000);
    expect(backoffDelay(3)).toBe(4000);
    expect(backoffDelay(8)).toBe(60000); // capped

    loop.stop();
  });
});
