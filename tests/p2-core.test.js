'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const suiteLayout = require('../src/main/suite-layout.js');
const suitePorts = require('../src/main/suite-ports.js');
const settingsExport = require('../src/main/settings-export.js');
const { normalizeSlotOffsets, clampSlotOffsetPct } = require('../src/main/avatar-slot-config.js');
const { listLanIPv4Candidates, resolveLanIPv4 } = require('../src/main/remote-lan-utils.js');

describe('suite-layout.normalizeLayout', () => {
  it('fills defaults for empty input', () => {
    const out = suiteLayout.normalizeLayout({});
    assert.equal(out.discord.anchor, 'top-left');
    assert.equal(out.avatar.widthPx, 960);
  });

  it('clamps invalid anchor', () => {
    const out = suiteLayout.normalizeLayout({
      discord: { anchor: 'center', offsetX: 9999, widthPx: 50 },
    });
    assert.equal(out.discord.anchor, 'top-left');
    assert.equal(out.discord.offsetX, 1920);
    assert.ok(out.discord.widthPx >= 120);
  });
});

describe('suite-ports', () => {
  it('returns defaults when store empty', () => {
    const p = suitePorts.getSuitePorts({ get: () => undefined });
    assert.deepEqual(p, suitePorts.DEFAULT_PORTS);
  });

  it('clamps stored ports', () => {
    const p = suitePorts.getSuitePorts({
      get: (k) => (k === 'suite.ports.youtube' ? 80 : undefined),
    });
    assert.equal(p.youtube, 1024);
  });
});

describe('settings-export.validateImportPayload', () => {
  it('rejects missing settings', () => {
    const r = settingsExport.validateImportPayload({ version: 1 });
    assert.equal(r.ok, false);
  });

  it('accepts valid payload', () => {
    const r = settingsExport.validateImportPayload({
      version: 1,
      settings: { 'suite.discordEnabled': true },
    });
    assert.equal(r.ok, true);
  });
});

describe('avatar-slot-config.normalizeSlotOffsets', () => {
  it('migrates px to percent', () => {
    const slot = normalizeSlotOffsets({ slotOffsetX: 96, slotOffsetY: 42 });
    assert.equal(slot.slotOffsetXPct, 10);
    assert.equal(slot.slotOffsetYPct, 10);
  });

  it('clamps percent', () => {
    assert.equal(clampSlotOffsetPct(200), 100);
    assert.equal(clampSlotOffsetPct(-150), -100);
  });
});

describe('remote-lan-utils', () => {
  it('listLanIPv4Candidates returns array', () => {
    const list = listLanIPv4Candidates();
    assert.ok(Array.isArray(list));
    for (const c of list) {
      assert.ok(c.address);
      assert.ok(c.interfaceName);
    }
  });

  it('resolveLanIPv4 prefers valid address', () => {
    const list = listLanIPv4Candidates();
    if (!list.length) return;
    assert.equal(resolveLanIPv4(list[0].address), list[0].address);
    assert.equal(resolveLanIPv4('999.999.999.999'), list[0].address);
  });
});
