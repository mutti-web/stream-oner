'use strict';

const crypto = require('crypto');

const K = {
  pin: 'remote.pin',
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function randomSessionId() {
  return crypto.randomUUID();
}

/**
 * リモート端末セッション（複数台）
 */
class RemoteSessionStore {
  /**
   * @param {object} store SimpleStore
   * @param {object} opts
   */
  constructor(store, opts = {}) {
    this._store = store;
    this._sessionTtlHours = opts.sessionTtlHours ?? 24;
    this._maxSessions = opts.maxSessions ?? 2;
    this._maxWsPerSession = opts.maxWsPerSession ?? 2;
    /** @type {Map<string, SessionRecord>} tokenHash -> record */
    this._byToken = new Map();
    /** @type {Map<string, string>} sessionId -> tokenHash */
    this._sessionToToken = new Map();
    /** @type {Map<string, number[]>} ip -> pin attempt timestamps */
    this._pinAttempts = new Map();
    this._onSessionsChanged = opts.onSessionsChanged || (() => {});
  }

  configure(opts) {
    if (opts.sessionTtlHours != null) {
      this._sessionTtlHours = Math.max(1, Math.min(168, Number(opts.sessionTtlHours) || 24));
    }
    if (opts.maxSessions != null) {
      this._maxSessions = Math.max(1, Math.min(50, Number(opts.maxSessions) || 2));
    }
    if (opts.maxWsPerSession != null) {
      this._maxWsPerSession = Math.max(1, Math.min(5, Number(opts.maxWsPerSession) || 2));
    }
  }

  getPin() {
    return this._store.getSecret(K.pin, '');
  }

  setPin(pin) {
    this._store.setSecret(K.pin, String(pin || '').trim());
    this.revokeAll();
  }

  ensurePin() {
    let pin = this.getPin();
    if (!pin) {
      pin = String(Math.floor(100000 + Math.random() * 900000));
      this.setPin(pin);
    }
    return pin;
  }

  regeneratePin() {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    this.setPin(pin);
    return pin;
  }

  _ttlMs() {
    return this._sessionTtlHours * 3600 * 1000;
  }

  _purgeExpired() {
    const now = Date.now();
    for (const [hash, rec] of this._byToken) {
      if (rec.expiresAt <= now) {
        this._byToken.delete(hash);
        this._sessionToToken.delete(rec.sessionId);
      }
    }
  }

  _activeSessions() {
    this._purgeExpired();
    return [...this._byToken.values()];
  }

  canAttemptPin(clientIp) {
    const ip = clientIp || 'unknown';
    const now = Date.now();
    const windowMs = 60_000;
    const max = 5;
    const arr = (this._pinAttempts.get(ip) || []).filter((t) => now - t < windowMs);
    this._pinAttempts.set(ip, arr);
    return arr.length < max;
  }

  recordPinAttempt(clientIp) {
    const ip = clientIp || 'unknown';
    const arr = this._pinAttempts.get(ip) || [];
    arr.push(Date.now());
    this._pinAttempts.set(ip, arr);
  }

  /**
   * @returns {{ success: boolean, error?: string, token?: string, sessionId?: string, expiresAt?: number, deviceLabel?: string }}
   */
  createSession(pin, deviceLabel, clientIp, userAgent) {
    if (!this.canAttemptPin(clientIp)) {
      return { success: false, error: 'PIN 試行回数が多すぎます。1分後に再試行してください' };
    }
    const expected = this.getPin();
    if (!expected) {
      return { success: false, error: 'リモート PIN が未設定です（PC の設定から有効化してください）' };
    }
    if (String(pin || '').trim() !== expected) {
      this.recordPinAttempt(clientIp);
      return { success: false, error: 'PIN が正しくありません' };
    }

    this._purgeExpired();
    if (this._activeSessions().length >= this._maxSessions) {
      return { success: false, error: `同時接続上限（${this._maxSessions} 台）に達しています` };
    }

    const token = randomToken();
    const sessionId = randomSessionId();
    const now = Date.now();
    const n = this._activeSessions().length + 1;
    const label = String(deviceLabel || '').trim() || (n === 1 ? 'マイスマホ' : `マイスマホ ${n}`);
    const rec = {
      sessionId,
      deviceLabel: label,
      clientIp: clientIp || '',
      userAgent: userAgent || '',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this._ttlMs(),
      wsCount: 0,
    };
    const hash = hashToken(token);
    this._byToken.set(hash, rec);
    this._sessionToToken.set(sessionId, hash);
    this._onSessionsChanged();
    return {
      success: true,
      token,
      sessionId,
      expiresAt: rec.expiresAt,
      deviceLabel: label,
    };
  }

  /**
   * @returns {SessionRecord | null}
   */
  validateToken(token) {
    if (!token) return null;
    const rec = this._byToken.get(hashToken(token));
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.revokeSession(rec.sessionId);
      return null;
    }
    rec.lastSeenAt = Date.now();
    return rec;
  }

  registerWs(token) {
    const rec = this.validateToken(token);
    if (!rec) return { ok: false, error: '認証が無効です' };
    if (rec.wsCount >= this._maxWsPerSession) {
      return { ok: false, error: 'この端末の接続数上限に達しています' };
    }
    rec.wsCount += 1;
    return { ok: true, session: rec };
  }

  unregisterWs(token) {
    const rec = this.validateToken(token);
    if (!rec) return;
    rec.wsCount = Math.max(0, rec.wsCount - 1);
  }

  revokeSession(sessionId) {
    const hash = this._sessionToToken.get(sessionId);
    if (hash) {
      this._byToken.delete(hash);
      this._sessionToToken.delete(sessionId);
      this._onSessionsChanged();
      return true;
    }
    return false;
  }

  revokeAll() {
    this._byToken.clear();
    this._sessionToToken.clear();
    this._onSessionsChanged();
  }

  listSessions() {
    return this._activeSessions().map((s) => ({
      sessionId: s.sessionId,
      deviceLabel: s.deviceLabel,
      clientIp: s.clientIp,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      wsConnected: s.wsCount > 0,
    }));
  }
}

module.exports = { RemoteSessionStore, K: { remotePin: K.pin } };
