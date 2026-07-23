'use strict';

/**
 * youtube-chat-manager.js - YouTubeチャットオーバーレイ管理モジュール
 *
 * 役割:
 *   - YouTubeChatPoller を管理（起動・停止・再起動）
 *   - HTTP サーバー（:3002）で youtube-overlay.html を配信
 *   - WebSocket で OBS ブラウザソースへリアルタイム配信
 *   - SimpleStore を通じて設定を読み書きする
 *
 * main.js からは以下のように使用する:
 *   const mgr = new YouTubeChatManager(3002, overlayHtmlPath, store);
 *   mgr.startServer();
 *   mgr.startPoller();
 *   mgr.on('status-changed', (status) => { ... });
 */

const { EventEmitter } = require('events');
const http = require('http');
const fs   = require('fs');
const { WebSocketServer } = require('ws');
const { app } = require('electron'); // 追加

const YouTubeChatPoller = require('./youtube-api');
const normalizeChatSource = YouTubeChatPoller.normalizeChatSource;
const ViewerDB = require('./viewer-db');
const { isPortAvailable } = require('./port-utils');
const staticFileCache = require('./static-file-cache');
const customCss = require('./custom-css');
const superchatTiers = require('./superchat-tiers');

const MAX_PINNED = 3;
const DEFAULT_BATCH_PROCESS_LIMIT = 50;

// ============================================================
// ストアキーのプレフィックス定数
// ============================================================
const K = {
  videoId:         'yt.videoId',
  apiKey:          'yt.apiKey',
  chatSource:      'yt.chatSource',
  pollingInterval: 'yt.pollingIntervalMs',
  maxComments:     'yt.maxComments',
  showDuration:    'yt.showDurationMs',
  animMode:        'yt.animMode',
  position:        'yt.position',
  width:           'yt.width',
  gap:             'yt.gap',
  ngWords:         'yt.ngWords',
  ngUserIds:       'yt.ngUserIds',
  allowMembers:    'yt.allowMembersOnly',
  superChatOnly:   'yt.showSuperChatOnly',
  hideBotCmds:     'yt.hideBotCommands',
  botPrefix:       'yt.botCommandPrefix',
  badgeFirst:      'yt.badgeFirst',
  badgeRegular:    'yt.badgeRegular',
  badgeThreshold:  'yt.badgeThreshold',
  batchProcessLimit: 'yt.batchProcessLimit',
  superChatTiers: superchatTiers.STORE_KEY,
};

class YouTubeChatManager extends EventEmitter {
  /**
   * @param {number} port        - HTTP + WebSocket サーバーのポート番号
   * @param {string} htmlPath    - youtube-overlay.html の絶対パス
   * @param {object} store       - SimpleStore インスタンス（main.js と共有）
   */
  constructor(port, htmlPath, store) {
    super();
    this._port     = port;
    this._htmlPath = htmlPath;
    this._store    = store;

    this._server  = null;
    this._wss     = null;
    this._clients = new Set();
    this._poller  = null;
    this._viewerDb = new ViewerDB(app.getPath('userData')); // 追加

    this._status = { pollerRunning: false, serverRunning: false, error: null };
    /** @type {object[]} 最大 MAX_PINNED 件 */
    this._pinnedMessages = [];
    /** @type {Map<string, object>} 今回の配信枠でコメントしたユーザー */
    this._sessionUsers = new Map();
    this._sessionEmitTimer = null;

    this._filterCache = null;
    this._updateFilterCache();
  }

  _updateFilterCache() {
    const s = this._store;
    this._filterCache = {
      ngWords:          s.get(K.ngWords,     []),
      ngUserIds:        s.get(K.ngUserIds,   []),
      allowMembersOnly: s.get(K.allowMembers, false),
      showSuperChatOnly: s.get(K.superChatOnly, false),
      hideBotCommands:  s.get(K.hideBotCmds, true),
      botCommandPrefix: s.get(K.botPrefix,   '!'),
    };
  }

  // ============================================================
  // 設定ヘルパー
  // ============================================================

