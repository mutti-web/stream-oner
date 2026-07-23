'use strict';

/**
 * P1 Pixi アバターオーバーレイ
 * - 現行 DOM と同じ init / audio WS
 * - レイヤー PNG → Sprite、口パク・母音・笑い、p1/p2、displayMode
 * - yaw/pitch は HUD（MediaPipe は P2）
 * OBS: ?hud=0
 */

const WS_URL = 'ws://127.0.0.1:3003';
const SHOW_HUD = !/(?:^|[?&])hud=0(?:&|$)/.test(location.search);

const AC = window.AvatarConstants || {};
const DEFAULT_LAYER_Z = AC.DEFAULT_LAYER_Z || {
  body: 10, face: 15, hair1: 20, eyes: 30, mouth: 40, nose: 42, hair2: 50,
};
const JIGGLE_HOLD_MS = AC.JIGGLE_HOLD_MS ?? 400;
const DEFAULT_JIGGLE_STRENGTH = AC.DEFAULT_JIGGLE_STRENGTH ?? 0.08;
const LEVEL_LERP_OPEN = AC.LEVEL_LERP_OPEN ?? 0.38;
const LEVEL_LERP_CLOSE = AC.LEVEL_LERP_CLOSE ?? 0.14;
const SLOT_REF_W = AC.SLOT_REF_W ?? 960;
const SLOT_REF_H = AC.SLOT_REF_H ?? 420;

const MULTIPLIERS = {
  body: 0.15,
  face: 1.0,
  eyes: 1.05,
  mouth: 1.0,
  nose: 1.0,
  hair1: 0.45,
  hair2: 0.35,
  composite: 0.7,
};

const YAW_PX = 2.2;
const PITCH_PX = 1.8;
const SLOT_TARGET_H = 280;

const hud = document.getElementById('hud');
const yawInput = document.getElementById('yaw');
const pitchInput = document.getElementById('pitch');
const yawVal = document.getElementById('yaw-val');
const pitchVal = document.getElementById('pitch-val');
const statusEl = document.getElementById('status');

if (!SHOW_HUD && hud) hud.classList.add('hidden-for-obs');

const pose = { yaw: 0, pitch: 0 };
/** @type {import('pixi.js').Application | null} */
let app = null;
let displayMode = 'both';
const slots = { p1: null, p2: null };

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function syncPoseFromHud() {
  pose.yaw = Number(yawInput?.value) || 0;
  pose.pitch = Number(pitchInput?.value) || 0;
  if (yawVal) yawVal.textContent = String(pose.yaw);
  if (pitchVal) pitchVal.textContent = String(pose.pitch);
}

yawInput?.addEventListener('input', syncPoseFromHud);
pitchInput?.addEventListener('input', syncPoseFromHud);
syncPoseFromHud();

function hasAssetUrl(assets, key) {
  return !!(assets && assets[key]);
}

function pickMouthUrl(s) {
  const a = s.assets;
  if (s.laughing) {
    return a['mouth-smile'] || a['mouth-open'] || a['mouth-closed'] || null;
  }
  if (s.speaking) {
    const v = s.vowel;
    if (v && hasAssetUrl(a, `mouth-${v}`)) return a[`mouth-${v}`];
    return a['mouth-open'] || a['mouth-closed'] || null;
  }
  return a['mouth-closed'] || null;
}

function pickEyesUrl(s, tNow) {
  const a = s.assets;
  if (s.laughing) return a['eyes-smile'] || a['eyes-normal'] || null;
  if (tNow < s.blinkUntil && a['eyes-blink']) return a['eyes-blink'];
  return a['eyes-normal'] || null;
}

function pickCompositeUrl(s) {
  const a = s.assets;
  if (s.laughing) {
    return a['mouth-smile'] || a['mouth-open'] || a['mouth-closed'] || a.face || a.body || null;
  }
  if (s.speaking) {
    const v = s.vowel;
    if (v && hasAssetUrl(a, `mouth-${v}`)) return a[`mouth-${v}`];
    return a['mouth-open'] || a['mouth-closed'] || a.face || a.body || null;
  }
  return a['mouth-closed'] || a.face || a.body || null;
}

function resolveSilentOpacity(cfg) {
  if (!cfg) return 1;
  if (cfg.silentOpacity !== undefined && cfg.silentOpacity !== null && cfg.silentOpacity !== '') {
    const n = Number(cfg.silentOpacity);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n)) / 100;
  }
  return cfg.hideWhenSilent ? 0 : 1;
}

function layerZ(cfg, name) {
  const n = Number(cfg?.layers?.[name]?.zIndex);
  return Number.isFinite(n) ? n : (DEFAULT_LAYER_Z[name] ?? 30);
}

