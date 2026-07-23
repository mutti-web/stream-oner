/**
 * avatar-face-capture.js — MediaPipe Face Landmarker（非表示ウィンドウ）
 * landmarks: 1(鼻), 33(左目), 263(右目), 152(顎)
 *
 * WASM / model は file:// 不可のため、avatar HTTP（config の URL）から読み込む。
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
let yawSmoothed = 0;
let pitchSmoothed = 0;
let lostCount = 0;
let calib = null;
let lastVideoTime = -1;

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

  // 画面座標: x増=右、y増=下。アバター yaw+: 左向き / pitch+: 下向き に合わせる
  const yawRaw = ((nose.x - midEyeX) / eyeDist) * YAW_GAIN;
  const pitchRaw = ((nose.y - midEyeY) / faceH) * PITCH_GAIN;
  return { yaw: yawRaw, pitch: pitchRaw };
}

async function ensureLandmarker(config) {
  const key = `${config.visionModuleUrl}|${config.wasmRoot}|${config.modelAssetPath}`;
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
    numFaces: 1,
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

  const faces = result?.faceLandmarks;
  if (!faces || !faces.length) {
    lostCount += 1;
    if (lostCount >= LOST_FRAMES) {
      window.avatarFaceAPI?.sendPose?.({ yaw: yawSmoothed, pitch: pitchSmoothed, tracking: false });
    }
    return;
  }

  lostCount = 0;
  const raw = computeRawPose(faces[0]);
  if (!raw) return;

  if (!calib) {
    calib = { yaw: raw.yaw, pitch: raw.pitch };
  }

  const yaw = clamp(raw.yaw - calib.yaw, -CLAMP, CLAMP);
  const pitch = clamp(raw.pitch - calib.pitch, -CLAMP, CLAMP);
  yawSmoothed = lerp(yawSmoothed, yaw, SMOOTH);
  pitchSmoothed = lerp(pitchSmoothed, pitch, SMOOTH);

  window.avatarFaceAPI?.sendPose?.({
    yaw: yawSmoothed,
    pitch: pitchSmoothed,
    tracking: true,
  });
}

async function applyConfig(config) {
  stopLoop();
  calib = null;
  yawSmoothed = 0;
  pitchSmoothed = 0;
  lostCount = 0;
  lastVideoTime = -1;

  if (!config || config.enabled === false) {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    window.avatarFaceAPI?.sendPose?.({ yaw: 0, pitch: 0, tracking: false });
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
    window.avatarFaceAPI?.sendPose?.({ yaw: 0, pitch: 0, tracking: false });
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
