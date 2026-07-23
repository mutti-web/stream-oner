/**
 * discord-rpc-manager.js - Discord RPC接続管理モジュール
 *
 * 追加機能:
 * - GET_CHANNEL でチャンネル参加時のメンバー初期一覧を取得
 * - VOICE_STATE_CREATE / UPDATE / DELETE でメンバーの入退出を追跡
 * - SPEAKING_START / STOP で発話状態をリアルタイム取得
 * - OAuth トークン永続化（初回または再認証が必要なときのみ承認 UI）
 */

const { EventEmitter } = require('events');
const net   = require('net');
const https = require('https');
const path  = require('path');

const MAX_RETRY_DELAY_MS    = 30_000;
const INITIAL_RETRY_DELAY_MS = 3_000;

class DiscordRPCManager extends EventEmitter {
  /**
   * @param {string} clientId
   * @param {string} clientSecret
   * @param {{ load: Function, save: Function, clear: Function, isAccessTokenFresh: Function } | null} oauthSession
   */
  constructor(clientId, clientSecret, oauthSession = null) {
    super();
    this._clientId     = clientId;
    this._clientSecret = clientSecret;
    this._session      = oauthSession;
    this._socket       = null;

    this._status = {
      connected: false,
      state: 'disconnected',
      error: null,
      username: null,
      avatar: null,
    };

    /** @type {Map<string, Object>} userId → VoiceUser */
    this._voiceUsers = new Map();

    this._currentChannelId   = null;
    this._currentChannelName = null;

    this._retryDelay          = INITIAL_RETRY_DELAY_MS;
    this._retryTimer          = null;
    this._intentionalDisconnect = false;
    this._partialBuffer       = null;
    this._nonce               = 0;

    /** @type {'stored_access'|'refresh'|'authorize_none'|'authorize_consent'|null} */
    this._authStep = null;
    /** @type {{ accessToken: string, refreshToken?: string, expiresIn: number } | null} */
    this._pendingTokens = null;
  }

  // ----------------------------------------------------------
  // 公開API
  // ----------------------------------------------------------

  async connect() {
    if (!this._clientId || !this._clientSecret) {
      this._updateStatus({ state: 'error', error: 'Client ID / Client Secret が未設定です。' });
      return;
    }
    if (this._status.state === 'connecting' || this._status.state === 'connected') return;
    this._intentionalDisconnect = false;
    await this._attemptConnect();
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._clearRetryTimer();
    this._authStep = null;
    this._pendingTokens = null;
    if (this._socket) { this._socket.destroy(); this._socket = null; }
    this._voiceUsers.clear();
    this._currentChannelId = null;
    this._updateStatus({ connected: false, state: 'disconnected' });
    console.log('[RPC] 切断しました');
  }

  async reconnect() {
    await this.disconnect();
    this._intentionalDisconnect = false;
    this._retryDelay = INITIAL_RETRY_DELAY_MS;
    await this.connect();
  }

  async updateClientId(newId) {
    if (newId !== this._clientId) this._session?.clear();
    this._clientId = newId;
    await this.reconnect();
  }

  async updateClientSecret(newSec) {
    if (newSec !== this._clientSecret) this._session?.clear();
    this._clientSecret = newSec;
    await this.reconnect();
  }

  /** 保存済みトークンを破棄し、次回接続で再承認する */
  clearSavedAuth() {
    this._session?.clear();
  }

  getStatus()     { return { ...this._status }; }
  getVoiceUsers() { return Array.from(this._voiceUsers.values()); }

  // ----------------------------------------------------------
  // 接続
  // ----------------------------------------------------------

