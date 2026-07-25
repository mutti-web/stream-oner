'use strict';

/**
 * アバター1スロット分の設定（体・髪×2・目・口、sine・drag・まばたき・jiggle 等）
 *
 * @typedef {Object} AvatarSineConfig
 * @property {boolean} enabled
 * @property {number} amp
 * @property {number} periodMs
 * @property {number} phase
 *
 * @typedef {Object} AvatarLayerConfig
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {number} scale
 * @property {number} zIndex
 * @property {AvatarSineConfig} sine
 * @property {boolean} drag
 *
 * @typedef {Object} AvatarSlotConfig
 * @property {Record<string, string>} paths
 * @property {boolean} [hideWhenSilent]
 * @property {number} [silentOpacity]
 * @property {number} [slotOffsetX]
 * @property {number} [slotOffsetY]
 * @property {number} [slotOffsetXPct]
 * @property {number} [slotOffsetYPct]
 * @property {AvatarLayerConfig} [layers]
 * @property {object[]} [customLayers]
 */

const ASSET_KEYS = [
  'body', 'face', 'nose', 'hair1', 'hair2',
  'eyes-normal', 'eyes-smile', 'eyes-blink', 'eyes-pupil',
  'mouth-closed', 'mouth-open', 'mouth-smile',
  'mouth-a', 'mouth-i', 'mouth-u', 'mouth-e', 'mouth-o',
];

/** カスタム部位の親として指定できる基本レイヤー */
const CUSTOM_PARENT_ANCHORS = new Set([
  'body', 'face', 'hair1', 'hair2', 'eyes', 'mouth', 'nose', 'attach', 'rig',
]);

/** 描画順（小さいほど奥）。鼻は口・顔より手前（既定 42）、髪2は最前面寄り */
const DEFAULT_LAYER_Z = {
  body: 10,
  face: 15,
  hair1: 20,
  eyes: 30,
  mouth: 40,
  nose: 42,
  hair2: 50,
};

function defaultSine(overrides = {}) {
  return { enabled: false, amp: 6, periodMs: 4000, phase: 0, ...overrides };
}

