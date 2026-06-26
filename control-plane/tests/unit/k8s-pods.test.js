'use strict';

/**
 * Unit tests for src/k8s/pods.js
 *
 * Mocks the CoreV1Api.listNamespacedPod boundary so the real mapping
 * logic in listPods()/toPlainPod() runs against a realistic fixture.
 */

describe('listPods()', () => {
  const NAMESPACE = 'default';
  const LABEL_SELECTOR = 'app=test';

  /**
   * Build a realistic V1PodList fixture. Only the fields the mapping
   * logic actually reads are populated — metadata.name, metadata.labels,
   * status.podIP, spec.nodeName — per the YAGNI principle.
   */
  function buildPodListFixture() {
    return {
      items: [
        {
          metadata: {
            name: 'web-0',
            labels: { app: 'test', tier: 'web' },
          },
          spec: { nodeName: 'node-a' },
          status: { podIP: '10.0.0.1' },
        },
        {
          metadata: {
            name: 'web-1',
            labels: { app: 'test', tier: 'web' },
          },
          spec: { nodeName: 'node-b' },
          status: { podIP: '10.0.0.2' },
        },
        {
          metadata: {
            name: 'web-2',
            labels: { app: 'test', tier: 'web' },
          },
          spec: { nodeName: 'node-c' },
          status: { podIP: '10.0.0.3' },
        },
      ],
    };
  }

  /**
   * Build a mock client whose `pods.listNamespacedPod` returns a fixed
   * response (no continuation, no error).
   */
  function buildMockClient(fixture) {
    return {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue(fixture),
      },
    };
  }

  test('returns an array of plain {name, ip, nodeName} objects', async () => {
    const fixture = buildPodListFixture();
    const mockClient = buildMockClient(fixture);

    // Require AFTER the mock is built so the module picks it up. Jest's
    // require cache is per-test-file so this is safe inside a single
    // describe.
    const { listPods } = require('../../src/k8s/pods');

    // Act
    const result = await listPods(mockClient, LABEL_SELECTOR, NAMESPACE);

    // Assert: the real CoreV1Api was called with the right params...
    expect(mockClient.pods.listNamespacedPod).toHaveBeenCalledTimes(1);
    expect(mockClient.pods.listNamespacedPod).toHaveBeenCalledWith({
      namespace: NAMESPACE,
      labelSelector: LABEL_SELECTOR,
    });

    // ...and the mapping logic produced the expected plain objects.
    expect(result).toEqual([
      { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' },
      { name: 'web-1', ip: '10.0.0.2', nodeName: 'node-b' },
      { name: 'web-2', ip: '10.0.0.3', nodeName: 'node-c' },
    ]);
  });

  test('returns an empty array when no pods match', async () => {
    const mockClient = buildMockClient({ items: [] });
    const { listPods } = require('../../src/k8s/pods');

    const result = await listPods(mockClient, LABEL_SELECTOR, NAMESPACE);

    expect(result).toEqual([]);
  });
});
