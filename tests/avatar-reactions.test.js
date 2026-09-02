'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reactionCfg = require('../src/main/avatar-reactions');

describe('avatar-reactions', () => {
  it('normalizes list with default duration', () => {
    const list = reactionCfg.normalizeList([
      { label: '驚き', path: '/tmp/a.png' },
      { label: '', path: '/tmp/b.png' },
      { label: '喜び', path: '', durationMs: 6000 },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, '驚き');
    assert.equal(list[0].durationMs, reactionCfg.DEFAULT_DURATION_MS);
    assert.match(list[0].id, /^react-/);
  });

  it('clamps duration and caps count', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      label: `r${i}`,
      path: `/tmp/${i}.png`,
      durationMs: 999999,
    }));
    const list = reactionCfg.normalizeList(many);
    assert.equal(list.length, reactionCfg.MAX_REACTIONS);
    assert.equal(list[0].durationMs, reactionCfg.MAX_DURATION_MS);
  });

  it('toRemoteList strips paths', () => {
    const remote = reactionCfg.toRemoteList([
      { id: 'react-abcd1234', label: 'A', path: '/secret.png', durationMs: 5000, flipX: true },
    ], { slotId: 'p1' });
    assert.deepEqual(remote, [{
      id: 'react-abcd1234',
      label: 'A',
      durationMs: 5000,
      previewUrl: '/remote/avatar-reaction/p1/react-abcd1234',
    }]);
  });

  it('toRemoteList omits previewUrl without slotId', () => {
    const remote = reactionCfg.toRemoteList([
      { id: 'react-abcd1234', label: 'A', path: '/secret.png', durationMs: 5000 },
    ]);
    assert.deepEqual(remote, [{ id: 'react-abcd1234', label: 'A', durationMs: 5000 }]);
  });

  it('preserves flipX in normalizeList', () => {
    const list = reactionCfg.normalizeList([
      { label: '反転', path: '/tmp/a.png', flipX: true },
      { label: '通常', path: '/tmp/b.png', flipX: false },
    ]);
    assert.equal(list.length, 2);
    assert.equal(list[0].flipX, true);
    assert.equal(list[1].flipX, false);
  });
});
