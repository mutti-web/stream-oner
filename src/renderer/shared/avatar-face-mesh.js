'use strict';

/**
 * 顔 Mesh のパラメトリック変形（yaw/pitch → 局所変位）。
 * Node テストと Pixi ランタイムの両方から使う。
 *
 * @see .ai_docs/avatar_mesh/p7_face_mesh_design.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AvatarFaceMesh = api;
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  const DEFAULTS = {
    faceMeshDivisions: 8,
    meshYawStrength: 0.55,
    meshPitchStrength: 0.40,
    meshDepthGain: 28,
    meshContourGain: 12,
    meshCompress: 10,
    meshNoseDrop: 6,
    meshPitchGain: 18,
    meshPitchSide: 4,
    meshAttachScaleK: 0.12,
    poseParallaxWhenMesh: 0.35,
    /** 楕円マスク半径（正規化 UV） */
    rx: 0.95,
    ry: 1.05,
    /** SLOT_TARGET_H 基準のピクセル換算（fittedH / 280） */
    pxScale: 1,
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function smoothstep(edge0, edge1, x) {
    if (edge1 === edge0) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function resolveMeshOpts(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const num = (k, fallback) => {
      const v = Number(o[k]);
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      faceMeshDivisions: Math.max(4, Math.min(16, Math.round(num('faceMeshDivisions', DEFAULTS.faceMeshDivisions)))),
      meshYawStrength: clamp(num('meshYawStrength', DEFAULTS.meshYawStrength), 0, 2),
      meshPitchStrength: clamp(num('meshPitchStrength', DEFAULTS.meshPitchStrength), 0, 2),
      meshDepthGain: clamp(num('meshDepthGain', DEFAULTS.meshDepthGain), 0, 80),
      meshContourGain: clamp(num('meshContourGain', DEFAULTS.meshContourGain), 0, 40),
      meshCompress: clamp(num('meshCompress', DEFAULTS.meshCompress), 0, 40),
      meshNoseDrop: clamp(num('meshNoseDrop', DEFAULTS.meshNoseDrop), 0, 30),
      meshPitchGain: clamp(num('meshPitchGain', DEFAULTS.meshPitchGain), 0, 60),
      meshPitchSide: clamp(num('meshPitchSide', DEFAULTS.meshPitchSide), 0, 20),
      meshAttachScaleK: clamp(num('meshAttachScaleK', DEFAULTS.meshAttachScaleK), 0, 0.5),
      poseParallaxWhenMesh: clamp(num('poseParallaxWhenMesh', DEFAULTS.poseParallaxWhenMesh), 0, 1),
      rx: Math.max(0.4, num('rx', DEFAULTS.rx)),
      ry: Math.max(0.4, num('ry', DEFAULTS.ry)),
      pxScale: Math.max(0.25, Math.min(4, num('pxScale', DEFAULTS.pxScale))),
    };
  }

  /**
   * 正規化 UV（中心 0、概ね ±1）と yaw/pitch（±1）から局所変位を返す。
   * @returns {{ dx: number, dy: number, mask: number, depth: number }}
   */
  function deformFaceUV(u, v, yaw, pitch, opts) {
    const o = resolveMeshOpts(opts);
    const uu = Number(u) || 0;
    const vv = Number(v) || 0;
    const yawCl = clamp(Number(yaw) || 0, -1.6, 1.6);
    const pitchCl = clamp(Number(pitch) || 0, -1.6, 1.6);

    const dist = Math.sqrt((uu / o.rx) * (uu / o.rx) + (vv / o.ry) * (vv / o.ry));
    const mask = clamp(1 - smoothstep(0.85, 1.15, dist), 0, 1);
    if (mask <= 0.001) return { dx: 0, dy: 0, mask: 0, depth: 0 };

    const absU = Math.abs(uu);
    const roundness = clamp(1 - absU * 0.85 - Math.abs(vv) * 0.25, 0, 1);
    const centerRidge = (1 - smoothstep(0.08, 0.5, absU)) * (1 - Math.abs(vv) * 0.3);
    const depth = mask * (roundness * 0.55 + centerRidge * 0.45);

    const sign = yawCl < 0 ? -1 : 1;
    const amount = Math.abs(yawCl) * o.meshYawStrength;
    const s = o.pxScale;

    let dx = sign * amount * (
      depth * o.meshDepthGain +
      (1 - depth) * o.meshContourGain * uu * sign
    ) * s;
    dx += -uu * amount * o.meshCompress * mask * s;

    let dy = amount * depth * o.meshNoseDrop * s;
    const pAmt = pitchCl * o.meshPitchStrength;
    dy += pAmt * depth * o.meshPitchGain * s;
    dx += uu * pAmt * o.meshPitchSide * mask * s;

    return { dx, dy, mask, depth };
  }

  /**
   * MeshPlane の aPosition バッファへ deform を書き込む。
   * rest はテクスチャ座標空間の初期位置（Float32Array、xy 交互）。
   */
  function applyMeshPlaneDeform(bufferData, rest, width, height, yaw, pitch, opts) {
    if (!bufferData || !rest || !width || !height) return;
    const n = Math.min(bufferData.length, rest.length);
    const o = resolveMeshOpts(opts);
    for (let i = 0; i + 1 < n; i += 2) {
      const x = rest[i];
      const y = rest[i + 1];
      const u = (x / width) * 2 - 1;
      const v = (y / height) * 2 - 1;
      const d = deformFaceUV(u, v, yaw, pitch, o);
      bufferData[i] = x + d.dx;
      bufferData[i + 1] = y + d.dy;
    }
  }

  /** 目口などのオフセット px を face 相対 UV に粗く写す */
  function offsetToFaceUV(offsetX, offsetY, faceHalfPx) {
    const half = Math.max(8, Number(faceHalfPx) || 140);
    return {
      u: clamp((Number(offsetX) || 0) / half, -1.2, 1.2),
      v: clamp((Number(offsetY) || 0) / half, -1.2, 1.2),
    };
  }

  function attachFollowFromPose(offsetX, offsetY, yaw, pitch, faceHalfPx, opts) {
    const o = resolveMeshOpts(opts);
    const { u, v } = offsetToFaceUV(offsetX, offsetY, faceHalfPx);
    const d = deformFaceUV(u, v, yaw, pitch, o);
    const scaleX = 1 - Math.abs(clamp(Number(yaw) || 0, -1.6, 1.6)) * o.meshAttachScaleK;
    return { dx: d.dx, dy: d.dy, scaleX: clamp(scaleX, 0.7, 1) };
  }

  return {
    DEFAULTS,
    clamp,
    smoothstep,
    resolveMeshOpts,
    deformFaceUV,
    applyMeshPlaneDeform,
    offsetToFaceUV,
    attachFollowFromPose,
  };
}));