  async _attemptConnect() {
    this._updateStatus({ state: 'connecting', error: null });
    const pipeName = this._getPipePath(0);
    console.log('[RPC] 接続先:', pipeName);

    this._socket = net.createConnection(pipeName);
    this._partialBuffer = null;

    this._socket.on('connect', () => {
      console.log('[RPC] ソケット接続成功');
      this._socket.setTimeout(0); // 接続後タイムアウト無効
      this._sendHandshake();
    });

    this._socket.on('data',  (chunk) => this._onData(chunk));
    this._socket.on('close', () => {
      console.log('[RPC] ソケット切断');
      this._socket = null;
      this._voiceUsers.clear();
      this._authStep = null;
      this._pendingTokens = null;
      this._updateStatus({ connected: false, state: 'disconnected' });
      if (!this._intentionalDisconnect) this._scheduleRetry();
    });
    this._socket.on('error', (err) => {
      console.error('[RPC] ソケットエラー:', err.message);
      this._socket = null;
      this._updateStatus({ state: 'error', error: err.message });
      if (!this._intentionalDisconnect) this._scheduleRetry();
    });

    // 接続確立まで10秒
    this._socket.setTimeout(10000, () => {
      console.error('[RPC] 接続タイムアウト');
      this._socket?.destroy();
    });
  }

  _getPipePath(index) {
    const name = `discord-ipc-${index}`;
    if (process.platform === 'win32') return `\\\\?\\pipe\\${name}`;
    const tmp = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
    return path.join(tmp, name);
  }

  // ----------------------------------------------------------
  // IPC フレーム
  // ----------------------------------------------------------

  _writeFrame(op, json) {
    const data  = Buffer.from(json, 'utf8');
    const frame = Buffer.alloc(8 + data.length);
    frame.writeUInt32LE(op, 0);
    frame.writeUInt32LE(data.length, 4);
    data.copy(frame, 8);
    this._socket?.write(frame);
  }

  _onData(chunk) {
    let buf = this._partialBuffer ? Buffer.concat([this._partialBuffer, chunk]) : chunk;
    this._partialBuffer = null;

    while (buf.length >= 8) {
      const op  = buf.readUInt32LE(0);
      const len = buf.readUInt32LE(4);
      if (buf.length < 8 + len) { this._partialBuffer = buf; break; }

      const json = buf.slice(8, 8 + len).toString('utf8');
      buf = buf.slice(8 + len);
      try { this._onMessage(op, JSON.parse(json)); }
      catch (e) { console.error('[RPC] JSONパースエラー:', e.message); }
    }
  }

  // ----------------------------------------------------------
  // メッセージ処理
  // ----------------------------------------------------------

  _onMessage(op, msg) {
    if (op !== 1 && op !== 2) return;
    if (op === 2) { console.log('[RPC] CLOSE受信:', msg); return; }

    const { cmd, evt, data } = msg;

    // ① READY → 保存トークン or 静かな承認
    if (cmd === 'DISPATCH' && evt === 'READY') {
      console.log('[RPC] READY → 認証開始');
      this._beginAuthOnReady();
      return;
    }

    // ② AUTHORIZE → token交換 → AUTHENTICATE
    if (cmd === 'AUTHORIZE') {
      const code = msg?.data?.code;
      if (code) {
        this._sendAuthenticateWithCode(code);
      } else if (this._authStep === 'authorize_none') {
        console.log('[RPC] 静かな承認失敗 → 承認画面を表示');
        this._sendAuthorize('consent');
        this._authStep = 'authorize_consent';
      } else {
        this._updateStatus({ state: 'error', error: 'AUTHORIZE失敗: ' + JSON.stringify(msg.data) });
      }
      return;
    }

    // ③ AUTHENTICATE → 購読開始
    if (cmd === 'AUTHENTICATE') {
      if (msg.data?.user) {
        this._onAuthenticateSuccess(msg.data.user);
      } else {
        this._onAuthenticateFailure(msg.data);
      }
      return;
    }

    // ④ GET_CHANNEL応答 → メンバー初期一覧を構築
    if (cmd === 'GET_CHANNEL') {
      this._onGetChannelResponse(msg.data);
      return;
    }

    // ⑤ イベント
    if (cmd === 'DISPATCH') this._handleEvent(evt, data);
  }

  // ----------------------------------------------------------
  // 認証フロー
  // ----------------------------------------------------------

