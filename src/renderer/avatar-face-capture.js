/**
 * avatar-face-capture.js — MediaPipe Face Landmarker（非表示ウィンドウ）
 * landmarks: 1(鼻), 33(左目), 263(右目), 152(顎)
 * numFaces は displayMode 連動: both=2（左→p1 / 右→p2）、p1|p2=1
 *
 * WASM / model は avatar HTTP（config の URL）から読み込む。
 */

'use strict';

const YAW_GAIN = 2.4;
const PITCH_GAIN = 2.8;
const CLAMP = 1;
const SMOOTH = 0.28;
/** 見失ったあとに正面へ戻す速さ */
const RETURN_SMOOTH = 0.2;
const LOST_FRAMES = 12;
/** 再検出直後、このフレーム数の平均を「正面」とする */
const CALIB_FRAMES = 10;
/** 設定プレビュー用ランドマーク送信間隔（ms）。実写は送らない */
const PREVIEW_EVERY_MS = 80;
/** 検出推論の最短間隔（≈30fps）。rAF は回すが detect を間引く */
const DETECT_MIN_MS = 33;
/** 配信向け: カメラ ideal 解像度（検出には十分） */
const CAM_W = 480;
const CAM_H = 360;

/**
 * MediaPipe 顔輪郭＋目・口の代表点（実写なしのマーキング用）。
 * @see https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */
