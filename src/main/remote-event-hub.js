'use strict';

const { EventEmitter } = require('events');

/** リモート向けチャット push のバッチ間隔（ms） */
const REMOTE_CHAT_BATCH_MS = 150;
/** 1 バッチ待ち中の最大件数（超過分は古いものから破棄） */
const REMOTE_CHAT_QUEUE_MAX = 80;

/**
 * PC ダッシュボード IPC とリモート WebSocket へのイベント fan-out
 */
class RemoteEventHub extends EventEmitter {
  constructor() {
    super();
    /** @type {((channel: string, data: unknown) => void) | null} */
    this._dashboardSend = null;
    /** @type {Set<(channel: string, data: unknown) => void>} */
    this._remoteSenders = new Set();
    /** @type {unknown[]} */
    this._remoteChatQueue = [];
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._remoteChatTimer = null;
  }

  /** @param {(channel: string, data: unknown) => void} fn */
  setDashboardSender(fn) {
    this._dashboardSend = fn;
  }

  /** @param {(channel: string, data: unknown) => void} fn */
  addRemoteSender(fn) {
    this._remoteSenders.add(fn);
    return () => this._remoteSenders.delete(fn);
  }

  /**
   * @param {string} channel
   * @param {unknown} data
   */
  _sendRemote(channel, data) {
    for (const send of this._remoteSenders) {
      try {
        send(channel, data);
      } catch (_) { /* ignore */ }
    }
  }

  _flushRemoteChat() {
    this._remoteChatTimer = null;
    const batch = this._remoteChatQueue;
    this._remoteChatQueue = [];
    for (const data of batch) {
      this._sendRemote('yt-message', data);
    }
  }

  /**
   * @param {unknown} data
   */
  _enqueueRemoteChat(data) {
    this._remoteChatQueue.push(data);
    if (this._remoteChatQueue.length > REMOTE_CHAT_QUEUE_MAX) {
      this._remoteChatQueue.splice(0, this._remoteChatQueue.length - REMOTE_CHAT_QUEUE_MAX);
    }
    if (!this._remoteChatTimer) {
      this._remoteChatTimer = setTimeout(() => this._flushRemoteChat(), REMOTE_CHAT_BATCH_MS);
    }
  }

  /**
   * @param {string} channel
   * @param {unknown} data
   * @param {{ skipDashboard?: boolean, skipRemote?: boolean }} [opts]
   */
  publish(channel, data, opts = {}) {
    if (!opts.skipDashboard && this._dashboardSend) {
      try {
        this._dashboardSend(channel, data);
      } catch (_) { /* ignore */ }
    }
    if (!opts.skipRemote) {
      if (channel === 'yt-message') {
        this._enqueueRemoteChat(data);
      } else {
        this._sendRemote(channel, data);
      }
    }
    this.emit('published', channel, data);
  }

  /** テスト用: 待ち中のチャットを即 flush */
  flushRemoteChatNow() {
    if (this._remoteChatTimer) {
      clearTimeout(this._remoteChatTimer);
      this._remoteChatTimer = null;
    }
    this._flushRemoteChat();
  }
}

module.exports = RemoteEventHub;
module.exports.REMOTE_CHAT_BATCH_MS = REMOTE_CHAT_BATCH_MS;
module.exports.REMOTE_CHAT_QUEUE_MAX = REMOTE_CHAT_QUEUE_MAX;