function slotOffsetPx(cfg, screenW, screenH) {
  const xPct = Number(cfg?.slotOffsetXPct);
  const yPct = Number(cfg?.slotOffsetYPct);
  if (Number.isFinite(xPct) || Number.isFinite(yPct)) {
    return {
      ox: ((Number.isFinite(xPct) ? xPct : 0) / 100) * screenW,
      oy: ((Number.isFinite(yPct) ? yPct : 0) / 100) * screenH,
    };
  }
  return {
    ox: Number(cfg?.slotOffsetX) || 0,
    oy: Number(cfg?.slotOffsetY) || 0,
  };
}

function naturalBlinkDelayMs(cfg) {
  const min = (cfg?.blinkMinSec || 3) * 1000;
  const max = (cfg?.blinkMaxSec || 7) * 1000;
  if (max <= min) return min;
  const u = (Math.random() + Math.random()) / 2;
  return min + u * (max - min);
}

function makePlaceholder(color, w, h, label) {
  const root = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.roundRect(-w / 2, -h / 2, w, h, 12);
  g.fill({ color, alpha: 0.9 });
  root.addChild(g);
  if (label) {
    const t = new PIXI.Text({
      text: label,
      style: { fill: 0xffffff, fontSize: 16, fontWeight: '600' },
    });
    t.anchor.set(0.5);
    root.addChild(t);
  }
  return root;
}

async function ensureTexture(url) {
  if (!url) return null;
  try {
    return await PIXI.Assets.load(url);
  } catch (e) {
    console.warn('[PixiAvatar] texture load failed', url, e);
    return null;
  }
}

function fitSprite(sp, maxH) {
  if (!sp?.texture || !sp.texture.height) return 1;
  const scale = maxH / sp.texture.height;
  sp.scale.set(scale);
  return scale;
}

function createEmptySlot(id) {
  const root = new PIXI.Container();
  root.sortableChildren = true;
  return {
    id,
    root,
    cfg: null,
    assets: {},
    sprites: {},
    useLayers: false,
    speaking: false,
    laughing: false,
    level: 0,
    smoothLevel: 0,
    vowel: null,
    nextBlinkAt: 0,
    blinkUntil: 0,
    jiggleHoldUntil: 0,
    peakJiggle: 1,
    smoothJiggle: 1,
    baseFaceY: -36,
    baseHair1Y: -88,
    baseHair2Y: -70,
    baseMouthY: 20,
    baseNoseY: 8,
    baseEyesY: -8,
  };
}

async function buildLayerSprite(url, z, placeholderLabel, color) {
  const tex = await ensureTexture(url);
  if (tex) {
    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    fitSprite(sp, SLOT_TARGET_H);
    sp.zIndex = z;
    return sp;
  }
  if (!placeholderLabel) return null;
  const ph = makePlaceholder(color, 120, 80, placeholderLabel);
  ph.zIndex = z;
  return ph;
}