const PREVIEW_LANDMARK_IDX = [
  // face oval
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109,
  // left eye
  33, 160, 158, 133, 153, 144,
  // right eye
  362, 385, 387, 263, 373, 380,
  // lips outer
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

let lastPreviewSentAt = 0;
let lastDetectAt = 0;
/** 設定プレビュー表示中のみ true（blendshapes/matrix もこのときだけ有効） */
let previewEnabled = false;
/** ensureLandmarker / openCamera 用に保持 */
let lastAssetConfig = null;
/** Landmarker 差し替え中は detect を止める（閉じたインスタンスへの触りを防ぐ） */
let landmarkerRefreshing = false;

/** @type {import('@mediapipe/tasks-vision').FaceLandmarker | null} */
let landmarker = null;
/** @type {string} */
let landmarkerKey = '';
/** @type {HTMLVideoElement | null} */
let video = null;
/** @type {MediaStream | null} */
let stream = null;
let rafId = 0;
let running = false;
let lastVideoTime = -1;

/**
 * displayMode に連動:
 * - both → 最大2顔（左=p1 / 右=p2）
 * - p1 / p2 → 最大1顔（検出顔をそのスロットへ）
 * @type {{ swapAssign: boolean, displayMode: 'both'|'p1'|'p2', numFaces: 1|2 }}
 */
let runtimeOpts = { swapAssign: false, displayMode: 'both', numFaces: 2 };

function resolveFaceOpts(config) {
  const dm = config?.displayMode === 'p1' || config?.displayMode === 'p2'
    ? config.displayMode
    : 'both';
  return {
    swapAssign: !!config?.faceAssignSwap,
    displayMode: dm,
    numFaces: dm === 'both' ? 2 : 1,
  };
}

function emptySlotState() {
  return {
    yaw: 0,
    pitch: 0,
    tracking: false,
    calib: null,
    calibSamples: [],
    lost: 0,
  };
}

const faceSlots = {
  p1: emptySlotState(),
  p2: emptySlotState(),
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function averagePose(samples) {
  const n = samples.length || 1;
  let yaw = 0;
  let pitch = 0;
  for (const s of samples) {
    yaw += s.yaw;
    pitch += s.pitch;
  }
  return { yaw: yaw / n, pitch: pitch / n };
}

function returnSlotToRest(slot) {
  slot.yaw = lerp(slot.yaw, 0, RETURN_SMOOTH);
  slot.pitch = lerp(slot.pitch, 0, RETURN_SMOOTH);
  if (Math.abs(slot.yaw) < 0.008) slot.yaw = 0;
  if (Math.abs(slot.pitch) < 0.008) slot.pitch = 0;
}

/**
 * @param {Array<{x:number,y:number,z?:number}>} lm
 */
function computeRawPose(lm) {
  const nose = lm[1];
  const leftEye = lm[33];
  const rightEye = lm[263];
  const chin = lm[152];
  if (!nose || !leftEye || !rightEye || !chin) return null;

  const midEyeX = (leftEye.x + rightEye.x) / 2;
  const midEyeY = (leftEye.y + rightEye.y) / 2;
  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1e-6;
  const faceH = Math.hypot(chin.x - midEyeX, chin.y - midEyeY) || 1e-6;

  const yawRaw = ((nose.x - midEyeX) / eyeDist) * YAW_GAIN;
  const pitchRaw = ((nose.y - midEyeY) / faceH) * PITCH_GAIN;
  return { yaw: yawRaw, pitch: pitchRaw, noseX: nose.x };
}

function noseX(lm) {
  return lm?.[1]?.x ?? 0.5;
}

/**
 * @param {object} slot
 * @param {{ yaw: number, pitch: number } | null} raw
 */
function updateSlot(slot, raw) {
  if (!raw) {
    slot.lost += 1;
    if (slot.lost >= LOST_FRAMES) {
      slot.tracking = false;
      slot.calib = null;
      slot.calibSamples = [];
      returnSlotToRest(slot);
    }
    return;
  }
  slot.lost = 0;
  if (!slot.calib) {
    if (!Array.isArray(slot.calibSamples)) slot.calibSamples = [];
    slot.calibSamples.push({ yaw: raw.yaw, pitch: raw.pitch });
    const avg = averagePose(slot.calibSamples);
    // キャリブ確定前も仮の正面（移動平均）からの相対値で動かす
    slot.yaw = lerp(slot.yaw, clamp(raw.yaw - avg.yaw, -CLAMP, CLAMP), SMOOTH);
    slot.pitch = lerp(slot.pitch, clamp(raw.pitch - avg.pitch, -CLAMP, CLAMP), SMOOTH);
    slot.tracking = true;
    if (slot.calibSamples.length >= CALIB_FRAMES) {
      slot.calib = avg;
      slot.calibSamples = [];
    }
    return;
  }
  const yaw = clamp(raw.yaw - slot.calib.yaw, -CLAMP, CLAMP);
  const pitch = clamp(raw.pitch - slot.calib.pitch, -CLAMP, CLAMP);
  slot.yaw = lerp(slot.yaw, yaw, SMOOTH);
  slot.pitch = lerp(slot.pitch, pitch, SMOOTH);
  slot.tracking = true;
}

function emitPose() {
  const p1 = faceSlots.p1;
  const p2 = faceSlots.p2;
  // 単一表示時のトップレベル互換値は表示スロット基準
  const primary = runtimeOpts.displayMode === 'p2' ? p2 : p1;
  window.avatarFaceAPI?.sendPose?.({
    yaw: primary.yaw,
    pitch: primary.pitch,
    tracking: p1.tracking || p2.tracking,
    faceCount: (p1.tracking ? 1 : 0) + (p2.tracking ? 1 : 0),
    p1: { yaw: p1.yaw, pitch: p1.pitch, tracking: p1.tracking },
    p2: { yaw: p2.yaw, pitch: p2.pitch, tracking: p2.tracking },
  });
}

/** 実写ではなく正規化座標の点群だけ送る（設定画面のシルエット用） */
function extractPreviewPoints(lm) {
  if (!lm) return null;
  const pts = [];
  for (const i of PREVIEW_LANDMARK_IDX) {
    const p = lm[i];
    if (!p) continue;
    pts.push([
      Math.round(p.x * 1000) / 1000,
      Math.round(p.y * 1000) / 1000,
    ]);
  }
  return pts.length ? pts : null;
}

/**
 * 4x4 column-major → yaw/pitch/roll（ラジアン）。失敗時は null。
 * MediaPipe facialTransformationMatrixes 用。
 */
function extractEulerFromMatrix(matrix) {
  const m = matrix?.data || matrix;
  if (!m || m.length < 16) return null;
  // R column-major: r_ij = m[i + j*4]
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2];
  const r01 = m[4];
  const r11 = m[5];
  const r21 = m[6];
  const r02 = m[8];
  const r12 = m[9];
  const r22 = m[10];
  // XYZ オイラー
  const pitch = Math.asin(clamp(-r12, -1, 1));
  let yaw;
  let roll;
  if (Math.abs(r12) < 0.9999) {
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);
  } else {
    // ジンバルロック近傍
    yaw = Math.atan2(-r20, r00);
    roll = 0;
  }
  if (![yaw, pitch, roll].every(Number.isFinite)) {
    const sy = Math.sqrt(r00 * r00 + r10 * r10) || 1e-6;
    return {
      yaw: Math.round(Math.atan2(-r20, sy) * 1000) / 1000,
      pitch: Math.round(Math.atan2(r21, r22) * 1000) / 1000,
      roll: Math.round(Math.atan2(r01, r00) * 1000) / 1000,
    };
  }
  return {
    yaw: Math.round(yaw * 1000) / 1000,
    pitch: Math.round(pitch * 1000) / 1000,
    roll: Math.round(roll * 1000) / 1000,
  };
}

/** プレビュー用に必要なブレンドシェイプだけ抜粋 */
const BLEND_KEYS = [
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'browInnerUp',
  'browDownLeft',
  'browDownRight',
];