  _sendHandshake() {
    this._writeFrame(0, JSON.stringify({ v: 1, client_id: this._clientId }));
    console.log('[RPC] ハンドシェイク送信');
  }

  async _beginAuthOnReady() {
    this._authStep = null;
    this._pendingTokens = null;

    if (!this._session) {
      this._sendAuthorize('none');
      this._authStep = 'authorize_none';
      return;
    }

    const saved = this._session.load(this._clientId);

    if (saved && this._session.isAccessTokenFresh(saved)) {
      console.log('[RPC] 保存済み access_token で認証');
      this._authStep = 'stored_access';
      this._sendAuthenticate(saved.accessToken);
      return;
    }

    if (saved?.refreshToken) {
      try {
        console.log('[RPC] refresh_token でトークン更新');
        await this._refreshAndAuthenticate(saved.refreshToken, saved);
        return;
      } catch (err) {
        console.warn('[RPC] トークン更新失敗:', err.message);
        this._session.clear();
      }
    }

    console.log('[RPC] 承認フロー開始（prompt=none）');
    this._sendAuthorize('none');
    this._authStep = 'authorize_none';
  }

  _onAuthenticateSuccess(user) {
    const prevUserId = this._session?.load(this._clientId)?.userId || '';

    if (this._pendingTokens && this._session) {
      const t = this._pendingTokens;
      this._session.save(this._clientId, {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken || '',
        expiresAt: Date.now() + (t.expiresIn || 604800) * 1000,
        userId: user.id,
      });
      this._pendingTokens = null;
    } else if (this._session) {
      const saved = this._session.load(this._clientId);
      if (saved?.accessToken) {
        this._session.save(this._clientId, {
          accessToken: saved.accessToken,
          refreshToken: saved.refreshToken,
          expiresAt: saved.expiresAt,
          userId: user.id,
        });
      }
    }

    if (prevUserId && prevUserId !== user.id) {
      console.log('[RPC] Discord ログインアカウントが変更されました');
    }

    console.log('[RPC] 認証成功:', user.username);
    this._authStep = null;
    this._updateStatus({
      connected: true,
      state: 'connected',
      username: user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
      error: null,
    });
    this._subscribeEvents();
  }

  _onAuthenticateFailure(data) {
    const detail = data ? JSON.stringify(data) : '不明';
    console.warn('[RPC] AUTHENTICATE 失敗:', detail, `(step=${this._authStep})`);

    if (this._authStep === 'stored_access' || this._authStep === 'refresh') {
      this._session?.clear();
      this._sendAuthorize('none');
      this._authStep = 'authorize_none';
      return;
    }

    if (this._authStep === 'authorize_none') {
      this._sendAuthorize('consent');
      this._authStep = 'authorize_consent';
      return;
    }

    this._pendingTokens = null;
    this._updateStatus({ state: 'error', error: '認証失敗: ' + detail });
  }

  _sendAuthorize(prompt) {
    const args = { client_id: this._clientId, scopes: ['rpc'] };
    if (prompt) args.prompt = prompt;
    this._writeFrame(1, JSON.stringify({
      cmd: 'AUTHORIZE',
      args,
      nonce: String(++this._nonce),
    }));
    console.log('[RPC] AUTHORIZE 送信', prompt ? `(prompt=${prompt})` : '');
  }

  _sendAuthenticate(accessToken) {
    this._writeFrame(1, JSON.stringify({
      cmd: 'AUTHENTICATE',
      args: { access_token: accessToken },
      nonce: String(++this._nonce),
    }));
  }

  async _sendAuthenticateWithCode(code) {
    try {
      const tokens = await this._exchangeCodeForToken(code);
      this._pendingTokens = tokens;
      this._authStep = 'authorize_consent';
      this._sendAuthenticate(tokens.accessToken);
    } catch (err) {
      this._pendingTokens = null;
      this._updateStatus({ state: 'error', error: 'トークン交換失敗: ' + err.message });
    }
  }

