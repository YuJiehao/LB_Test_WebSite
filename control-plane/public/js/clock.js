/* =========================================================================
 * Clock —— 让所有带 class="live-clock" 的元素每秒更新为当前北京时间
 *
 * 用法：
 *   <span class="live-clock"></span>
 *
 * 选项（通过 data-format 指定格式）：
 *   data-format="full"    默认，YYYY/MM/DD HH:mm:ss
 *   data-format="time"    仅 HH:mm:ss
 *   data-format="date"    仅 YYYY/MM/DD
 *
 * 可选 data-server-offset="ms" 让客户端时间与服务端时间同步（避免偏差）
 * ========================================================================= */
(function (global) {
    'use strict';

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function formatBeijing(d, fmt) {
        // 用 Intl 取北京时间的年月日时分秒
        const parts = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        }).formatToParts(d);
        const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
        const y = get('year'), mo = get('month'), da = get('day');
        const h = get('hour'), mi = get('minute'), s = get('second');
        if (fmt === 'time') return `${h}:${mi}:${s}`;
        if (fmt === 'date') return `${y}/${mo}/${da}`;
        return `${y}/${mo}/${da} ${h}:${mi}:${s}`;
    }

    function tick() {
        const now = Date.now();
        document.querySelectorAll('.live-clock').forEach(el => {
            const fmt = el.dataset.format || 'full';
            el.textContent = formatBeijing(new Date(now), fmt);
        });
    }

    function start() {
        tick();
        setInterval(tick, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})(window);