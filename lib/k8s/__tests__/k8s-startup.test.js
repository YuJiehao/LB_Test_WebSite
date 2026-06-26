'use strict';

/**
 * Tests for lib/k8s/k8s-startup.js — reading the Pod's own ConfigMap.
 */

// Mock @kubernetes/client-node before requiring the module under test.
jest.mock('@kubernetes/client-node', () => {
  const mockRead = jest.fn();
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromCluster: jest.fn(),
      makeApiClient: jest.fn().mockReturnValue({
        readNamespacedConfigMap: mockRead,
        listNamespacedConfigMap: jest.fn(),
      }),
    })),
    CoreV1Api: jest.fn(),
    __mockRead: mockRead, // Expose for test assertions
  };
});

describe('loadInitialFaultState()', () => {
  let mockRead;

  beforeEach(() => {
    jest.clearAllMocks();
    const clientNode = require('@kubernetes/client-node');
    mockRead = clientNode.__mockRead;
  });

  test('returns {mode, slowDelayMs} from the ConfigMap data', async () => {
    mockRead.mockResolvedValue({
      data: { mode: 'http_500', slowDelayMs: '8000' },
    });

    const { loadInitialFaultState } = require('../k8s-startup');
    const result = await loadInitialFaultState('web-0');

    expect(result).toEqual({ mode: 'http_500', slowDelayMs: 8000 });
  });

  test('returns defaults when data fields are missing', async () => {
    mockRead.mockResolvedValue({ data: {} });

    const { loadInitialFaultState } = require('../k8s-startup');
    const result = await loadInitialFaultState('web-0');

    expect(result).toEqual({ mode: 'none', slowDelayMs: 0 });
  });

  test('returns null when the ConfigMap does not exist (404)', async () => {
    const err = new Error('Not Found');
    err.statusCode = 404;
    mockRead.mockRejectedValue(err);

    const { loadInitialFaultState } = require('../k8s-startup');
    const result = await loadInitialFaultState('web-0');

    expect(result).toBeNull();
  });

  test('rethrows non-404 errors', async () => {
    const err = new Error('etcd timeout');
    err.statusCode = 500;
    mockRead.mockRejectedValue(err);

    const { loadInitialFaultState } = require('../k8s-startup');
    await expect(loadInitialFaultState('web-0')).rejects.toThrow('etcd timeout');
  });
});
