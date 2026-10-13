'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractInnertubeApiKeyFromHtml,
  extractInnertubeClientVersionFromHtml,
  extractVisitorDataFromHtml,
  normalizeChatSource,
} = require('../src/main/youtube-api.js');

describe('youtube-api innertube key extraction', () => {
  it('extracts INNERTUBE_API_KEY from watch-like HTML', () => {
    const html = '<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyExampleKeyFromPage1234567890","foo":1});</script>';
    assert.equal(extractInnertubeApiKeyFromHtml(html), 'AIzaSyExampleKeyFromPage1234567890');
  });

  it('extracts client version and visitorData from watch-like HTML', () => {
    const html = '<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261012.01.00","VISITOR_DATA":"CgtVisitorExample123","INNERTUBE_API_KEY":"AIzaSyExampleKeyFromPage1234567890"});</script>';
    assert.equal(extractInnertubeClientVersionFromHtml(html), '2.20261012.01.00');
    assert.equal(extractVisitorDataFromHtml(html), 'CgtVisitorExample123');
  });

  it('returns empty when key is absent', () => {
    assert.equal(extractInnertubeApiKeyFromHtml('<html></html>'), '');
  });

  it('does not ship a hardcoded InnerTube key constant in module source', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/main/youtube-api.js'), 'utf8');
    // 実キー文字列をテストに埋め込まない（Secret scanning 対策）。定数直書きの形だけ禁止する。
    assert.equal(/\b(?:const|let|var)\s+INNERTUBE_KEY\b/.test(src), false);
    assert.equal(/INNERTUBE_KEY\s*=\s*['"]AIza/.test(src), false);
  });
});

describe('normalizeChatSource', () => {
  it('defaults unknown to auto', () => {
    assert.equal(normalizeChatSource('nope'), 'auto');
    assert.equal(normalizeChatSource('dataapi'), 'dataapi');
  });
});
