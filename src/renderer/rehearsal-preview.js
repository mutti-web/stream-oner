(function () {
  'use strict';

  const CANVAS_W = 1920;
  const CANVAS_H = 1080;
  const HOST_IDS = {
    discord: 'host-discord',
    youtube: 'host-youtube',
    avatar: 'host-avatar',
  };

  let selectedPanel = null;
  let dragState = null;
  let resizeState = null;
  let layoutCache = null;
  let flagsCache = null;
  let editMode = false;

  const IS_UI_PREVIEW = !!window.__UI_PREVIEW__;

  function overlaySrc(panel) {
    const ts = Date.now();
    if (IS_UI_PREVIEW) return `/dev/overlay/${panel}?rehearsal=${ts}`;
    const ports = { discord: 3000, youtube: 3002, avatar: 3003 };
    return `http://127.0.0.1:${ports[panel]}/overlay?rehearsal=${ts}`;
  }

  function hostEl(panel) {
    return document.getElementById(HOST_IDS[panel]);
  }

  function panelFromHost(el) {
    return el?.dataset?.panel || null;
  }

  /** 本番 /suite と同様に配信 OFF のパネルは非表示 */
  function applyFlags(flags) {
    if (!flags || typeof flags !== 'object') return;
    flagsCache = flags;
    const map = {
      discordEnabled: 'discord',
      youtubeEnabled: 'youtube',
      avatarEnabled: 'avatar',
    };
    for (const [key, panel] of Object.entries(map)) {
      const el = hostEl(panel);
      if (!el || flags[key] === undefined) continue;
      el.style.display = flags[key] ? '' : 'none';
    }
  }

  async function refreshFlags() {
    try {
      const res = await fetch(`/suite-flags?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      applyFlags(await res.json());
    } catch (_) { /* retry */ }
  }

  function reapplyVisibility() {
    if (flagsCache) applyFlags(flagsCache);
  }

  /** Electron setZoomFactor 適用時はビューポート座標 ≠ 1920×1080 レイアウト座標 */
  function layoutScale() {
    const w = document.documentElement.clientWidth;
    return w > 0 ? w / CANVAS_W : 1;
  }

  function rectFromHost(el) {
    const scale = layoutScale();
    const bodyRect = document.body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      left: (r.left - bodyRect.left) / scale,
      top: (r.top - bodyRect.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    };
  }

  function rectFromStyle(el) {
    const st = el.style;
    const parsedLeft = parseFloat(st.left);
    const parsedTop = parseFloat(st.top);
    const parsedW = parseFloat(st.width);
    const parsedH = parseFloat(st.height);
    if (Number.isFinite(parsedLeft) && st.left && Number.isFinite(parsedTop) && st.top) {
      return {
        left: parsedLeft,
        top: parsedTop,
        width: Number.isFinite(parsedW) ? parsedW : el.offsetWidth,
        height: Number.isFinite(parsedH) ? parsedH : el.offsetHeight,
      };
    }
    return rectFromHost(el);
  }

  function clampRect(rect) {
    const w = Math.max(120, Math.min(CANVAS_W, Number(rect.width) || 400));
    const h = Math.max(80, Math.min(CANVAS_H, Number(rect.height) || 400));
    let left = Number(rect.left);
    let top = Number(rect.top);
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(top)) top = 0;
    left = Math.max(0, Math.min(CANVAS_W - w, left));
    top = Math.max(0, Math.min(CANVAS_H - h, top));
    return { left, top, width: w, height: h };
  }

  function applyPanelStyle(panel, rect) {
    const el = hostEl(panel);
    if (!el || !rect) return;
    const r = clampRect(rect);
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    el.style.visibility = 'visible';
    reapplyVisibility();
  }

  function reloadIframes() {
    const urls = {
      'layer-discord': overlaySrc('discord'),
      'layer-youtube': overlaySrc('youtube'),
      'layer-avatar': overlaySrc('avatar'),
    };
    for (const [id, url] of Object.entries(urls)) {
      const frame = document.getElementById(id);
      if (frame) frame.src = url;
    }
  }

  function layoutToRects(layout) {
    const out = {};
    for (const panel of ['discord', 'youtube', 'avatar']) {
      const p = layout[panel];
      if (!p) continue;
      const width = p.widthPx || 400;
      const height = p.heightPx || 400;
      let left;
      let top;
      if (p.anchor.includes('right')) {
        left = CANVAS_W - (p.offsetX || 0) - width;
      } else {
        left = p.offsetX || 0;
      }
      if (p.anchor.includes('top')) {
        top = p.offsetY || 0;
      } else {
        top = CANVAS_H - (p.offsetY || 0) - height;
      }
      out[panel] = clampRect({ left, top, width, height });
    }
    return out;
  }

  function rectToPanel(panel, rect, prev) {
    const anchor = prev?.anchor || (panel === 'avatar' ? 'bottom-left' : 'top-left');
    const r = clampRect(rect);
    const width = Math.round(r.width);
    const height = Math.round(r.height);
    let offsetX;
    let offsetY;
    if (anchor.includes('right')) {
      offsetX = Math.max(0, Math.round(CANVAS_W - r.left - width));
    } else {
      offsetX = Math.max(0, Math.round(r.left));
    }
    if (anchor.includes('top')) {
      offsetY = Math.max(0, Math.round(r.top));
    } else {
      offsetY = Math.max(0, Math.round(CANVAS_H - r.top - height));
    }
    return {
      anchor,
      offsetX,
      offsetY,
      widthPx: width,
      heightPx: height,
    };
  }

  /** 編集中は操作中・選択中パネル以外を同期（本番・設定・スロット切替との整合） */
  function panelsToSkipForSync() {
    if (dragState?.panel) return [dragState.panel];
    if (resizeState?.panel) return [resizeState.panel];
    if (editMode && selectedPanel) return [selectedPanel];
    return [];
  }

  function applyLayout(layout, skipPanels = []) {
    layoutCache = layout;
    const rects = layoutToRects(layout);
    for (const [panel, rect] of Object.entries(rects)) {
      if (skipPanels.includes(panel)) continue;
      applyPanelStyle(panel, rect);
    }
    reapplyVisibility();
  }

  async function fetchLayout() {
    try {
      const res = await fetch(`/rehearsal/layout?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = await res.json();
      applyLayout(next, panelsToSkipForSync());
    } catch (_) { /* retry */ }
  }

  async function savePanelLayout(panel) {
    const el = hostEl(panel);
    if (!el || !layoutCache) return;
    const rect = rectFromStyle(el);
    const next = { ...layoutCache };
    next[panel] = rectToPanel(panel, rect, layoutCache[panel]);
    const res = await fetch('/rehearsal/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel, layout: next[panel] }),
    });
    if (res.ok) layoutCache = next;
  }

  async function focusSettings(panel) {
    if (IS_UI_PREVIEW) {
      const map = {
        discord: 'suite-layout-discord',
        youtube: 'suite-layout-youtube',
        avatar: 'suite-layout-avatar',
      };
      const sectionId = map[panel] || 'suite-layout-editor';
      window.open(
        `/renderer/settings.html?tab=overlay&focus=${encodeURIComponent(sectionId)}`,
        '_blank',
      );
      return;
    }
    await fetch('/rehearsal/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel }),
    });
  }

  const PANEL_LABELS = {
    discord: 'Discord',
    youtube: 'YouTube チャット',
    avatar: 'アバター',
  };

  function updateEditModeUi() {
    const pill = document.getElementById('rehearsal-mode-pill');
    const btn = document.getElementById('rehearsal-edit-toggle');
    const hint = document.getElementById('rehearsal-toolbar-hint');
    const focusBtn = document.getElementById('rehearsal-focus-settings');
    if (pill) pill.textContent = editMode ? '編集中' : 'プレビュー';
    if (btn) {
      btn.textContent = editMode ? '編集を終了' : 'レイアウト編集を開始';
      btn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
    }
    if (hint) {
      if (editMode) {
        if (dragState || resizeState) {
          hint.textContent = 'ドラッグ中 — 他パネルの変更は終了後に反映されます';
        } else if (selectedPanel) {
          hint.textContent = `${PANEL_LABELS[selectedPanel] || selectedPanel} を選択中 — ドラッグで移動、右下でサイズ変更`;
        } else {
          hint.textContent = 'パネルをクリックして選択（他パネルは設定と同期されます）';
        }
      } else {
        hint.textContent = '本番と同じく OFF のパネルは非表示です';
      }
    }
    if (focusBtn) focusBtn.disabled = !editMode || !selectedPanel;
  }

  function setEditMode(on) {
    const wasEdit = editMode;
    editMode = !!on;
    document.body.classList.toggle('rehearsal-edit', editMode);
    if (!editMode) {
      selectedPanel = null;
      if (layoutCache) applyLayout(layoutCache);
      else fetchLayout();
    } else if (!wasEdit) {
      document.querySelectorAll('.layer-host').forEach((el) => {
        const panel = panelFromHost(el);
        if (panel) applyPanelStyle(panel, rectFromStyle(el));
      });
    }
    document.querySelectorAll('.layer-host').forEach((el) => {
      el.classList.toggle('layer-selected', editMode && panelFromHost(el) === selectedPanel);
    });
    updateEditModeUi();
  }

  function clearDragListeners() {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
  }

  function onDocumentPointerMove(e) {
    const scale = layoutScale();
    if (dragState) {
      const dx = (e.clientX - dragState.startX) / scale;
      const dy = (e.clientY - dragState.startY) / scale;
      applyPanelStyle(dragState.panel, {
        ...dragState.rect,
        left: dragState.rect.left + dx,
        top: dragState.rect.top + dy,
        width: dragState.rect.width,
        height: dragState.rect.height,
      });
    } else if (resizeState) {
      const dx = (e.clientX - resizeState.startX) / scale;
      const dy = (e.clientY - resizeState.startY) / scale;
      applyPanelStyle(resizeState.panel, {
        ...resizeState.rect,
        width: resizeState.rect.width + dx,
        height: resizeState.rect.height + dy,
      });
    }
  }

  async function onDocumentPointerUp() {
    clearDragListeners();
    const panel = dragState?.panel || resizeState?.panel;
    dragState = null;
    resizeState = null;
    updateEditModeUi();
    if (panel) await savePanelLayout(panel);
    await fetchLayout();
  }

  function onPointerDown(e) {
    if (!editMode) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    let host = null;
    for (const node of path) {
      if (node instanceof Element && node.classList?.contains('layer-host')) {
        host = node;
        break;
      }
    }
    if (!host) host = e.target.closest?.('.layer-host');
    if (!host) return;
    const panel = panelFromHost(host);
    if (!panel) return;
    e.preventDefault();
    e.stopPropagation();
    selectPanel(panel);
    const rect = rectFromStyle(host);
    const handle = path.find((n) => n instanceof Element && n.matches?.('[data-resize]'))
      || e.target.closest?.('[data-resize]');
    if (handle) {
      resizeState = { panel, startX: e.clientX, startY: e.clientY, rect: { ...rect } };
    } else {
      dragState = { panel, startX: e.clientX, startY: e.clientY, rect: { ...rect } };
    }
    updateEditModeUi();
    if (typeof host.setPointerCapture === 'function') {
      try { host.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    document.addEventListener('pointermove', onDocumentPointerMove);
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);
  }

  function selectPanel(panel) {
    selectedPanel = panel;
    document.querySelectorAll('.layer-host').forEach((el) => {
      el.classList.toggle('layer-selected', panelFromHost(el) === panel);
    });
    updateEditModeUi();
  }

  function bindUi() {
    document.getElementById('rehearsal-edit-toggle')?.addEventListener('click', () => {
      setEditMode(!editMode);
    });
    document.getElementById('rehearsal-focus-settings')?.addEventListener('click', () => {
      if (selectedPanel) focusSettings(selectedPanel);
    });
    document.querySelectorAll('.layer-host').forEach((el) => {
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('dblclick', () => {
        const panel = panelFromHost(el);
        if (panel) focusSettings(panel);
      });
    });
  }

  refreshFlags();
  fetchLayout();
  bindUi();
  updateEditModeUi();
  reloadIframes();
  setTimeout(reloadIframes, 800);
  setTimeout(reloadIframes, 2500);
  setInterval(refreshFlags, 1000);
  setInterval(fetchLayout, 1500);
})();