function extractBlendSummary(blendshapes) {
  const cats = blendshapes?.categories;
  if (!Array.isArray(cats) || !cats.length) return null;
  const map = Object.create(null);
  for (const c of cats) {
    const name = c?.categoryName || c?.displayName;
    if (!name) continue;
    map[name] = Number(c.score) || 0;
  }
  const out = {};
  let any = false;
  for (const k of BLEND_KEYS) {
    if (map[k] != null) {
      out[k] = Math.round(map[k] * 1000) / 1000;
      any = true;
    }
  }
  return any ? out : null;
}

function buildSlotPreview(slot, faceEntry) {
  const base = {
    tracking: !!slot.tracking,
    yaw: slot.yaw,
    pitch: slot.pitch,
    points: extractPreviewPoints(faceEntry?.lm) || null,
    euler: null,
    blend: null,
  };
  if (!faceEntry) return base;
  base.euler = extractEulerFromMatrix(faceEntry.matrix) || null;
  base.blend = extractBlendSummary(faceEntry.blend) || null;
  return base;
}

function emitPreview(ranked, leftFace, rightFace, opts = {}) {
  if (!previewEnabled) return;
  const now = performance.now();
  if (!opts.force && now - lastPreviewSentAt < PREVIEW_EVERY_MS) return;
  lastPreviewSentAt = now;
  const mode = runtimeOpts.displayMode;
  const p1 = faceSlots.p1;
  const p2 = faceSlots.p2;
  let p1Prev;
  let p2Prev;
  if (mode === 'p1') {
    p1Prev = buildSlotPreview(p1, ranked?.[0] || null);
    p2Prev = buildSlotPreview(p2, null);
  } else if (mode === 'p2') {
    p1Prev = buildSlotPreview(p1, null);
    p2Prev = buildSlotPreview(p2, ranked?.[0] || null);
  } else {
    p1Prev = buildSlotPreview(p1, leftFace || null);
    p2Prev = buildSlotPreview(p2, rightFace || null);
  }
  const calibrating = opts.calibrating != null
    ? !!opts.calibrating
    : !!(
      (p1.tracking && !p1.calib && (p1.calibSamples?.length || 0) > 0) ||
      (p2.tracking && !p2.calib && (p2.calibSamples?.length || 0) > 0)
    );
  window.avatarFaceAPI?.sendPreview?.({
    tracking: p1.tracking || p2.tracking,
    calibrating,
    p1: p1Prev,
    p2: p2Prev,
  });
}

function recalibrateSlots() {
  for (const id of ['p1', 'p2']) {
    const slot = faceSlots[id];
    slot.calib = null;
    slot.calibSamples = [];
    slot.lost = 0;
    // 現在値はそのまま。次の検出で正面サンプルを取り直す
  }
  // プレビュー ON なら「記憶中」を即反映（次フレーム待ちで旧表示が残らないように）
  if (previewEnabled) {
    emitPreview([], null, null, { force: true, calibrating: true });
  }
}

async function ensureLandmarker(config) {
  const numFaces = runtimeOpts.numFaces;
  const rich = !!previewEnabled;
  const key = `${config.visionModuleUrl}|${config.wasmRoot}|${config.modelAssetPath}|n${numFaces}|${rich ? 'mx+bs' : 'lite'}`;
  if (landmarker && landmarkerKey === key) return landmarker;

  landmarkerRefreshing = true;
  try {
    if (landmarker) {
      try { landmarker.close(); } catch (_) { /* */ }
      landmarker = null;
      landmarkerKey = '';
    }

    const mod = await import(config.visionModuleUrl);
    const { FaceLandmarker, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(config.wasmRoot);
    const options = {
      baseOptions: {
        modelAssetPath: config.modelAssetPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces,
      // プレビュー表示中のみ表情・変換行列（配信時の負荷を下げる）
      outputFacialTransformationMatrixes: rich,
      outputFaceBlendshapes: rich,
    };
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch (gpuErr) {
      console.warn('[avatar-face-capture] GPU failed, fallback CPU', gpuErr);
      options.baseOptions.delegate = 'CPU';
      landmarker = await FaceLandmarker.createFromOptions(vision, options);
    }
    landmarkerKey = key;
    return landmarker;
  } finally {
    landmarkerRefreshing = false;
  }
}

async function openCamera(deviceId) {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: CAM_W }, height: { ideal: CAM_H } }
      : { facingMode: 'user', width: { ideal: CAM_W }, height: { ideal: CAM_H } },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (deviceId) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: CAM_W }, height: { ideal: CAM_H } },
      });
    } else {
      throw err;
    }
  }
  if (!video) {
    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.appendChild(video);
  }
  video.srcObject = stream;
  await video.play();
}

