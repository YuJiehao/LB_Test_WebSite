'use strict';

/**
 * Integration tests for the dashboard page render (Task 5.1).
 *
 * Verifies that GET / returns an HTML page with:
 * 1. The page title "LB Fault Control Plane"
 * 2. The nav partial (top-nav)
 * 3. The footer partial (app-footer)
 *
 * These tests will initially fail (RED) because the GET / route does
 * not exist yet. They pass (GREEN) once mountRoutes is extended with
 * EJS view engine setup, static file serving, and the dashboard route.
 */

const request = require('supertest');
const express = require('express');
const { mountRoutes } = require('../../src/api/routes');

describe('Dashboard page render', () => {
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
    app = express();

    mockClient = {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue({ items: [makePod('pod-1', '10.0.0.1')] }),
      },
    };

    mountRoutes(app, { client: mockClient, namespace: 'test-ns' });
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Test 1: GET / returns 200 with page title
  // -----------------------------------------------------------------------
  test('GET / returns 200 HTML containing the page title', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('LB Fault Control Plane');
  });

  // -----------------------------------------------------------------------
  // Test 2: Rendered HTML includes the nav partial
  // -----------------------------------------------------------------------
  test('rendered HTML includes the nav partial', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('top-nav');
  });

  // -----------------------------------------------------------------------
  // Test 3: Rendered HTML includes the footer partial
  // -----------------------------------------------------------------------
  test('rendered HTML includes the footer partial', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('app-footer');
  });
});
