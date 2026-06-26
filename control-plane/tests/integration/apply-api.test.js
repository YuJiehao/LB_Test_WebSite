'use strict';

jest.mock('../../src/fault/apply', () => ({
  applyFault: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { mountRoutes } = require('../../src/api/routes');
const { applyFault } = require('../../src/fault/apply');

describe('Fault apply API', () => {
  let app;
  let mockClient;

  function makePod(name, ip, nodeName) {
    return {
      metadata: { name },
      status: { podIP: ip },
      spec: { nodeName },
    };
  }

  beforeEach(() => {
    app = express();
    app.use(express.json());

    mockClient = {
      pods: {
        listNamespacedPod: jest.fn().mockResolvedValue({
          items: [makePod('pod-1', '10.0.0.1', 'node-1')],
        }),
      },
    };

    mountRoutes(app, { client: mockClient, namespace: 'test-ns' });
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Test 1: POST /api/fault/apply valid body -> 200 with applied/skipped/errors
  // -----------------------------------------------------------------------
  test('POST /api/fault/apply valid body returns 200 with applied/skipped/errors', async () => {
    applyFault.mockResolvedValue({ applied: ['pod-1'], skipped: [], errors: [] });

    const res = await request(app)
      .post('/api/fault/apply')
      .send({ target: { type: 'all' }, mode: 'http_500' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: ['pod-1'], skipped: [], errors: [] });
    expect(applyFault).toHaveBeenCalledWith(
      { type: 'all' },
      'http_500',
      0,
      expect.objectContaining({ client: mockClient, namespace: 'test-ns' })
    );
  });

  // -----------------------------------------------------------------------
  // Test 2: POST /api/fault/apply invalid mode -> 400
  // -----------------------------------------------------------------------
  test('POST /api/fault/apply invalid mode returns 400', async () => {
    const res = await request(app)
      .post('/api/fault/apply')
      .send({ target: { type: 'all' }, mode: 'bogus_mode' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -----------------------------------------------------------------------
  // Test 3: POST /api/fault/apply invalid target.type -> 400
  // -----------------------------------------------------------------------
  test('POST /api/fault/apply invalid target.type returns 400', async () => {
    const res = await request(app)
      .post('/api/fault/apply')
      .send({ target: { type: 'unknown_type' }, mode: 'http_500' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -----------------------------------------------------------------------
  // Test 4: POST /api/fault/reset returns 200, calls applyFault with mode=none
  // -----------------------------------------------------------------------
  test('POST /api/fault/reset returns 200 and calls applyFault with mode=none', async () => {
    applyFault.mockResolvedValue({ applied: ['pod-1'], skipped: [], errors: [] });

    const res = await request(app)
      .post('/api/fault/reset')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: ['pod-1'], skipped: [], errors: [] });
    expect(applyFault).toHaveBeenCalledWith(
      { type: 'all' },
      'none',
      0,
      expect.objectContaining({ client: mockClient, namespace: 'test-ns' })
    );
  });

  // -----------------------------------------------------------------------
  // Test 5: POST /api/fault/apply missing required target field -> 400
  // -----------------------------------------------------------------------
  test('POST /api/fault/apply missing target.pod for type=single returns 400', async () => {
    const res = await request(app)
      .post('/api/fault/apply')
      .send({ target: { type: 'single' }, mode: 'http_500' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
