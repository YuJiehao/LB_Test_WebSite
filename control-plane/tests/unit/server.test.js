const request = require('supertest');
const { app } = require('../../src/server');

describe('GET /healthz', () => {
  test('returns 200 with body "OK"', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});