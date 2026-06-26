/**
 * @jest-environment jsdom
 */

'use strict';

/**
 * Integration tests for dashboard real-time SSE updates (Task 5.4).
 *
 * Verifies that:
 * 1. Receiving a `pod_state_change` event updates the corresponding row's
 *    mode cell and status badge.
 * 2. Receiving a `drift_detected` event triggers a warn toast via the
 *    global notice system.
 *
 * Tests fail (RED) before dashboard.js is created and pass (GREEN) once
 * the EventSource listener and mergeStateChange function exist.
 */

// Dynamic require — will throw in RED (file does not exist yet),
// resolved in GREEN when public/js/dashboard.js is created.
let dashboard;
try {
  dashboard = require('../../public/js/dashboard');
} catch (_) {
  dashboard = null;
}

/**
 * Build a pod-row table row DOM fragment.
 */
function createPodRow(podName, mode, ip) {
  const row = document.createElement('tr');
  row.className = 'pod-row';
  row.dataset.pod = podName;
  row.innerHTML = [
    '<td class="pod-row__name">' + podName + '</td>',
    '<td class="pod-row__ip">' + (ip || '') + '</td>',
    '<td class="pod-row__mode"><code>' + mode + '</code></td>',
    '<td class="pod-row__status"><span class="badge ' +
      (mode === 'none' ? 'status-ok' : 'status-err') + '">' +
      (mode === 'none' ? 'Healthy' : 'Fault') + '</span></td>',
    '<td class="pod-row__actions"><button>Reset</button></td>',
  ].join('');
  return row;
}

describe('Dashboard SSE real-time updates', () => {
  let tbody;
  let toastCalls;
  let eventHandlers;

  beforeEach(() => {
    document.body.innerHTML = '';

    tbody = document.createElement('tbody');
    const table = document.createElement('table');
    table.className = 'pod-table';
    table.appendChild(tbody);
    document.body.appendChild(table);

    // Record toast calls
    toastCalls = [];
    window.notice = {
      toast: function (msg, type) {
        toastCalls.push({ msg: msg, type: type });
      },
    };

    // Mock EventSource
    eventHandlers = {};
    window.EventSource = jest.fn(function () {
      return {
        addEventListener: jest.fn(function (event, handler) {
          eventHandlers[event] = handler;
        }),
        close: jest.fn(),
      };
    });
  });

  // -----------------------------------------------------------------------
  // Test 1: mergeStateChange function is exported
  // -----------------------------------------------------------------------
  test('dashboard module exports mergeStateChange function', () => {
    // RED: dashboard is null because require fails
    // GREEN: dashboard.mergeStateChange is a function
    expect(dashboard).not.toBeNull();
    expect(typeof dashboard.mergeStateChange).toBe('function');
  });

  // -----------------------------------------------------------------------
  // Test 2: mergeStateChange updates mode cell and badge
  // -----------------------------------------------------------------------
  test('mergeStateChange updates pod row mode and status', () => {
    // This test only runs once dashboard.js exists (GREEN)
    const row = createPodRow('web-0', 'none', '10.0.0.1');
    tbody.appendChild(row);

    dashboard.mergeStateChange(row, { pod: 'web-0', mode: 'http_500' });

    const modeCell = row.querySelector('.pod-row__mode code');
    expect(modeCell.textContent).toBe('http_500');

    const badge = row.querySelector('.badge');
    expect(badge.textContent).toBe('Fault');
    expect(badge.className).toContain('status-err');
  });

  // -----------------------------------------------------------------------
  // Test 3: drift_detected triggers warn toast via EventSource
  // -----------------------------------------------------------------------
  test('drift_detected EventSource event triggers warn toast', () => {
    // This test only runs once dashboard.js exists (GREEN)
    dashboard.initDashboard();

    expect(eventHandlers.drift_detected).toBeDefined();

    eventHandlers.drift_detected({
      data: JSON.stringify({ message: 'ConfigMaps drifted' }),
    });

    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0].type).toBe('warn');
    expect(toastCalls[0].msg).toContain('Drift');
  });
});
