'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createYoutubeChatStartCoordinator } = require('../src/main/youtube-chat-start-coordinator.js');

function makeCoordinator(overrides = {}) {
  const store = { data: { 'yt.videoId': '' }, get(k, d) { return this.data[k] ?? d; } };
  const oauth = {
    linked: false,
    nudgeDismissed: false,
    configured: true,
    ...overrides.oauth,
  };
  const ytManager = {
    pollerRunning: false,
    config: { videoId: '' },
    getStatus() { return { pollerRunning: this.pollerRunning }; },
    getConfig() { return { ...this.config }; },
    saveConfig(patch) { this.config = { ...this.config, ...patch }; },
    startPoller() { this.pollerRunning = true; return { success: true }; },
    ...overrides.ytManager,
  };
  const resolver = {
    resolveActiveBroadcasts: async () => ({
      success: true,
      kind: 'single',
      broadcasts: [{ videoId: 'live-vid', title: 'テスト配信' }],
    }),
    ...overrides.resolver,
  };
  let videoIdChanged = null;
  const coord = createYoutubeChatStartCoordinator({
    getStore: () => store,
    getOAuthManager: () => ({ getStatus: () => oauth }),
    getLiveResolver: () => resolver,
    getYtManager: () => ytManager,
    getBroadcastTimer: () => ({ onVideoIdChanged: (vid) => { videoIdChanged = vid; } }),
    broadcastYtConfigChanged: () => {},
  });
  return { coord, oauth, ytManager, store, resolver, getVideoIdChanged: () => videoIdChanged };
}

describe('youtube-chat-start-coordinator.prepareStart', () => {
  it('returns already_running when poller is active', async () => {
    const { coord, ytManager } = makeCoordinator();
    ytManager.pollerRunning = true;
    const r = await coord.prepareStart();
    assert.equal(r.step, 'already_running');
  });

  it('returns start_manual when unlinked with saved videoId', async () => {
    const { coord, ytManager } = makeCoordinator();
    ytManager.config.videoId = 'manual-id';
    const r = await coord.prepareStart();
    assert.equal(r.step, 'start_manual');
    assert.equal(r.videoId, 'manual-id');
  });

  it('returns nudge when unlinked without videoId', async () => {
    const { coord } = makeCoordinator();
    const r = await coord.prepareStart();
    assert.equal(r.step, 'nudge');
    assert.equal(r.configured, true);
  });

  it('returns confirm_single when linked and one broadcast', async () => {
    const { coord } = makeCoordinator({ oauth: { linked: true } });
    const r = await coord.prepareStart();
    assert.equal(r.step, 'confirm_single');
    assert.equal(r.broadcast.videoId, 'live-vid');
  });

  it('returns pick_multiple when linked and multiple broadcasts', async () => {
    const { coord } = makeCoordinator({
      oauth: { linked: true },
      resolver: {
        resolveActiveBroadcasts: async () => ({
          success: true,
          kind: 'multiple',
          broadcasts: [
            { videoId: 'a', title: 'A' },
            { videoId: 'b', title: 'B' },
          ],
        }),
      },
    });
    const r = await coord.prepareStart();
    assert.equal(r.step, 'pick_multiple');
    assert.equal(r.broadcasts.length, 2);
  });

  it('returns confirm_manual_fallback when detect fails but manual id exists', async () => {
    const { coord, ytManager } = makeCoordinator({
      oauth: { linked: true },
      resolver: {
        resolveActiveBroadcasts: async () => ({
          success: false,
          error: '配信なし',
        }),
      },
    });
    ytManager.config.videoId = 'fallback-id';
    const r = await coord.prepareStart();
    assert.equal(r.step, 'confirm_manual_fallback');
    assert.equal(r.videoId, 'fallback-id');
  });
});

describe('youtube-chat-start-coordinator.confirmStart', () => {
  it('saves videoId and starts poller', async () => {
    const { coord, ytManager, getVideoIdChanged } = makeCoordinator();
    const r = await coord.confirmStart('new-vid');
    assert.equal(r.success, true);
    assert.equal(ytManager.config.videoId, 'new-vid');
    assert.equal(ytManager.pollerRunning, true);
    assert.equal(getVideoIdChanged(), 'new-vid');
  });

  it('rejects empty videoId', async () => {
    const { coord } = makeCoordinator();
    const r = await coord.confirmStart('  ');
    assert.equal(r.success, false);
  });
});
