const WS_URL = 'ws://127.0.0.1:3003';

/** 設定のプレビュー窓のみ（/overlay?preview=1）。OBS 配信ではラベル・プレースホルダーを出さない */
const IS_PREVIEW = /(?:^|[?&])preview=1(?:&|$)/.test(location.search);
if (IS_PREVIEW) document.body.classList.add('preview-mode');

const AC = window.AvatarConstants || {};
const DEFAULT_LAYER_Z = AC.DEFAULT_LAYER_Z || {
  body: 10, face: 15, hair1: 20, eyes: 30, mouth: 40, nose: 42, hair2: 50,
};
const JIGGLE_HOLD_MS = AC.JIGGLE_HOLD_MS ?? 400;
const SINE_ROT_PER_AMP = AC.SINE_ROT_PER_AMP ?? 0.006;
const DEFAULT_JIGGLE_STRENGTH = AC.DEFAULT_JIGGLE_STRENGTH ?? 0.08;
const OBS_HIDDEN_TICK_MS = AC.OBS_HIDDEN_TICK_MS ?? 50;
const LEVEL_LERP_OPEN = AC.LEVEL_LERP_OPEN ?? 0.38;
const LEVEL_LERP_CLOSE = AC.LEVEL_LERP_CLOSE ?? 0.14;

function lerp(a, b, t) { return a + (b - a) * t; }

function layerZ(cfg, name) {
  const L = cfg?.layers || {};
  const n = Number(L[name]?.zIndex);
  return Number.isFinite(n) ? n : (DEFAULT_LAYER_Z[name] ?? 30);
}

function applyLayerStacking(s) {
  if (!s.cfg || !s.useLayers) return;
  const imgs = s.imgs;
  if (imgs.body) imgs.body.style.zIndex = String(layerZ(s.cfg, 'body'));
  if (imgs.face) imgs.face.style.zIndex = String(layerZ(s.cfg, 'face'));
  if (imgs.hair1) imgs.hair1.style.zIndex = String(layerZ(s.cfg, 'hair1'));
  if (imgs.hair2) imgs.hair2.style.zIndex = String(layerZ(s.cfg, 'hair2'));
  if (imgs.eyes) imgs.eyes.style.zIndex = String(layerZ(s.cfg, 'eyes'));
  if (imgs.mouth) imgs.mouth.style.zIndex = String(layerZ(s.cfg, 'mouth'));
  if (imgs.nose) imgs.nose.style.zIndex = String(layerZ(s.cfg, 'nose'));
  if (s.attach) {
    const attachZ = Math.min(
      layerZ(s.cfg, 'eyes'),
      layerZ(s.cfg, 'mouth'),
      layerZ(s.cfg, 'nose'),
    ) - 1;
    s.attach.style.zIndex = String(attachZ);
  }
}

function hasAnyAssetUrl(assets) {
  return Object.values(assets || {}).some((u) => !!u);
}

function ensurePreviewLabel(slotEl, id) {
  let label = document.getElementById(`label-${id}`);
  if (!label) {
    label = document.createElement('div');
    label.className = 'avatar-label';
    label.id = `label-${id}`;
    label.textContent = id === 'p1' ? 'A' : 'B';
    const body = document.getElementById(`body-${id}`);
    slotEl.insertBefore(label, body);
  }
  return label;
}

