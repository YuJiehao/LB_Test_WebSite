'use strict';

/**
 * Tests for lib/k8s/k8s-informer.js — watching Pod's ConfigMap.
 */

jest.mock('@kubernetes/client-node', () => {
  const mockList = jest.fn();
  const mockWatch = jest.fn();
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromCluster: jest.fn(),
      makeApiClient: jest.fn().mockReturnValue({
        listNamespacedConfigMap: mockList,
      }),
    })),
    CoreV1Api: jest.fn(),
    Watch: jest.fn().mockImplementation(() => ({
      watch: mockWatch,
    })),
    __mockList: mockList,
    __mockWatch: mockWatch,
  };
});

describe('watchFaultState()', () => {
  let mockList;
  let mockWatch;

  beforeEach(() => {
    jest.clearAllMocks();
    const clientNode = require('@kubernetes/client-node');
    mockList = clientNode.__mockList;
    mockWatch = clientNode.__mockWatch;
  });

  test('calls onChange when ConfigMap MODIFIED event fires', async () => {
    const onChange = jest.fn();

    // List returns a resourceVersion so the watch can start.
    mockList.mockResolvedValue({
      metadata: { resourceVersion: '100' },
    });

    // Watch: capture the onEvent callback for later firing.
    let capturedOnEvent;
    mockWatch.mockImplementation((_path, _opts, onEvent, onDone) => {
      capturedOnEvent = onEvent;
      return Promise.resolve({ abort: jest.fn() });
    });

    const { watchFaultState } = require('../k8s-informer');
    const handle = watchFaultState('web-0', null, onChange);

    // Wait for the async connect to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate the watch receiving a MODIFIED event.
    capturedOnEvent('MODIFIED', {
      data: { mode: 'http_503', slowDelayMs: '2000' },
    });

    expect(onChange).toHaveBeenCalledWith({ mode: 'http_503', slowDelayMs: 2000 });

    handle.stop();
  });

  test('ignores non-MODIFIED events (ADDED, DELETED)', async () => {
    const onChange = jest.fn();

    mockList.mockResolvedValue({ metadata: { resourceVersion: '100' } });
    let capturedOnEvent;
    mockWatch.mockImplementation((_path, _opts, onEvent) => {
      capturedOnEvent = onEvent;
      return Promise.resolve({ abort: jest.fn() });
    });

    const { watchFaultState } = require('../k8s-informer');
    const handle = watchFaultState('web-0', null, onChange);
    await new Promise((resolve) => setTimeout(resolve, 10));

    capturedOnEvent('ADDED', { data: { mode: 'none', slowDelayMs: '0' } });
    capturedOnEvent('DELETED', { data: { mode: 'none', slowDelayMs: '0' } });

    expect(onChange).not.toHaveBeenCalled();
    handle.stop();
  });

  test('stop() prevents further onChange calls', async () => {
    const onChange = jest.fn();

    mockList.mockResolvedValue({ metadata: { resourceVersion: '100' } });
    let capturedOnEvent;
    mockWatch.mockImplementation((_path, _opts, onEvent) => {
      capturedOnEvent = onEvent;
      return Promise.resolve({ abort: jest.fn() });
    });

    const { watchFaultState } = require('../k8s-informer');
    const handle = watchFaultState('web-0', null, onChange);
    await new Promise((resolve) => setTimeout(resolve, 10));

    handle.stop();

    capturedOnEvent('MODIFIED', { data: { mode: 'reset', slowDelayMs: '0' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
