'use strict';

const path = require('path');
const fs = require('fs');

const MOCK_PATH = path.join(__dirname, '../renderer/dev/rehearsal-mock.json');

class RehearsalMockFeed {
  /**
   * @param {{ deliverMockMessage: (msg: object) => void } | null} ytManager
   */
  constructor(ytManager) {
    this._yt = ytManager;
    this._timer = null;
    this._idx = 0;
    this._messages = [];
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(MOCK_PATH, 'utf8'));
      this._messages = Array.isArray(raw.messages) ? raw.messages : [];
    } catch (e) {
      console.warn('[Rehearsal] モック読込失敗:', e.message);
      this._messages = [];
    }
  }

  get running() {
    return this._timer != null;
  }

  start() {
    this.stop();
    if (!this._yt || !this._messages.length) {
      console.warn('[Rehearsal] モック配信を開始できません（YT 未初期化またはモック空）');
      return;
    }
    this._idx = 0;
    this._scheduleNext(800);
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._idx = 0;
  }

  _scheduleNext(delayMs) {
    this._timer = setTimeout(() => {
      this._timer = null;
      this._emitOne();
    }, delayMs);
  }

  _emitOne() {
    if (!this._yt || !this._messages.length) return;
    const raw = this._messages[this._idx % this._messages.length];
    this._idx += 1;
    const { _delayMs, ...msg } = raw;
    try {
      this._yt.deliverMockMessage(msg);
    } catch (e) {
      console.warn('[Rehearsal] モック送信失敗:', e.message);
    }
    const nextDelay = Math.max(1500, Number(_delayMs) || 4000);
    this._scheduleNext(nextDelay);
  }
}

module.exports = RehearsalMockFeed;
