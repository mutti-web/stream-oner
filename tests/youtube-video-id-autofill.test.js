'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createYoutubeVideoIdAutofill } = require('../src/main/youtube-video-id-autofill.js');

function makeAutofill(overrides = {}) {
  const saved = [];
  const notices = [];
  let current = overrides.currentVideoId ?? 'old-id';
  let pollerRunning = !!overrides.pollerRunning;
  const autofill = createYoutubeVideoIdAutofill({
    isEnabled: overrides.isEnabled || (() => true),
    getOAuthStatus: overrides.getOAuthStatus || (() => ({ linked: true })),
    resolveActiveBroadcasts: overrides.resolveActiveBroadcasts,
    getCurrentVideoId: () => current,
    saveVideoId: (videoId) => {
      current = videoId;
      saved.push(videoId);
    },
    isPollerRunning: () => pollerRunning,
    notify: (result) => notices.push(result),
    sleep: overrides.sleep || (async () => {}),
    delays: overrides.delays || [0, 1],
  });
  return {
    autofill,
    saved,
    notices,
    setPollerRunning: (value) => { pollerRunning = value; },
  };
}

describe('youtube-video-id-autofill', () => {
  it('fills the video id when one live broadcast is found', async () => {
    const { autofill, saved, notices } = makeAutofill({
      resolveActiveBroadcasts: async () => ({
        success: true,
        kind: 'single',
        broadcasts: [{ videoId: 'live-1', title: '今夜の配信' }],
      }),
    });
    await autofill.onStreamingStarted();
    assert.deepEqual(saved, ['live-1']);
    assert.equal(autofill.getLast().status, 'filled');
    assert.match(notices.at(-1).message, /今夜の配信/);
  });

  it('retries until a broadcast appears', async () => {
    let calls = 0;
    const { autofill, saved } = makeAutofill({
      delays: [0, 1, 1],
      resolveActiveBroadcasts: async () => {
        calls += 1;
        if (calls < 3) return { success: false, code: 'NO_BROADCAST', error: 'なし' };
        return {
          success: true,
          kind: 'single',
          broadcasts: [{ videoId: 'late', title: '遅れて検出' }],
        };
      },
    });
    await autofill.onStreamingStarted();
    assert.equal(calls, 3);
    assert.deepEqual(saved, ['late']);
  });

  it('keeps the saved id when the broadcast cannot be confirmed', async () => {
    const { autofill, saved } = makeAutofill({
      resolveActiveBroadcasts: async () => ({
        success: false,
        code: 'NO_BROADCAST',
        error: '配信中のライブが見つかりません。',
      }),
    });
    await autofill.onStreamingStarted();
    assert.deepEqual(saved, []);
    const last = autofill.getLast();
    assert.equal(last.status, 'not_found');
    assert.equal(last.keptVideoId, 'old-id');
    assert.match(last.message, /そのままです/);
  });

  it('asks for manual entry when nothing is saved and nothing is live', async () => {
    const { autofill } = makeAutofill({
      currentVideoId: '',
      resolveActiveBroadcasts: async () => ({
        success: false,
        code: 'NO_BROADCAST',
        error: '配信中のライブが見つかりません。',
      }),
    });
    await autofill.onStreamingStarted();
    assert.equal(autofill.getLast().keptVideoId, '');
    assert.match(autofill.getLast().message, /手入力/);
  });

  it('does not pick one when several broadcasts are live', async () => {
    const { autofill, saved } = makeAutofill({
      resolveActiveBroadcasts: async () => ({
        success: true,
        kind: 'multiple',
        broadcasts: [
          { videoId: 'a', title: 'A' },
          { videoId: 'b', title: 'B' },
        ],
      }),
    });
    await autofill.onStreamingStarted();
    assert.deepEqual(saved, []);
    assert.equal(autofill.getLast().status, 'multiple');
    assert.equal(autofill.getLast().broadcasts.length, 2);
  });

  it('does not overwrite the id when YouTube is not linked', async () => {
    const { autofill, saved } = makeAutofill({
      getOAuthStatus: () => ({ linked: false }),
      resolveActiveBroadcasts: async () => {
        throw new Error('should not resolve');
      },
    });
    await autofill.onStreamingStarted();
    assert.deepEqual(saved, []);
    assert.equal(autofill.getLast().status, 'needs_link');
  });

  it('stops retrying on auth errors', async () => {
    let calls = 0;
    const { autofill } = makeAutofill({
      delays: [0, 1, 1, 1],
      resolveActiveBroadcasts: async () => {
        calls += 1;
        return { success: false, code: 'AUTH', error: '再連携してください' };
      },
    });
    await autofill.onStreamingStarted();
    assert.equal(calls, 1);
    assert.equal(autofill.getLast().status, 'not_found');
    assert.match(autofill.getLast().message, /再連携/);
  });

  it('cancels the search when the stream stops', async () => {
    let release;
    let calls = 0;
    const { autofill, saved } = makeAutofill({
      delays: [0, 20],
      sleep: () => new Promise((resolve) => { release = resolve; }),
      resolveActiveBroadcasts: async () => {
        calls += 1;
        return { success: false, code: 'NO_BROADCAST', error: 'なし' };
      },
    });
    const pending = autofill.onStreamingStarted();
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(autofill.getLast().status, 'searching');
    autofill.onStreamingStopped();
    release();
    await pending;
    assert.equal(calls, 1);
    assert.deepEqual(saved, []);
    assert.equal(autofill.getLast().status, 'idle');
  });

  it('does not replace an id while chat polling is already running', async () => {
    let calls = 0;
    const { autofill, saved } = makeAutofill({
      pollerRunning: true,
      resolveActiveBroadcasts: async () => {
        calls += 1;
        return {
          success: true,
          kind: 'single',
          broadcasts: [{ videoId: 'new', title: '別配信' }],
        };
      },
    });
    await autofill.onStreamingStarted();
    assert.equal(calls, 0);
    assert.deepEqual(saved, []);
  });
});