function clamp01Num(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function defaultLayer(overrides = {}) {
  return {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    zIndex: 30,
    sine: defaultSine(),
    drag: false,
    /** Pixi パララックス倍率。未設定なら rigType プリセットを使う */
    lookMul: null,
    ...overrides,
  };
}

/** 旧 hideWhenSilent を含め、OBS 用の無音時透明度（0=完全透明, 100=そのまま） */
function resolveSilentOpacity(slot) {
  if (slot && slot.silentOpacity !== undefined && slot.silentOpacity !== null && slot.silentOpacity !== '') {
    const n = Number(slot.silentOpacity);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return slot && slot.hideWhenSilent ? 0 : 100;
}

function defaultCustomLayer(overrides = {}) {
  return {
    id: `cl-${Date.now().toString(36)}`,
    name: 'カスタム',
    parentAnchor: 'hair1',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    zIndex: 45,
    path: '',
    /** Pixi 顔向きパララックス倍率。null なら既定 0.7 */
    lookMul: null,
    /** Pixi 揺れスプリング（0=無効）。髪と同じ挙動を任意部位で使える */
    springStrength: 0,
    springSpeed: 0.55,
    springDamp: 0.55,
    /** 声の大きさで上下に弾む量（px 相当） */
    audioBounce: 0,
    sine: defaultSine(),
    ...overrides,
  };
}

function normalizeCustomLayers(layers) {
  if (!Array.isArray(layers)) return [];
  return layers.map((raw, i) => {
    const l = raw && typeof raw === 'object' ? raw : {};
    const anchor = CUSTOM_PARENT_ANCHORS.has(l.parentAnchor) ? l.parentAnchor : 'body';
    const lookRaw = l.lookMul;
    const lookNum = Number(lookRaw);
    const sine = l.sine && typeof l.sine === 'object' ? l.sine : {};
    const sway = l.sway && typeof l.sway === 'object' ? l.sway : {};
    return {
      id: String(l.id || `cl-${i}`),
      name: String(l.name || 'カスタム'),
      parentAnchor: anchor,
      offsetX: Number(l.offsetX) || 0,
      offsetY: Number(l.offsetY) || 0,
      scale: Math.max(0.1, Math.min(4, Number(l.scale) || 1)),
      zIndex: Number(l.zIndex) || 45,
      path: String(l.path || '').trim(),
      lookMul: lookRaw == null || lookRaw === '' || !Number.isFinite(lookNum) || lookNum < 0
        ? null
        : lookNum,
      springStrength: clamp01Num(l.springStrength, 0),
      springSpeed: clamp01Num(l.springSpeed, 0.55),
      springDamp: clamp01Num(l.springDamp, 0.55),
      audioBounce: Math.max(0, Math.min(40, Number(l.audioBounce) || 0)),
      sine: defaultSine({
        enabled: !!sine.enabled,
        amp: Number(sine.amp) || 0,
        periodMs: Number(sine.periodMs) || 4000,
        phase: Number(sine.phase) || 0,
      }),
      sway: {
        enabled: !!sway.enabled,
        pivotX: Number(sway.pivotX) || 0,
        pivotY: Number.isFinite(Number(sway.pivotY)) ? Number(sway.pivotY) : -40,
        width: Math.max(0, Math.min(800, Number(sway.width) || 0)),
        maxAngleDeg: Math.max(0, Math.min(25, Number(sway.maxAngleDeg) || 6)),
        falloff: Math.max(0, Math.min(3, Number.isFinite(Number(sway.falloff)) ? Number(sway.falloff) : 1)),
        reach: Math.max(8, Math.min(600, Number(sway.reach) || 140)),
        periodMs: Math.max(400, Number(sway.periodMs) || 3200),
        follow: clamp01Num(sway.follow, 0.5),
        audio: Math.max(0, Math.min(2, Number(sway.audio) || 0)),
      },
    };
  }).filter((l) => l.path || l.name);
}

/** 旧 px オフセット → % 換算の参照（統合レイアウトのアバター既定サイズ） */
const SLOT_REF_W = 960;
const SLOT_REF_H = 420;
const SLOT_OFFSET_PCT_MIN = -100;
const SLOT_OFFSET_PCT_MAX = 100;

function clampSlotOffsetPct(n) {
  return Math.max(SLOT_OFFSET_PCT_MIN, Math.min(SLOT_OFFSET_PCT_MAX, Number(n) || 0));
}

/**
 * slotOffsetXPct / slotOffsetYPct を正規化。未移行の px 値があれば % へ一度だけ換算。
 */
function normalizeSlotOffsets(slot) {
  if (!slot || typeof slot !== 'object') return slot;
  const oxPx = Number(slot.slotOffsetX) || 0;
  const oyPx = Number(slot.slotOffsetY) || 0;
  const hasXPct = slot.slotOffsetXPct !== undefined && slot.slotOffsetXPct !== null && slot.slotOffsetXPct !== '';
  const hasYPct = slot.slotOffsetYPct !== undefined && slot.slotOffsetYPct !== null && slot.slotOffsetYPct !== '';
  let xPct = hasXPct ? Number(slot.slotOffsetXPct) : null;
  let yPct = hasYPct ? Number(slot.slotOffsetYPct) : null;
  if (!hasXPct && oxPx !== 0) xPct = (oxPx / SLOT_REF_W) * 100;
  if (!hasYPct && oyPx !== 0) yPct = (oyPx / SLOT_REF_H) * 100;
  slot.slotOffsetXPct = clampSlotOffsetPct(xPct ?? 0);
  slot.slotOffsetYPct = clampSlotOffsetPct(yPct ?? 0);
  return slot;
}

function defaultSlot() {
  return {
    hideWhenSilent: false,
    silentOpacity: 100,
    dragLag: 0.35,
    blinkMinSec: 3,
    blinkMaxSec: 7,
    blinkDurationMs: 130,
    jiggleStrength: 0.08,
    speakThreshold: 12,
    sensitivity: 1.5,
    lookAtEnabled: false,
    pupilOffsetMax: 4,
    /** human: 部位パララックス / integrated: 一体感寄り（差を抑える） */
    rigType: 'human',
    /** Pixi: pose±1 に対するパララックス移動量（px） */
    poseYawPx: 42,
    posePitchPx: 34,
    /** 髪スプリングの強さ（0=追従のみ, 1=よく揺れる）。Pixi 経路で使用 */
    hairSpringStrength: 0.55,
    /** 髪スプリングの応答速度（0=遅い, 1=速い） */
    hairSpringSpeed: 0.55,
    /** 髪スプリングの減衰（0=余韻長め, 1=すぐ収まる） */
    hairSpringDamp: 0.55,
    /** Pixi: 目・口・鼻・瞳を face（なければ body）の不透明領域でマスク（オプトイン） */
    faceMaskEnabled: false,
    /** Pixi: 顔テクスチャの格子 Mesh 変形（オプトイン） */
    faceMeshEnabled: false,
    faceMeshDivisions: 8,
    meshYawStrength: 0.55,
    meshPitchStrength: 0.40,
    /** Mesh ON 時、face/eyes/mouth の平行移動に掛ける係数 */
    poseParallaxWhenMesh: 0.35,
    customLayers: [],
    flipX: false,
    flipY: false,
    /** スロット全体の表示位置（パネル幅・高さに対する %）。レイヤー offset とは別 */
    slotOffsetXPct: 0,
    slotOffsetYPct: 0,
    /** @deprecated 読み込み時のみ % へ移行。新規保存では使わない */
    slotOffsetX: 0,
    slotOffsetY: 0,
    paths: {
      body: '',
      face: '',
      nose: '',
      hair1: '',
      hair2: '',
      'eyes-normal': '',
      'eyes-smile': '',
      'eyes-blink': '',
      'eyes-pupil': '',
      'mouth-closed': '',
      'mouth-open': '',
      'mouth-smile': '',
      'mouth-a': '',
      'mouth-i': '',
      'mouth-u': '',
      'mouth-e': '',
      'mouth-o': '',
    },
    layers: {
      body: defaultLayer({ zIndex: DEFAULT_LAYER_Z.body, sine: defaultSine({ enabled: true, amp: 8, periodMs: 4200 }) }),
      face: defaultLayer({ zIndex: DEFAULT_LAYER_Z.face, sine: defaultSine({ enabled: true, amp: 5, periodMs: 3800, phase: 0.3 }) }),
      hair1: defaultLayer({ zIndex: DEFAULT_LAYER_Z.hair1, sine: defaultSine({ enabled: true, amp: 4, periodMs: 2800, phase: 0.6 }) }),
      hair2: defaultLayer({ zIndex: DEFAULT_LAYER_Z.hair2 }),
      eyes: defaultLayer({ zIndex: DEFAULT_LAYER_Z.eyes, drag: true, offsetY: 0 }),
      mouth: defaultLayer({ zIndex: DEFAULT_LAYER_Z.mouth, drag: true, offsetY: 0 }),
      nose: defaultLayer({
        zIndex: DEFAULT_LAYER_Z.nose,
        drag: true,
        offsetY: 0,
        sine: defaultSine({ enabled: false }),
      }),
    },
  };
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], patch[k]);
    } else if (patch[k] !== undefined) {
      out[k] = patch[k];
    }
  }
  return out;
}

