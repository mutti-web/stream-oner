(function () {
  const api = window.avatarCaptureAPI;
  if (!api) return;

  const streams = [];
  const analysers = [];
  /** @type {AudioContext[]} */
  const audioContexts = [];
  const timeDomainBufs = [];
  const freqDataBufs = [];
  const laughStates = [createLaughState(), createLaughState()];
  const speakStates = [{ active: false, holdUntil: 0 }, { active: false, holdUntil: 0 }];
  const vowelStates = [{ value: null, holdUntil: 0 }, { value: null, holdUntil: 0 }];
  let lastMicA = '';
  let lastMicB = '';
  let rafId = null;
  let config = {
    micADeviceId: '',
    micBDeviceId: '',
    speakThreshold: 12,
    sensitivity: 1.5,
    smileDetectEnabled: false,
    smileSensitivity: 50,
  };

  const AC = window.AvatarConstants || {};
  const LAUGH_HOLD_MS = AC.LAUGH_HOLD_MS ?? 2800;
  const SPEAK_HOLD_MS = AC.SPEAK_HOLD_MS ?? 600;
  const SPEAK_OFF_RATIO = AC.SPEAK_OFF_RATIO ?? 0.72;
  const RMS_LEVEL_GAIN = AC.RMS_LEVEL_GAIN ?? 400;
  const NOISE_FLOOR_RATIO = AC.NOISE_FLOOR_RATIO ?? 0.4;
  const NOISE_FLOOR_MIN = AC.NOISE_FLOOR_MIN ?? 3;

  function createLaughState() {
    return { score: 0, prevLevel: 0, holdUntil: 0 };
  }

  function closeAudioContexts() {
    for (const ctx of audioContexts) {
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    }
    audioContexts.length = 0;
  }

  function stopAll() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.length = 0;
    analysers.length = 0;
    closeAudioContexts();
    timeDomainBufs.length = 0;
    freqDataBufs.length = 0;
    laughStates[0] = createLaughState();
    laughStates[1] = createLaughState();
    speakStates[0] = { active: false, holdUntil: 0 };
    speakStates[1] = { active: false, holdUntil: 0 };
    vowelStates[0] = { value: null, holdUntil: 0 };
    vowelStates[1] = { value: null, holdUntil: 0 };
    lastMicA = '';
    lastMicB = '';
  }

  /** 非表示ウィンドウ長時間稼働で AudioContext が suspended になり VU がコマ送りになるのを防ぐ */
  function resumeAudioContextsIfNeeded() {
    for (const ctx of audioContexts) {
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    }
  }

  function ensureTimeDomainBuf(index, analyser) {
    const size = analyser.fftSize;
    if (!timeDomainBufs[index] || timeDomainBufs[index].length !== size) {
      timeDomainBufs[index] = new Uint8Array(size);
    }
    return timeDomainBufs[index];
  }

  function ensureFreqBuf(index, analyser) {
    const size = analyser.frequencyBinCount;
    if (!freqDataBufs[index] || freqDataBufs[index].length !== size) {
      freqDataBufs[index] = new Uint8Array(size);
    }
    return freqDataBufs[index];
  }

  /** 閾値付近の ON/OFF ちらつきを抑えるヒステリシス付き発話判定 */
  function updateSpeaking(level, th, state) {
    const now = performance.now();
    const onTh = th;
    const offTh = th * SPEAK_OFF_RATIO;

    if (level >= onTh) {
      state.active = true;
      state.holdUntil = now + SPEAK_HOLD_MS;
    } else if (state.active && level >= offTh) {
      state.holdUntil = now + SPEAK_HOLD_MS;
    } else if (now >= (state.holdUntil || 0)) {
      state.active = false;
    }
    return !!state.active;
  }

  function bandEnergy(data, binHz, loHz, hiHz) {
    const i0 = Math.max(0, Math.floor(loHz / binHz));
    const i1 = Math.min(data.length - 1, Math.ceil(hiHz / binHz));
    if (i1 < i0) return 0;
    let sum = 0;
    for (let i = i0; i <= i1; i++) sum += data[i];
    return sum / (i1 - i0 + 1);
  }

  /** 周波数帯のエネルギー比で母音を推定（口形 PNG 切替用） */
  function detectVowel(analyser, level, speakTh, index) {
    if (!analyser || level < speakTh * 0.85) return null;
    const data = ensureFreqBuf(index, analyser);
    analyser.getByteFrequencyData(data);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const bands = [
      { v: 'u', lo: 250, hi: 500 },
      { v: 'o', lo: 500, hi: 800 },
      { v: 'a', lo: 700, hi: 1300 },
      { v: 'e', lo: 1800, hi: 2800 },
      { v: 'i', lo: 2500, hi: 4500 },
    ];
    const scored = bands.map((b) => ({ v: b.v, e: bandEnergy(data, binHz, b.lo, b.hi) }));
    scored.sort((a, b) => b.e - a.e);
    if (scored[0].e < 12) return null;
    if (scored.length > 1 && scored[0].e < scored[1].e * 1.15) return null;
    return scored[0].v;
  }

  function updateVowel(analyser, level, speakTh, state, index) {
    const now = performance.now();
    const instant = detectVowel(analyser, level, speakTh, index);
    if (instant) {
      state.value = instant;
      state.holdUntil = now + 120;
    } else if (now >= (state.holdUntil || 0)) {
      state.value = null;
    }
    return state.value;
  }

  /** 口パク用: 時間軸 RMS（笑い検出は従来どおり周波数帯を使用） */
  function levelFromRms(analyser, sensitivity, index) {
    const buf = ensureTimeDomainBuf(index, analyser);
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = buf.length ? Math.sqrt(sumSq / buf.length) : 0;
    const sens = sensitivity || 1;
    return Math.min(100, Math.round(rms * RMS_LEVEL_GAIN * sens));
  }

  /**
   * AIF ミュート残留やホワイトノイズ床を 0 にする。
   * 発話閾値ぴったりだと VU で閾値調整しづらいので、閾値 × 比率（下限あり）。
   */
  function applyNoiseFloor(level, speakTh) {
    const th = Math.max(1, Number(speakTh) || 12);
    const floor = Math.max(NOISE_FLOOR_MIN, Math.round(th * NOISE_FLOOR_RATIO));
    const n = Math.max(0, Math.min(100, Number(level) || 0));
    return n < floor ? 0 : n;
  }

  /**
   * 笑い検出: スコア＋ヒステリシス。検出後は LAUGH_HOLD_MS の間、
   * 音量の断続的な低下では笑い顔を維持し、ホールド終了後に通常顔へ戻す。
   */
  function updateLaugh(analyser, level, speakTh, state, index) {
    const now = performance.now();

    if (!config.smileDetectEnabled) {
      state.score = 0;
      state.holdUntil = 0;
      state.prevLevel = level;
      return false;
    }

    const sens = Math.min(100, Math.max(10, config.smileSensitivity || 50));
    const onTh = 0.35 + (100 - sens) * 0.004;
    const offTh = onTh - 0.12;
    const inHold = now < state.holdUntil;

    const levelOk = analyser && (level >= speakTh * (inHold ? 0.45 : 0.65));

    if (!levelOk) {
      state.score *= inHold ? 0.94 : 0.88;
      state.prevLevel = level;
      return inHold;
    }

    const data = ensureFreqBuf(index, analyser);
    analyser.getByteFrequencyData(data);
    const n = data.length;
    const mid = Math.floor(n * 0.22);
    const highStart = Math.floor(n * 0.42);
    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    for (let i = 0; i < mid; i++) lowSum += data[i];
    for (let i = mid; i < highStart; i++) midSum += data[i];
    for (let i = highStart; i < n; i++) highSum += data[i];
    const total = lowSum + midSum + highSum || 1;
    const highRatio = highSum / total;
    const delta = Math.abs(level - state.prevLevel);
    state.prevLevel = level;

    let instant = 0;
    if (level >= speakTh) instant += 0.22;
    if (highRatio > 0.3) instant += 0.32;
    if (midSum / total > 0.18) instant += 0.12;
    if (delta >= 5) instant += 0.22;
    if (level >= speakTh * 1.35) instant += 0.12;

    state.score = state.score * 0.8 + instant * 0.2;

    let rawLaugh = false;
    if (state.score >= onTh) {
      rawLaugh = true;
    } else if (inHold && state.score >= offTh * 0.55) {
      rawLaugh = true;
    }

    if (rawLaugh) {
      state.holdUntil = now + LAUGH_HOLD_MS;
    }

    return now < state.holdUntil;
  }

  function tick() {
    resumeAudioContextsIfNeeded();

    const th1 = config.p1SpeakThreshold ?? config.speakThreshold ?? 12;
    const th2 = config.p2SpeakThreshold ?? config.speakThreshold ?? 12;
    const sens1 = config.p1Sensitivity ?? config.sensitivity ?? 1.5;
    const sens2 = config.p2Sensitivity ?? config.sensitivity ?? 1.5;
    const p1Raw = analysers[0] ? levelFromRms(analysers[0], sens1, 0) : 0;
    const p2Raw = analysers[1] ? levelFromRms(analysers[1], sens2, 1) : 0;
    const p1 = applyNoiseFloor(p1Raw, th1);
    const p2 = applyNoiseFloor(p2Raw, th2);
    api.sendLevels({
      p1,
      p2,
      p1Speaking: updateSpeaking(p1, th1, speakStates[0]),
      p2Speaking: updateSpeaking(p2, th2, speakStates[1]),
      p1Laughing: updateLaugh(analysers[0], p1, th1, laughStates[0], 0),
      p2Laughing: updateLaugh(analysers[1], p2, th2, laughStates[1], 1),
      p1Vowel: updateVowel(analysers[0], p1, th1, vowelStates[0], 0),
      p2Vowel: updateVowel(analysers[1], p2, th2, vowelStates[1], 1),
    });
    rafId = requestAnimationFrame(tick);
  }

  async function addMic(deviceId, index) {
    if (!deviceId) return;
    const constraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streams.push(stream);
    const ctx = new AudioContext();
    audioContexts.push(ctx);
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.35;
    src.connect(analyser);
    analysers[index] = analyser;
    ensureTimeDomainBuf(index, analyser);
    ensureFreqBuf(index, analyser);
  }

  async function startCapture() {
    stopAll();
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      api.sendError('マイクへのアクセスが拒否されました: ' + e.message);
      return;
    }
    try {
      await addMic(config.micADeviceId, 0);
      await addMic(config.micBDeviceId, 1);
      resumeAudioContextsIfNeeded();
      rafId = requestAnimationFrame(tick);
    } catch (e) {
      stopAll();
      api.sendError('マイクの開始に失敗しました: ' + e.message);
    }
  }

  api.onConfig((next) => {
    config = { ...config, ...next };
    const devA = config.micADeviceId || '';
    const devB = config.micBDeviceId || '';
    const devChanged = devA !== lastMicA || devB !== lastMicB;
    lastMicA = devA;
    lastMicB = devB;
    if (devChanged || !rafId) startCapture();
  });
})();
