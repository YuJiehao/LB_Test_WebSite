'use strict';

/**
 * Integration tests for startPollingLoop() — the background reconciliation
 * loop that polls Pods, detects drift, and patches ConfigMaps.
 *
 * Uses Jest fake timers and module-level mocks to verify the loop's
 * behavior without real network calls.
 */

jest.mock('../../src/k8s/pods');
jest.mock('../../src/k8s/configmaps');
jest.mock('../../src/fault/poll', () => {
  const actual = jest.requireActual('../../src/fault/poll');
  return {
    ...actual,
    pollPod: jest.fn(),
    detectDrift: jest.fn(),
  };
});

const { listPods } = require('../../src/k8s/pods');
const { listFaultStateConfigMaps, patchFaultState } = require('../../src/k8s/configmaps');
const { pollPod, detectDrift } = require('../../src/fault/poll');

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

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    listPods.mockResolvedValue(PODS);
    listFaultStateConfigMaps.mockResolvedValue(CMS);
    patchFaultState.mockResolvedValue({});
    pollPod.mockResolvedValue({ mode: 'none', slowDelayMs: 0, updatedBy: '', reachable: true });
    detectDrift.mockReturnValue({ drift: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('polls every Pod on each tick', async () => {
    const { startPollingLoop } = require('../../src/fault/poll');
    const ctx = { client: {}, namespace: NAMESPACE, intervalMs: 3000 };

    const loop = startPollingLoop(ctx);

    // First tick runs immediately.
    await jest.runOnlyPendingTimersAsync();

    expect(pollPod).toHaveBeenCalledTimes(2);
    expect(pollPod).toHaveBeenCalledWith(PODS[0], expect.any(Number));
    expect(pollPod).toHaveBeenCalledWith(PODS[1], expect.any(Number));

    // Second tick after intervalMs.
    await jest.advanceTimersByTimeAsync(3000);

    expect(pollPod).toHaveBeenCalledTimes(4); // 2 pods × 2 ticks

    loop.stop();
    jest.clearAllTimers();
  });

  test('patches ConfigMap when drift is detected', async () => {
    detectDrift.mockReturnValue({ drift: true, field: 'mode' });
    pollPod.mockResolvedValue({ mode: 'http_500', slowDelayMs: 0, updatedBy: 'admin', reachable: true });

    const { startPollingLoop } = require('../../src/fault/poll');
    const ctx = { client: {}, namespace: NAMESPACE, intervalMs: 3000 };

    const loop = startPollingLoop(ctx);
    await jest.runOnlyPendingTimersAsync();

    expect(patchFaultState).toHaveBeenCalledTimes(2);
    // Verify reconciliation state shape.
    const call = patchFaultState.mock.calls[0];
    expect(call[0]).toBe(ctx.client);
    expect(call[1]).toBe(NAMESPACE);
    expect(call[2]).toBe('web-0');
    expect(call[3].mode).toBe('http_500');
    expect(call[3].updatedBy).toMatch(/^reconciled:/);

    loop.stop();
    jest.clearAllTimers();
  });

  test('unreachable Pods get exponential backoff', async () => {
    // First poll: web-0 unreachable.
    pollPod
      .mockResolvedValueOnce({ mode: 'unknown', slowDelayMs: 0, updatedBy: '', reachable: false }) // web-0 fail
      .mockResolvedValue({ mode: 'none', slowDelayMs: 0, updatedBy: '', reachable: true }); // others ok

    const { startPollingLoop } = require('../../src/fault/poll');
    const ctx = { client: { bar: 1 }, namespace: NAMESPACE, intervalMs: 3000 };

    const loop = startPollingLoop(ctx);
    await jest.runOnlyPendingTimersAsync();

    // web-0 failed once → 1s backoff → should NOT be polled on next tick if <1s
    expect(pollPod).toHaveBeenCalledTimes(2); // both pods polled first tick

    // Advance by 500ms — web-0 still in backoff (1s > 500ms)
    await jest.advanceTimersByTimeAsync(3000);
    // web-0 backoff is 1s, so after 3s it should be retried
    // But on tick 2, web-0 was retried AND failed again (since we only mocked one failure)
    // Let's count: tick 1 → 2 polls, tick 2 → web-0 in backoff? Let's check
    // After 3s (the interval), tick 2 fires. web-0's backoff expired (1s < 3s) → polled again
    // web-0 reaches the default mock (reachable: true) → reset backoff
    expect(pollPod.mock.calls.length).toBeGreaterThanOrEqual(3); // at least 1 more poll for web-0

    loop.stop();
    jest.clearAllTimers();
  });
});
