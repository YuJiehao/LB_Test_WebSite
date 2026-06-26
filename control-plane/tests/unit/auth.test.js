'use strict';

const request = require('supertest');
const express = require('express');

describe('Basic Auth Middleware', () => {
  let app;

  beforeEach(() => {
    // Fresh Express app per test with auth middleware and a test route
    jest.resetModules();
    app = express();
  });

  // -----------------------------------------------------------------------
  //  When BASIC_AUTH_USER env is set
  // -----------------------------------------------------------------------
  describe('when BASIC_AUTH_USER is set', () => {
    beforeAll(() => {
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASS = 'secret';
    });

    afterAll(() => {
      delete process.env.BASIC_AUTH_USER;
      delete process.env.BASIC_AUTH_PASS;
    });

    test('rejects requests without Authorization header with 401', async () => {
      const { basicAuthMiddleware } = require('../../src/auth');
      app.use(basicAuthMiddleware);
      app.get('/test', (_req, res) => res.status(200).json({ ok: true }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Basic/i);
    });

    test('rejects requests with wrong credentials with 401', async () => {
      const { basicAuthMiddleware } = require('../../src/auth');
      app.use(basicAuthMiddleware);
      app.get('/test', (_req, res) => res.status(200).json({ ok: true }));

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Basic ${Buffer.from('admin:wrong').toString('base64')}`);
      expect(res.status).toBe(401);
    });

    test('allows requests with correct credentials', async () => {
      const { basicAuthMiddleware } = require('../../src/auth');
      app.use(basicAuthMiddleware);
      app.get('/test', (_req, res) => res.status(200).json({ ok: true }));

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Basic ${Buffer.from('admin:secret').toString('base64')}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  // -----------------------------------------------------------------------
  //  When BASIC_AUTH_USER is NOT set (dev mode) — middleware is no-op
  // -----------------------------------------------------------------------
  describe('when BASIC_AUTH_USER is not set (dev mode)', () => {
    beforeAll(() => {
      delete process.env.BASIC_AUTH_USER;
      delete process.env.BASIC_AUTH_PASS;
    });

    test('allows requests without any auth header', async () => {
      const { basicAuthMiddleware } = require('../../src/auth');
      app.use(basicAuthMiddleware);
      app.get('/test', (_req, res) => res.status(200).json({ ok: true }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