/**
 * 旧フラット設定からスロット設定へ移行
 */
function migrateSlotFromLegacy(prefix, flat) {
  const slot = defaultSlot();
  const p = prefix;
  const closed = flat[`${p}ImageClosed`] || '';
  const open = flat[`${p}ImageOpen`] || '';
  slot.paths.body = closed;
  slot.paths['mouth-closed'] = closed;
  slot.paths['mouth-open'] = open || closed;
  slot.paths['mouth-smile'] = flat[`${p}MouthSmile`] || '';
  slot.paths['eyes-normal'] = flat[`${p}EyesNormal`] || '';
  slot.paths['eyes-smile'] = flat[`${p}EyesSmile`] || '';
  const fullSmile = flat[`${p}ImageSmile`] || '';
  if (fullSmile && !slot.paths['mouth-smile']) {
    slot.paths['mouth-smile'] = fullSmile;
  }
  if (fullSmile && !slot.paths['eyes-smile']) {
    slot.paths['eyes-smile'] = fullSmile;
  }
  return slot;
}

/** store 上の legacy キー名（avatar.p1ImageClosed 等） */
const LEGACY_STORE_KEYS = [
  'avatar.p1ImageClosed', 'avatar.p1ImageOpen',
  'avatar.p2ImageClosed', 'avatar.p2ImageOpen',
  'avatar.p1ImageSmile', 'avatar.p2ImageSmile',
  'avatar.p1MouthSmile', 'avatar.p2MouthSmile',
  'avatar.p1EyesSmile', 'avatar.p2EyesSmile',
  'avatar.p1EyesNormal', 'avatar.p2EyesNormal',
];

function readLegacyFlatFromStore(store) {
  return {
    p1ImageClosed: store.get('avatar.p1ImageClosed', ''),
    p1ImageOpen: store.get('avatar.p1ImageOpen', ''),
    p2ImageClosed: store.get('avatar.p2ImageClosed', ''),
    p2ImageOpen: store.get('avatar.p2ImageOpen', ''),
    p1ImageSmile: store.get('avatar.p1ImageSmile', ''),
    p2ImageSmile: store.get('avatar.p2ImageSmile', ''),
    p1MouthSmile: store.get('avatar.p1MouthSmile', ''),
    p2MouthSmile: store.get('avatar.p2MouthSmile', ''),
    p1EyesSmile: store.get('avatar.p1EyesSmile', ''),
    p2EyesSmile: store.get('avatar.p2EyesSmile', ''),
    p1EyesNormal: store.get('avatar.p1EyesNormal', ''),
    p2EyesNormal: store.get('avatar.p2EyesNormal', ''),
  };
}

function hasLegacyData(flat, prefix) {
  const p = prefix;
  return !!(
    flat[`${p}ImageClosed`] || flat[`${p}ImageOpen`] || flat[`${p}ImageSmile`]
    || flat[`${p}MouthSmile`] || flat[`${p}EyesSmile`] || flat[`${p}EyesNormal`]
  );
}

/**
 * legacy フラット設定を p1Slot / p2Slot へ移行し、legacy キーを削除
 */