function createSlotDom(id) {
  const slot = document.getElementById(`slot-${id}`);
  const body = document.getElementById(`body-${id}`);
  if (!slot || !body) {
    console.error('[Avatar] DOM missing for slot', id, { slot: !!slot, body: !!body });
    return null;
  }
  const label = IS_PREVIEW ? ensurePreviewLabel(slot, id) : null;
  const placeholderHtml = IS_PREVIEW
    ? `<div class="placeholder ${id === 'p1' ? 'p1' : 'p2'}" data-ph>A</div>`
    : '';
  body.innerHTML = `
    <div class="layer-root layer-mode" hidden>
      <div class="layer-rig" data-rig>
        <img class="layer-img" data-layer="body" alt="" hidden />
        <img class="layer-img" data-layer="face" alt="" hidden />
        <img class="layer-img" data-layer="hair1" alt="" hidden />
        <div class="layer-attach" data-attach>
          <img class="layer-img" data-layer="eyes" alt="" hidden />
          <img class="layer-img layer-pupil" data-layer="pupil" alt="" hidden />
          <img class="layer-img" data-layer="mouth" alt="" hidden />
          <img class="layer-img" data-layer="nose" alt="" hidden />
        </div>
        <img class="layer-img" data-layer="hair2" alt="" hidden />
        <div class="layer-customs" data-customs></div>
      </div>
    </div>
    <img class="composite-img" data-composite alt="" hidden />
    ${placeholderHtml}
    <div class="mouth-bar"></div>
  `;

  return {
    id,
    el: slot,
    label,
    body,
    root: body.querySelector('.layer-mode'),
    rig: body.querySelector('[data-rig]'),
    attach: body.querySelector('[data-attach]'),
    customsRoot: body.querySelector('[data-customs]'),
    imgs: {
      body: body.querySelector('[data-layer="body"]'),
      face: body.querySelector('[data-layer="face"]'),
      hair1: body.querySelector('[data-layer="hair1"]'),
      hair2: body.querySelector('[data-layer="hair2"]'),
      eyes: body.querySelector('[data-layer="eyes"]'),
      pupil: body.querySelector('[data-layer="pupil"]'),
      mouth: body.querySelector('[data-layer="mouth"]'),
      nose: body.querySelector('[data-layer="nose"]'),
    },
    composite: body.querySelector('[data-composite]'),
    ph: body.querySelector('[data-ph]'),
    cfg: null,
    assets: {},
    speaking: false,
    laughing: false,
    level: 0,
    smoothLevel: 0,
    vowel: null,
    peakJiggle: 1,
    smoothJiggle: 1,
    jiggleHoldUntil: 0,
    useLayers: false,
    attachX: 0, attachY: 0, attachRot: 0,
    rigX: 0, rigY: 0, rigRot: 0,
    blinkUntil: 0,
    nextBlinkAt: 0,
    pupilX: 0,
    pupilY: 0,
    pupilTargetX: 0,
    pupilTargetY: 0,
    pupilNextMoveAt: 0,
    customImgs: [],
  };
}

const slots = { p1: null, p2: null };
slots.p1 = createSlotDom('p1');
slots.p2 = createSlotDom('p2');
if (!slots.p1 || !slots.p2) {
  console.error('[Avatar] スロット初期化に失敗しました。avatar-overlay.html の構造を確認してください。');
}

const preloadedUrls = new Set();

