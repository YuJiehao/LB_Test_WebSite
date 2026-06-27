'use strict';

/**
 * Integration tests for the dashboard pod table and label filter (Task 5.2).
 *
 * Verifies that GET / renders:
 * 1. A <table> with one row per discovered Pod
 * 2. Each row contains Pod name, current mode, and a status indicator
 * 3. A label-selector filter input prefilled with "app=load-balancer-test"
 *
 * These tests will initially fail (RED) because the dashboard template
 * does not yet render the pod table or filter. They pass (GREEN) once
 * the template and route handler are updated.
 */

const request = require('supertest');
const express = require('express');
const { mountRoutes } = require('../../src/api/routes');

// Mock listFaultStateConfigMaps so we control what ConfigMaps are returned
jest.mock('../../src/k8s/configmaps', () => ({
  listFaultStateConfigMaps: jest.fn(),
}));

const { listFaultStateConfigMaps } = require('../../src/k8s/configmaps');

describe('Dashboard pod table and filter', () => {
  let app;
  let mockClient;

  function makePod(name, ip, nodeName) {
    return {
      metadata: { name },
      status: { podIP: ip },
      spec: { nodeName: nodeName || 'node-x' },
    };
  }

  beforeEach(() => {
    // Reset mocks first
    jest.clearAllMocks();

    app = express();

    mockClient = {
      pods: {
        listNamespacedPod: jest.fn(),
      },
    };

    // Default: listPods returns 2 pods, configmaps returns 1 match
    mockClient.pods.listNamespacedPod.mockResolvedValue({
      items: [
        makePod('web-0', '10.0.0.1', 'node-a'),
        makePod('web-1', '10.0.0.2', 'node-b'),
      ],
    });

    listFaultStateConfigMaps.mockResolvedValue([
      { name: 'fault-state-web-0', podName: 'web-0', mode: 'http_500', slowDelayMs: 0, resourceVersion: '42' },
    ]);

    mountRoutes(app, { client: mockClient, namespace: 'test-ns' });
  });

  // -----------------------------------------------------------------------
  // Test 1: Response contains a <table> with one row per pod
  // -----------------------------------------------------------------------
  test('renders a table with one row per discovered Pod', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    // Check it contains a table element
    expect(res.text).toMatch(/<table/i);
    // Each pod should appear in a table row
    expect(res.text).toContain('web-0');
    expect(res.text).toContain('web-1');
  });

  // -----------------------------------------------------------------------
  // Test 2: Each row shows pod name, current mode, status indicator
  // -----------------------------------------------------------------------
  test('each pod row contains name, current mode, and status indicator', async () => {
    const res = await request(app).get('/');

    // web-0 has mode http_500 from ConfigMap
    expect(res.text).toContain('web-0');
    expect(res.text).toContain('http_500');
    // web-1 has no ConfigMap — defaults to 'none'
    expect(res.text).toContain('web-1');
    expect(res.text).toContain('none');
    // At least one status-indicator DOM element should exist
    expect(res.text).toMatch(/status/);
  });

  // -----------------------------------------------------------------------
  // Test 3: Label-selector input is prefilled with app=load-balancer-test
  // -----------------------------------------------------------------------
  test('header bar shows pod count and label selector', async () => {
    const res = await request(app).get('/');

    // The header should show the label selector and pod count
    expect(res.text).toContain('app=load-balancer-test');
    expect(res.text).toContain('2 pods');
    expect(res.text).toContain('1 healthy');
  });

  // -----------------------------------------------------------------------
  // Test 4: Pod IPs are rendered in the table
  // -----------------------------------------------------------------------
  test('table includes pod IP addresses', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('10.0.0.1');
    expect(res.text).toContain('10.0.0.2');
  });
});
