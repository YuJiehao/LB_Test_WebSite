'use strict';

/**
 * Unit tests for reconcileOnStartup (Task 1.5).
 *
 * Mocks the CoreV1Api boundary at:
 *   - pods.listNamespacedPod
 *   - configMaps.listNamespacedConfigMap
 *   - configMaps.createNamespacedConfigMap
 *
 * so the real reconciliation logic runs against a realistic fixture.
 *
 * The function must:
 *   - create a fault-state-<pod-name> ConfigMap (with the default data
 *     shape) for every Pod that lacks one
 *   - be idempotent: a second run against an already-reconciled cluster
 *     must make zero createNamespacedConfigMap calls
 */

describe('reconcileOnStartup()', () => {
  const NAMESPACE = 'default';
  const APP_SELECTOR = 'app=load-balancer-test';

  function buildPod(name) {
    return {
      metadata: { name },
      spec: { nodeName: `node-${name}` },
      status: { podIP: `10.0.0.${name.slice(-1)}` },
    };
  }

  function buildFaultStateConfigMap(podName, rv) {
    return {
      metadata: {
        name: `fault-state-${podName}`,
        labels: { role: 'fault-state', pod: podName },
        resourceVersion: rv,
      },
      data: { mode: 'none', slowDelayMs: '0' },
    };
  }

  function buildMockClient({ pods, faultStateCms }) {
    return {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue({ items: pods }),
      },
      configMaps: {
        listNamespacedConfigMap: jest
          .fn()
          .mockResolvedValue({ items: faultStateCms }),
        createNamespacedConfigMap: jest.fn().mockResolvedValue({}),
      },
    };
  }

  test('creates a fault-state ConfigMap for every Pod that lacks one', async () => {
    // Two of three Pods already have a fault-state ConfigMap; web-2 is missing.
    const pods = [
      buildPod('web-0'),
      buildPod('web-1'),
      buildPod('web-2'),
    ];
    const faultStateCms = [
      buildFaultStateConfigMap('web-0', '10'),
      buildFaultStateConfigMap('web-1', '11'),
    ];
    const mockClient = buildMockClient({ pods, faultStateCms });

    const { reconcileOnStartup } = require('../../src/k8s/configmaps');

    const result = await reconcileOnStartup(mockClient, NAMESPACE);

    // Pods were listed with the app selector.
    // Adapter uses positional args for @kubernetes/client-node@0.22.3:
    // (namespace, _, _, _, _, labelSelector, ...).
    expect(mockClient.pods.listNamespacedPod).toHaveBeenCalledTimes(1);
    const podListCallArgs = mockClient.pods.listNamespacedPod.mock.calls[0];
    expect(podListCallArgs[0]).toBe(NAMESPACE);
    expect(podListCallArgs[5]).toBe(APP_SELECTOR);

    // Fault-state ConfigMaps were listed with the role=fault-state selector.
    expect(
      mockClient.configMaps.listNamespacedConfigMap,
    ).toHaveBeenCalledTimes(1);
    const cmListCallArgs = mockClient.configMaps.listNamespacedConfigMap.mock.calls[0];
    expect(cmListCallArgs[0]).toBe(NAMESPACE);
    expect(cmListCallArgs[5]).toBe('role=fault-state');

    // Only the missing Pod (web-2) got a create call.
    // createNamespacedConfigMap(namespace, body, ...).
    expect(
      mockClient.configMaps.createNamespacedConfigMap,
    ).toHaveBeenCalledTimes(1);
    const createCallArgs = mockClient.configMaps.createNamespacedConfigMap.mock.calls[0];
    expect(createCallArgs[0]).toBe(NAMESPACE);
    expect(createCallArgs[1]).toEqual({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'fault-state-web-2',
        labels: { role: 'fault-state', pod: 'web-2' },
        namespace: NAMESPACE,
      },
      data: {
        mode: 'none',
        slowDelayMs: '60000',
        updatedAt: '',
        updatedBy: 'control-plane-bootstrap',
      },
    });

    // Returned summary matches the work done.
    expect(result).toEqual({
      created: ['web-2'],
      skipped: ['web-0', 'web-1'],
      errors: [],
    });
  });

  test('is idempotent: zero creates when every Pod already has a ConfigMap', async () => {
    const pods = [buildPod('web-0'), buildPod('web-1')];
    const faultStateCms = [
      buildFaultStateConfigMap('web-0', '10'),
      buildFaultStateConfigMap('web-1', '11'),
    ];
    const mockClient = buildMockClient({ pods, faultStateCms });

    const { reconcileOnStartup } = require('../../src/k8s/configmaps');

    const result = await reconcileOnStartup(mockClient, NAMESPACE);

    expect(
      mockClient.configMaps.createNamespacedConfigMap,
    ).not.toHaveBeenCalled();
    expect(result).toEqual({
      created: [],
      skipped: ['web-0', 'web-1'],
      errors: [],
    });
  });
});