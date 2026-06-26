/* =========================================================================
 * Logger —— 复用日志打印 helper
 *
 * 用法：
 *   const log = makeLogger('ws-log', { maxLines: 300 });
 *   log('✅ 已连接', 'log-ws');
 *
 * 选项：
 *   - maxLines:  日志最大行数（超出从顶部裁剪），默认 300
 *   - timestamp: 是否在每行前面加时间戳，默认 true
 * ========================================================================= */
(function (global) {
    'use strict';

    function makeLogger(elementId, options) {
        const opts = Object.assign({ maxLines: 300, timestamp: true }, options || {});
        const el = document.getElementById(elementId);
        if (!el) {
            return function () { /* noop if element missing */ };
        }

        return function append(text, cls) {
            const line = document.createElement('div');
            line.className = 'log-line' + (cls ? ' ' + cls : '');
            line.textContent = opts.timestamp
                ? '[' + new Date().toLocaleTimeString() + '] ' + text
                : text;
            el.appendChild(line);
            el.scrollTop = el.scrollHeight;
            // cap log lines
            while (el.childElementCount > opts.maxLines) {
                el.removeChild(el.firstChild);
            }
        };
    }

    global.makeLogger = makeLogger;
})(window);