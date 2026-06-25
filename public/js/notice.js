/* =========================================================================
 * notice.js -- toast notifications + window.alert shim
 *
 * API:
 *   notice.toast(msg, type?, duration?)
 *     type:    'success' | 'error' | 'warn' | 'info' (default: info)
 *     duration: ms, 0 = no auto-dismiss, default 4000
 *
 *   notice.dismissAll()
 *
 * Auto-shims window.alert to route through notice.toast (error-detection by
 * keyword: 失败|错误|fail|err).  Pass { noShim: true } when including the
 * script if you want to keep native alert.
 * ========================================================================= */
(function () {
    'use strict';

    const ICON_SUCCESS = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const ICON_ERROR   = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const ICON_WARN    = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const ICON_INFO    = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    const ICON_MAP = {
        success: ICON_SUCCESS,
        error:   ICON_ERROR,
        warn:    ICON_WARN,
        info:    ICON_INFO,
    };

    const DEFAULT_DUR = 4000;
    const ERROR_DUR   = 6000;
    let _seq = 0;

    function ensureContainer() {
        let c = document.getElementById('notice-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'notice-container';
            c.className = 'notice-container';
            c.setAttribute('aria-live', 'polite');
            c.setAttribute('aria-atomic', 'false');
            document.body.appendChild(c);
        }
        return c;
    }

    function dismiss(el) {
        if (!el || !el.parentNode) return;
        el.classList.remove('notice--show');
        el.classList.add('notice--hide');
        setTimeout(() => el.remove(), 250);
    }

    function toast(msg, type, duration) {
        const t = (typeof type === 'string' && ICON_MAP[type]) ? type : 'info';
        const d = (typeof duration === 'number') ? duration
                : (t === 'error' ? ERROR_DUR : DEFAULT_DUR);
        const c = ensureContainer();
        const id = 'notice-' + (++_seq);
        const el = document.createElement('div');
        el.className = 'notice notice--' + t;
        el.id = id;
        el.setAttribute('role', t === 'error' ? 'alert' : 'status');
        el.innerHTML =
            '<div class="notice__icon">' + ICON_MAP[t] + '</div>' +
            '<div class="notice__body"></div>' +
            '<button class="notice__close" type="button" aria-label="关闭">' +
                '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>';
        el.querySelector('.notice__body').textContent = String(msg);
        el.querySelector('.notice__close').onclick = () => dismiss(el);
        c.appendChild(el);
        // animate in on next frame
        requestAnimationFrame(() => el.classList.add('notice--show'));
        if (d > 0) setTimeout(() => dismiss(el), d);
        return el;
    }

    function dismissAll() {
        document.querySelectorAll('.notice').forEach(dismiss);
    }

    // ---- Shim window.alert to route through toast ----
    const _origAlert = window.alert;
    const _errRe = /失败|错误|err\b|fail|exception/i;
    window.alert = function (msg) {
        if (msg == null) return;
        const s = String(msg);
        const type = _errRe.test(s) ? 'error' : 'info';
        return toast(s, type);
    };

    window.notice = { toast, dismiss, dismissAll };
})();