function stopLoop() {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function tick() {
  // running 中は必ず次フレームを予約する。Landmarker 差し替え中に return すると
  // ループが止まり、プレビュー ON 後も IPC が来ない原因になる。
  if (!running) return;
  rafId = requestAnimationFrame(tick);
  if (!landmarker || !video || landmarkerRefreshing) return;

  // カメラ切断・未準備でもロスト扱いにして正面へ戻す
  if (video.readyState < 2 || (stream && stream.getTracks().every((t) => t.readyState !== 'live'))) {
    updateSlot(faceSlots.p1, null);
    updateSlot(faceSlots.p2, null);
    emitPose();
    return;
  }
  const now = performance.now();
  // ≈30fps: 推論を間引く（描画ループ自体は rAF）
  if (now - lastDetectAt < DETECT_MIN_MS) return;
  if (video.currentTime === lastVideoTime) {
    // フレームが進まない間もロストカウントを進めたい場合はここでも null 更新できるが、
    // 一時停止っぽいスタッターでは誤ロストしやすいのでスキップ
    return;
  }
  lastDetectAt = now;
  lastVideoTime = video.currentTime;

  let result;
  try {
    result = landmarker.detectForVideo(video, now);
  } catch (err) {
    window.avatarFaceAPI?.sendError?.(String(err?.message || err));
    updateSlot(faceSlots.p1, null);
    updateSlot(faceSlots.p2, null);
    emitPose();
    return;
  }

  const faces = result?.faceLandmarks || [];
  const matrices = previewEnabled ? (result?.facialTransformationMatrixes || []) : [];
  const blends = previewEnabled ? (result?.faceBlendshapes || []) : [];
  const ranked = faces
    .map((lm, i) => ({
      lm,
      x: noseX(lm),
      raw: computeRawPose(lm),
      matrix: matrices[i] || null,
      blend: blends[i] || null,
    }))
    .filter((f) => f.raw)
    .sort((a, b) => a.x - b.x);

  const mode = runtimeOpts.displayMode;
  let leftFace = null;
  let rightFace = null;
  if (mode === 'p1' || mode === 'p2') {
    // 1顔モード: 検出顔を表示スロットへ。他方はロスト扱い
    const only = ranked[0]?.raw || null;
    if (mode === 'p1') {
      updateSlot(faceSlots.p1, only);
      updateSlot(faceSlots.p2, null);
    } else {
      updateSlot(faceSlots.p1, null);
      updateSlot(faceSlots.p2, only);
    }
  } else {
    // both: 左=p1 右=p2。swapAssign で入れ替え
    let left = ranked[0] || null;
    let right = ranked[1] || null;
    if (runtimeOpts.swapAssign) {
      const tmp = left;
      left = right;
      right = tmp;
    }
    leftFace = left;
    rightFace = right;
    updateSlot(faceSlots.p1, left?.raw || null);
    updateSlot(faceSlots.p2, right?.raw || null);
  }
  emitPose();
  if (previewEnabled) emitPreview(ranked, leftFace, rightFace);
}

async function applyPreviewMode(enabled) {
  const next = !!enabled;
  if (previewEnabled === next) return;
  previewEnabled = next;
  if (!lastAssetConfig || !running) return;
  try {
    await ensureLandmarker(lastAssetConfig);
  } catch (err) {
    console.warn('[avatar-face-capture] preview mode landmarker refresh failed', err);
    window.avatarFaceAPI?.sendError?.(String(err?.message || err));
  }
}

async function applyConfig(config) {
  stopLoop();
  faceSlots.p1 = emptySlotState();
  faceSlots.p2 = emptySlotState();
  lastVideoTime = -1;
  lastDetectAt = 0;
  runtimeOpts = resolveFaceOpts(config);
  if (typeof config?.previewEnabled === 'boolean') {
    previewEnabled = config.previewEnabled;
  }

  if (!config || config.enabled === false) {
    lastAssetConfig = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    emitPose();
    return;
  }

  lastAssetConfig = config;
  try {
    await ensureLandmarker(config);
    await openCamera(String(config.cameraDeviceId || '').trim());
    running = true;
    tick();
  } catch (err) {
    console.error('[avatar-face-capture]', err);
    window.avatarFaceAPI?.sendError?.(String(err?.message || err));
    emitPose();
  }
}

function boot() {
  if (!window.avatarFaceAPI) {
    console.error('[avatar-face-capture] avatarFaceAPI missing');
    return;
  }
  window.avatarFaceAPI.onConfig((config) => {
    applyConfig(config).catch((err) => {
      window.avatarFaceAPI.sendError(String(err?.message || err));
    });
  });
  window.avatarFaceAPI.onRecalibrate?.(() => {
    recalibrateSlots();
  });
  window.avatarFaceAPI.onPreviewMode?.((enabled) => {
    applyPreviewMode(enabled).catch((err) => {
      window.avatarFaceAPI.sendError(String(err?.message || err));
    });
  });
}

boot();
