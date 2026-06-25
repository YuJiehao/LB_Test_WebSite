/* =========================================================================
 * theme.js -- dark mode manager
 *
 * Storage key:  'lb-test-theme'  ('light' | 'dark' | absent = follow system)
 *
 * The script runs in <head> to set data-theme BEFORE the first paint
 * (avoids FOUC).  It also wires up #theme-toggle button if present.
 * ========================================================================= */
(function () {
    'use strict';

    const STORAGE_KEY = 'lb-test-theme';
    const root = document.documentElement;

    function getSystemPref() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function getStoredPref() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function getCurrentTheme() {
        const stored = getStoredPref();
        return (stored === 'light' || stored === 'dark') ? stored : getSystemPref();
    }

    function applyTheme(theme) {
        root.setAttribute('data-theme', theme);
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            const isDark = (theme === 'dark');
            const label = isDark ? '切换到浅色模式' : '切换到深色模式';
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
            const sun  = btn.querySelector('.theme-icon-sun');
            const moon = btn.querySelector('.theme-icon-moon');
            if (sun)  sun.style.display  = isDark ? '' : 'none';
            if (moon) moon.style.display = isDark ? 'none' : '';
        }
    }

    function toggle() {
        const next = (getCurrentTheme() === 'dark') ? 'light' : 'dark';
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* private mode */ }
        applyTheme(next);
    }

    // Apply early to prevent FOUC
    applyTheme(getCurrentTheme());

    // React to system change only if user has not set a manual preference
    if (window.matchMedia) {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        mql.addEventListener('change', function (e) {
            if (!getStoredPref()) applyTheme(e.matches ? 'dark' : 'light');
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.addEventListener('click', toggle);
        applyTheme(getCurrentTheme());
    });

    window.theme = { toggle: toggle, apply: applyTheme, current: getCurrentTheme };
})();
