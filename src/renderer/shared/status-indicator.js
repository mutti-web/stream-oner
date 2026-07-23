'use strict';

/**
 * MD3 風ステータス表示（md-icon + トークン色）。
 * 依存: material/bundle.js（md-icon）
 */
(function (global) {
  const KIND_META = {
    off: { icon: 'pause_circle', cls: 'is-off', short: '停止' },
    ok: { icon: 'check_circle', cls: 'is-ok', short: 'OK' },
    warn: { icon: 'info', cls: 'is-warn', short: '注意' },
    err: { icon: 'error', cls: 'is-err', short: 'エラー' },
    rec: { icon: 'fiber_manual_record', cls: 'is-rec', short: 'REC' },
  };

  /** @param {HTMLElement} el */
  function ensureStructure(el, style) {
    let icon = el.querySelector('md-icon');
    if (!icon) {
      icon = document.createElement('md-icon');
      el.prepend(icon);
    }
    let label = el.querySelector('.status-chip-label');
    if (style === 'chip') {
      if (!label) {
        label = document.createElement('span');
        label.className = 'status-chip-label';
        el.appendChild(label);
      }
    } else if (label) {
      label.remove();
    }
    return { icon, label };
  }

  /**
   * @param {HTMLElement|null} el
   * @param {'off'|'ok'|'warn'|'err'|'rec'} kind
   * @param {string} [title] tooltip / aria-label
   * @param {{ style?: 'icon'|'chip', label?: string, icon?: string }} [opts]
   */
  function apply(el, kind, title, opts = {}) {
    if (!el) return;
    const meta = KIND_META[kind] || KIND_META.off;
    const style = opts.style || 'icon';
    el.className = style === 'chip' ? `status-chip ${meta.cls}` : `status-indicator ${meta.cls}`;
    el.setAttribute('role', 'status');

    const aria = title || opts.label || meta.short;
    el.setAttribute('aria-label', aria);
    if (title) el.title = title;
    else el.removeAttribute('title');

    const { icon, label } = ensureStructure(el, style);
    icon.textContent = opts.icon || meta.icon;
    if (label) label.textContent = opts.label || meta.short;
  }

  global.StatusIndicator = { apply, KIND_META };
})(typeof window !== 'undefined' ? window : global);
