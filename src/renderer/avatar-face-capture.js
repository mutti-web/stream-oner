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
const LOST_FRAMES = 12;

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
    }
    return;
  }
  slot.lost = 0;
  if (!slot.calib) {
    slot.calib = { yaw: raw.yaw, pitch: raw.pitch };
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

async function ensureLandmarker(config) {
  const numFaces = runtimeOpts.numFaces;
  const key = `${config.visionModuleUrl}|${config.wasmRoot}|${config.modelAssetPath}|n${numFaces}`;
  if (landmarker && landmarkerKey === key) return landmarker;
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
}

async function openCamera(deviceId) {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (deviceId) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
  if (!running || !landmarker || !video) return;
  rafId = requestAnimationFrame(tick);

  if (video.readyState < 2) return;
  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  let result;
  try {
    result = landmarker.detectForVideo(video, now);
  } catch (err) {
    window.avatarFaceAPI?.sendError?.(String(err?.message || err));
    return;
  }

  const faces = result?.faceLandmarks || [];
  const ranked = faces
    .map((lm) => ({ lm, x: noseX(lm), raw: computeRawPose(lm) }))
    .filter((f) => f.raw)
    .sort((a, b) => a.x - b.x);

  const mode = runtimeOpts.displayMode;
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
    updateSlot(faceSlots.p1, left?.raw || null);
    updateSlot(faceSlots.p2, right?.raw || null);
  }
  emitPose();
}

async function applyConfig(config) {
  stopLoop();
  faceSlots.p1 = emptySlotState();
  faceSlots.p2 = emptySlotState();
  lastVideoTime = -1;
  runtimeOpts = resolveFaceOpts(config);

  if (!config || config.enabled === false) {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    emitPose();
    return;
  }

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
}

boot();