function migrateStoreToSlots(store, slotKeys) {
  const legacy = readLegacyFlatFromStore(store);
  let migrated = false;

  for (const { storeKey, prefix } of slotKeys) {
    const raw = store.get(storeKey, null);
    const existing = raw && typeof raw === 'object'
      ? deepMerge(defaultSlot(), raw)
      : null;
    const slotEmpty = !existing || !hasLayerContent(existing);
    if (slotEmpty && hasLegacyData(legacy, prefix)) {
      saveSlot(store, storeKey, migrateSlotFromLegacy(prefix, legacy));
      migrated = true;
    }
  }

  if (migrated || LEGACY_STORE_KEYS.some((k) => store.get(k, '') !== '')) {
    for (const k of LEGACY_STORE_KEYS) {
      store.set(k, '');
    }
  }
}

/** 旧グローバルしきい値・感度を各スロットへ一度だけコピー */
function migrateSlotAudioFromGlobal(store, p1Key, p2Key, globalThKey, globalSensKey) {
  const gTh = Number(store.get(globalThKey, 12)) || 12;
  const gSens = Number(store.get(globalSensKey, 1.5)) || 1.5;
  for (const slotKey of [p1Key, p2Key]) {
    const raw = store.get(slotKey, null);
    if (!raw || typeof raw !== 'object') continue;
    let changed = false;
    const slot = { ...raw };
    if (slot.speakThreshold === undefined || slot.speakThreshold === null) {
      slot.speakThreshold = gTh;
      changed = true;
    }
    if (slot.sensitivity === undefined || slot.sensitivity === null) {
      slot.sensitivity = gSens;
      changed = true;
    }
    if (changed) store.set(slotKey, slot);
  }
}

function loadSlot(store, slotKey, legacyFlat, prefix) {
  const raw = store.get(slotKey, null);
  if (raw && typeof raw === 'object') {
    return normalizeSlotOffsets(deepMerge(defaultSlot(), raw));
  }
  return migrateSlotFromLegacy(prefix, legacyFlat);
}

function saveSlot(store, slotKey, slot) {
  store.set(slotKey, normalizeSlotOffsets({ ...slot }));
}

function hasLayerContent(slot) {
  if (ASSET_KEYS.some((k) => slot.paths[k])) return true;
  return (slot.customLayers || []).some((l) => l.path);
}

function pathForAsset(slot, asset) {
  if (String(asset).startsWith('custom-')) {
    const id = String(asset).slice(7);
    const cl = (slot.customLayers || []).find((l) => l.id === id);
    return cl?.path || '';
  }
  return slot.paths[asset] || '';
}

/**
 * OBS init 用 URL マップ
 */
function buildAssetUrls(slotId, slot, baseUrl, existsFn) {
  const assets = {};
  for (const key of ASSET_KEYS) {
    const filePath = pathForAsset(slot, key);
    assets[key] = filePath && existsFn(filePath)
      ? `${baseUrl}/avatar/${slotId}/${key}`
      : null;
  }
  for (const cl of normalizeCustomLayers(slot.customLayers)) {
    const assetKey = `custom-${cl.id}`;
    assets[assetKey] = cl.path && existsFn(cl.path)
      ? `${baseUrl}/avatar/${slotId}/${assetKey}`
      : null;
  }
  return assets;
}

function hasAvailableAssets(assets) {
  return Object.values(assets || {}).some((u) => !!u);
}

function slotToOverlay(slotId, slot, baseUrl, existsFn) {
  const normalized = normalizeSlotOffsets({ ...slot });
  const assets = buildAssetUrls(slotId, normalized, baseUrl, existsFn);
  return {
    assets,
    hideWhenSilent: !!normalized.hideWhenSilent,
    silentOpacity: resolveSilentOpacity(normalized),
    dragLag: Number(normalized.dragLag) || 0.35,
    blinkMinSec: Number(normalized.blinkMinSec) || 3,
    blinkMaxSec: Number(normalized.blinkMaxSec) || 7,
    blinkDurationMs: Number(normalized.blinkDurationMs) || 130,
    jiggleStrength: Number(normalized.jiggleStrength) ?? 0.08,
    flipX: !!normalized.flipX,
    flipY: !!normalized.flipY,
    slotOffsetXPct: normalized.slotOffsetXPct,
    slotOffsetYPct: normalized.slotOffsetYPct,
    slotOffsetX: Number(normalized.slotOffsetX) || 0,
    slotOffsetY: Number(normalized.slotOffsetY) || 0,
    lookAtEnabled: !!normalized.lookAtEnabled,
    pupilOffsetMax: Math.max(1, Math.min(16, Number(normalized.pupilOffsetMax) || 4)),
    rigType: normalized.rigType === 'integrated' ? 'integrated' : 'human',
    poseYawPx: Math.max(0, Math.min(120, Number(normalized.poseYawPx) ?? 42)),
    posePitchPx: Math.max(0, Math.min(120, Number(normalized.posePitchPx) ?? 34)),
    hairSpringStrength: Math.max(0, Math.min(1, Number(normalized.hairSpringStrength) ?? 0.55)),
    hairSpringSpeed: Math.max(0, Math.min(1, Number(normalized.hairSpringSpeed) ?? 0.55)),
    hairSpringDamp: Math.max(0, Math.min(1, Number(normalized.hairSpringDamp) ?? 0.55)),
    faceMaskEnabled: !!normalized.faceMaskEnabled,
    faceMeshEnabled: !!normalized.faceMeshEnabled,
    faceMeshDivisions: Math.max(4, Math.min(16, Math.round(Number(normalized.faceMeshDivisions) || 8))),
    meshYawStrength: Math.max(0, Math.min(2, Number(normalized.meshYawStrength) ?? 0.55)),
    meshPitchStrength: Math.max(0, Math.min(2, Number(normalized.meshPitchStrength) ?? 0.40)),
    poseParallaxWhenMesh: Math.max(0, Math.min(1, Number(normalized.poseParallaxWhenMesh) ?? 0.35)),
    customLayers: normalizeCustomLayers(normalized.customLayers),
    layers: normalized.layers,
    /** パスが保存されていてもファイルが無い場合はレイヤーモードにしない */
    useLayers: hasLayerContent(normalized) && hasAvailableAssets(assets),
  };
}

