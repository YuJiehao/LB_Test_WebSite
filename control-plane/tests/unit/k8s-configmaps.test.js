'use strict';

/**
 * Unit tests for src/k8s/configmaps.js
 *
 * Mocks the CoreV1Api boundary at the `listNamespacedConfigMap` and
 * `readNamespacedConfigMap` methods so the real mapping logic in
 * `listFaultStateConfigMaps` / `getFaultStateConfigMap` runs against
 * a realistic fixture.
 *
 * The K8s API already filters by `labelSelector` server-side, but the
 * fault-state selector is an in-cluster convention ("anything labelled
 * `role=fault-state` belongs to us"). We still apply it at the API
 * boundary so the API does the heavy lifting; the unit test simulates
 * the API's filter behaviour by feeding in a mix of labelled and
 * unlabelled ConfigMaps and asserting that:
 *   - the selector is forwarded to the API; and
 *   - the mapping only returns items the API would have returned
 *     (in practice, the API handles this — but the mapping helper is
 *     defensive so it would also tolerate pre-filtered fixtures).
 */

describe('listFaultStateConfigMaps()', () => {
  const NAMESPACE = 'default';

  /**
   * Build a realistic V1ConfigMapList fixture with a mix of fault-state
   * ConfigMaps and unrelated ones. Only the fields the mapping logic
   * actually reads are populated — metadata.name, metadata.labels,
   * metadata.resourceVersion, data — per the YAGNI principle.
   */
  function buildConfigMapListFixture() {
    return {
      items: [
        {
          metadata: {
            name: 'fault-state-web-0',
            labels: { role: 'fault-state', pod: 'web-0' },
            resourceVersion: '42',
          },
          data: { mode: 'none', slowDelayMs: '0' },
        },
        {
          metadata: {
            name: 'fault-state-web-1',
            labels: { role: 'fault-state', pod: 'web-1' },
            resourceVersion: '17',
          },
          data: { mode: 'http_500', slowDelayMs: '0' },
        },
        // Unrelated ConfigMap (e.g. app config) — should be ignored.
        {
          metadata: {
            name: 'app-config',
            labels: { app: 'lb-test' },
            resourceVersion: '5',
          },
          data: { logLevel: 'info' },
        },
        {
          metadata: {
            name: 'fault-state-web-2',
            labels: { role: 'fault-state', pod: 'web-2' },
            resourceVersion: '99',
          },
          data: { mode: 'slow', slowDelayMs: '5000' },
        },
      ],
    };
  }

  function buildMockClient(fixture) {
    return {
      configMaps: {
        listNamespacedConfigMap: jest.fn().mockResolvedValue(fixture),
      },
    };
  }

  test('forwards the role=fault-state label selector and maps fault-state ConfigMaps to plain objects', async () => {
    const fixture = buildConfigMapListFixture();
    const mockClient = buildMockClient(fixture);

    // Require AFTER the mock is built so the module picks it up.
    const { listFaultStateConfigMaps } = require('../../src/k8s/configmaps');

    // Act
    const result = await listFaultStateConfigMaps(mockClient, NAMESPACE);

    // Assert: the real CoreV1Api was called with the right params...
    expect(mockClient.configMaps.listNamespacedConfigMap).toHaveBeenCalledTimes(1);
    // Adapter uses positional args for @kubernetes/client-node@0.22.3:
    // (namespace, _, _, _, _, labelSelector, ...).
    const listCallArgs = mockClient.configMaps.listNamespacedConfigMap.mock.calls[0];
    expect(listCallArgs[0]).toBe(NAMESPACE);
    expect(listCallArgs[5]).toBe('role=fault-state');

    // ...and only the labelled (fault-state) entries were mapped.
    expect(result).toEqual([
      {
        name: 'fault-state-web-0',
        podName: 'web-0',
        mode: 'none',
        slowDelayMs: 0,
        resourceVersion: '42',
      },
      {
        name: 'fault-state-web-1',
        podName: 'web-1',
        mode: 'http_500',
        slowDelayMs: 0,
        resourceVersion: '17',
      },
      {
        name: 'fault-state-web-2',
        podName: 'web-2',
        mode: 'slow',
        slowDelayMs: 5000,
        resourceVersion: '99',
      },
    ]);
  });

  test('returns an empty array when no fault-state ConfigMaps exist', async () => {
    const mockClient = buildMockClient({ items: [] });
    const { listFaultStateConfigMaps } = require('../../src/k8s/configmaps');

    const result = await listFaultStateConfigMaps(mockClient, NAMESPACE);

    expect(result).toEqual([]);
  });
});

describe('getFaultStateConfigMap()', () => {
  const NAMESPACE = 'default';
  const POD_NAME = 'web-1';
  const CONFIG_MAP_NAME = `fault-state-${POD_NAME}`;

  test('returns the mapped ConfigMap when the API resolves', async () => {
    const fixture = {
      metadata: {
        name: CONFIG_MAP_NAME,
        labels: { role: 'fault-state', pod: POD_NAME },
        resourceVersion: '17',
      },
      data: { mode: 'http_500', slowDelayMs: '0' },
    };
    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: jest.fn().mockResolvedValue(fixture),
      },
    };
    const { getFaultStateConfigMap } = require('../../src/k8s/configmaps');

    const result = await getFaultStateConfigMap(
      mockClient,
      NAMESPACE,
      POD_NAME,
    );

    expect(mockClient.configMaps.readNamespacedConfigMap).toHaveBeenCalledTimes(1);
    // Adapter uses positional args for @kubernetes/client-node@0.22.3:
    // readNamespacedConfigMap(name, namespace, ...) — name BEFORE namespace.
    const readCallArgs = mockClient.configMaps.readNamespacedConfigMap.mock.calls[0];
    expect(readCallArgs[0]).toBe(CONFIG_MAP_NAME);
    expect(readCallArgs[1]).toBe(NAMESPACE);
    expect(result).toEqual({
      name: CONFIG_MAP_NAME,
      podName: POD_NAME,
      mode: 'http_500',
      slowDelayMs: 0,
      resourceVersion: '17',
    });
  });

  test('returns null when the API rejects with a 404', async () => {
    const notFound = Object.assign(new Error('Not Found'), {
      statusCode: 404,
      body: { reason: 'NotFound' },
    });
    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: jest.fn().mockRejectedValue(notFound),
      },
    };
    const { getFaultStateConfigMap } = require('../../src/k8s/configmaps');

    const result = await getFaultStateConfigMap(
      mockClient,
      NAMESPACE,
      POD_NAME,
    );

    expect(result).toBeNull();
  });

  test('rethrows non-404 errors', async () => {
    const boom = Object.assign(new Error('cluster unreachable'), {
      statusCode: 500,
    });
    const mockClient = {
      configMaps: {
        readNamespacedConfigMap: jest.fn().mockRejectedValue(boom),
      },
    };
    const { getFaultStateConfigMap } = require('../../src/k8s/configmaps');

    await expect(
      getFaultStateConfigMap(mockClient, NAMESPACE, POD_NAME),
    ).rejects.toThrow('cluster unreachable');
  });
});