/**
 * dashboard.js — Control-plane dashboard interactivity
 *
 * Responsibilities:
 *  - Radio-button ↔ inline-input enable/disable
 *  - AJAX form submission (no page reload)
 *  - SSE real-time pod-state updates
 *  - Toast feedback for errors / drift
 *
 * Exports: mergeStateChange, initDashboard (for Jest tests)
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
    if (!rowEl || !payload || typeof payload.mode !== 'string') {
      return;
    }
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
  //  Radio → inline-input toggle
  // -----------------------------------------------------------------------

  /**
   * Enable the text / number input that belongs to the selected radio and
   * disable all others.  Each inline input carries a `data-target-type`
   * attribute matching the radio value so the mapping is explicit.
   */
  function syncInlineInputs(form) {
    var checked = form.querySelector('input[name="target[type]"]:checked');
    var activeType = checked ? checked.value : 'all';

    var inputs = form.querySelectorAll('.action-form__inline-input[data-target-type]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].disabled = (inputs[i].getAttribute('data-target-type') !== activeType);
    }
  }

  /**
   * Attach change listeners to every target-type radio in the given form.
   */
  function wireInlineInputs(form) {
    var radios = form.querySelectorAll('input[name="target[type]"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function () {
        syncInlineInputs(form);
      });
    }
    // initial state
    syncInlineInputs(form);
  }

  // -----------------------------------------------------------------------
  //  AJAX form submission
  // -----------------------------------------------------------------------

  /**
   * Serialise a <form> whose inputs use bracket notation
   * (e.g. target[type], target[pod]) into a flat JSON object.
   */
  function serialiseForm(form) {
    var fd = new FormData(form);
    var obj = {};
    fd.forEach(function (val, key) {
      // Only include non-empty values for optional fields
      if (val === '' || val === undefined) return;
      obj[key] = val;
    });
    return obj;
  }

  /**
   * Build the JSON body the control-plane API expects from flat
   * FormData-style keys.
   *
   * FormData gives us:
   *   target[type]   = "single"
   *   target[pod]    = "load-balancer-test-deployment-xxx"
   *   target[selector]    = "app=lb-test"
   *   target[percent]     = "25"
   *   mode           = "http_500"
   *   slowDelayMs    = "3000"
   *
   * API expects:
   *   { target: { type: "single", pod: "..." }, mode: "http_500", slowDelayMs: 3000 }
   */
  function buildPayload(flat) {
    var target = { type: flat['target[type]'] || 'all' };
    if (target.type === 'single' && flat['target[pod]']) {
      target.pod = flat['target[pod]'];
    }
    if (target.type === 'selector' && flat['target[selector]']) {
      target.selector = flat['target[selector]'];
    }
    if (target.type === 'canary' && flat['target[percent]']) {
      target.percent = parseInt(flat['target[percent]'], 10) || 0;
    }

    var payload = {
      target: target,
      mode: flat['mode'] || 'none',
    };
    if (flat['slowDelayMs']) {
      payload.slowDelayMs = parseInt(flat['slowDelayMs'], 10) || 0;
    }
    return payload;
  }

  /**
   * Intercept the fault-apply form and POST as JSON via fetch().
   */
  function wireFormSubmit(form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Applying…';
      }

      var flat = serialiseForm(form);
      var payload = buildPayload(flat);

      fetch('/api/fault/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok, status: res.status, body: body };
          });
        })
        .then(function (result) {
          if (result.ok) {
            var count =
              result.body && Array.isArray(result.body.applied)
                ? result.body.applied.length
                : 0;
            window.notice.toast('Fault applied to ' + count + ' pod(s)', 'success');
          } else {
            var msg =
              (result.body && result.body.error) ||
              'Unexpected error (HTTP ' + result.status + ')';
            window.notice.toast(msg, 'error');
          }
        })
        .catch(function (err) {
          window.notice.toast('Request failed: ' + err.message, 'error');
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Apply Fault';
          }
        });
    });
  }

  // -----------------------------------------------------------------------
  //  SSE — EventSource for real-time pod state
  // -----------------------------------------------------------------------

  function initSSE() {
    var es;

    try {
      es = new EventSource('/api/events');
    } catch (_) {
      return; // EventSource not available
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
  //  initDashboard — wire everything up
  // -----------------------------------------------------------------------

  function initDashboard() {
    var form = document.querySelector('.action-form');
    if (form) {
      wireInlineInputs(form);
      wireFormSubmit(form);
    }
    initSSE();
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
