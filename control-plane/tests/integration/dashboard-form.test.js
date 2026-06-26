'use strict';

/**
 * Integration tests for the dashboard action form (Task 5.3).
 *
 * Verifies that GET / renders a form with:
 * 1. Radio buttons for target type (all/single/selector/canary)
 * 2. A mode <select> with all 6 fault modes
 * 3. The form posts to /api/fault/apply
 */

const request = require('supertest');
const express = require('express');
const { mountRoutes } = require('../../src/api/routes');

jest.mock('../../src/k8s/configmaps', () => ({
  listFaultStateConfigMaps: jest.fn(),
}));

describe('Dashboard action form', () => {
  let app;
  let mockClient;

  function makePod(name, ip) {
    return {
      metadata: { name },
      status: { podIP: ip },
      spec: { nodeName: 'node-x' },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();

    mockClient = {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue({
          items: [makePod('web-0', '10.0.0.1')],
        }),
      },
    };

    const { listFaultStateConfigMaps } = require('../../src/k8s/configmaps');
    listFaultStateConfigMaps.mockResolvedValue([]);

    mountRoutes(app, { client: mockClient, namespace: 'test-ns' });
  });

  // -----------------------------------------------------------------------
  // Test 1: Form has radio buttons for target type
  // -----------------------------------------------------------------------
  test('form contains radio buttons for all target types', async () => {
    const res = await request(app).get('/');

    // Check for radio inputs with the right names and values
    expect(res.text).toMatch(/<input[^>]*type="radio"[^>]*name="target\[type\]"[^>]*value="all"[^>]*>/i);
    expect(res.text).toMatch(/<input[^>]*type="radio"[^>]*name="target\[type\]"[^>]*value="single"[^>]*>/i);
    expect(res.text).toMatch(/<input[^>]*type="radio"[^>]*name="target\[type\]"[^>]*value="selector"[^>]*>/i);
    expect(res.text).toMatch(/<input[^>]*type="radio"[^>]*name="target\[type\]"[^>]*value="canary"[^>]*>/i);
  });

  // -----------------------------------------------------------------------
  // Test 2: Form has mode <select> with all 6 options
  // -----------------------------------------------------------------------
  test('form contains mode select with all 6 fault modes', async () => {
    const res = await request(app).get('/');

    expect(res.text).toMatch(/<select[^>]*>/i);
    expect(res.text).toContain('value="none"');
    expect(res.text).toContain('value="http_500"');
    expect(res.text).toContain('value="http_503"');
    expect(res.text).toContain('value="slow"');
    expect(res.text).toContain('value="wrong_body"');
    expect(res.text).toContain('value="reset"');
  });

  // -----------------------------------------------------------------------
  // Test 3: Form posts to /api/fault/apply
  // -----------------------------------------------------------------------
  test('form action is /api/fault/apply with POST method', async () => {
    const res = await request(app).get('/');

    // The form should have action="/api/fault/apply" and method="POST"
    expect(res.text).toMatch(/<form[^>]*action="\/api\/fault\/apply"[^>]*>/i);
    expect(res.text).toMatch(/<form[^>]*method="POST"[^>]*>/i);
  });

  // -----------------------------------------------------------------------
  // Test 4: Slow delay input exists
  // -----------------------------------------------------------------------
  test('form includes a slow delay input for slow mode', async () => {
    const res = await request(app).get('/');

    // Check for a number input for slowDelayMs
    expect(res.text).toMatch(/<input[^>]*(name="slowDelayMs"|slowDelay|slow-delay)[^>]*>/i);
  });
});
