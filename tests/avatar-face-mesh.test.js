'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mesh = require('../src/renderer/shared/avatar-face-mesh.js');

describe('avatar-face-mesh.deformFaceUV', () => {
  it('returns zero displacement at rest pose', () => {
    const d = mesh.deformFaceUV(0, 0, 0, 0);
    assert.equal(d.dx, 0);
    assert.equal(d.dy, 0);
    assert.ok(d.mask > 0.5);
  });

  it('returns zero outside the elliptical mask', () => {
    const d = mesh.deformFaceUV(2, 2, 1, 0);
    assert.equal(d.dx, 0);
    assert.equal(d.dy, 0);
    assert.equal(d.mask, 0);
  });

  it('moves center toward facing side on yaw', () => {
    const right = mesh.deformFaceUV(0, 0, 1, 0);
    const left = mesh.deformFaceUV(0, 0, -1, 0);
    // 中心は depth が高いので sign * amount * depth * gain 方向へ
    assert.ok(right.dx > 0, `expected +dx for +yaw, got ${right.dx}`);
    assert.ok(left.dx < 0, `expected -dx for -yaw, got ${left.dx}`);
    assert.ok(Math.abs(right.dx + left.dx) < 1e-6);
  });

  it('compresses left-right under yaw (sides move toward center relative to each other)', () => {
    const yaw = 0.8;
    const facing = mesh.deformFaceUV(0.6, 0, yaw, 0);
    const back = mesh.deformFaceUV(-0.6, 0, yaw, 0);
    // 圧縮項 -u·amount により、右点の dx は左点より小さくなる（相対的に中心へ）
    assert.ok(facing.dx < back.dx, `facing ${facing.dx} should be < back ${back.dx}`);
  });

  it('applies pitch primarily as vertical displacement at center', () => {
    const up = mesh.deformFaceUV(0, 0, 0, -0.8);
    const down = mesh.deformFaceUV(0, 0, 0, 0.8);
    assert.ok(Math.abs(up.dx) < 1e-6);
    assert.ok(down.dy > 0);
    assert.ok(up.dy < 0);
  });

  it('scales with pxScale', () => {
    const a = mesh.deformFaceUV(0, 0, 1, 0, { pxScale: 1 });
    const b = mesh.deformFaceUV(0, 0, 1, 0, { pxScale: 2 });
    assert.ok(Math.abs(b.dx - a.dx * 2) < 1e-6);
  });
});

describe('avatar-face-mesh.applyMeshPlaneDeform', () => {
  it('writes deformed positions into the buffer from rest', () => {
    const w = 100;
    const h = 100;
    // 3 点: 左・中・右（中央行）
    const rest = new Float32Array([0, 50, 50, 50, 100, 50]);
    const buf = new Float32Array(rest);
    mesh.applyMeshPlaneDeform(buf, rest, w, h, 1, 0, { pxScale: 1, meshYawStrength: 1 });
    // 中心は動く
    assert.ok(buf[2] !== rest[2] || buf[3] !== rest[3]);
    // rest は不変
    assert.equal(rest[2], 50);
  });
});

describe('avatar-face-mesh.attachFollowFromPose', () => {
  it('returns scaleX < 1 when yaw is non-zero', () => {
    const f = mesh.attachFollowFromPose(0, 0, 0.9, 0, 140);
    assert.ok(f.scaleX < 1);
    assert.ok(f.scaleX >= 0.7);
  });
});

describe('avatar-face-mesh.resolveMeshOpts', () => {
  it('clamps divisions to 4..16', () => {
    assert.equal(mesh.resolveMeshOpts({ faceMeshDivisions: 2 }).faceMeshDivisions, 4);
    assert.equal(mesh.resolveMeshOpts({ faceMeshDivisions: 99 }).faceMeshDivisions, 16);
  });
});