async function rebuildSlot(id, data) {
  if (!app) return;
  const prev = slots[id];
  if (prev?.root) {
    app.stage.removeChild(prev.root);
    prev.root.destroy({ children: true });
  }

  const s = createEmptySlot(id);
  slots[id] = s;
  s.cfg = data || {};
  s.assets = data?.assets || {};
  s.useLayers = !!data?.useLayers && Object.values(s.assets).some(Boolean);
  s.nextBlinkAt = performance.now() + naturalBlinkDelayMs(s.cfg);

  const a = s.assets;
  const cfg = s.cfg;

  if (s.useLayers) {
    const bodyUrl = a.face ? a.body : null;
    const faceUrl = a.face || a.body || a['mouth-closed'] || null;

    s.sprites.body = await buildLayerSprite(bodyUrl, layerZ(cfg, 'body'), bodyUrl ? null : null, 0x3d5a80);
    s.sprites.face = await buildLayerSprite(
      faceUrl,
      layerZ(cfg, 'face'),
      faceUrl ? null : 'face',
      0x98c1d9,
    );
    s.sprites.hair1 = await buildLayerSprite(a.hair1, layerZ(cfg, 'hair1'), null, 0x293241);
    s.sprites.hair2 = await buildLayerSprite(a.hair2, layerZ(cfg, 'hair2'), null, 0x1b263b);
    s.sprites.eyes = await buildLayerSprite(
      a['eyes-normal'] || a.eyes,
      layerZ(cfg, 'eyes'),
      null,
      0xe0fbfc,
    );
    s.sprites.mouth = await buildLayerSprite(
      a['mouth-closed'] || a['mouth-open'],
      layerZ(cfg, 'mouth'),
      a['mouth-closed'] || a['mouth-open'] ? null : 'mouth',
      0xee6c4d,
    );
    s.sprites.nose = await buildLayerSprite(a.nose, layerZ(cfg, 'nose'), null, 0xffb703);

    for (const [name, sp] of Object.entries(s.sprites)) {
      if (!sp) continue;
      if (name === 'face') sp.position.y = s.baseFaceY;
      if (name === 'hair1') sp.position.y = s.baseHair1Y;
      if (name === 'hair2') sp.position.y = s.baseHair2Y;
      if (name === 'eyes') sp.position.y = s.baseEyesY;
      if (name === 'mouth') sp.position.y = s.baseMouthY;
      if (name === 'nose') sp.position.y = s.baseNoseY;
      s.root.addChild(sp);
    }
  } else {
    const url = pickCompositeUrl(s) || a.face || a.body;
    s.sprites.composite = await buildLayerSprite(url, 20, url ? null : id.toUpperCase(), id === 'p1' ? 0x3d5a80 : 0xee6c4d);
    if (s.sprites.composite) s.root.addChild(s.sprites.composite);
  }

  // custom layers
  for (const cl of cfg.customLayers || []) {
    const assetKey = `custom-${cl.id}`;
    const url = a[assetKey];
    if (!url) continue;
    const sp = await buildLayerSprite(url, Number(cl.zIndex) || 45, null, 0xadb5bd);
    if (!sp) continue;
    sp.position.set(Number(cl.offsetX) || 0, Number(cl.offsetY) || 0);
    const sc = Number(cl.scale);
    if (Number.isFinite(sc) && sc > 0 && sp.scale) sp.scale.set(sp.scale.x * sc);
    s.sprites[`custom-${cl.id}`] = sp;
    s.root.addChild(sp);
  }

  const fx = cfg.flipX ? -1 : 1;
  const fy = cfg.flipY ? -1 : 1;
  s.root.scale.set(fx, fy);

  app.stage.addChild(s.root);
  layoutSlots();
}

function layoutSlots() {
  if (!app) return;
  const w = app.screen.width;
  const h = app.screen.height;
  const mode = displayMode === 'p1' || displayMode === 'p2' ? displayMode : 'both';

  for (const id of ['p1', 'p2']) {
    const s = slots[id];
    if (!s?.root) continue;
    const off = mode === 'p2' ? id !== 'p2' : mode === 'p1' ? id !== 'p1' : false;
    s.root.visible = !off;
    if (off) continue;

    let cx;
    let cy = h * 0.55;
    if (mode === 'both') {
      cx = id === 'p1' ? w * 0.28 : w * 0.72;
    } else {
      cx = w * 0.5;
    }
    const { ox, oy } = slotOffsetPx(s.cfg, w || SLOT_REF_W, h || SLOT_REF_H);
    s.root.position.set(cx + ox, cy + oy);
  }
}

async function applyInit(msg) {
  const c = msg.config || {};
  displayMode = c.displayMode === 'p1' || c.displayMode === 'p2' ? c.displayMode : 'both';
  await rebuildSlot('p1', c.p1 || {});
  await rebuildSlot('p2', c.p2 || {});
  const n1 = Object.keys(slots.p1?.assets || {}).filter((k) => slots.p1.assets[k]).length;
  const n2 = Object.keys(slots.p2?.assets || {}).filter((k) => slots.p2.assets[k]).length;
  setStatus(`WS ok / p1 assets:${n1} p2:${n2} mode:${displayMode}`);
}

function updateAudio(id, speaking, laughing, level, vowel) {
  const s = slots[id];
  if (!s) return;
  const wasVocal = s.speaking || s.laughing;
  s.speaking = speaking;
  s.laughing = laughing;
  const target = level || 0;
  const prev = s.smoothLevel || 0;
  s.smoothLevel = lerp(prev, target, target > prev ? LEVEL_LERP_OPEN : LEVEL_LERP_CLOSE);
  s.level = target;
  s.vowel = speaking && !laughing ? (vowel || null) : null;
  if (wasVocal && !(speaking || laughing)) {
    s.nextBlinkAt = performance.now() + naturalBlinkDelayMs(s.cfg);
  }
}

function getJiggleScale(s) {
  const raw = Number(s.cfg?.jiggleStrength);
  const strength = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_JIGGLE_STRENGTH;
  const instant = 1 + strength * ((s.smoothLevel ?? s.level ?? 0) / 100);
  const now = performance.now();
  const vocal = s.speaking || s.laughing;
  if (vocal) {
    s.jiggleHoldUntil = now + JIGGLE_HOLD_MS;
    s.peakJiggle = Math.max(s.peakJiggle || 1, instant);
  }
  const inHold = now < (s.jiggleHoldUntil || 0);
  if (!vocal && !inHold) {
    s.peakJiggle = 1;
    s.smoothJiggle = lerp(s.smoothJiggle ?? 1, 1, 0.32);
    return s.smoothJiggle;
  }
  const target = Math.max(s.peakJiggle || 1, vocal ? instant : (s.peakJiggle || 1));
  s.smoothJiggle = lerp(s.smoothJiggle ?? 1, target, 0.22);
  return s.smoothJiggle;
}

