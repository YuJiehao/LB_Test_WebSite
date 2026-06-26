'use strict';

/**
 * Unit tests for src/k8s/configmaps.js#patchFaultState
 *
 * Mocks `readNamespacedConfigMap` (returns current state) and
 * `patchNamespacedConfigMap` (returns updated state OR throws 409)
 * to exercise the optimistic-locking retry loop.
 *
 * The K8s API uses `resourceVersion` for optimistic locking: a patch
 * referencing a stale `resourceVersion` is rejected with HTTP 409.
 * `patchFaultState` must refetch and retry up to 3 times before
 * surfacing the conflict as a `PatchConflictError`.
 */

describe('patchFaultState()', () => {
  const NAMESPACE = 'default';
  const POD_NAME = 'web-1';
  const CONFIG_MAP_NAME = `fault-state-${POD_NAME}`;
  const NEW_STATE = {
    mode: 'http_500',
    slowDelayMs: 0,
    updatedAt: '2026-06-26T12:00:00Z',
    updatedBy: 'admin@lb-test',
  };

  function buildCurrentFixture(resourceVersion) {
    return {
      metadata: {
        name: CONFIG_MAP_NAME,
        labels: { role: 'fault-state', pod: POD_NAME },
        resourceVersion,
        namespace: NAMESPACE,
      },
      data: { mode: 'none', slowDelayMs: '0', updatedAt: '', updatedBy: '' },
    };
  }

  function buildUpdatedFixture(resourceVersion) {
    return {
      metadata: {
        name: CONFIG_MAP_NAME,
        labels: { role: 'fault-state', pod: POD_NAME },
        resourceVersion,
        namespace: NAMESPACE,
      },
      data: {
        mode: NEW_STATE.mode,
        slowDelayMs: String(NEW_STATE.slowDelayMs),
        updatedAt: NEW_STATE.updatedAt,
        updatedBy: NEW_STATE.updatedBy,
      },
    };
  }

  test('sends a JSON merge patch with the current resourceVersion and returns the updated plain ConfigMap', async () => {
    const current = buildCurrentFixture('42');
    const updated = buildUpdatedFixture('43');
    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: jest.fn().mockResolvedValue(current),
        patchNamespacedConfigMap: jest.fn().mockResolvedValue(updated),
      },
    };

    const { patchFaultState } = require('../../src/k8s/configmaps');

    const result = await patchFaultState(mockClient, NAMESPACE, POD_NAME, NEW_STATE);

    // The patch was sent once, against the current resourceVersion,
    // as a JSON merge patch (RFC 7396) carrying the new data fields.
    // Adapter uses positional args for @kubernetes/client-node@0.22.3:
    // patchNamespacedConfigMap(name, namespace, body, ..., { headers }).
    expect(mockClient.configMaps.patchNamespacedConfigMap).toHaveBeenCalledTimes(1);
    const callArgs = mockClient.configMaps.patchNamespacedConfigMap.mock.calls[0];
    expect(callArgs[0]).toBe(CONFIG_MAP_NAME);
    expect(callArgs[1]).toBe(NAMESPACE);
    expect(callArgs[8].headers).toEqual(
      { 'Content-Type': 'application/merge-patch+json' }
    );
    expect(callArgs[2]).toEqual({
      metadata: { resourceVersion: '42' },
      data: {
        mode: NEW_STATE.mode,
        slowDelayMs: String(NEW_STATE.slowDelayMs),
        updatedAt: NEW_STATE.updatedAt,
        updatedBy: NEW_STATE.updatedBy,
      },
    });

    // Returns the mapped (plain) updated ConfigMap.
    expect(result).toEqual({
      name: CONFIG_MAP_NAME,
      podName: POD_NAME,
      mode: NEW_STATE.mode,
      slowDelayMs: NEW_STATE.slowDelayMs,
      resourceVersion: '43',
    });
  });

  test('refetches and retries when the API rejects with 409 (up to 3 attempts total)', async () => {
    // Two reads yield bumped resourceVersions; the first two patches
    // race-fail; the third succeeds. Verifies the retry loop converges.
    const rv1 = buildCurrentFixture('42');
    const rv2 = buildCurrentFixture('43');
    const rv3 = buildCurrentFixture('44');
    const conflict = Object.assign(new Error('Conflict'), { statusCode: 409 });
    const updated = buildUpdatedFixture('45');

    const readMock = jest
      .fn()
      .mockResolvedValueOnce(rv1)
      .mockResolvedValueOnce(rv2)
      .mockResolvedValueOnce(rv3);
    const patchMock = jest
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(updated);

    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: readMock,
        patchNamespacedConfigMap: patchMock,
      },
    };

    const { patchFaultState } = require('../../src/k8s/configmaps');

    const result = await patchFaultState(mockClient, NAMESPACE, POD_NAME, NEW_STATE);

    expect(readMock).toHaveBeenCalledTimes(3);
    expect(patchMock).toHaveBeenCalledTimes(3);
    // Each patch uses the resourceVersion from its preceding read.
    // Adapter positional args: (name, namespace, body, ...).
    expect(patchMock.mock.calls[0][2]).toEqual({
      metadata: { resourceVersion: '42' },
      data: {
        mode: NEW_STATE.mode,
        slowDelayMs: String(NEW_STATE.slowDelayMs),
        updatedAt: NEW_STATE.updatedAt,
        updatedBy: NEW_STATE.updatedBy,
      },
    });
    expect(patchMock.mock.calls[1][2]).toEqual({
      metadata: { resourceVersion: '43' },
      data: {
        mode: NEW_STATE.mode,
        slowDelayMs: String(NEW_STATE.slowDelayMs),
        updatedAt: NEW_STATE.updatedAt,
        updatedBy: NEW_STATE.updatedBy,
      },
    });
    // Last patch used the latest fetched resourceVersion (44).
    expect(patchMock.mock.calls[2][2]).toEqual({
      metadata: { resourceVersion: '44' },
      data: {
        mode: NEW_STATE.mode,
        slowDelayMs: String(NEW_STATE.slowDelayMs),
        updatedAt: NEW_STATE.updatedAt,
        updatedBy: NEW_STATE.updatedBy,
      },
    });
    expect(result).toEqual({
      name: CONFIG_MAP_NAME,
      podName: POD_NAME,
      mode: NEW_STATE.mode,
      slowDelayMs: NEW_STATE.slowDelayMs,
      resourceVersion: '45',
    });
  });

  test('surfaces a PatchConflictError after 3 consecutive 409s', async () => {
    const conflict = Object.assign(new Error('Conflict'), { statusCode: 409 });
    const current = buildCurrentFixture('42');
    const readMock = jest.fn().mockResolvedValue(current);
    const patchMock = jest.fn().mockRejectedValue(conflict);

    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: readMock,
        patchNamespacedConfigMap: patchMock,
      },
    };

    const { patchFaultState } = require('../../src/k8s/configmaps');

    await expect(
      patchFaultState(mockClient, NAMESPACE, POD_NAME, NEW_STATE)
    ).rejects.toThrow(/conflict/i);

    expect(readMock).toHaveBeenCalledTimes(3);
    expect(patchMock).toHaveBeenCalledTimes(3);
  });

  test('rejects with a timeout error if the K8s API call hangs longer than the patch budget', async () => {
    // Read resolves quickly, then patch hangs forever. Without the
    // wrapper, this would block until Jest's own test timeout fires
    // (~5s default) and report a hung test instead of a clean failure.
    const current = buildCurrentFixture('42');
    const pending = new Promise(() => {}); // never resolves
    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: jest.fn().mockResolvedValue(current),
        patchNamespacedConfigMap: jest.fn().mockReturnValue(pending),
      },
    };

    const { patchFaultState } = require('../../src/k8s/configmaps');

    // 50ms budget: short enough to fail fast, long enough to absorb
    // scheduler jitter so the assertion reflects the wrapper, not a race.
    await expect(
      patchFaultState(mockClient, NAMESPACE, POD_NAME, NEW_STATE, { timeoutMs: 50 })
    ).rejects.toThrow(/timeout/i);

    // Exactly one patch attempt happened before the wrapper fired.
    expect(mockClient.configMaps.patchNamespacedConfigMap).toHaveBeenCalledTimes(1);
  });
});