  async _refreshAndAuthenticate(refreshToken, previousSession) {
    const tokens = await this._refreshAccessToken(refreshToken);
    if (this._session) {
      this._session.save(this._clientId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresAt: Date.now() + (tokens.expiresIn || 604800) * 1000,
        userId: previousSession?.userId || '',
      });
    }
    this._authStep = 'refresh';
    this._sendAuthenticate(tokens.accessToken);
  }

  _requestOAuthToken(bodyParams) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams(bodyParams).toString();

      const req = https.request({
        hostname: 'discord.com',
        path: '/api/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': 'Basic ' + Buffer.from(`${this._clientId}:${this._clientSecret}`).toString('base64'),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.access_token) {
              reject(new Error(json.error_description || json.error || data));
              return;
            }
            resolve({
              accessToken: json.access_token,
              refreshToken: json.refresh_token || null,
              expiresIn: Number(json.expires_in) || 604800,
            });
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _exchangeCodeForToken(code) {
    return this._requestOAuthToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost',
    });
  }

  _refreshAccessToken(refreshToken) {
    return this._requestOAuthToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  // ----------------------------------------------------------
  // イベント購読
  // ----------------------------------------------------------

  _subscribeEvents() {
    // ボイスチャンネル切り替え
    this._subscribe('VOICE_CHANNEL_SELECT', {});
    console.log('[RPC] イベント購読完了');
  }

  /**
   * チャンネルに参加したとき、そのチャンネルのイベントを追加購読する
   * @param {string} channelId
   */
  _subscribeChannelEvents(channelId) {
    this._subscribe('SPEAKING_START',      { channel_id: channelId });
    this._subscribe('SPEAKING_STOP',       { channel_id: channelId });
    this._subscribe('VOICE_STATE_CREATE',  { channel_id: channelId });
    this._subscribe('VOICE_STATE_UPDATE',  { channel_id: channelId });
    this._subscribe('VOICE_STATE_DELETE',  { channel_id: channelId });
    console.log('[RPC] チャンネルイベント購読:', channelId);
  }

  _subscribe(evt, args) {
    this._writeFrame(1, JSON.stringify({
      cmd: 'SUBSCRIBE', args, evt,
      nonce: String(++this._nonce),
    }));
  }

  // ----------------------------------------------------------
  // チャンネルメンバー取得
  // ----------------------------------------------------------

  /**
   * GET_CHANNEL コマンドを送ってメンバー一覧を要求する
   * @param {string} channelId
   */
  _requestChannelInfo(channelId) {
    this._writeFrame(1, JSON.stringify({
      cmd: 'GET_CHANNEL',
      args: { channel_id: channelId },
      nonce: String(++this._nonce),
    }));
    console.log('[RPC] GET_CHANNEL送信:', channelId);
  }

  /**
   * GET_CHANNEL の応答からメンバー初期一覧を構築する
   * @param {Object} data
   */
  _onGetChannelResponse(data) {
    if (!data) return;
    this._currentChannelName = data.name ?? 'ボイスチャンネル';
    this._voiceUsers.clear();

    // voice_states に現在参加中のメンバーが入っている
    const voiceStates = data.voice_states ?? [];
    for (const vs of voiceStates) {
      const user = this._buildVoiceUser(vs);
      this._voiceUsers.set(user.id, user);
    }

    console.log(`[RPC] メンバー取得完了: ${this._voiceUsers.size}人`);

    this.emit('channel-update', {
      channelId:   this._currentChannelId,
      channelName: this._currentChannelName,
      users:       this.getVoiceUsers(),
    });
  }

  // ----------------------------------------------------------
  // イベントハンドラー
  // ----------------------------------------------------------

  _handleEvent(evt, data) {
    switch (evt) {

      // ボイスチャンネル切り替え
      case 'VOICE_CHANNEL_SELECT': {
        const newChannelId = data?.channel_id ?? null;
        console.log('[RPC] チャンネル切り替え:', newChannelId);

        this._voiceUsers.clear();
        this._currentChannelId   = newChannelId;
        this._currentChannelName = null;

        if (newChannelId) {
          // メンバー一覧を取得してからチャンネルイベントを購読
          this._requestChannelInfo(newChannelId);
          this._subscribeChannelEvents(newChannelId);
        } else {
          // チャンネル退出
          this.emit('channel-update', { channelId: null, channelName: null, users: [] });
        }
        break;
      }

      // メンバー参加
      case 'VOICE_STATE_CREATE': {
        const user = this._buildVoiceUser(data);
        this._voiceUsers.set(user.id, user);
        console.log('[RPC] 参加:', user.username);
        this.emit('voice-state-update', { type: 'join', user, users: this.getVoiceUsers() });
        break;
      }

      // ミュート・デフ等の状態変化
      case 'VOICE_STATE_UPDATE': {
        const userId   = data?.user?.id;
        if (!userId) break;
        const existing = this._voiceUsers.get(userId);
        const updated  = this._buildVoiceUser(data, existing);
        this._voiceUsers.set(userId, updated);
        this.emit('voice-state-update', { type: 'update', user: updated, users: this.getVoiceUsers() });
        break;
      }

      // メンバー退出
      case 'VOICE_STATE_DELETE': {
        const userId = data?.user?.id;
        if (!userId) break;
        const user = this._voiceUsers.get(userId);
        this._voiceUsers.delete(userId);
        console.log('[RPC] 退出:', user?.username);
        this.emit('voice-state-update', { type: 'leave', user, users: this.getVoiceUsers() });
        break;
      }

      // 発話開始
      case 'SPEAKING_START': {
        const userId = data?.user_id;
        if (!userId) break;
        const user = this._voiceUsers.get(userId);
        if (user) { user.speaking = true; user.speakingStartTime = Date.now(); }
        this.emit('speaking-update', { userId, speaking: true, timestamp: Date.now() });
        break;
      }

      // 発話停止
      case 'SPEAKING_STOP': {
        const userId = data?.user_id;
        if (!userId) break;
        const user = this._voiceUsers.get(userId);
        if (user) { user.speaking = false; user.speakingStartTime = null; }
        this.emit('speaking-update', { userId, speaking: false, timestamp: Date.now() });
        break;
      }
    }
  }

  // ----------------------------------------------------------
  // ユーティリティ
  // ----------------------------------------------------------

  /**
   * voiceState オブジェクトから統一的な VoiceUser を生成する
   * @param {Object} vs       - voice_state オブジェクト
   * @param {Object} existing - 既存ユーザー（発話状態を引き継ぐ）
   */
  _buildVoiceUser(vs, existing = null) {
    const u = vs?.user ?? vs?.member?.user ?? {};
    const avatarUrl = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${(parseInt(u.id || '0') % 5)}.png`;

    return {
      id:               u.id ?? 'unknown',
      username:         u.username ?? 'Unknown',
      globalName:       u.global_name ?? u.username ?? 'Unknown',
      avatar:           avatarUrl,
      speaking:         existing?.speaking         ?? false,
      speakingStartTime:existing?.speakingStartTime ?? null,
      mute:             vs?.mute      ?? false,
      deaf:             vs?.deaf      ?? false,
      selfMute:         vs?.self_mute ?? false,
      selfDeaf:         vs?.self_deaf ?? false,
      volume:           vs?.volume    ?? 100,
    };
  }

  _updateStatus(updates) {
    this._status = { ...this._status, ...updates };
    this.emit('status-changed', { ...this._status });
  }

  _scheduleRetry() {
    this._clearRetryTimer();
    console.log(`[RPC] ${this._retryDelay / 1000}秒後に再試行...`);
    this._retryTimer = setTimeout(async () => {
      if (!this._intentionalDisconnect) await this._attemptConnect();
    }, this._retryDelay);
    this._retryDelay = Math.min(this._retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  _clearRetryTimer() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
  }
}

module.exports = DiscordRPCManager;
