'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractInnertubeApiKeyFromHtml,
  normalizeChatSource,
} = require('../src/main/youtube-api.js');

describe('youtube-api innertube key extraction', () => {
  it('extracts INNERTUBE_API_KEY from watch-like HTML', () => {
    const html = '<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyExampleKeyFromPage1234567890","foo":1});</script>';
    assert.equal(extractInnertubeApiKeyFromHtml(html), 'AIzaSyExampleKeyFromPage1234567890');
  });

  it('returns empty when key is absent', () => {
    assert.equal(extractInnertubeApiKeyFromHtml('<html></html>'), '');
  });

  it('does not ship a hardcoded production key in module source', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/main/youtube-api.js'), 'utf8');
    assert.equal(/AIzaSyAO_FJ2SlqU8Q4STEHL6lRqiXPj-WDrM7g/.test(src), false);
  });
});

describe('normalizeChatSource', () => {
  it('defaults unknown to auto', () => {
    assert.equal(normalizeChatSource('nope'), 'auto');
    assert.equal(normalizeChatSource('dataapi'), 'dataapi');
  });
});
