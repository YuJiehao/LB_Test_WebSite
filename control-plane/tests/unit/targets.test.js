'use strict';

/**
 * Unit tests for src/fault/targets.js
 *
 * Covers all four target selection algorithms:
 *   - all       : returns every pod
 *   - single    : returns one named pod (hit + miss)
 *   - selector  : delegates to K8s API and applies client-side filter
 *   - canary    : deterministic hash-based percentage selection
 */

describe('selectTargets()', () => {
  const NAMESPACE = 'default';

  const pods = [
    { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' },
    { name: 'web-1', ip: '10.0.0.2', nodeName: 'node-b' },
    { name: 'web-2', ip: '10.0.0.3', nodeName: 'node-c' },
    { name: 'web-3', ip: '10.0.0.4', nodeName: 'node-d' },
  ];

  function buildMockClient(items) {
    return {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue({ items }),
      },
    };
  }

  function apiPodFixture(name, ip, labels) {
    return {
      metadata: { name, labels },
      spec: { nodeName: 'node-x' },
      status: { podIP: ip },
    };
  }

  test('type "all" returns every pod', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const result = selectTargets({ type: 'all' }, pods);
    expect(result).toEqual(pods);
  });

  test('type "single" returns the named pod (hit)', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const result = selectTargets({ type: 'single', pod: 'web-2' }, pods);
    expect(result).toEqual([{ name: 'web-2', ip: '10.0.0.3', nodeName: 'node-c' }]);
  });

  test('type "single" returns [] when pod is not in the list (miss)', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const result = selectTargets({ type: 'single', pod: 'ghost' }, pods);
    expect(result).toEqual([]);
  });

  test('type "selector" calls K8s API once with the right args and filters by labels', async () => {
    const items = [
      apiPodFixture('web-0', '10.0.0.1', { app: 'lb-test', tier: 'web' }),
      apiPodFixture('web-1', '10.0.0.2', { app: 'lb-test', tier: 'db' }),
      apiPodFixture('web-2', '10.0.0.3', { app: 'lb-test', tier: 'web' }),
    ];
    const mockClient = buildMockClient(items);

    const { selectTargets } = require('../../src/fault/targets');
    const result = await selectTargets(
      { type: 'selector', selector: 'app=lb-test,tier=web' },
      pods,
      { client: mockClient, namespace: NAMESPACE }
    );

    expect(mockClient.pods.listNamespacedPod).toHaveBeenCalledTimes(1);
    // Adapter uses positional args for @kubernetes/client-node@0.22.3:
    // (namespace, _, _, _, _, labelSelector, ...).
    const callArgs = mockClient.pods.listNamespacedPod.mock.calls[0];
    expect(callArgs[0]).toBe(NAMESPACE);
    expect(callArgs[5]).toBe('app=lb-test,tier=web');
    expect(result).toEqual([
      { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-x' },
      { name: 'web-2', ip: '10.0.0.3', nodeName: 'node-x' },
    ]);
  });

  test('type "canary" is deterministic for the same input', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const target = { type: 'canary', percent: 50 };
    const first = selectTargets(target, pods);
    const second = selectTargets(target, pods);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    // A subset that happens to include all pods is still deterministic;
    // the strict subset property is asserted separately by the
    // canary-0% / canary-100% tests at the boundaries.
  });

  test('type "canary" with percent 0 returns []', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const result = selectTargets({ type: 'canary', percent: 0 }, pods);
    expect(result).toEqual([]);
  });

  test('type "canary" with percent 100 returns all pods', () => {
    const { selectTargets } = require('../../src/fault/targets');
    const result = selectTargets({ type: 'canary', percent: 100 }, pods);
    expect(result).toEqual(pods);
  });

  test('type "canary" with percent 50 over a 100-pod universe selects roughly half', () => {
    // The defining property of canary is "stable, roughly proportional
    // subset" — not just "deterministic". A 100-pod universe is large
    // enough that binomial std dev (~5) makes 50±15 a safe bound for
    // any reasonable hash distribution.
    const { selectTargets } = require('../../src/fault/targets');
    const bigPods = Array.from({ length: 100 }, (_, i) => ({
      name: `pod-${String(i).padStart(3, '0')}`,
      ip: `10.0.0.${i}`,
      nodeName: 'worker-0',
    }));
    const result = selectTargets({ type: 'canary', percent: 50 }, bigPods);
    expect(result.length).toBeGreaterThanOrEqual(35);
    expect(result.length).toBeLessThanOrEqual(65);
  });
});