  /**
   * ストアから YouTube 表示用の設定オブジェクトを組み立てる。
   * overlay/index.html の init パケットに使用する。
   */
  _buildOverlayConfig() {
    const s = this._store;
    return {
      youtube: {
        videoId:          s.get(K.videoId, ''),
        apiKey:           s.getSecret(K.apiKey, ''),
        chatSource:       normalizeChatSource(s.get(K.chatSource, 'auto')),
        pollingIntervalMs: s.get(K.pollingInterval, 5000),
      },
      display: {
        maxComments:   s.get(K.maxComments,  8),
        showDurationMs: s.get(K.showDuration, 8000),
        animMode:      s.get(K.animMode,     'slide-up'),
        position:      s.get(K.position,     'bottom-right'),
        width:         s.get(K.width,        400),
        gap:           s.get(K.gap,          6),
        badgeFirst:    s.get(K.badgeFirst,   '🔰初見'),
        badgeRegular:  s.get(K.badgeRegular, '⭐常連'),
        badgeThreshold:s.get(K.badgeThreshold, 10),
        superChatTiers: superchatTiers.normalizeTiers(s.get(K.superChatTiers)),
      },
      style: {
        fontFamily:      "'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif",
        fontSize:        14,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        textColor:       '#f0f0f0',
        usernameColor:   '#7dd3fc',
        superChatColor:  '#fbbf24',
        ownerColor:      '#f87171',
        moderatorColor:  '#86efac',
        borderRadius:    8,
        padding:         '6px 10px',
        avatarSize:      22,
      },
      animation: {
        enterDurationMs: 350,
        exitDurationMs:  220,
        easingEnter:     'cubic-bezier(0.25, 0.8, 0.25, 1)',
        easingExit:      'ease-in',
      },
      filter: {
        ngWords:          s.get(K.ngWords,     []),
        ngUserIds:        s.get(K.ngUserIds,   []),
        allowMembersOnly: s.get(K.allowMembers, false),
        showSuperChatOnly: s.get(K.superChatOnly, false),
        hideBotCommands:  s.get(K.hideBotCmds, true),
        botCommandPrefix: s.get(K.botPrefix,   '!'),
      },
    };
  }

  /**
   * 設定画面（settings.html）向けの設定サマリーを返す。
   * APIキーは有無のみ返す（セキュリティ）。
   */
  getConfig() {
    const s = this._store;
    return {
      videoId:          s.get(K.videoId, ''),
      hasApiKey:        !!s.getSecret(K.apiKey, ''),
      chatSource:       normalizeChatSource(s.get(K.chatSource, 'auto')),
      pollingIntervalMs: s.get(K.pollingInterval, 5000),
      maxComments:      s.get(K.maxComments,  8),
      showDurationMs:   s.get(K.showDuration, 8000),
      animMode:         s.get(K.animMode,     'slide-up'),
      position:         s.get(K.position,     'bottom-right'),
      width:            s.get(K.width,        400),
      gap:              s.get(K.gap,          6),
      badgeFirst:       s.get(K.badgeFirst,   '🔰初見'),
      badgeRegular:     s.get(K.badgeRegular, '⭐常連'),
      badgeThreshold:   s.get(K.badgeThreshold, 10),
      ngWords:          s.get(K.ngWords, []),
      ngUserIds:        s.get(K.ngUserIds, []),
      allowMembersOnly: s.get(K.allowMembers, false),
      showSuperChatOnly: s.get(K.superChatOnly, false),
      hideBotCommands:  s.get(K.hideBotCmds, true),
      botCommandPrefix: s.get(K.botPrefix, '!'),
      obsUrl:           `http://127.0.0.1:${this._port}/overlay`,
      batchProcessLimit: this._store.get(K.batchProcessLimit, DEFAULT_BATCH_PROCESS_LIMIT),
      superChatTiers: superchatTiers.normalizeTiers(s.get(K.superChatTiers)),
    };
  }

  getFilterSettings() {
    return { ...this._filterCache };
  }

