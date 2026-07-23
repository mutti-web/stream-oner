'use strict';

/**
 * P0 スパイク: Pixi 1 スロット
 * - 既存 WS audio で口パク
 * - HUD の yaw/pitch でパララックス（MediaPipe なし）
 * OBS 本番確認時は ?hud=0 で HUD 非表示
 */

const WS_URL = 'ws://127.0.0.1:3003';
const SHOW_HUD = !/(?:^|[?&])hud=0(?:&|$)/.test(location.search);

const MULTIPLIERS = {
  body: 0.15,
  face: 1.0,
  mouth: 1.0,
  hair: 0.4,
};

const YAW_PX = 2.2;
const PITCH_PX = 1.8;

const hud = document.getElementById('hud');
const yawInput = document.getElementById('yaw');
const pitchInput = document.getElementById('pitch');
const yawVal = document.getElementById('yaw-val');
const pitchVal = document.getElementById('pitch-val');
const statusEl = document.getElementById('status');

if (!SHOW_HUD && hud) hud.classList.add('hidden-for-obs');

const pose = { yaw: 0, pitch: 0 };
const audio = {
  speaking: false,
  laughing: false,
  level: 0,
  vowel: null,
};

/** @type {import('pixi.js').Application | null} */
let app = null;
/** @type {ReturnType<typeof createRig> | null} */
let rig = null;
let assets = {};

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function syncPoseFromHud() {
  pose.yaw = Number(yawInput?.value) || 0;
  pose.pitch = Number(pitchInput?.value) || 0;
  if (yawVal) yawVal.textContent = String(pose.yaw);
  if (pitchVal) pitchVal.textContent = String(pose.pitch);
}

yawInput?.addEventListener('input', syncPoseFromHud);
pitchInput?.addEventListener('input', syncPoseFromHud);
syncPoseFromHud();

function makePlaceholder(color, w, h, label) {
  const root = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.roundRect(-w / 2, -h / 2, w, h, 16);
  g.fill({ color, alpha: 0.92 });
  root.addChild(g);
  if (label) {
    const t = new PIXI.Text({
      text: label,
      style: { fill: 0xffffff, fontSize: 18, fontWeight: '600' },
    });
    t.anchor.set(0.5);
    root.addChild(t);
  }
  return root;
}

async function loadSprite(url, fallbackColor, w, h, label) {
  if (url) {
    try {
      const tex = await PIXI.Assets.load(url);
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      const maxH = h;
      const scale = Math.min(maxH / sp.height, (w * 1.2) / sp.width);
      sp.scale.set(scale);
      return sp;
    } catch (e) {
      console.warn('[PixiSpike] texture load failed', url, e);
    }
  }
  return makePlaceholder(fallbackColor, w, h, label);
}

function createRig() {
  const root = new PIXI.Container();
  const layers = {
    body: null,
    face: null,
    mouth: null,
    hair: null,
  };
  return { root, layers };
}

async function rebuildRigFromAssets(nextAssets) {
  assets = nextAssets || {};
  if (!app) return;

  if (rig) {
    app.stage.removeChild(rig.root);
    rig.root.destroy({ children: true });
    rig = null;
  }

  rig = createRig();
  const cx = app.screen.width * 0.5;
  const cy = app.screen.height * 0.55;
  rig.root.position.set(cx, cy);

  const body = await loadSprite(assets.body, 0x3d5a80, 220, 280, 'body');
  const face = await loadSprite(assets.face || assets.body, 0x98c1d9, 160, 160, 'face');
  const mouthClosed = await loadSprite(
    assets['mouth-closed'] || assets.mouth,
    0xee6c4d,
    70,
    36,
    'mouth',
  );
  const mouthOpen = assets['mouth-open']
    ? await loadSprite(assets['mouth-open'], 0xee6c4d, 70, 42, 'open')
    : null;
  const hair = await loadSprite(assets.hair1 || assets.hair2, 0x293241, 200, 120, 'hair');

  body.zIndex = 10;
  face.zIndex = 20;
  hair.zIndex = 25;
  mouthClosed.zIndex = 30;
  if (mouthOpen) mouthOpen.zIndex = 30;

  face.position.y = -40;
  hair.position.y = -90;
  mouthClosed.position.y = 18;
  if (mouthOpen) {
    mouthOpen.position.y = 18;
    mouthOpen.visible = false;
  }

  rig.root.addChild(body, face, hair, mouthClosed);
  if (mouthOpen) rig.root.addChild(mouthOpen);
  rig.root.sortableChildren = true;

  rig.layers.body = body;
  rig.layers.face = face;
  rig.layers.hair = hair;
  rig.layers.mouthClosed = mouthClosed;
  rig.layers.mouthOpen = mouthOpen;

  app.stage.addChild(rig.root);
  setStatus(`WS ok / assets: ${Object.keys(assets).filter((k) => assets[k]).length}`);
}

function applyMouth() {
  if (!rig) return;
  const open = audio.speaking || audio.laughing || audio.level > 12;
  const { mouthClosed, mouthOpen } = rig.layers;
  if (mouthOpen) {
    mouthClosed.visible = !open;
    mouthOpen.visible = open;
  } else if (mouthClosed) {
    const s = open ? 1 + Math.min(0.35, (audio.level || 0) / 200) : 1;
    mouthClosed.scale.y = s;
  }
}

function applyParallax() {
  if (!rig) return;
  const ox = pose.yaw * YAW_PX;
  const oy = pose.pitch * PITCH_PX;
  const L = rig.layers;
  if (L.body) L.body.position.set(ox * MULTIPLIERS.body, oy * MULTIPLIERS.body);
  if (L.face) L.face.position.set(ox * MULTIPLIERS.face, -40 + oy * MULTIPLIERS.face);
  if (L.hair) L.hair.position.set(ox * MULTIPLIERS.hair, -90 + oy * MULTIPLIERS.hair);
  const mouthY = 18 + oy * MULTIPLIERS.mouth;
  if (L.mouthClosed) L.mouthClosed.position.set(ox * MULTIPLIERS.mouth, mouthY);
  if (L.mouthOpen) L.mouthOpen.position.set(ox * MULTIPLIERS.mouth, mouthY);
}

function onFrame() {
  applyMouth();
  applyParallax();
}

function connectWs() {
  let ws;
  let retryMs = 800;

  const connect = () => {
    ws = new WebSocket(WS_URL);
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
        const p1 = msg.config?.p1 || {};
        rebuildRigFromAssets(p1.assets || {});
      } else if (msg.type === 'audio') {
        audio.speaking = !!msg.p1Speaking;
        audio.laughing = !!msg.p1Laughing;
        audio.level = Number(msg.p1) || 0;
        audio.vowel = msg.p1Vowel || null;
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

  await rebuildRigFromAssets({});
  app.ticker.add(onFrame);
  connectWs();
}

main().catch((e) => {
  console.error('[PixiSpike]', e);
  setStatus(`boot error: ${e.message || e}`);
});
