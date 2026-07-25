'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const slotCfg = require('../src/main/avatar-slot-config.js');

function slotWithHairNose() {
  const slot = slotCfg.defaultSlot();
  slot.paths.hair1 = '/tmp/hair1.png';
  slot.paths.hair2 = '/tmp/hair2.png';
  slot.paths.nose = '/tmp/nose.png';
  slot.layers.hair1.offsetX = 4;
  slot.layers.hair1.offsetY = -6;
  slot.layers.hair1.scale = 1.2;
  slot.layers.nose.offsetY = 3;
  slot.layers.nose.scale = 0.9;
  return slot;
}

describe('avatar-slot-config.demoteHairNoseToCustom', () => {
  it('moves hair/nose paths into custom layers and clears the asset paths', () => {
    const { slot, changed, moved } = slotCfg.demoteHairNoseToCustom(slotWithHairNose());
    assert.equal(changed, true);
    assert.deepEqual(moved, ['hair1', 'hair2', 'nose']);
    assert.equal(slot.paths.hair1, '');
    assert.equal(slot.paths.hair2, '');
    assert.equal(slot.paths.nose, '');
    assert.equal(slot.customLayers.length, 3);
  });

  it('keeps layers config so hair1/hair2/nose anchors still resolve', () => {
    const { slot } = slotCfg.demoteHairNoseToCustom(slotWithHairNose());
    assert.equal(slot.layers.hair1.offsetX, 4);
    assert.equal(slot.layers.nose.offsetY, 3);
    assert.equal(slot.layers.hair1.sine.enabled, true);
  });

  it('carries visual params over (offset/scale for hair, anchor-provided for nose)', () => {
    const { slot } = slotCfg.demoteHairNoseToCustom(slotWithHairNose());
    const byId = Object.fromEntries(slot.customLayers.map((l) => [l.id, l]));

    const hair1 = byId['cl-legacy-hair1'];
    assert.equal(hair1.parentAnchor, 'rig');
    assert.equal(hair1.offsetX, 4);
    assert.equal(hair1.offsetY, -6);
    assert.equal(hair1.scale, 1.2);
    assert.equal(hair1.lookMul, 0.45);
    assert.ok(hair1.springStrength > 0);
    assert.ok(hair1.audioBounce > 0);
    assert.equal(hair1.sine.enabled, true);

    const nose = byId['cl-legacy-nose'];
    // 親アンカー nose が layers.nose の offset / scale を持つため二重掛けしない
    assert.equal(nose.parentAnchor, 'nose');
    assert.equal(nose.offsetX, 0);
    assert.equal(nose.offsetY, 0);
    assert.equal(nose.scale, 1);
    assert.equal(nose.springStrength, 0);
    assert.equal(nose.sine.enabled, false);
  });

  it('uses the integrated multipliers when rigType is integrated', () => {
    const src = slotWithHairNose();
    src.rigType = 'integrated';
    const { slot } = slotCfg.demoteHairNoseToCustom(src);
    const hair2 = slot.customLayers.find((l) => l.id === 'cl-legacy-hair2');
    assert.equal(hair2.lookMul, 0.7);
  });

  it('is idempotent and leaves untouched slots alone', () => {
    const first = slotCfg.demoteHairNoseToCustom(slotWithHairNose());
    const second = slotCfg.demoteHairNoseToCustom(first.slot);
    assert.equal(second.changed, false);
    assert.equal(second.slot.customLayers.length, 3);

    const empty = slotCfg.demoteHairNoseToCustom(slotCfg.defaultSlot());
    assert.equal(empty.changed, false);
    assert.deepEqual(empty.moved, []);
  });

  it('does not mutate the input slot', () => {
    const src = slotWithHairNose();
    slotCfg.demoteHairNoseToCustom(src);
    assert.equal(src.paths.hair1, '/tmp/hair1.png');
  });
});

describe('avatar-slot-config.normalizeCustomLayers', () => {
  it('normalizes the new motion fields', () => {
    const [l] = slotCfg.normalizeCustomLayers([{
      id: 'x', path: '/a.png', lookMul: '1.4', springStrength: 5,
      springSpeed: -1, audioBounce: 999, sine: { enabled: true, amp: '3' },
    }]);
    assert.equal(l.lookMul, 1.4);
    assert.equal(l.springStrength, 1);
    assert.equal(l.springSpeed, 0);
    assert.equal(l.audioBounce, 40);
    assert.equal(l.sine.amp, 3);
  });

  it('treats blank lookMul as "use default"', () => {
    const [l] = slotCfg.normalizeCustomLayers([{ id: 'x', path: '/a.png', lookMul: '' }]);
    assert.equal(l.lookMul, null);
  });
});
