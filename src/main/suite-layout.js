'use strict';

/**
 * 統合 OBS URL（/suite）上の iframe 配置と、既定レイアウトの検証
 *
 * @typedef {'top-left'|'top-right'|'bottom-left'|'bottom-right'} SuiteAnchor
 *
 * @typedef {Object} SuitePanelLayout
 * @property {SuiteAnchor} anchor
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {number} widthPx
 * @property {number} heightPx
 *
 * @typedef {Object} SuiteObsLayout
 * @property {SuitePanelLayout} discord
 * @property {SuitePanelLayout} youtube
 * @property {SuitePanelLayout} avatar
 */

const STORE_KEY = 'suite.obsLayout';

const ANCHORS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

const DEFAULT_LAYOUT = {
  discord: {
    anchor: 'top-left',
    offsetX: 12,
    offsetY: 12,
    widthPx: 340,
    heightPx: 420,
  },
  youtube: {
    anchor: 'bottom-right',
    offsetX: 12,
    offsetY: 12,
    widthPx: 440,
    heightPx: 720,
  },
  avatar: {
    anchor: 'bottom-left',
    offsetX: 0,
    offsetY: 0,
    widthPx: 960,
    heightPx: 420,
  },
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const OFFSET_X_MAX = CANVAS_W;
const OFFSET_Y_MAX = CANVAS_H;

function normalizePanel(raw, defaults) {
  const d = defaults;
  const anchor = ANCHORS.has(raw?.anchor) ? raw.anchor : d.anchor;
  return {
    anchor,
    offsetX: clamp(Number(raw?.offsetX ?? d.offsetX) || 0, 0, OFFSET_X_MAX),
    offsetY: clamp(Number(raw?.offsetY ?? d.offsetY) || 0, 0, OFFSET_Y_MAX),
    widthPx: clamp(Number(raw?.widthPx ?? d.widthPx) || d.widthPx, 120, 3840),
    heightPx: clamp(Number(raw?.heightPx ?? d.heightPx) || d.heightPx, 80, 2160),
  };
}

function normalizeLayout(raw) {
  return {
    discord: normalizePanel(raw?.discord, DEFAULT_LAYOUT.discord),
    youtube: normalizePanel(raw?.youtube, DEFAULT_LAYOUT.youtube),
    avatar: normalizePanel(raw?.avatar, DEFAULT_LAYOUT.avatar),
  };
}

function panelCss(layerId, panel) {
  const horiz = panel.anchor.includes('right') ? 'right' : 'left';
  const vert = panel.anchor.includes('top') ? 'top' : 'bottom';
  const offH = horiz === 'right' ? 'right' : 'left';
  const offV = vert === 'bottom' ? 'bottom' : 'top';
  const oppositeH = horiz === 'right' ? 'left' : 'right';
  const oppositeV = vert === 'bottom' ? 'top' : 'bottom';

  const width = `${panel.widthPx}px`;
  return (
    `#${layerId} {\n` +
    `  ${oppositeH}: auto;\n` +
    `  ${oppositeV}: auto;\n` +
    `  ${offH}: ${panel.offsetX}px;\n` +
    `  ${offV}: ${panel.offsetY}px;\n` +
    `  width: ${width};\n` +
    `  height: ${panel.heightPx}px;\n` +
    `}\n`
  );
}

const LAYER_IDS = {
  discord: 'layer-discord',
  youtube: 'layer-youtube',
  avatar: 'layer-avatar',
};

const REHEARSAL_HOST_IDS = {
  discord: 'host-discord',
  youtube: 'host-youtube',
  avatar: 'host-avatar',
};

function buildLayoutCss(layout, { rehearsal = false } = {}) {
  const L = normalizeLayout(layout);
  const ids = rehearsal ? REHEARSAL_HOST_IDS : LAYER_IDS;
  return (
    '/* suite.obsLayout — 設定画面「全般」で変更 */\n' +
    panelCss(ids.discord, L.discord) +
    panelCss(ids.youtube, L.youtube) +
    panelCss(ids.avatar, L.avatar)
  );
}

function getLayout(store) {
  const raw = store.get(STORE_KEY, null);
  return normalizeLayout(raw && typeof raw === 'object' ? raw : {});
}

function saveLayout(store, layout) {
  store.set(STORE_KEY, normalizeLayout(layout));
}

function injectLayoutIntoHtml(html, layout, opts = {}) {
  const css = buildLayoutCss(layout, opts);
  const marker = '/* SUITE_LAYOUT_INJECT */';
  if (html.includes(marker)) {
    return html.replace(
      /\/\* SUITE_LAYOUT_INJECT \*\/[\s\S]*?\/\* SUITE_LAYOUT_INJECT_END \*\//,
      `${marker}\n${css}/* SUITE_LAYOUT_INJECT_END */`,
    );
  }
  return html.replace('</style>', `${marker}\n${css}/* SUITE_LAYOUT_INJECT_END */\n</style>`);
}

module.exports = {
  STORE_KEY,
  DEFAULT_LAYOUT,
  ANCHORS,
  normalizeLayout,
  buildLayoutCss,
  getLayout,
  saveLayout,
  injectLayoutIntoHtml,
};