function preloadAssetUrl(url) {
  if (!url || preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

function preloadSlotAssets(assets) {
  if (!assets) return;
  for (const url of Object.values(assets)) preloadAssetUrl(url);
}

function setSrc(el, url) {
  if (!el) return;
  if (!url) { el.hidden = true; el.removeAttribute('src'); return; }
  el.hidden = false;
  if (el.src !== url) el.src = url;
}

function sineOffset(layer, tMs) {
  const s = layer.sine;
  if (!s || !s.enabled) return { x: 0, y: 0, rot: 0 };
  const w = (2 * Math.PI * tMs) / (Math.max(800, s.periodMs) || 4000);
  const p = s.phase || 0;
  const amp = s.amp || 0;
  return {
    x: 0,
    y: amp * Math.sin(w + p),
    rot: amp * SINE_ROT_PER_AMP * Math.sin(w + p * 0.7),
  };
}

function hasAssetUrl(assets, key) {
  return !!(assets && assets[key]);
}

function pickMouthAsset(s, tNow) {
  const a = s.assets;
  if (s.laughing) {
    return a['mouth-smile'] || (hasAssetUrl(a, 'mouth-open') ? a['mouth-open'] : null)
      || (hasAssetUrl(a, 'mouth-closed') ? a['mouth-closed'] : null);
  }
  if (s.speaking) {
    const v = s.vowel;
    if (v) {
      const vk = `mouth-${v}`;
      if (hasAssetUrl(a, vk)) return a[vk];
    }
    if (hasAssetUrl(a, 'mouth-open')) return a['mouth-open'];
    if (hasAssetUrl(a, 'mouth-closed')) return a['mouth-closed'];
    return null;
  }
  if (hasAssetUrl(a, 'mouth-closed')) return a['mouth-closed'];
  return null;
}

function pickEyesAsset(s, tNow) {
  const a = s.assets;
  if (s.laughing) return a['eyes-smile'] || a['eyes-normal'] || null;
  if (tNow < s.blinkUntil && a['eyes-blink']) return a['eyes-blink'];
  return a['eyes-normal'] || null;
}

function pickComposite(s) {
  const a = s.assets;
  if (s.laughing) {
    return a['mouth-smile'] || (hasAssetUrl(a, 'mouth-open') ? a['mouth-open'] : null)
      || (hasAssetUrl(a, 'mouth-closed') ? a['mouth-closed'] : null);
  }
  if (s.speaking) {
    const v = s.vowel;
    if (v && hasAssetUrl(a, `mouth-${v}`)) return a[`mouth-${v}`];
    if (hasAssetUrl(a, 'mouth-open')) return a['mouth-open'];
    if (hasAssetUrl(a, 'mouth-closed')) return a['mouth-closed'];
    return a.face || a.body || null;
  }
  if (hasAssetUrl(a, 'mouth-closed')) return a['mouth-closed'];
  return a.face || a.body || null;
}

/** 旧設定（体1枚）: face 未設定時は body PNG を顔レイヤーに表示 */
function applyBodyFaceLayers(s) {
  const a = s.assets;
  if (a.face) {
    setSrc(s.imgs.body, a.body);
    setSrc(s.imgs.face, a.face);
  } else if (a.body) {
    setSrc(s.imgs.body, null);
    setSrc(s.imgs.face, a.body);
  } else {
    setSrc(s.imgs.body, a['mouth-closed'] || a['mouth-open'] || null);
    setSrc(s.imgs.face, null);
  }
}

function naturalBlinkDelayMs(cfg) {
  const min = (cfg.blinkMinSec || 3) * 1000;
  const max = (cfg.blinkMaxSec || 7) * 1000;
  if (max <= min) return min;
  // 三角分布（2つの一様乱数の平均）で中央付近に寄せ、不自然な長い空白を減らす
  const u = (Math.random() + Math.random()) / 2;
  return min + u * (max - min);
}

function scheduleBlink(s) {
  s.nextBlinkAt = performance.now() + naturalBlinkDelayMs(s.cfg);
}

function rebuildCustomLayers(s) {
  if (!s.customsRoot) return;
  s.customsRoot.innerHTML = '';
  s.customImgs = [];
  const layers = s.cfg?.customLayers || [];
  for (const cl of layers) {
    const assetKey = `custom-${cl.id}`;
    const url = s.assets[assetKey];
    if (!url) continue;
    const img = document.createElement('img');
    img.className = 'layer-img layer-custom';
    img.alt = '';
    img.dataset.customId = cl.id;
    img.style.zIndex = String(cl.zIndex || 45);
    s.customsRoot.appendChild(img);
    s.customImgs.push({ cfg: cl, img, assetKey });
    setSrc(img, url);
  }
}

function getAnchorTransform(s, anchor, t, faceS, h1, h2) {
  const L = s.cfg.layers || {};
  switch (anchor) {
    case 'rig':
      return { x: s.rigX, y: s.rigY, rot: s.rigRot, scale: 1 };
    case 'attach':
      return { x: s.attachX, y: s.attachY, rot: s.attachRot, scale: 1 };
    case 'body': {
      const bodyS = sineOffset(L.body || {}, t);
      return {
        x: (L.body?.offsetX || 0),
        y: (L.body?.offsetY || 0) + bodyS.y,
        rot: bodyS.rot,
        scale: L.body?.scale || 1,
      };
    }
    case 'face':
      return {
        x: (L.face?.offsetX || 0),
        y: (L.face?.offsetY || 0) + faceS.y,
        rot: faceS.rot,
        scale: L.face?.scale || 1,
      };
    case 'hair1':
      return {
        x: (L.hair1?.offsetX || 0),
        y: (L.hair1?.offsetY || 0) + h1.y,
        rot: h1.rot,
        scale: L.hair1?.scale || 1,
      };
    case 'hair2':
      return {
        x: (L.hair2?.offsetX || 0),
        y: (L.hair2?.offsetY || 0) + h2.y,
        rot: h2.rot,
        scale: L.hair2?.scale || 1,
      };
    case 'eyes':
      return {
        x: (L.eyes?.offsetX || 0),
        y: (L.eyes?.offsetY || 0),
        rot: 0,
        scale: L.eyes?.scale || 1,
      };
    case 'mouth':
      return {
        x: (L.mouth?.offsetX || 0),
        y: (L.mouth?.offsetY || 0),
        rot: 0,
        scale: L.mouth?.scale || 1,
      };
    case 'nose':
      return {
        x: (L.nose?.offsetX || 0),
        y: (L.nose?.offsetY || 0) + faceS.y,
        rot: faceS.rot,
        scale: L.nose?.scale || 1,
      };
    default:
      return { x: 0, y: 0, rot: 0, scale: 1 };
  }
}

function isAttachChildAnchor(anchor) {
  return anchor === 'eyes' || anchor === 'mouth' || anchor === 'nose';
}

function applyCustomLayerTransforms(s, t, faceS, h1, h2) {
  for (const item of s.customImgs || []) {
    const cl = item.cfg;
    const parent = getAnchorTransform(s, cl.parentAnchor || 'body', t, faceS, h1, h2);
    let baseX = parent.x;
    let baseY = parent.y;
    let baseRot = parent.rot;
    if (isAttachChildAnchor(cl.parentAnchor)) {
      baseX += s.attachX;
      baseY += s.attachY;
      baseRot += s.attachRot;
    } else if (cl.parentAnchor !== 'attach' && cl.parentAnchor !== 'rig') {
      baseX += s.rigX;
      baseY += s.rigY;
      baseRot += s.rigRot;
    }
    const sc = (cl.scale || 1) * (parent.scale || 1);
    const x = baseX + (cl.offsetX || 0);
    const y = baseY + (cl.offsetY || 0);
    item.img.style.transform = `translate(${x}px, ${y}px) scale(${sc}) rotate(${baseRot}rad)`;
  }
}

function updateLookAt(s, t) {
  const cfg = s.cfg || {};
  const max = Number(cfg.pupilOffsetMax) || 4;
  const pupil = s.imgs.pupil;
  if (!cfg.lookAtEnabled || !hasAssetUrl(s.assets, 'eyes-pupil') || !pupil) {
    if (pupil) pupil.hidden = true;
    return;
  }
  if (t >= (s.pupilNextMoveAt || 0)) {
    s.pupilTargetX = (Math.random() * 2 - 1) * max;
    s.pupilTargetY = (Math.random() * 2 - 1) * max * 0.65;
    s.pupilNextMoveAt = t + 1800 + Math.random() * 3200;
  }
  s.pupilX = lerp(s.pupilX || 0, s.pupilTargetX || 0, 0.06);
  s.pupilY = lerp(s.pupilY || 0, s.pupilTargetY || 0, 0.06);
  setSrc(pupil, s.assets['eyes-pupil']);
  const L = cfg.layers?.eyes || {};
  const ex = (L.offsetX || 0) + s.pupilX;
  const ey = (L.offsetY || 0) + s.pupilY;
  pupil.style.transform = `translate(${ex}px, ${ey}px) scale(${L.scale || 1})`;
  pupil.style.zIndex = String((Number(L.zIndex) || layerZ(cfg, 'eyes')) + 1);
}

/** スロット（ラベル含む）全体の位置 — パネルサイズに対する % */
function slotOffsetPx(cfg) {
  const AC = typeof AvatarConstants !== 'undefined' ? AvatarConstants : {};
  const refW = AC.SLOT_REF_W || 960;
  const refH = AC.SLOT_REF_H || 420;
  const stage = document.getElementById('stage');
  const w = stage?.clientWidth || refW;
  const h = stage?.clientHeight || refH;
  const xPct = Number(cfg?.slotOffsetXPct);
  const yPct = Number(cfg?.slotOffsetYPct);
  if (Number.isFinite(xPct) || Number.isFinite(yPct)) {
    return {
      ox: (Number.isFinite(xPct) ? xPct : 0) / 100 * w,
      oy: (Number.isFinite(yPct) ? yPct : 0) / 100 * h,
    };
  }
  return {
    ox: Number(cfg?.slotOffsetX) || 0,
    oy: Number(cfg?.slotOffsetY) || 0,
  };
}

function applyAllSlotPositions() {
  applySlotPosition(slots.p1);
  applySlotPosition(slots.p2);
}

let stageResizeObserver = null;

function wireStageResizeObserver() {
  const stage = document.getElementById('stage');
  if (!stage || stageResizeObserver || typeof ResizeObserver === 'undefined') return;
  stageResizeObserver = new ResizeObserver(() => applyAllSlotPositions());
  stageResizeObserver.observe(stage);
}

/** スロット（ラベル含む）全体の位置 */
function applySlotPosition(s) {
  if (!s?.el) return;
  const { ox, oy } = slotOffsetPx(s.cfg);
  s.el.style.transform = (ox === 0 && oy === 0) ? '' : `translate(${ox}px, ${oy}px)`;
}

/** スロット全体を中心基準で水平・垂直反転 */
function applySlotFlip(s) {
  if (!s?.body) return;
  const fx = s.cfg?.flipX ? -1 : 1;
  const fy = s.cfg?.flipY ? -1 : 1;
  s.body.style.transform = (fx === 1 && fy === 1) ? '' : `scale(${fx}, ${fy})`;
}

function applySlotConfig(key, data) {
  const s = slots[key];
  if (!s) return;
  s.cfg = data;
  s.assets = data.assets || {};
  preloadSlotAssets(s.assets);
  const hasAssets = hasAnyAssetUrl(s.assets);
  s.useLayers = !!data.useLayers && hasAssets;

  if (s.useLayers) {
    s.root.hidden = false;
    s.composite.hidden = true;
    if (s.ph) s.ph.hidden = true;
    s.el.classList.add('has-layers');
    applyBodyFaceLayers(s);
    setSrc(s.imgs.hair1, s.assets.hair1);
    setSrc(s.imgs.hair2, s.assets.hair2);
    setSrc(s.imgs.nose, s.assets.nose);
    applyLayerStacking(s);
    rebuildCustomLayers(s);
  } else if (hasAssets) {
    s.root.hidden = true;
    s.composite.hidden = false;
    if (s.ph) s.ph.hidden = true;
    s.el.classList.remove('has-layers');
    setSrc(
      s.composite,
      s.assets['mouth-closed'] || s.assets['mouth-open'] || s.assets.body || s.assets['mouth-smile'],
    );
  } else {
    s.root.hidden = true;
    s.composite.hidden = true;
    s.el.classList.remove('has-layers');
    if (IS_PREVIEW && s.ph) {
      s.ph.hidden = false;
      s.ph.textContent = (s.label?.textContent || key).charAt(0).toUpperCase();
    } else if (s.ph) {
      s.ph.hidden = true;
    }
  }
  applySlotPosition(s);
  applySlotFlip(s);
  scheduleBlink(s);
}

function applyDisplayMode(mode) {
  const m = mode === 'p1' || mode === 'p2' ? mode : 'both';
  const stage = document.getElementById('stage');
  stage.classList.remove('mode-both', 'mode-p1', 'mode-p2');
  stage.classList.add(m === 'both' ? 'mode-both' : `mode-${m}`);
  slots.p1.el.classList.toggle('slot-off', m === 'p2');
  slots.p2.el.classList.toggle('slot-off', m === 'p1');
}

function applyInit(msg) {
  const c = msg.config || {};
  if (slots.p1?.label && c.p1Label) slots.p1.label.textContent = c.p1Label;
  if (slots.p2?.label && c.p2Label) slots.p2.label.textContent = c.p2Label;
  applyDisplayMode(c.displayMode);
  if (c.p1) applySlotConfig('p1', c.p1);
  if (c.p2) applySlotConfig('p2', c.p2);
}

function resolveSilentOpacityPct(cfg) {
  if (!cfg) return 100;
  if (cfg.silentOpacity !== undefined && cfg.silentOpacity !== null && cfg.silentOpacity !== '') {
    const n = Number(cfg.silentOpacity);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return cfg.hideWhenSilent ? 0 : 100;
}

/**
 * 喋り中のわずかな拡大。音量が文節で下がっても JIGGLE_HOLD_MS はピーク倍率を維持し、
 * 急な縮小を lerp で抑える。
 */
function getJiggleScale(s) {
  const raw = Number(s.cfg?.jiggleStrength);
  const strength = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_JIGGLE_STRENGTH;
  const instant = 1 + strength * ((s.smoothLevel ?? s.level ?? 0) / 100);
  const now = performance.now();
  const vocallyActive = s.speaking || s.laughing;

  if (vocallyActive) {
    s.jiggleHoldUntil = now + JIGGLE_HOLD_MS;
    s.peakJiggle = Math.max(s.peakJiggle || 1, instant);
  }

  const inHold = now < (s.jiggleHoldUntil || 0);
  if (!vocallyActive && !inHold) {
    s.peakJiggle = 1;
    s.smoothJiggle = lerp(s.smoothJiggle ?? 1, 1, 0.32);
    return s.smoothJiggle;
  }

  const target = Math.max(s.peakJiggle || 1, vocallyActive ? instant : (s.peakJiggle || 1));
  s.smoothJiggle = lerp(s.smoothJiggle ?? 1, target, 0.22);
  return s.smoothJiggle;
}

function updateAudioState(key, speaking, laughing, level, vowel) {
  const s = slots[key];
  if (!s?.el) return;
  const wasVocal = s.speaking || s.laughing;
  s.speaking = speaking;
  s.laughing = laughing;
  const targetLevel = level || 0;
  const prev = s.smoothLevel ?? 0;
  const t = targetLevel > prev ? LEVEL_LERP_OPEN : LEVEL_LERP_CLOSE;
  s.smoothLevel = lerp(prev, targetLevel, t);
  s.level = targetLevel;
  s.vowel = speaking && !laughing ? (vowel || null) : null;
  const active = speaking || laughing;
  if (wasVocal && !active) scheduleBlink(s);
  const silentPct = resolveSilentOpacityPct(s.cfg);
  s.el.style.opacity = active ? '1' : String(silentPct / 100);
  s.el.classList.toggle('speaking', speaking);
}

function transformLayer(img, layerCfg, ox, oy, extraY, extraRot, scaleMul) {
  if (!img || img.hidden) return;
  const sc = (layerCfg.scale || 1) * (scaleMul || 1);
  const x = (layerCfg.offsetX || 0) + ox;
  const y = (layerCfg.offsetY || 0) + oy + extraY;
  const rot = extraRot || 0;
  img.style.transform = `translate(${x}px, ${y}px) scale(${sc}) rotate(${rot}rad)`;
}

function tick() {
  const t = performance.now();
  for (const key of ['p1', 'p2']) {
    const s = slots[key];
    if (!s?.cfg || !s.body) continue;

    if (s.useLayers) {
      const L = s.cfg.layers || {};
      let rigY = 0;
      let rigRot = 0;
      const bodyS = sineOffset(L.body || {}, t);
      rigY += bodyS.y;
      rigRot += bodyS.rot;

      s.rigX = lerp(s.rigX, (L.body?.offsetX || 0), 0.35);
      s.rigY = lerp(s.rigY, (L.body?.offsetY || 0) + rigY, 0.35);
      s.rigRot = lerp(s.rigRot, rigRot, 0.35);
      s.rig.style.transform = `translate(${s.rigX}px, ${s.rigY}px) rotate(${s.rigRot}rad)`;

      const faceS = sineOffset(L.face || {}, t);
      const h1 = sineOffset(L.hair1 || {}, t);
      const h2 = sineOffset(L.hair2 || {}, t);
      transformLayer(s.imgs.body, L.body || {}, 0, 0, 0, 0, 1);
      transformLayer(s.imgs.face, L.face || {}, 0, 0, faceS.y, faceS.rot, 1);
      transformLayer(s.imgs.hair1, L.hair1 || {}, 0, 0, h1.y, h1.rot, 1);
      transformLayer(s.imgs.hair2, L.hair2 || {}, 0, 0, h2.y, h2.rot, 1);

      const dragOn = !!(L.eyes?.drag || L.mouth?.drag || L.nose?.drag);
      const targetX = s.rigX;
      const targetY = s.rigY;
      if (dragOn) {
        const lag = Math.min(0.95, Math.max(0.05, s.cfg.dragLag ?? 0.35));
        s.attachX = lerp(s.attachX, targetX, lag);
        s.attachY = lerp(s.attachY, targetY, lag);
        s.attachRot = lerp(s.attachRot, s.rigRot, lag);
      } else {
        s.attachX = targetX;
        s.attachY = targetY;
        s.attachRot = s.rigRot;
      }
      s.attach.style.transform = `translate(${s.attachX}px, ${s.attachY}px) rotate(${s.attachRot}rad)`;

      if (t >= s.nextBlinkAt && s.assets['eyes-blink'] && !s.speaking && !s.laughing) {
        s.blinkUntil = t + (s.cfg.blinkDurationMs || 130);
        scheduleBlink(s);
      }

      const eyesUrl = pickEyesAsset(s, t);
      setSrc(s.imgs.eyes, eyesUrl);

      const mouthUrl = pickMouthAsset(s, t);
      setSrc(s.imgs.mouth, mouthUrl);
      setSrc(s.imgs.nose, s.assets.nose);

      const jiggle = getJiggleScale(s);
      transformLayer(s.imgs.eyes, L.eyes || {}, 0, 0, 0, 0, 1);
      updateLookAt(s, t);
      transformLayer(s.imgs.mouth, L.mouth || {}, 0, 0, 0, 0, jiggle);
      transformLayer(s.imgs.nose, L.nose || {}, 0, 0, faceS.y, faceS.rot, 1);
      applyCustomLayerTransforms(s, t, faceS, h1, h2);
    } else if (!s.composite.hidden) {
      const src = pickComposite(s);
      setSrc(s.composite, src);
      const jiggle = getJiggleScale(s);
      s.composite.style.transform = `scale(${jiggle})`;
    }
  }
  scheduleTick();
}

let tickLoopActive = false;

function scheduleTick() {
  if (tickLoopActive) return;
  tickLoopActive = true;
  const run = () => {
    tickLoopActive = false;
    tick();
  };
  if (typeof document !== 'undefined' && document.hidden) {
    setTimeout(run, OBS_HIDDEN_TICK_MS);
  } else {
    requestAnimationFrame(run);
  }
}

function handle(msg) {
  if (msg.type === 'init') applyInit(msg);
  else if (msg.type === 'audio') {
    updateAudioState('p1', !!msg.p1Speaking, !!msg.p1Laughing, msg.p1, msg.p1Vowel);
    updateAudioState('p2', !!msg.p2Speaking, !!msg.p2Laughing, msg.p2, msg.p2Vowel);
  }
}

let ws = null;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (_) {} };
  ws.onclose = () => {
    ws = null;
    setTimeout(connect, 3000);
  };
  ws.onerror = () => { /* onclose で再接続 */ };
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      connect();
      scheduleTick();
    }
  });
}

connect();
scheduleTick();
wireStageResizeObserver();