  /**
   * 設定画面からの保存リクエストをストアに反映する。
   * @param {object} settings
   */
  saveConfig(settings) {
    const s = this._store;
    const prevChatSource = normalizeChatSource(s.get(K.chatSource, 'auto'));
    if (settings.videoId          !== undefined) s.set(K.videoId,        settings.videoId);
    if (settings.apiKey)                          s.setSecret(K.apiKey,         settings.apiKey);
    if (settings.chatSource       !== undefined) s.set(K.chatSource, normalizeChatSource(settings.chatSource));
    if (settings.pollingIntervalMs !== undefined) s.set(K.pollingInterval, settings.pollingIntervalMs);
    if (settings.maxComments       !== undefined) s.set(K.maxComments,    settings.maxComments);
    if (settings.showDurationMs    !== undefined) s.set(K.showDuration,   settings.showDurationMs);
    if (settings.animMode          !== undefined) s.set(K.animMode,       settings.animMode);
    if (settings.position          !== undefined) s.set(K.position,       settings.position);
    if (settings.width             !== undefined) {
      const w = Math.max(200, Math.min(1200, Number(settings.width) || 400));
      s.set(K.width, w);
    }
    if (settings.gap               !== undefined) {
      const g = Math.max(0, Math.min(48, Number(settings.gap) || 6));
      s.set(K.gap, g);
    }
    if (settings.badgeFirst        !== undefined) s.set(K.badgeFirst,     settings.badgeFirst);
    if (settings.badgeRegular      !== undefined) s.set(K.badgeRegular,   settings.badgeRegular);
    if (settings.badgeThreshold    !== undefined) s.set(K.badgeThreshold, settings.badgeThreshold);
    if (settings.ngWords           !== undefined) s.set(K.ngWords, settings.ngWords);
    if (settings.ngUserIds         !== undefined) s.set(K.ngUserIds, settings.ngUserIds);
    if (settings.allowMembersOnly  !== undefined) s.set(K.allowMembers, settings.allowMembersOnly);
    if (settings.showSuperChatOnly !== undefined) s.set(K.superChatOnly, settings.showSuperChatOnly);
    if (settings.hideBotCommands   !== undefined) s.set(K.hideBotCmds, settings.hideBotCommands);
    if (settings.botCommandPrefix  !== undefined) s.set(K.botPrefix, settings.botCommandPrefix);
    if (settings.batchProcessLimit !== undefined) {
      const n = Math.max(1, Math.min(200, Number(settings.batchProcessLimit) || DEFAULT_BATCH_PROCESS_LIMIT));
      s.set(K.batchProcessLimit, n);
    }
    if (settings.superChatTiers !== undefined) {
      s.set(K.superChatTiers, superchatTiers.normalizeTiers(settings.superChatTiers));
    }

    this._updateFilterCache();

    // 接続中のオーバーレイに設定変更を即時反映
    this._broadcast({ type: 'config', data: this._buildOverlayConfig() });

    const chatSourceChanged = settings.chatSource !== undefined
      && normalizeChatSource(settings.chatSource) !== prevChatSource;
    if (chatSourceChanged && this._status.pollerRunning) {
      this.stopPoller();
      this.startPoller();
    }
  }

  /**
   * ポーラーとサーバーの現在の状態を返す。
   */
  getStatus() {
    return {
      ...this._status,
      chatSource: normalizeChatSource(this._store.get(K.chatSource, 'auto')),
      activeChatBackend: this._poller?.activeBackend || null,
    };
  }

  // ============================================================
  // メッセージフィルタリング
  // ============================================================

  _isMembershipEvent(msg) {
    const t = msg.type || '';
    return t.includes('memberMilestone') || t === 'newSponsorEvent';
  }

  _passesFilter(msg) {
    if (this._isMembershipEvent(msg)) return true;
    const f = this._filterCache;
    if (f.ngUserIds.includes(msg.author.id)) return false;
    if (f.ngWords.length > 0) {
      const lower = msg.text.toLowerCase();
      if (f.ngWords.some(w => lower.includes(w.toLowerCase()))) return false;
    }
    if (f.allowMembersOnly  && !msg.author.isMember && !msg.author.isOwner) return false;
    if (f.showSuperChatOnly && !msg.superChat) return false;
    if (f.hideBotCommands   && msg.text.startsWith(f.botCommandPrefix))    return false;
    return true;
  }