/**
 * 設定画面のフラット payload → スロットオブジェクト
 */
function slotFromFormPayload(prefix, data) {
  const slot = defaultSlot();
  const g = (name, def) => {
    const v = data[`${prefix}_${name}`];
    return v !== undefined && v !== '' ? v : def;
  };
  if (data[`${prefix}_silentOpacity`] !== undefined && data[`${prefix}_silentOpacity`] !== '') {
    slot.silentOpacity = Math.max(0, Math.min(100, Number(data[`${prefix}_silentOpacity`]) || 0));
    slot.hideWhenSilent = slot.silentOpacity === 0;
  } else {
    slot.hideWhenSilent = !!data[`${prefix}_hideWhenSilent`];
    slot.silentOpacity = slot.hideWhenSilent ? 0 : 100;
  }
  slot.dragLag = Number(g('dragLag', 0.35));
  slot.blinkMinSec = Number(g('blinkMinSec', 3));
  slot.blinkMaxSec = Number(g('blinkMaxSec', 7));
  slot.blinkDurationMs = Number(g('blinkDurationMs', 130));
  slot.jiggleStrength = Number(g('jiggleStrength', 0.08));
  slot.speakThreshold = Math.max(1, Math.min(100, Number(g('speakThreshold', 12)) || 12));
  slot.sensitivity = Math.max(0.5, Math.min(5, Number(g('sensitivity', 1.5)) || 1.5));
  if (data[`${prefix}_flipX`] !== undefined) slot.flipX = !!data[`${prefix}_flipX`];
  if (data[`${prefix}_flipY`] !== undefined) slot.flipY = !!data[`${prefix}_flipY`];
  if (data[`${prefix}_slot_ox`] !== undefined) {
    slot.slotOffsetXPct = clampSlotOffsetPct(data[`${prefix}_slot_ox`]);
  }
  if (data[`${prefix}_slot_oy`] !== undefined) {
    slot.slotOffsetYPct = clampSlotOffsetPct(data[`${prefix}_slot_oy`]);
  }
  if (data[`${prefix}_lookAtEnabled`] !== undefined) slot.lookAtEnabled = !!data[`${prefix}_lookAtEnabled`];
  if (data[`${prefix}_pupilOffsetMax`] !== undefined) {
    slot.pupilOffsetMax = Math.max(1, Math.min(16, Number(data[`${prefix}_pupilOffsetMax`]) || 4));
  }
  if (data[`${prefix}_rigType`] !== undefined) {
    slot.rigType = String(data[`${prefix}_rigType`]) === 'integrated' ? 'integrated' : 'human';
  }
  if (data[`${prefix}_poseYawPx`] !== undefined && data[`${prefix}_poseYawPx`] !== '') {
    slot.poseYawPx = Math.max(0, Math.min(120, Number(data[`${prefix}_poseYawPx`]) || 0));
  }
  if (data[`${prefix}_posePitchPx`] !== undefined && data[`${prefix}_posePitchPx`] !== '') {
    slot.posePitchPx = Math.max(0, Math.min(120, Number(data[`${prefix}_posePitchPx`]) || 0));
  }
  if (data[`${prefix}_hairSpringStrength`] !== undefined && data[`${prefix}_hairSpringStrength`] !== '') {
    slot.hairSpringStrength = Math.max(0, Math.min(1, Number(data[`${prefix}_hairSpringStrength`]) || 0));
  }
  if (data[`${prefix}_hairSpringSpeed`] !== undefined && data[`${prefix}_hairSpringSpeed`] !== '') {
    slot.hairSpringSpeed = Math.max(0, Math.min(1, Number(data[`${prefix}_hairSpringSpeed`]) || 0));
  }
  if (data[`${prefix}_hairSpringDamp`] !== undefined && data[`${prefix}_hairSpringDamp`] !== '') {
    slot.hairSpringDamp = Math.max(0, Math.min(1, Number(data[`${prefix}_hairSpringDamp`]) || 0));
  }
  if (data[`${prefix}_faceMaskEnabled`] !== undefined) {
    slot.faceMaskEnabled = !!data[`${prefix}_faceMaskEnabled`];
  }
  if (data[`${prefix}_faceMeshEnabled`] !== undefined) {
    slot.faceMeshEnabled = !!data[`${prefix}_faceMeshEnabled`];
  }
  if (data[`${prefix}_faceMeshDivisions`] !== undefined && data[`${prefix}_faceMeshDivisions`] !== '') {
    slot.faceMeshDivisions = Math.max(4, Math.min(16, Math.round(Number(data[`${prefix}_faceMeshDivisions`]) || 8)));
  }
  if (data[`${prefix}_meshYawStrength`] !== undefined && data[`${prefix}_meshYawStrength`] !== '') {
    slot.meshYawStrength = Math.max(0, Math.min(2, Number(data[`${prefix}_meshYawStrength`]) || 0));
  }
  if (data[`${prefix}_meshPitchStrength`] !== undefined && data[`${prefix}_meshPitchStrength`] !== '') {
    slot.meshPitchStrength = Math.max(0, Math.min(2, Number(data[`${prefix}_meshPitchStrength`]) || 0));
  }
  if (data[`${prefix}_poseParallaxWhenMesh`] !== undefined && data[`${prefix}_poseParallaxWhenMesh`] !== '') {
    slot.poseParallaxWhenMesh = Math.max(0, Math.min(1, Number(data[`${prefix}_poseParallaxWhenMesh`]) || 0));
  }
  if (data[`${prefix}_custom_layers_json`] !== undefined) {
    try {
      const parsed = JSON.parse(String(data[`${prefix}_custom_layers_json`] || '[]'));
      slot.customLayers = normalizeCustomLayers(parsed);
    } catch (_) {
      slot.customLayers = [];
    }
  }

  for (const key of ASSET_KEYS) {
    const pk = key.replace(/-/g, '_');
    if (data[`${prefix}_path_${pk}`] !== undefined) {
      slot.paths[key] = String(data[`${prefix}_path_${pk}`] || '').trim();
    }
  }

  const layerNames = ['body', 'face', 'hair1', 'hair2', 'eyes', 'mouth', 'nose'];
  for (const ln of layerNames) {
    const L = slot.layers[ln];
    if (!L) continue;
    if (data[`${prefix}_${ln}_ox`] !== undefined) L.offsetX = Number(data[`${prefix}_${ln}_ox`]) || 0;
    if (data[`${prefix}_${ln}_oy`] !== undefined) L.offsetY = Number(data[`${prefix}_${ln}_oy`]) || 0;
    if (data[`${prefix}_${ln}_scale`] !== undefined) L.scale = Number(data[`${prefix}_${ln}_scale`]) || 1;
    if (data[`${prefix}_${ln}_z`] !== undefined) {
      L.zIndex = Number(data[`${prefix}_${ln}_z`]) || DEFAULT_LAYER_Z[ln] || 30;
    }
    if (data[`${prefix}_${ln}_drag`] !== undefined) L.drag = !!data[`${prefix}_${ln}_drag`];
    if (data[`${prefix}_${ln}_sine_on`] !== undefined) L.sine.enabled = !!data[`${prefix}_${ln}_sine_on`];
    if (data[`${prefix}_${ln}_sine_amp`] !== undefined) L.sine.amp = Number(data[`${prefix}_${ln}_sine_amp`]) || 0;
    if (data[`${prefix}_${ln}_sine_period`] !== undefined) L.sine.periodMs = Number(data[`${prefix}_${ln}_sine_period`]) || 4000;
    if (data[`${prefix}_${ln}_sine_phase`] !== undefined) L.sine.phase = Number(data[`${prefix}_${ln}_sine_phase`]) || 0;
    if (data[`${prefix}_${ln}_lookMul`] !== undefined) {
      const raw = data[`${prefix}_${ln}_lookMul`];
      if (raw === '' || raw == null) {
        L.lookMul = null;
      } else {
        const n = Number(raw);
        L.lookMul = Number.isFinite(n) && n >= 0 ? n : null;
      }
    }
  }
  return slot;
}

