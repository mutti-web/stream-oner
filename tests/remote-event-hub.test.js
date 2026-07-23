'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const RemoteEventHub = require('../src/main/remote-event-hub');

describe('RemoteEventHub chat throttle', () => {
  it('batches yt-message to remote senders', async () => {
    const hub = new RemoteEventHub();
    const dash = [];
    const remote = [];
    hub.setDashboardSender((ch, data) => dash.push([ch, data]));
    hub.addRemoteSender((ch, data) => remote.push([ch, data]));

    hub.publish('yt-message', { id: '1' });
    hub.publish('yt-message', { id: '2' });
    hub.publish('obs-mute-state-changed', { p1Muted: true });

    assert.equal(dash.length, 3);
    assert.equal(remote.length, 1);
    assert.deepEqual(remote[0], ['obs-mute-state-changed', { p1Muted: true }]);

    hub.flushRemoteChatNow();
    assert.equal(remote.length, 3);
    assert.deepEqual(remote[1], ['yt-message', { id: '1' }]);
    assert.deepEqual(remote[2], ['yt-message', { id: '2' }]);
  });

  it('drops oldest remote chat when queue exceeds max', () => {
    const hub = new RemoteEventHub();
    const remote = [];
    hub.addRemoteSender((ch, data) => remote.push([ch, data]));
    const max = RemoteEventHub.REMOTE_CHAT_QUEUE_MAX;
    for (let i = 0; i < max + 5; i += 1) {
      hub.publish('yt-message', { id: String(i) });
    }
    hub.flushRemoteChatNow();
    assert.equal(remote.length, max);
    assert.equal(remote[0][1].id, '5');
    assert.equal(remote[max - 1][1].id, String(max + 4));
  });
});
