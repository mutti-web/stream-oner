'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const K = {
  lagOffsetMs: 'yt.sessionLogLagOffsetMs',
  maxSessions: 'yt.sessionLogMaxSessions',
  maxDays: 'yt.sessionLogMaxDays',
};

const DEFAULTS = {
  lagOffsetMs: 0,
  maxSessions: 30,
  maxDays: 90,
};

/**
 * @param {Date} [d]
 */
function formatSessionFileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * @param {string} videoId
 * @param {number} sessionElapsedMs
 * @param {number} [lagOffsetMs]
 */
function buildTimestampUrl(videoId, sessionElapsedMs, lagOffsetMs = 0) {
  const vid = String(videoId || '').trim();
  if (!vid) return null;
  const t = Math.max(0, Math.floor((Number(sessionElapsedMs) - Number(lagOffsetMs || 0)) / 1000));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}&t=${t}s`;
}

class SessionLogManager {
  /**
   * @param {object} store
   * @param {string} userDataPath
   * @param {() => { elapsedMs?: number, running?: boolean, startedAt?: number | null }} getTimerState
   * @param {(event: string, data: unknown) => void} [emit]
   */
  constructor(store, userDataPath, getTimerState, emit = () => {}) {
    this._store = store;
    this._dir = path.join(userDataPath, 'session-logs');
    this._getTimerState = getTimerState;
    this._emit = emit;
    /** @type {object | null} */
    this._active = null;
    /** @type {object | null} */
    this._lastEnded = null;
    fs.mkdirSync(this._dir, { recursive: true });
  }

  getConfig() {
    const lag = Number(this._store.get(K.lagOffsetMs, DEFAULTS.lagOffsetMs));
    return {
      sessionLogLagOffsetMs: Math.max(-120000, Math.min(30000, Number.isFinite(lag) ? lag : 0)),
      sessionLogMaxSessions: Math.max(1, Math.min(500, Number(this._store.get(K.maxSessions, DEFAULTS.maxSessions)) || 30)),
      sessionLogMaxDays: Math.max(1, Math.min(3650, Number(this._store.get(K.maxDays, DEFAULTS.maxDays)) || 90)),
    };
  }

  saveConfig(partial = {}) {
    if (partial.sessionLogLagOffsetMs !== undefined) {
      const ms = Math.max(-120000, Math.min(30000, Number(partial.sessionLogLagOffsetMs) || 0));
      this._store.set(K.lagOffsetMs, ms);
    }
    if (partial.sessionLogMaxSessions !== undefined) {
      const n = Math.max(1, Math.min(500, Number(partial.sessionLogMaxSessions) || 30));
      this._store.set(K.maxSessions, n);
    }
    if (partial.sessionLogMaxDays !== undefined) {
      const n = Math.max(1, Math.min(3650, Number(partial.sessionLogMaxDays) || 90));
      this._store.set(K.maxDays, n);
    }
    return this.getConfig();
  }

  getStatus() {
    return {
      active: !!this._active,
      sessionId: this._active?.id || null,
      videoId: this._active?.videoId || '',
      startedAt: this._active?.startedAt || null,
      entryCount: this._active?.entries?.length || 0,
      highlightCount: this._active?.highlights?.length || 0,
    };
  }

  getLastSession() {
    if (this._lastEnded) {
      return this._decorateSession(this._lastEnded);
    }
    const files = this._listLogFiles();
    if (!files.length) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(files[0].path, 'utf8'));
      this._lastEnded = raw;
      return this._decorateSession(raw);
    } catch (_) {
      return null;
    }
  }

  _decorateSession(session) {
    if (!session) return null;
    const cfg = this.getConfig();
    const highlights = (session.highlights || []).map((h) => ({
      ...h,
      url: buildTimestampUrl(session.videoId, h.sessionElapsedMs, cfg.sessionLogLagOffsetMs),
    }));
    return { ...session, highlights };
  }

  _getElapsedMs() {
    const st = this._getTimerState?.() || {};
    let ms = Math.max(0, Number(st.elapsedMs) || 0);
    if (st.running && st.startedAt) {
      ms += Math.max(0, Date.now() - Number(st.startedAt));
    }
    return ms;
  }

  _notifyActive() {
    this._emit('session-log-changed', this.getStatus());
  }

  /**
   * @param {string} [videoId]
   * @param {{ manual?: boolean }} [opts]
   */
  startSession(videoId = '', opts = {}) {
    const vid = String(videoId || '').trim();
    if (this._active) {
      if (vid && this._active.videoId && vid !== this._active.videoId) {
        this.endSession({ reason: 'video-changed' });
      } else {
        this._notifyActive();
        return { success: true, sessionId: this._active.id, continued: true };
      }
    }
    const now = Date.now();
    const id = formatSessionFileStamp(new Date(now));
    this._active = {
      version: 1,
      id,
      videoId: vid,
      startedAt: now,
      endedAt: null,
      manual: !!opts.manual,
      entries: [],
      highlights: [],
    };
    this._notifyActive();
    console.log('[SessionLog] 開始:', id, vid || '(動画IDなし)');
    return { success: true, sessionId: id };
  }

  /**
   * @param {{ reason?: string }} [opts]
   */
  endSession(opts = {}) {
    if (!this._active) {
      return { success: true, ended: false };
    }
    const session = this._active;
    session.endedAt = Date.now();
    session.endReason = opts.reason || 'manual';
    this._active = null;

    try {
      const filePath = path.join(this._dir, `${session.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
      console.log('[SessionLog] 保存:', filePath, `(${session.entries.length}件)`);
    } catch (e) {
      console.error('[SessionLog] 保存失敗:', e.message);
      return { success: false, error: e.message };
    }

    this._lastEnded = session;
    this._pruneOldLogs();
    const decorated = this._decorateSession(session);
    this._emit('session-log-ended', decorated);
    this._emit('session-log-changed', this.getStatus());
    return { success: true, ended: true, session: decorated };
  }

  /**
   * @param {object} msg
   */
  recordMessage(msg) {
    if (!this._active || !msg) return null;
    if (!msg.author) return null;

    const entry = {
      id: String(msg.id || `entry-${crypto.randomUUID()}`),
      receivedAt: Date.now(),
      sessionElapsedMs: this._getElapsedMs(),
      authorId: msg.author.id || '',
      authorName: msg.author.name || '',
      text: msg.text || '',
      superChat: msg.superChat || null,
      isFirstTime: !!msg.author.isFirstTime,
    };
    this._active.entries.push(entry);

    if (entry.isFirstTime) {
      this._addHighlight({
        kind: 'auto-first',
        entryId: entry.id,
        sessionElapsedMs: entry.sessionElapsedMs,
        label: `初見: ${entry.authorName || '—'}`,
      });
    }
    if (entry.superChat) {
      const amount = entry.superChat.amountDisplayString || '';
      this._addHighlight({
        kind: 'auto-sc',
        entryId: entry.id,
        sessionElapsedMs: entry.sessionElapsedMs,
        label: `スパチャ${amount ? ` ${amount}` : ''}: ${entry.authorName || '—'}`,
      });
    }

    if (this._active.entries.length % 20 === 0) {
      this._notifyActive();
    }
    return entry;
  }

  /**
   * @param {string} entryId
   */
  markHighlight(entryId) {
    if (!this._active) {
      return { success: false, error: 'セッションが開始されていません' };
    }
    const entry = this._active.entries.find((e) => e.id === entryId);
    if (!entry) {
      return { success: false, error: 'コメントが見つかりません' };
    }
    const existing = this._active.highlights.some((h) => h.entryId === entryId && h.kind === 'manual');
    if (existing) {
      return { success: true, duplicate: true };
    }
    const hl = this._addHighlight({
      kind: 'manual',
      entryId: entry.id,
      sessionElapsedMs: entry.sessionElapsedMs,
      label: entry.text?.slice(0, 40) || entry.authorName || 'ハイライト',
    });
    this._notifyActive();
    return { success: true, highlight: hl };
  }

  _addHighlight(partial) {
    const hl = {
      id: `hl-${crypto.randomUUID()}`,
      markedAt: Date.now(),
      ...partial,
    };
    this._active.highlights.push(hl);
    return hl;
  }

  _listLogFiles() {
    let names = [];
    try {
      names = fs.readdirSync(this._dir).filter((n) => n.endsWith('.json'));
    } catch (_) {
      return [];
    }
    const files = names.map((name) => {
      const filePath = path.join(this._dir, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch (_) { /* ignore */ }
      return { name, path: filePath, mtime };
    });
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  }

  _pruneOldLogs() {
    const cfg = this.getConfig();
    const files = this._listLogFiles();
    const maxSessions = cfg.sessionLogMaxSessions;
    const maxAgeMs = cfg.sessionLogMaxDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const toDelete = new Set();

    files.forEach((f, idx) => {
      if (idx >= maxSessions) toDelete.add(f.path);
      if (maxAgeMs > 0 && now - f.mtime > maxAgeMs) toDelete.add(f.path);
    });

    for (const filePath of toDelete) {
      try {
        fs.unlinkSync(filePath);
        console.log('[SessionLog] 削除:', path.basename(filePath));
      } catch (_) { /* ignore */ }
    }
  }
}

module.exports = {
  SessionLogManager,
  K,
  DEFAULTS,
  buildTimestampUrl,
  formatSessionFileStamp,
};