/**
 * フォーム payload を既存スロットにマージ。空の画像パスは意図的クリア時のみ上書きする。
 * @param {object} existing
 * @param {string} prefix
 * @param {object} data
 */
function buildSlotFromForm(existing, prefix, data) {
  const base = existing && typeof existing === 'object' ? existing : defaultSlot();
  const merged = deepMerge(base, slotFromFormPayload(prefix, data));
  const cleared = new Set(Array.isArray(data.__clearedPathKeys) ? data.__clearedPathKeys : []);
  for (const key of ASSET_KEYS) {
    const pk = key.replace(/-/g, '_');
    const formKey = `${prefix}_path_${pk}`;
    if (!(formKey in data)) continue;
    const val = String(data[formKey] ?? '').trim();
    if (val) {
      merged.paths[key] = val;
    } else if (cleared.has(formKey)) {
      merged.paths[key] = '';
    } else {
      merged.paths[key] = base.paths[key] || '';
    }
  }
  return normalizeSlotOffsets(merged);
}

function slotToFormFlat(prefix, slot) {
  const normalized = normalizeSlotOffsets({ ...slot });
  const flat = {};
  flat[`${prefix}_hideWhenSilent`] = normalized.hideWhenSilent;
  flat[`${prefix}_silentOpacity`] = resolveSilentOpacity(normalized);
  flat[`${prefix}_dragLag`] = normalized.dragLag;
  flat[`${prefix}_blinkMinSec`] = normalized.blinkMinSec;
  flat[`${prefix}_blinkMaxSec`] = normalized.blinkMaxSec;
  flat[`${prefix}_blinkDurationMs`] = normalized.blinkDurationMs;
  flat[`${prefix}_jiggleStrength`] = normalized.jiggleStrength;
  flat[`${prefix}_speakThreshold`] = normalized.speakThreshold ?? 12;
  flat[`${prefix}_sensitivity`] = normalized.sensitivity ?? 1.5;
  flat[`${prefix}_flipX`] = !!normalized.flipX;
  flat[`${prefix}_flipY`] = !!normalized.flipY;
  flat[`${prefix}_slot_ox`] = normalized.slotOffsetXPct;
  flat[`${prefix}_slot_oy`] = normalized.slotOffsetYPct;
  flat[`${prefix}_lookAtEnabled`] = !!normalized.lookAtEnabled;
  flat[`${prefix}_pupilOffsetMax`] = Number(normalized.pupilOffsetMax) || 4;
  flat[`${prefix}_rigType`] = normalized.rigType === 'integrated' ? 'integrated' : 'human';
  flat[`${prefix}_poseYawPx`] = Number(normalized.poseYawPx) ?? 42;
  flat[`${prefix}_posePitchPx`] = Number(normalized.posePitchPx) ?? 34;
  flat[`${prefix}_hairSpringStrength`] = Number(normalized.hairSpringStrength) ?? 0.55;
  flat[`${prefix}_hairSpringSpeed`] = Number(normalized.hairSpringSpeed) ?? 0.55;
  flat[`${prefix}_hairSpringDamp`] = Number(normalized.hairSpringDamp) ?? 0.55;
  flat[`${prefix}_faceMaskEnabled`] = !!normalized.faceMaskEnabled;
  flat[`${prefix}_faceMeshEnabled`] = !!normalized.faceMeshEnabled;
  flat[`${prefix}_faceMeshDivisions`] = Number(normalized.faceMeshDivisions) || 8;
  flat[`${prefix}_meshYawStrength`] = Number(normalized.meshYawStrength) ?? 0.55;
  flat[`${prefix}_meshPitchStrength`] = Number(normalized.meshPitchStrength) ?? 0.40;
  flat[`${prefix}_poseParallaxWhenMesh`] = Number(normalized.poseParallaxWhenMesh) ?? 0.35;
  flat[`${prefix}_custom_layers_json`] = JSON.stringify(normalizeCustomLayers(normalized.customLayers));
  for (const key of ASSET_KEYS) {
    const pk = key.replace(/-/g, '_');
    flat[`${prefix}_path_${pk}`] = normalized.paths[key] || '';
  }
  for (const ln of ['body', 'face', 'hair1', 'hair2', 'eyes', 'mouth', 'nose']) {
    const L = normalized.layers[ln];
    if (!L) continue;
    flat[`${prefix}_${ln}_ox`] = L.offsetX;
    flat[`${prefix}_${ln}_oy`] = L.offsetY;
    flat[`${prefix}_${ln}_scale`] = L.scale;
    flat[`${prefix}_${ln}_z`] = L.zIndex;
    flat[`${prefix}_${ln}_drag`] = L.drag;
    flat[`${prefix}_${ln}_sine_on`] = L.sine.enabled;
    flat[`${prefix}_${ln}_sine_amp`] = L.sine.amp;
    flat[`${prefix}_${ln}_sine_period`] = L.sine.periodMs;
    flat[`${prefix}_${ln}_sine_phase`] = L.sine.phase;
    flat[`${prefix}_${ln}_lookMul`] = L.lookMul == null || L.lookMul === '' ? '' : Number(L.lookMul);
  }
  return flat;
}

