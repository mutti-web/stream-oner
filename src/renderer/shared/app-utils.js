'use strict';

/**
 * 設定・ダッシュボードで共通の小さなユーティリティ。
 */
(function (global) {
  function linesToArray(text) {
    return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }

  function arrayToLines(arr) {
    return arr && arr.length ? arr.join('\n') : '';
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const fbTimers = {};
  function showFb(id, msg, type = 'ok') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'app-fb ' + type;
    clearTimeout(fbTimers[id]);
    fbTimers[id] = setTimeout(() => { el.className = 'app-fb'; }, 3000);
  }

  function copyTextToClipboard(text, onDone) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      if (typeof onDone === 'function') onDone();
    });
  }

  function wireAutoSavePanel(panelId, debouncedSave, opts = {}) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const skip = new Set(opts.skipIds || []);
    const suppress = () => (opts.getSuppress?.() ?? 0) > 0;

    panel.addEventListener('change', (e) => {
      if (suppress() || skip.has(e.target.id)) return;
      debouncedSave();
    });
    panel.addEventListener('input', (e) => {
      if (suppress() || skip.has(e.target.id)) return;
      const tag = e.target.tagName;
      if (tag === 'MD-OUTLINED-TEXT-FIELD' || tag === 'MD-OUTLINED-SELECT' ||
          tag === 'TEXTAREA' || e.target.type === 'text' ||
          e.target.type === 'number' || e.target.type === 'password') {
        debouncedSave();
      }
    });
  }

  global.AppUtils = {
    linesToArray,
    arrayToLines,
    debounce,
    showFb,
    copyTextToClipboard,
    wireAutoSavePanel,
  };
})(typeof window !== 'undefined' ? window : global);
