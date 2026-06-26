'use strict';

/**
 * Unit tests for src/fault/poll.js#pollPod
 *
 * Verifies per-Pod HTTP state polling with timeout and error handling.
 * Uses a mocked global.fetch (Node 18+) instead of nock for a lighter
 * dependency footprint.
 */

describe('pollPod()', () => {
  const POD = { name: 'web-0', ip: '10.0.0.1', nodeName: 'node-a' };
  const FAULT_URL = `http://${POD.ip}:3000/api/fault`;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = undefined;
  });

  test('returns fault state with reachable=true on successful response', async () => {
    const responseBody = { mode: 'http_500', slowDelayMs: 4000, updatedBy: 'admin@lb-test' };
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(responseBody),
    });

    const { pollPod } = require('../../src/fault/poll');
    const result = await pollPod(POD);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      FAULT_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual({
      mode: 'http_500',
      slowDelayMs: 4000,
      updatedBy: 'admin@lb-test',
      reachable: true,
    });
  });

  test('returns reachable=false on AbortError (timeout)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    global.fetch.mockRejectedValue(abortError);

    // Use a short timeout so the test runs fast.
    const { pollPod } = require('../../src/fault/poll');
    const result = await pollPod(POD, 50);

    expect(result).toEqual({
      mode: 'unknown',
      slowDelayMs: 0,
      updatedBy: '',
      reachable: false,
    });
  });

  test('returns reachable=false on connection refused / fetch rejection', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'));

    const { pollPod } = require('../../src/fault/poll');
    const result = await pollPod(POD);

    expect(result).toEqual({
      mode: 'unknown',
      slowDelayMs: 0,
      updatedBy: '',
      reachable: false,
    });
  });
});