/**
 * 髪・鼻の「降格」用。Pixi ランタイムの部位別パララックス倍率と同値を持ち、
 * カスタム部位へ移す際に lookMul として引き継ぐ。
 */
const DEMOTE_LOOK_MUL = {
  human: { hair1: 0.45, hair2: 0.35, nose: 1.0 },
  integrated: { hair1: 0.75, hair2: 0.7, nose: 0.85 },
};

/** 降格対象の部位 → カスタム部位の親アンカー / 表示名 */
const DEMOTE_SPEC = {
  hair1: { anchor: 'rig', name: '髪（前）' },
  hair2: { anchor: 'rig', name: '髪（後ろ）' },
  nose: { anchor: 'nose', name: '鼻' },
};

/**
 * hair1 / hair2 / nose を customLayers へ降格する（1スロット分・破壊的でない純関数）。
 *
 * - `paths[key]` のみクリアし、`layers[key]` は残す。
 *   親アンカー hair1/hair2/nose を使う既存カスタム部位の追従を壊さないため。
 * - 現行の見え方（追従倍率・スプリング・音声バウンス・sine）を数値として引き継ぐ。
 *
 * @param {object} slot
 * @param {string[]} [keys] 対象キー。既定は hair1 → hair2 → 鼻の順
 * @returns {{ slot: object, changed: boolean, moved: string[] }}
 */