  // ============================================================
  // 参加者一覧・視聴者詳細（Phase 3）
  // ============================================================

  clearSession() {
    this._sessionUsers.clear();
    this.emit('session-changed', []);
    return { success: true };
  }

  getSessionParticipants() {
    return Array.from(this._sessionUsers.values())
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  getViewerDetail(channelId) {
    if (!channelId) return null;
    const db = this._viewerDb.getUser(channelId);
    const session = this._sessionUsers.get(channelId);
    const threshold = this._store.get(K.badgeThreshold, 10);
    const total = db?.commentCount ?? 0;
    return {
      channelId,
      name: session?.name || db?.name || '不明',
      iconUrl: session?.iconUrl || '',
      firstSeen: db?.firstSeen ?? null,
      lastSeen: db?.lastSeen ?? session?.lastSeen ?? null,
      totalComments: total,
      sessionComments: session?.sessionComments ?? 0,
      isRegular: total >= threshold,
      inSession: !!session,
    };
  }

  _trackSessionUser(msg) {
    const id = msg.author?.id;
    if (!id) return;
    let u = this._sessionUsers.get(id);
    if (!u) {
      u = {
        id,
        name: msg.author.name,
        iconUrl: msg.author.iconUrl || '',
        sessionComments: 0,
        lastSeen: 0,
      };
      this._sessionUsers.set(id, u);
    }
    u.name = msg.author.name;
    if (msg.author.iconUrl) u.iconUrl = msg.author.iconUrl;
    u.sessionComments += 1;
    u.lastSeen = Date.now();
  }

  _scheduleSessionEmit() {
    if (this._sessionEmitTimer) return;
    this._sessionEmitTimer = setTimeout(() => {
      this._sessionEmitTimer = null;
      this.emit('session-changed', this.getSessionParticipants());
    }, 250);
  }

  // ============================================================
  // NG フィルター操作
  // ============================================================

  addNgUser(channelId) {
    if (!channelId) return { success: false, error: 'channelId が空です' };
    const ids = [...this._store.get(K.ngUserIds, [])];
    if (!ids.includes(channelId)) {
      ids.push(channelId);
      this._store.set(K.ngUserIds, ids);
      this._updateFilterCache();
      this._broadcast({ type: 'config', data: this._buildOverlayConfig() });
    }
    return { success: true };
  }

  addNgWord(word) {
    const w = (word || '').trim();
    if (!w) return { success: false, error: 'NGワードが空です' };
    const words = [...this._store.get(K.ngWords, [])];
    const lower = w.toLowerCase();
    if (!words.some(x => x.toLowerCase() === lower)) {
      words.push(w);
      this._store.set(K.ngWords, words);
      this._updateFilterCache();
      this._broadcast({ type: 'config', data: this._buildOverlayConfig() });
    }
    return { success: true };
  }

  // ============================================================
  // ピン留め（Phase 2）
  // ============================================================

  getPinnedMessages() {
    return [...this._pinnedMessages];
  }

  /** @deprecated 互換用 */
  getPinnedMessage() {
    return this._pinnedMessages[0] ?? null;
  }

  _syncPinBroadcast() {
    this._broadcast({ type: 'pins', data: this._pinnedMessages });
    this.emit('pin-changed', this.getPinnedMessages());
  }

  /**
   * @param {object} msg - 正規化済みチャットメッセージ
   * @returns {{ success: boolean, error?: string }}
   */
  pinMessage(msg) {
    if (!msg?.id) {
      return { success: false, error: 'ピン留めできないメッセージです' };
    }
    const idx = this._pinnedMessages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      this._pinnedMessages.splice(idx, 1);
      this._syncPinBroadcast();
      console.log('[YT] ピン留め解除:', msg.id);
      return { success: true };
    }
    if (this._pinnedMessages.length >= MAX_PINNED) {
      this._pinnedMessages.shift();
    }
    this._pinnedMessages.push(msg);
    this._syncPinBroadcast();
    console.log('[YT] ピン留め:', msg.author?.name, msg.text?.slice(0, 40));
    return { success: true };
  }

