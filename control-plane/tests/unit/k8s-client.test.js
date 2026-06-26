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
    // Fresh env per test so KUBERNETES_SERVICE_HOST is whatever the test sets
    process.env = { ...ORIGINAL_ENV };
    // Clear any cached @kubernetes/client-node modules so each test gets a
    // fresh KubeConfig built from the current env.
    jest.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns object with `pods` and `configMaps` namespaces', () => {
    // Arrange: simulate running inside a Kubernetes cluster.
    process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    process.env.KUBERNETES_SERVICE_PORT = '443';
    // The in-cluster loader also reads /var/run/secrets/kubernetes.io/serviceaccount/token
    // We can't provide a real SA token in unit tests; assert the loader at
    // least returns the expected shape. We use a KUBECONFIG file via the
    // KUBECONFIG env var fallback isn't available for loadInCluster, so
    // instead we require the module AFTER setting the env and just verify
    // that the function exists and (when invoked) returns the expected
    // shape -- we'll keep the test focused on the public contract.
    const { loadK8sClient } = require('../../src/k8s/client');

    expect(typeof loadK8sClient).toBe('function');

    // The function should not throw and should return an object with the
    // two namespace properties documented in the brief.
    const client = loadK8sClient();

    expect(client).toBeDefined();
    expect(client).not.toBeNull();
    expect(typeof client).toBe('object');
    expect(client.pods).toBeDefined();
    expect(client.configMaps).toBeDefined();
    // Both namespaces should expose the list API methods we rely on later.
    expect(typeof client.pods.listNamespacedPod).toBe('function');
    expect(typeof client.configMaps.listNamespacedConfigMap).toBe('function');
  });

  test('uses in-cluster config when KUBERNETES_SERVICE_HOST is set', () => {
    // Arrange: set the env vars that loadInCluster() checks for.
    process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    process.env.KUBERNETES_SERVICE_PORT = '443';

    // Spy on loadInCluster from the @kubernetes/client-node module to confirm
    // it gets called when KUBERNETES_SERVICE_HOST is set.
    const k8s = require('@kubernetes/client-node');
    const spy = jest.spyOn(k8s, 'loadInCluster');

    // Require the module AFTER setting env + spy so the spy is in place.
    const { loadK8sClient } = require('../../src/k8s/client');

    // Act
    loadK8sClient();

    // Assert
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});