function demoteHairNoseToCustom(slot, keys = ['hair1', 'hair2', 'nose']) {
  if (!slot || typeof slot !== 'object') return { slot, changed: false, moved: [] };
  const out = { ...slot, paths: { ...(slot.paths || {}) } };
  const existing = normalizeCustomLayers(out.customLayers);
  const rig = out.rigType === 'integrated' ? 'integrated' : 'human';
  const hairStr = clamp01Num(out.hairSpringStrength, 0.55);
  // Pixi の hair 音声バウンス係数と同式
  const bounceBase = 2.2 + hairStr * 3.5;
  const moved = [];

  for (const key of keys) {
    const spec = DEMOTE_SPEC[key];
    const path = String(out.paths?.[key] || '').trim();
    if (!spec || !path) continue;
    const id = `cl-legacy-${key}`;
    if (existing.some((l) => l.id === id)) continue;
    const L = (out.layers && out.layers[key]) || {};
    const isHair = key === 'hair1' || key === 'hair2';
    const lookRaw = L.lookMul == null || L.lookMul === '' ? NaN : Number(L.lookMul);
    existing.push(defaultCustomLayer({
      id,
      name: spec.name,
      parentAnchor: spec.anchor,
      path,
      // nose は親アンカー側が layers.nose の offset / scale を持つため二重に掛けない
      offsetX: isHair ? (Number(L.offsetX) || 0) : 0,
      offsetY: isHair ? (Number(L.offsetY) || 0) : 0,
      scale: isHair ? (Number(L.scale) > 0 ? Number(L.scale) : 1) : 1,
      zIndex: Number(L.zIndex) || DEFAULT_LAYER_Z[key] || 45,
      lookMul: Number.isFinite(lookRaw) && lookRaw >= 0 ? lookRaw : DEMOTE_LOOK_MUL[rig][key],
      springStrength: key === 'hair1' ? hairStr : (key === 'hair2' ? hairStr * 0.85 : 0),
      springSpeed: clamp01Num(out.hairSpringSpeed, 0.55),
      springDamp: clamp01Num(out.hairSpringDamp, 0.55),
      audioBounce: key === 'hair1' ? bounceBase * 0.55 : (key === 'hair2' ? bounceBase : 0),
      // 鼻は親アンカー（face の sine）に乗るので自前 sine は持たせない
      sine: isHair ? defaultSine({ ...(L.sine || {}) }) : defaultSine({ enabled: false }),
    }));
    out.paths[key] = '';
    moved.push(key);
  }

  if (!moved.length) return { slot, changed: false, moved };
  out.customLayers = normalizeCustomLayers(existing);
  return { slot: out, changed: true, moved };
}

module.exports = {
  demoteHairNoseToCustom,
  normalizeSlotOffsets,
  clampSlotOffsetPct,
  SLOT_REF_W,
  SLOT_REF_H,
  ASSET_KEYS,
  CUSTOM_PARENT_ANCHORS,
  DEFAULT_LAYER_Z,
  resolveSilentOpacity,
  defaultSlot,
  defaultCustomLayer,
  normalizeCustomLayers,
  deepMerge,
  loadSlot,
  saveSlot,
  hasLayerContent,
  hasAvailableAssets,
  pathForAsset,
  slotToOverlay,
  slotFromFormPayload,
  buildSlotFromForm,
  slotToFormFlat,
  migrateSlotFromLegacy,
  migrateStoreToSlots,
  migrateSlotAudioFromGlobal,
  LEGACY_STORE_KEYS,
};