async function setSpriteUrl(sp, url) {
  if (!sp || !url || sp._pixiUrl === url) return;
  if (!sp.texture || !sp.anchor) return; // placeholder Container はスキップ
  const tex = await ensureTexture(url);
  if (!tex) return;
  sp.texture = tex;
  sp._pixiUrl = url;
  fitSprite(sp, SLOT_TARGET_H);
}

function applySlotVisuals(s, tNow) {
  if (!s?.root) return;
  const active = s.speaking || s.laughing;
  const silent = resolveSilentOpacity(s.cfg);
  s.root.alpha = active ? 1 : silent;

  if (tNow >= s.nextBlinkAt && s.assets['eyes-blink'] && !s.speaking && !s.laughing) {
    s.blinkUntil = tNow + (s.cfg.blinkDurationMs || 130);
    s.nextBlinkAt = tNow + naturalBlinkDelayMs(s.cfg);
  }

  if (s.useLayers) {
    const mouthUrl = pickMouthUrl(s);
    const eyesUrl = pickEyesUrl(s, tNow);
    if (s.sprites.mouth && mouthUrl) setSpriteUrl(s.sprites.mouth, mouthUrl);
    if (s.sprites.eyes && eyesUrl) setSpriteUrl(s.sprites.eyes, eyesUrl);

    const jiggle = getJiggleScale(s);
    if (s.sprites.mouth?.scale && s.sprites.mouth.texture) {
      fitSprite(s.sprites.mouth, SLOT_TARGET_H);
      const base = Math.abs(s.sprites.mouth.scale.x) || 1;
      s.sprites.mouth.scale.set(base, base * jiggle);
    }
  } else if (s.sprites.composite) {
    const url = pickCompositeUrl(s);
    if (url) setSpriteUrl(s.sprites.composite, url);
  }

  const ox = pose.yaw * YAW_PX;
  const oy = pose.pitch * PITCH_PX;
  const L = s.sprites;
  const put = (sp, name, baseY) => {
    if (!sp) return;
    const m = MULTIPLIERS[name] ?? 1;
    sp.position.set(ox * m, (baseY || 0) + oy * m);
  };

  if (s.useLayers) {
    put(L.body, 'body', 0);
    put(L.face, 'face', s.baseFaceY);
    put(L.hair1, 'hair1', s.baseHair1Y);
    put(L.hair2, 'hair2', s.baseHair2Y);
    put(L.eyes, 'eyes', s.baseEyesY);
    put(L.mouth, 'mouth', s.baseMouthY);
    put(L.nose, 'nose', s.baseNoseY);
  } else {
    put(L.composite, 'composite', 0);
  }
}

function onFrame() {
  const t = performance.now();
  applySlotVisuals(slots.p1, t);
  applySlotVisuals(slots.p2, t);
}

function connectWs() {
  let retryMs = 800;
  const connect = () => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      retryMs = 800;
      setStatus('WS: connected');
    };
    ws.onclose = () => {
      setStatus('WS: reconnecting…');
      setTimeout(connect, retryMs);
      retryMs = Math.min(5000, retryMs * 1.5);
    };
    ws.onerror = () => {
      try { ws.close(); } catch (_) { /* */ }
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'init') {
        applyInit(msg).catch((e) => console.error('[PixiAvatar] init', e));
      } else if (msg.type === 'audio') {
        updateAudio('p1', !!msg.p1Speaking, !!msg.p1Laughing, Number(msg.p1) || 0, msg.p1Vowel || null);
        updateAudio('p2', !!msg.p2Speaking, !!msg.p2Laughing, Number(msg.p2) || 0, msg.p2Vowel || null);
      }
    };
  };
  connect();
}

async function main() {
  if (!window.PIXI) {
    setStatus('PIXI global missing');
    return;
  }
  const stageEl = document.getElementById('stage');
  app = new PIXI.Application();
  await app.init({
    backgroundAlpha: 0,
    resizeTo: stageEl,
    antialias: true,
    preference: 'webgl',
  });
  stageEl.appendChild(app.canvas);

  window.addEventListener('resize', layoutSlots);
  await rebuildSlot('p1', {});
  await rebuildSlot('p2', {});
  app.ticker.add(onFrame);
  connectWs();
}

main().catch((e) => {
  console.error('[PixiAvatar]', e);
  setStatus(`boot error: ${e.message || e}`);
});
