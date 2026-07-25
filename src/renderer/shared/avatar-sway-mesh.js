'use strict';

/**
 * 髪・リボンの付着帯しなり（yaw デルタ駆動の単段振り子近似）。
 * Node テストと Pixi ランタイムの両方から使う。
 *
 * @see .ai_docs/avatar_mesh/p8_sway_mesh.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AvatarSwayMesh = api;
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  const DEFAULTS = {
    /** 最大振れ角（度） */
    maxAngleDeg: 6,
    /** しなり: 0=剛体, 1=線形, 2=毛先寄り */
    falloff: 1,
    /** しなり到達距離（表示 px） */
    reach: 140,
    /** 付着帯の幅（表示 px）。0=点 */
    pivotWidth: 0,
    /** 付着帯中心（表示 px、レイヤー中心基準） */
    pivotX: 0,
    pivotY: -40,
    /** sine 周期 ms */
    periodMs: 3200,
    /** sine 振幅倍率（maxAngle に対する 0..1） */
    sineAmp: 0.35,
    /** 頭の動きへの追従・慣性 0..1 */
    follow: 0.5,
    /** 声で揺れる量 0..1（maxAngle に対する） */
    audio: 0,
    /** yaw デルタ → 角への感度 */
    yawDeltaGain: 18,
    /** 角度スプリング速度 / 減衰 */
    springSpeed: 0.55,
    springDamp: 0.55,
    dt: 1 / 60,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function resolveSwayOpts(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const num = (k, fallback) => {
      const v = Number(o[k]);
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      maxAngleDeg: clamp(num('maxAngleDeg', num('swayAngle', DEFAULTS.maxAngleDeg)), 0, 25),
      falloff: clamp(num('falloff', num('swayFalloff', DEFAULTS.falloff)), 0, 3),
      reach: clamp(num('reach', num('swayReach', DEFAULTS.reach)), 8, 600),
      pivotWidth: clamp(num('pivotWidth', num('swayWidth', DEFAULTS.pivotWidth)), 0, 800),
      pivotX: num('pivotX', num('swayPx', DEFAULTS.pivotX)),
      pivotY: num('pivotY', num('swayPy', DEFAULTS.pivotY)),
      periodMs: Math.max(400, num('periodMs', num('swayPeriod', DEFAULTS.periodMs))),
      sineAmp: clamp(num('sineAmp', DEFAULTS.sineAmp), 0, 1),
      follow: clamp(num('follow', num('swayFollow', DEFAULTS.follow)), 0, 1),
      audio: clamp(num('audio', num('swayAudio', DEFAULTS.audio)), 0, 2),
      yawDeltaGain: clamp(num('yawDeltaGain', DEFAULTS.yawDeltaGain), 0, 60),
      springSpeed: clamp(num('springSpeed', DEFAULTS.springSpeed), 0.05, 1),
      springDamp: clamp(num('springDamp', DEFAULTS.springDamp), 0.05, 1),
      dt: Math.max(1 / 240, Math.min(1 / 20, num('dt', DEFAULTS.dt))),
    };
  }

  /**
   * 線分 AB 上の最近傍点と距離。
   * @returns {{ qx: number, qy: number, dist: number }}
   */
  function closestOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 1e-12) {
      t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
    }
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    const dx = px - qx;
    const dy = py - qy;
    return { qx, qy, dist: Math.hypot(dx, dy) };
  }

  /**
   * @param {number} dist
   * @param {number} reach
   * @param {number} falloff 0 以下なら常に 1（剛体）
   */
  function swayWeight(dist, reach, falloff) {
    if (!(falloff > 0)) return 1;
    const r = Math.max(1e-6, Number(reach) || 1);
    const t = clamp((Number(dist) || 0) / r, 0, 1);
    return Math.pow(t, falloff);
  }

  /**
   * 表示 px の付着帯（水平線分）を、テクスチャ座標へ写す。
   * MeshPlane はテクスチャ中心が pivot、scale = fittedH / texH。
   */
  function bandInTex(pivotDispX, pivotDispY, pivotWidthDisp, texW, texH, displayScale) {
    const s = Math.max(1e-6, Number(displayScale) || 1);
    const cx = (Number(texW) || 1) / 2;
    const cy = (Number(texH) || 1) / 2;
    const px = cx + (Number(pivotDispX) || 0) / s;
    const py = cy + (Number(pivotDispY) || 0) / s;
    const half = Math.max(0, (Number(pivotWidthDisp) || 0) / s) / 2;
    return { ax: px - half, ay: py, bx: px + half, by: py, px, py };
  }

  /**
   * MeshPlane aPosition を rest から変形。
   * @param {Float32Array} bufferData
   * @param {Float32Array} rest
   * @param {number} width texW
   * @param {number} height texH
   * @param {{ x: number, y: number, width?: number }} pivotDisp 表示px（レイヤー中心基準）
   * @param {number} angleRad
   * @param {object} opts
   * @param {number} [displayScale] sprite scale（tex→display）
   */
  function applySwayDeform(bufferData, rest, width, height, pivotDisp, angleRad, opts, displayScale) {
    if (!bufferData || !rest || !width || !height) return;
    const o = resolveSwayOpts(opts);
    const angle = Number(angleRad) || 0;
    if (Math.abs(angle) < 1e-8 && !(o.falloff > 0)) {
      // 剛体でも角0なら rest へ
    }
    const pd = pivotDisp || {};
    const band = bandInTex(
      pd.x != null ? pd.x : o.pivotX,
      pd.y != null ? pd.y : o.pivotY,
      pd.width != null ? pd.width : o.pivotWidth,
      width,
      height,
      displayScale != null ? displayScale : 1,
    );
    const n = Math.min(bufferData.length, rest.length);
    const cos0 = Math.cos(angle);
    const sin0 = Math.sin(angle);

    for (let i = 0; i + 1 < n; i += 2) {
      const x = rest[i];
      const y = rest[i + 1];
      const near = closestOnSegment(x, y, band.ax, band.ay, band.bx, band.by);
      const w = swayWeight(near.dist, o.reach / Math.max(1e-6, displayScale != null ? displayScale : 1), o.falloff);
      const a = angle * w;
      let cos = cos0;
      let sin = sin0;
      if (w !== 1) {
        cos = Math.cos(a);
        sin = Math.sin(a);
      }
      // 帯中心まわりに回転
      const rx = x - band.px;
      const ry = y - band.py;
      bufferData[i] = band.px + rx * cos - ry * sin;
      bufferData[i + 1] = band.py + rx * sin + ry * cos;
    }
  }

  function makeAngleSpring(angle = 0) {
    return { angle: Number(angle) || 0, vel: 0 };
  }

  /**
   * 1D 角度スプリング。
   * @returns {number} 新しい角度
   */
  function stepAngleSpring(state, target, speed, damp, dt) {
    if (!state) return Number(target) || 0;
    const k = 40 * clamp(Number(speed) || 0.55, 0.05, 1);
    const d = 8 * clamp(Number(damp) || 0.55, 0.05, 1);
    const h = Math.max(1 / 240, Math.min(1 / 20, Number(dt) || 1 / 60));
    const x = Number(state.angle) || 0;
    const v = Number(state.vel) || 0;
    const tgt = Number(target) || 0;
    const acc = k * (tgt - x) - d * v;
    state.vel = v + acc * h;
    state.angle = x + state.vel * h;
    if (Math.abs(state.angle) < 1e-6 && Math.abs(state.vel) < 1e-5) {
      state.angle = 0;
      state.vel = 0;
    }
    return state.angle;
  }

  /**
   * sine + yaw デルタ + 音量 → 目標角 → スプリングで平滑化。
   * @param {object} args
   * @param {number} args.headYawDelta 直前フレームからの yaw 差（概ね ±0.05 程度）
   * @param {number} [args.audioLevel] 0..100
   * @param {number} args.tMs
   * @param {{ angle: number, vel: number }} args.spring
   * @param {object} [args.opts]
   * @returns {{ angle: number, target: number }}
   */
  function computeSwayAngle(args) {
    const a = args || {};
    const o = resolveSwayOpts(a.opts);
    const maxRad = (o.maxAngleDeg * Math.PI) / 180;
    const w = (2 * Math.PI * (Number(a.tMs) || 0)) / o.periodMs;
    const sine = Math.sin(w) * o.sineAmp * maxRad;
    const yawKick = clamp(
      -(Number(a.headYawDelta) || 0) * o.yawDeltaGain * o.follow,
      -maxRad * 1.4,
      maxRad * 1.4,
    );
    const audio = ((Number(a.audioLevel) || 0) / 100) * o.audio * maxRad * Math.sin(w * 1.7);
    let target = sine + yawKick + audio;
    target = clamp(target, -maxRad, maxRad);
    const angle = stepAngleSpring(a.spring || makeAngleSpring(), target, o.springSpeed, o.springDamp, o.dt);
    return {
      angle: clamp(angle, -maxRad * 1.15, maxRad * 1.15),
      target,
    };
  }

  /** カスタムレイヤー cfg から sway 有効判定 */
  function isSwayEnabled(cfg) {
    return !!(cfg && (cfg.swayEnabled === true || cfg.sway?.enabled === true));
  }

  function swayOptsFromCustom(cfg) {
    const s = cfg?.sway && typeof cfg.sway === 'object' ? cfg.sway : {};
    return resolveSwayOpts({
      maxAngleDeg: s.maxAngleDeg ?? cfg?.swayAngle,
      falloff: s.falloff ?? cfg?.swayFalloff,
      reach: s.reach ?? cfg?.swayReach,
      pivotWidth: s.width ?? cfg?.swayWidth,
      pivotX: s.pivotX ?? cfg?.swayPx,
      pivotY: s.pivotY ?? cfg?.swayPy,
      periodMs: s.periodMs ?? cfg?.swayPeriod,
      follow: s.follow ?? cfg?.swayFollow,
      audio: s.audio ?? cfg?.swayAudio,
      sineAmp: s.sineAmp,
    });
  }

  return {
    DEFAULTS,
    clamp,
    resolveSwayOpts,
    closestOnSegment,
    swayWeight,
    bandInTex,
    applySwayDeform,
    makeAngleSpring,
    stepAngleSpring,
    computeSwayAngle,
    isSwayEnabled,
    swayOptsFromCustom,
  };
}));
