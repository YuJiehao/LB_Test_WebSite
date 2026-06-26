/**
 * dashboard.js -- Real-time SSE updates for the control-plane dashboard
 *
 * Listens on GET /api/events and:
 *  - pod_state_change: updates the target row's mode cell + status badge
 *  - drift_detected:   fires a warn toast via the global notice system
 *
 * The mergeStateChange function is exported as a named export so it can
 * be unit-tested via Jest + JSDOM without a browser.
 *
 * Strategy: IIFE with CommonJS detection.  When loaded via <script> in
 * the browser, it exposes mergeStateChange on window and auto-inits on
 * DOMContentLoaded.  When require'd in Node (Jest), it sets module.exports
 * and does NOT touch window.
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  //  mergeStateChange — extracted for testability (Task 5.4 REFACTOR)
  // -----------------------------------------------------------------------

  /**
   * Update a pod row's mode cell and status badge in-place.
   *
   * @param {Element} rowEl - <tr data-pod="..."> element
   * @param {{pod: string, mode: string}} payload - SSE event data
   */
  function mergeStateChange(rowEl, payload) {
    var modeCell = rowEl.querySelector('.pod-row__mode code');
    if (modeCell) {
      modeCell.textContent = payload.mode;
    }

    var badge = rowEl.querySelector('.badge');
    if (badge) {
      var isNone = payload.mode === 'none';
      var isSlow = payload.mode === 'slow';
      badge.className =
        'badge ' + (isNone ? 'status-ok' : isSlow ? 'status-warn' : 'status-err');
      badge.textContent = isNone ? 'Healthy' : isSlow ? 'Slow' : 'Fault';
    }
  }

  // -----------------------------------------------------------------------
  //  initDashboard — wire up EventSource listeners
  // -----------------------------------------------------------------------

  /**
   * Open an EventSource to /api/events and register handlers for
   * pod_state_change and drift_detected.
   */
  function initDashboard() {
    var es;

    try {
      es = new EventSource('/api/events');
    } catch (_) {
      return; // EventSource not available (e.g. no browser)
    }

    es.addEventListener('pod_state_change', function (e) {
      try {
        var data = JSON.parse(e.data);
        var row = document.querySelector('[data-pod="' + data.pod + '"]');
        if (row) {
          mergeStateChange(row, data);
        }
      } catch (_) {
        // ignore malformed events
      }
    });

    es.addEventListener('drift_detected', function (e) {
      try {
        var data = JSON.parse(e.data);
        var msg = data.message || JSON.stringify(data);
        if (window.notice && window.notice.toast) {
          window.notice.toast('Drift detected: ' + msg, 'warn');
        }
      } catch (_) {
        // ignore malformed events
      }
    });

    // Expose EventSource handle for debugging / testing
    window.__dashboardSSE = es;
  }

  // -----------------------------------------------------------------------
  //  Exports
  // -----------------------------------------------------------------------

  // Node.js / Jest: export module so tests can require() it
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      mergeStateChange: mergeStateChange,
      initDashboard: initDashboard,
    };
    return; // Skip browser init below
  }

  // Browser: expose on window and auto-init after DOM is ready
  window.mergeStateChange = mergeStateChange;
  window.initDashboard = initDashboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();
