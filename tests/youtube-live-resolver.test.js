'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBroadcastItem,
  classifyBroadcastCount,
  createYoutubeLiveResolver,
  isActivelyStreaming,
  ERR,
} = require('../src/main/youtube-live-resolver.js');

describe('youtube-live-resolver.normalizeBroadcastItem', () => {
  it('maps broadcast id to videoId', () => {
    const item = normalizeBroadcastItem({
      id: 'abc123XYZ',
      snippet: { title: 'テスト配信', actualStartTime: '2026-01-01T00:00:00Z' },
      status: { lifeCycleStatus: 'live' },
    });
    assert.equal(item.videoId, 'abc123XYZ');
    assert.equal(item.title, 'テスト配信');
  });

  it('returns null without id', () => {
    assert.equal(normalizeBroadcastItem({ snippet: { title: 'x' } }), null);
  });
});

describe('youtube-live-resolver.classifyBroadcastCount', () => {
  it('classifies none, single, multiple', () => {
    assert.equal(classifyBroadcastCount([]), 'none');
    assert.equal(classifyBroadcastCount([{}]), 'single');
    assert.equal(classifyBroadcastCount([{}, {}]), 'multiple');
  });
});

describe('youtube-live-resolver.isActivelyStreaming', () => {
  it('accepts live and testing statuses', () => {
    assert.equal(isActivelyStreaming({ status: { lifeCycleStatus: 'live' } }), true);
    assert.equal(isActivelyStreaming({ status: { lifeCycleStatus: 'testing' } }), true);
    assert.equal(isActivelyStreaming({ status: { lifeCycleStatus: 'ready' } }), false);
    assert.equal(isActivelyStreaming({ status: { lifeCycleStatus: 'complete' } }), false);
  });
});

describe('youtube-live-resolver.resolveActiveBroadcasts', () => {
  it('returns NO_BROADCAST when API returns empty', async () => {
    const resolver = createYoutubeLiveResolver({
      getAccessToken: async () => 'token',
      fetchActiveBroadcasts: async () => ({ items: [] }),
    });
    const r = await resolver.resolveActiveBroadcasts();
    assert.equal(r.success, false);
    assert.equal(r.kind, 'none');
    assert.equal(r.code, ERR.NO_BROADCAST);
  });

  it('returns single broadcast', async () => {
    const resolver = createYoutubeLiveResolver({
      getAccessToken: async () => 'token',
      fetchActiveBroadcasts: async () => ({
        items: [{ id: 'vid1', snippet: { title: 'Live 1' }, status: { lifeCycleStatus: 'live' } }],
      }),
    });
    const r = await resolver.resolveActiveBroadcasts();
    assert.equal(r.success, true);
    assert.equal(r.kind, 'single');
    assert.equal(r.broadcasts[0].videoId, 'vid1');
  });

  it('falls back to mine and filters testing streams', async () => {
    let calls = 0;
    const resolver = createYoutubeLiveResolver({
      getAccessToken: async () => 'token',
      fetchBroadcasts: async (_token, params) => {
        calls += 1;
        if (params.get('broadcastStatus') === 'active') {
          return { items: [] };
        }
        if (params.get('mine') === 'true') {
          return {
            items: [
              { id: 'ready1', snippet: { title: 'Ready' }, status: { lifeCycleStatus: 'ready' } },
              { id: 'test1', snippet: { title: 'Test Live' }, status: { lifeCycleStatus: 'testing', privacyStatus: 'unlisted' } },
            ],
          };
        }
        return { items: [] };
      },
    });
    const r = await resolver.resolveActiveBroadcasts();
    assert.equal(calls, 2);
    assert.equal(r.success, true);
    assert.equal(r.kind, 'single');
    assert.equal(r.broadcasts[0].videoId, 'test1');
    assert.equal(r.broadcasts[0].privacyStatus, 'unlisted');
  });
});
