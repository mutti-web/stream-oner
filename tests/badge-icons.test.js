'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const badgeIcons = require('../src/main/badge-icons');

function mockStore(initial = {}) {
  const data = { ...initial };
  return {
    get(key, def) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : def;
    },
    set(key, val) {
      data[key] = val;
    },
    _data: data,
  };
}

describe('badge-icons', () => {
  it('iconUrlForOverlay returns empty when unset', () => {
    const store = mockStore();
    assert.equal(badgeIcons.iconUrlForOverlay(store, 'member'), '');
  });

  it('iconUrlForOverlay includes kind and revision', () => {
    const store = mockStore({
      [badgeIcons.PATH_KEYS.member]: '/tmp/badge.png',
      [badgeIcons.PATH_KEYS.first]: '/tmp/first.png',
      [badgeIcons.REV_KEY]: 3,
    });
    assert.equal(badgeIcons.iconUrlForOverlay(store, 'member'), '/badge-icon/member?v=3');
    assert.equal(badgeIcons.iconUrlForOverlay(store, 'first'), '/badge-icon/first?v=3');
  });

  it('allIconUrls covers first and regular', () => {
    const store = mockStore({
      [badgeIcons.PATH_KEYS.first]: '/a.png',
      [badgeIcons.PATH_KEYS.regular]: '/b.png',
      [badgeIcons.REV_KEY]: 1,
    });
    const urls = badgeIcons.allIconUrls(store);
    assert.equal(urls.first, '/badge-icon/first?v=1');
    assert.equal(urls.regular, '/badge-icon/regular?v=1');
    assert.equal(urls.member, '');
  });

  it('bumpRevision increments', () => {
    const store = mockStore();
    assert.equal(badgeIcons.bumpRevision(store), 1);
    assert.equal(badgeIcons.bumpRevision(store), 2);
  });
});
