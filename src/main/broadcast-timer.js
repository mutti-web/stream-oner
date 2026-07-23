'use strict';

const K = {
  anchorVideoId: 'yt.broadcastTimer.anchorVideoId',
  elapsedMs: 'yt.broadcastTimer.elapsedMs',
};

/**
 * 配信タイマー（チャット取得の開始/停止と連動）
 * - 同じ動画IDなら経過時間を保持（アプリ再起動後も store から復元）
 * - 動画IDが変わったら 0 にリセット
 */
class BroadcastTimer {
  constructor(store, onChange) {
    this._store = store;
    this._onChange = onChange || (() => {});
    this._anchorVideoId = String(store.get(K.anchorVideoId, '') || '').trim();
    this._elapsedMs = Math.max(0, Number(store.get(K.elapsedMs, 0)) || 0);
    this._running = false;
    this._startedAt = null;
  }

  _persist() {
    this._store.set(K.anchorVideoId, this._anchorVideoId);
    this._store.set(K.elapsedMs, this._elapsedMs);
  }

  _notify() {
    this._onChange(this.getState());
  }

  getState() {
    return {
      anchorVideoId: this._anchorVideoId,
      elapsedMs: this._elapsedMs,
      running: this._running,
      startedAt: this._running ? this._startedAt : null,
    };
  }

  /** 動画ID保存時（ポーラー停止中でもリセット判定） */
  onVideoIdChanged(videoId) {
    const vid = String(videoId || '').trim();
    if (!vid) return;
    if (vid === this._anchorVideoId) return;
    this._anchorVideoId = vid;
    this._elapsedMs = 0;
    if (this._running && this._startedAt) {
      this._startedAt = Date.now();
    }
    this._persist();
    this._notify();
  }

  /** チャット取得開始 */
  onPollerStart(videoId) {
    const vid = String(videoId || '').trim();
    if (!vid) return;

    if (vid !== this._anchorVideoId) {
      this._anchorVideoId = vid;
      this._elapsedMs = 0;
    }

    if (!this._running) {
      this._running = true;
      this._startedAt = Date.now();
    }

    this._persist();
    this._notify();
  }

  /** チャット取得停止 */
  onPollerStop() {
    if (this._running && this._startedAt) {
      this._elapsedMs += Math.max(0, Date.now() - this._startedAt);
    }
    this._running = false;
    this._startedAt = null;
    this._persist();
    this._notify();
  }
}

module.exports = BroadcastTimer;
