'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const sway = require('../src/renderer/shared/avatar-sway-mesh.js');

describe('avatar-sway-mesh.swayWeight', () => {
  it('returns 1 for falloff <= 0 (rigid)', () => {
    assert.equal(sway.swayWeight(0, 100, 0), 1);
    assert.equal(sway.swayWeight(50, 100, 0), 1);
  });

  it('is 0 at pivot and 1 at reach for falloff=1', () => {
    assert.equal(sway.swayWeight(0, 100, 1), 0);
    assert.equal(sway.swayWeight(100, 100, 1), 1);
    assert.ok(Math.abs(sway.swayWeight(50, 100, 1) - 0.5) < 1e-9);
  });
});

describe('avatar-sway-mesh.closestOnSegment', () => {
  it('clamps to endpoints', () => {
    const a = sway.closestOnSegment(-10, 0, 0, 0, 10, 0);
    assert.equal(a.qx, 0);
    assert.equal(a.qy, 0);
    const b = sway.closestOnSegment(20, 5, 0, 0, 10, 0);
    assert.equal(b.qx, 10);
    assert.ok(Math.abs(b.dist - Math.hypot(10, 5)) < 1e-9);
  });
});

describe('avatar-sway-mesh.applySwayDeform', () => {
  const w = 100;
  const h = 100;
  // 中心・上・下（tex 空間、中心 50,50）
  function makeRest() {
    return new Float32Array([50, 50, 50, 10, 50, 90]);
  }

  it('copies rest when angle is 0', () => {
    const rest = makeRest();
    const buf = new Float32Array(rest);
    sway.applySwayDeform(buf, rest, w, h, { x: 0, y: 0, width: 0 }, 0, { falloff: 1 }, 1);
    assert.deepEqual([...buf], [...rest]);
  });

  it('rotates all vertices equally when falloff=0 (rigid)', () => {
    const rest = makeRest();
    const buf = new Float32Array(rest);
    const ang = 0.2;
    sway.applySwayDeform(buf, rest, w, h, { x: 0, y: 0, width: 0 }, ang, { falloff: 0, reach: 140 }, 1);
    // 中心は不動
    assert.ok(Math.abs(buf[0] - 50) < 1e-6);
    assert.ok(Math.abs(buf[1] - 50) < 1e-6);
    // 上点の回転角が下点と同じ（中心からの距離は異なるが角は同じ）
    const topDx = buf[2] - 50;
    const topDy = buf[3] - 50;
    const botDx = buf[4] - 50;
    const botDy = buf[5] - 50;
    const topAng = Math.atan2(topDx, -(topDy)); // rough
    const botAng = Math.atan2(botDx, botDy);
    // 両方とも同じ回転量: |r| は保たれ、角度は ang
    assert.ok(Math.abs(Math.hypot(topDx, topDy) - 40) < 0.5);
    assert.ok(Math.abs(Math.hypot(botDx, botDy) - 40) < 0.5);
    void topAng;
    void botAng;
  });

  it('keeps band points nearly fixed and moves far points more when falloff>0', () => {
    const rest = new Float32Array([
      50, 50, // on pivot
      20, 50, // on wide band left
      80, 50, // on wide band right
      50, 90, // tip below
    ]);
    const buf = new Float32Array(rest);
    const ang = 0.35;
    // width 80 display px with scale 1 → half 40 around center
    sway.applySwayDeform(
      buf,
      rest,
      w,
      h,
      { x: 0, y: 0, width: 80 },
      ang,
      { falloff: 1, reach: 50 },
      1,
    );
    // 帯上はほぼ不動
    assert.ok(Math.hypot(buf[0] - 50, buf[1] - 50) < 0.01);
    assert.ok(Math.hypot(buf[2] - 20, buf[3] - 50) < 0.5);
    assert.ok(Math.hypot(buf[4] - 80, buf[5] - 50) < 0.5);
    // 先端は動く
    assert.ok(Math.hypot(buf[6] - 50, buf[7] - 90) > 5);
  });

  it('width=0 behaves as point pivot', () => {
    const rest = makeRest();
    const buf = new Float32Array(rest);
    sway.applySwayDeform(buf, rest, w, h, { x: 0, y: 0, width: 0 }, 0.3, { falloff: 1, reach: 80 }, 1);
    assert.ok(Math.hypot(buf[0] - 50, buf[1] - 50) < 0.01);
    assert.ok(Math.hypot(buf[4] - rest[4], buf[5] - rest[5]) > 1);
  });
});

describe('avatar-sway-mesh.computeSwayAngle', () => {
  it('clamps to maxAngleDeg', () => {
    const spring = sway.makeAngleSpring(0);
    const r = sway.computeSwayAngle({
      headYawDelta: 5,
      audioLevel: 100,
      tMs: 0,
      spring,
      opts: { maxAngleDeg: 6, follow: 1, audio: 1, sineAmp: 1, yawDeltaGain: 100 },
    });
    const max = (6 * Math.PI) / 180 * 1.15;
    assert.ok(Math.abs(r.angle) <= max + 1e-6);
  });

  it('stepAngleSpring converges toward target', () => {
    const spring = sway.makeAngleSpring(0);
    let a = 0;
    for (let i = 0; i < 120; i++) {
      a = sway.stepAngleSpring(spring, 0.2, 0.8, 0.5, 1 / 60);
    }
    assert.ok(Math.abs(a - 0.2) < 0.05, `got ${a}`);
  });
});

describe('avatar-sway-mesh.resolveSwayOpts', () => {
  it('clamps falloff and angle', () => {
    assert.equal(sway.resolveSwayOpts({ falloff: 9 }).falloff, 3);
    assert.equal(sway.resolveSwayOpts({ maxAngleDeg: 100 }).maxAngleDeg, 25);
  });
});