  /**
   * @param {string} [msgId] - 指定時はその ID のみ解除。未指定は全解除
   * @returns {{ success: boolean }}
   */
  unpinMessage(msgId) {
    if (msgId) {
      const before = this._pinnedMessages.length;
      this._pinnedMessages = this._pinnedMessages.filter((m) => m.id !== msgId);
      if (before !== this._pinnedMessages.length) this._syncPinBroadcast();
      return { success: true };
    }
    if (!this._pinnedMessages.length) return { success: true };
    this._pinnedMessages = [];
    this._broadcast({ type: 'unpin' });
    this.emit('pin-changed', []);
    console.log('[YT] ピン留め全解除');
    return { success: true };
  }

  // ============================================================
  // WebSocket ブロードキャスト
  // ============================================================

  _broadcast(data) {
    const json = JSON.stringify(data);
    for (const ws of this._clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  /**
   * リハーサル用: フィルタ・WS・イベントを通すモックメッセージ
   * @param {object} msg
   */
  deliverMockMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const normalized = {
      ...msg,
      author: { ...(msg.author || {}) },
    };

    if (this._isMembershipEvent(normalized)) {
      this._broadcast({ type: 'membership', data: normalized });
      this.emit('membership-event', normalized);
      return;
    }

    // リハーサル用モックは NG リスト・スパチャのみ表示等のフィルタを適用しない
    const threshold = this._store.get(K.badgeThreshold, 10);
    if (normalized.isEmojiOnly === undefined) {
      const text = String(normalized.text || '').trim();
      normalized.isEmojiOnly = text.length > 0 && /^[\p{Extended_Pictographic}\s]+$/u.test(text);
    }
    normalized.author.isFirstTime = !!normalized.author.isFirstTime;
    normalized.author.isRegular = !!normalized.author.isRegular
      || (Number(normalized.author.commentCount) || 0) >= threshold;

    this._trackSessionUser(normalized);
    this._scheduleSessionEmit();

    this._broadcast({ type: 'message', data: normalized });
    this.emit('message', normalized);
  }

  // ============================================================
  // HTTP + WebSocket サーバー
  // ============================================================

  /**
   * HTTP + WebSocket サーバーを起動する（固定ポート）。
   * 冪等（既に起動済みなら success を返す）。
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async startServer() {
    if (this._server) {
      return { success: true };
    }

    if (!(await isPortAvailable(this._port))) {
      const err = `ポート ${this._port} は既に使用されています`;
      console.warn('[YT-HTTP]', err);
      this._updateStatus({ serverRunning: false, error: err });
      return { success: false, error: err };
    }

    this._server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/overlay') {
        staticFileCache.readUtf8(this._htmlPath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('youtube-overlay.html not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          }
        });
        return;
      }
      if (customCss.tryHandleCustomCssRoutes(url, res, this._store, staticFileCache)) return;
      res.writeHead(404);
      res.end('Not Found');
    });

    this._wss = new WebSocketServer({ server: this._server });
    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      console.log(`[YT-WS] クライアント接続 (合計: ${this._clients.size})`);

      ws.send(JSON.stringify({
        type: 'init',
        config: this._buildOverlayConfig(),
        pinned: this._pinnedMessages[0] ?? null,
        pins: this._pinnedMessages,
      }));

      ws.on('close', () => {
        this._clients.delete(ws);
        console.log(`[YT-WS] クライアント切断 (合計: ${this._clients.size})`);
      });
      ws.on('error', () => this._clients.delete(ws));
    });

    this._server.on('error', (e) => {
      console.error('[YT-HTTP] サーバーエラー:', e.message);
      this._teardownServer();
      this._updateStatus({ serverRunning: false, error: e.message });
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (e) => {
          this._server.removeListener('listening', onListening);
          reject(e);
        };
        const onListening = () => {
          this._server.removeListener('error', onError);
          resolve();
        };
        this._server.once('error', onError);
        this._server.once('listening', onListening);
        this._server.listen(this._port, '127.0.0.1');
      });
    } catch (e) {
      this._teardownServer();
      const err = e.message || String(e);
      this._updateStatus({ serverRunning: false, error: err });
      return { success: false, error: err };
    }

    console.log(`[YT-HTTP] YouTube オーバーレイ: http://127.0.0.1:${this._port}/overlay`);
    this._updateStatus({ serverRunning: true, error: null });
    return { success: true };
  }

  _teardownServer() {
    if (this._wss) {
      try { this._wss.close(); } catch (_) { /* ignore */ }
      this._wss = null;
    }
    if (this._server) {
      try { this._server.close(); } catch (_) { /* ignore */ }
      this._server = null;
    }
    this._clients.clear();
  }

  /**
   * HTTP + WebSocket サーバーを停止する。
   * ポーラーも一緒に停止する。
   */
  stopServer() {
    this.stopPoller();
    this._teardownServer();
    this._updateStatus({ serverRunning: false });
    console.log('[YT] サーバー停止');
  }

  // ============================================================
  // YouTubeポーラー
  // ============================================================

  /**
   * YouTube チャットポーリングを開始する。
   * videoId が未設定の場合はエラーを返す（API キーは任意）。
   * @returns {{ success: boolean, error?: string }}
   */
  startPoller() {
    this.stopPoller();
    this._sessionUsers.clear();
    this.emit('session-changed', []);

    const cfg = this._buildOverlayConfig();
    const { videoId, apiKey } = cfg.youtube;

    if (!videoId) {
      const err = 'videoId が未設定です。ダッシュボードで入力してください。';
      console.warn('[YT-Poller]', err);
      this._updateStatus({ pollerRunning: false, error: err });
      return { success: false, error: err };
    }

    const batchLimit = Math.max(
      1,
      Math.min(200, Number(this._store.get(K.batchProcessLimit, DEFAULT_BATCH_PROCESS_LIMIT)) || DEFAULT_BATCH_PROCESS_LIMIT),
    );

    this._poller = new YouTubeChatPoller(cfg.youtube, (messages) => {
      const filtered = messages.filter((m) => this._passesFilter(m));
      const toProcess = filtered.length > batchLimit
        ? filtered.slice(-batchLimit)
        : filtered;
      const threshold = this._store.get(K.badgeThreshold, 10);
      let sessionUpdated = false;
      for (const msg of toProcess) {
        if (this._isMembershipEvent(msg)) {
          this._broadcast({ type: 'membership', data: msg });
          this.emit('membership-event', msg);
          continue;
        }

        const stats = this._viewerDb.trackUser(msg.author.id, msg.author.name);
        msg.author.isFirstTime = stats.isFirstTime;
        msg.author.commentCount = stats.commentCount;
        msg.author.isRegular = stats.commentCount >= threshold;

        this._trackSessionUser(msg);
        sessionUpdated = true;

        this._broadcast({ type: 'message', data: msg });
        this.emit('message', msg);
      }
      if (sessionUpdated) this._scheduleSessionEmit();
    });

    this._poller.start()
      .then(() => {
        console.log('[YT-Poller] ポーリング開始');
        this._updateStatus({ pollerRunning: true, error: null });
      })
      .catch((e) => {
        console.error('[YT-Poller] 起動エラー:', e.message);
        this._updateStatus({ pollerRunning: false, error: e.message });
      });

    // 楽観的に running 状態を反映（実際の結果は .then/.catch で更新）
    this._updateStatus({ pollerRunning: true, error: null });
    return { success: true };
  }

  /**
   * YouTube チャットポーリングを停止する。
   */
  stopPoller() {
    if (this._poller) {
      this._poller.stop();
      this._poller = null;
      this._updateStatus({ pollerRunning: false });
      console.log('[YT-Poller] ポーリング停止');
    }
  }

  // ============================================================
  // 内部ヘルパー
  // ============================================================

  _updateStatus(updates) {
    this._status = { ...this._status, ...updates };
    this.emit('status-changed', this.getStatus());
  }
}

module.exports = YouTubeChatManager;
