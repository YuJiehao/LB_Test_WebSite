'use strict';

/**
 * Unit tests for src/k8s/client.js
 *
 * These tests stub KUBERNETES_SERVICE_HOST and exercise the loader against
 * the real @kubernetes/client-node library (NOT mocked). The first test
 * verifies the loader returns an object with `pods` and `configMaps`
 * namespaces backed by CoreV1Api. The second test verifies that the
 * loader uses in-cluster config when KUBERNETES_SERVICE_HOST is set.
 */

describe('loadK8sClient()', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Fresh env per test so KUBERNETES_SERVICE_HOST is whatever the test sets.
    process.env = { ...ORIGINAL_ENV };
    // Clear any cached modules so each test gets a fresh KubeConfig built
    // from the current env.
    jest.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns object with `pods` and `configMaps` namespaces', () => {
    // Arrange: simulate running inside a Kubernetes cluster.
    process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    process.env.KUBERNETES_SERVICE_PORT = '443';

    const { loadK8sClient } = require('../../src/k8s/client');

    expect(typeof loadK8sClient).toBe('function');

    // Act
    const client = loadK8sClient();

    // Assert: the loader returns an object with the two namespace
    // properties documented in the brief, each backed by a CoreV1Api
    // instance exposing the list API methods we rely on later.
    expect(client).toBeDefined();
    expect(client).not.toBeNull();
    expect(typeof client).toBe('object');
    expect(client.pods).toBeDefined();
    expect(client.configMaps).toBeDefined();
    expect(typeof client.pods.listNamespacedPod).toBe('function');
    expect(typeof client.configMaps.listNamespacedConfigMap).toBe('function');
  });

  test('uses in-cluster config when KUBERNETES_SERVICE_HOST is set', () => {
    // Arrange: set the env vars that loadFromCluster() checks for.
    process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    process.env.KUBERNETES_SERVICE_PORT = '443';

    // Spy on KubeConfig.prototype.loadFromCluster -- the 0.22.x equivalent
    // of `loadInCluster` -- to confirm the loader routes through it when
    // KUBERNETES_SERVICE_HOST is set.
    const k8s = require('@kubernetes/client-node');
    const spy = jest.spyOn(k8s.KubeConfig.prototype, 'loadFromCluster');

    // Require the module AFTER setting env + spy so the spy is in place.
    const { loadK8sClient } = require('../../src/k8s/client');

    // Act
    loadK8sClient();

    // Assert
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  test('wraps in-cluster load failures with a descriptive error', () => {
    // Arrange: simulate a Pod that has the env vars set but no service-
    // account token mounted. The KubeConfig loader will throw, and we
    // expect the loader to wrap that with a descriptive message.
    process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    process.env.KUBERNETES_SERVICE_PORT = '443';

    const k8s = require('@kubernetes/client-node');
    jest
      .spyOn(k8s.KubeConfig.prototype, 'loadFromCluster')
      .mockImplementation(() => {
        throw new Error('no SA token at /var/run/secrets/...');
      });

    const { loadK8sClient } = require('../../src/k8s/client');

    // Act + Assert
    expect(() => loadK8sClient()).toThrow(/Failed to load in-cluster/);
    expect(() => loadK8sClient()).toThrow(/no SA token/);

    jest.restoreAllMocks();
  });
});