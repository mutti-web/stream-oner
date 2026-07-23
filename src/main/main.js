/**
 * main.js - Electronメインプロセス
 *
 * 追加機能:
 * - ローカルHTTPサーバー（port 3000）: OBSブラウザソース用HTMLを配信
 * - WebSocketサーバー（port 3001）: RPCイベントをブラウザにリアルタイム転送
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeImage, screen, dialog, shell, safeStorage, nativeTheme,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

/** パッケージ済みビルドでは DevTools を開かない */
const IS_DEV = process.env.NODE_ENV === 'development'
  || (process.env.NODE_ENV !== 'production' && !app.isPackaged);
const OVERLAY_HTML  = path.join(__dirname, '../renderer/overlay.html');
const SETTINGS_HTML = path.join(__dirname, '../renderer/settings.html');
const DASHBOARD_HTML = path.join(__dirname, '../renderer/dashboard.html');
const OBS_HTML      = path.join(__dirname, '../renderer/obs-overlay.html');
const SUITE_COMBINED_HTML = path.join(__dirname, '../renderer/suite-combined-overlay.html');
const REHEARSAL_HTML = path.join(__dirname, '../renderer/rehearsal-preview.html');
const DISCORD_CSS   = path.join(__dirname, '../renderer/discord-overlay.css');
const ICON_PATH     = path.join(__dirname, '../../assets/tray-icon.png');

const lazy = require('./lazy-modules');
const { APP_DISPLAY_NAME, SUITE_UI_WINDOW_OPTS, configureApplicationMenu } = require('./app-chrome');
const { installProcessGuards } = require('./process-guards');
const { SimpleStore, adoptLegacyUserDataIfNeeded } = require('./simple-store');
const suitePorts = require('./suite-ports');
const { isPortAvailable } = require('./port-utils');
const staticFileCache = require('./static-file-cache');
const suiteLayout = require('./suite-layout');
const customCss = require('./custom-css');
const BroadcastTimer = require('./broadcast-timer');
const { resolveLanIPv4, listLanIPv4Candidates } = require('./remote-lan-utils');
const settingsExport = require('./settings-export');
const suitePresets = require('./suite-presets');
const {
  clampDashboardChatLimit,
  clampDashboardScLimit,
} = require('./suite-feature-limits');
const obsEventDispatcher = require('./obs-event-dispatcher');
const RehearsalMockFeed = require('./rehearsal-mock-feed');
const { SessionLogManager } = require('./session-log-manager');

const YT_OVERLAY_HTML     = path.join(__dirname, '../renderer/youtube-overlay.html');
const AVATAR_OVERLAY_HTML = path.join(__dirname, '../renderer/avatar-overlay.html');
const AVATAR_PREVIEW_HTML  = path.join(__dirname, '../renderer/avatar-preview.html');

/** OBS オーバーレイポート（settings で上書き可・再起動後に反映） */
adoptLegacyUserDataIfNeeded();
installProcessGuards(APP_DISPLAY_NAME);
const store = new SimpleStore();
let activePorts = suitePorts.getSuitePorts(store);

const SUITE_K = {
  discordEnabled: 'suite.discordEnabled',
  youtubeEnabled: 'suite.youtubeEnabled',
  avatarEnabled: 'avatar.enabled',
  /** false のとき起動時にデスクトップ用 Discord 透過ウィンドウを作らない（OBS のみ運用向け） */
  desktopOverlayEnabled: 'suite.desktopOverlayEnabled',
  dashboardChatLimit: 'suite.dashboardChatLimit',
  dashboardScLimit: 'suite.dashboardScLimit',
};

const REMOTE_K = {
  enabled: 'remote.enabled',
  port: 'remote.port',
  sessionTtlHours: 'remote.sessionTtlHours',
  maxSessions: 'remote.maxSessions',
  maxWsPerSession: 'remote.maxWsPerSession',
  bindHost: 'remote.bindHost',
  lanPreferredAddress: 'remote.lanPreferredAddress',
};

function isDiscordFeatureEnabled() {
  return store.get(SUITE_K.discordEnabled, true) !== false;
}

function isYoutubeFeatureEnabled() {
  return store.get(SUITE_K.youtubeEnabled, true) !== false;
}

function isDesktopOverlayStartupEnabled() {
  return store.get(SUITE_K.desktopOverlayEnabled, true) !== false;
}

// ============================================================
// グローバル変数
// ============================================================

let overlayWindow   = null;
let settingsWindow  = null;
let dashboardWindow = null;
let rehearsalWindow = null;
/** @type {RehearsalMockFeed | null} */
let rehearsalMockFeed = null;
/** @type {ObsService | null} */
let obsService = null;
/** @type {BroadcastTimer | null} */
let broadcastTimer = null;
/** @type {RemoteEventHub | null} */
let remoteHub = null;
/** @type {RemoteSessionStore | null} */
let remoteSessionStore = null;
/** @type {RemoteDashboardServer | null} */
let remoteServer = null;
let ytPollerWasRunning = false;
let tray            = null;
let rpcManager      = null;
let httpServer      = null;
let wsServer       = null;
let ytManager      = null;
let avatarManager  = null;
let avatarPreviewWindow = null;
/** @type {SessionLogManager | null} */
let sessionLogManager = null;
/** @type {ReturnType<import('./youtube-oauth-manager').createYoutubeOAuthManager> | null} */
let ytOAuthManager = null;
/** @type {ReturnType<import('./youtube-live-resolver').createYoutubeLiveResolver> | null} */
let ytLiveResolver = null;
/** @type {ReturnType<import('./youtube-chat-start-coordinator').createYoutubeChatStartCoordinator> | null} */
let ytChatStartCoordinator = null;

let obsBridgeAttached = false;
let rpcBridgeAttached = false;
let ytBridgeAttached = false;
let avatarBridgeAttached = false;
let remoteCoreReady = false;

let isClickThrough   = false;
let isPositionLocked = false;

/** トレイ関連（互換のためキー名は残すが、ダブルクリックは常にダッシュボード） */
const THEME_PREF_STORE_KEY = 'ui.themePreference';
const THEME_PREFS = new Set(['system', 'light', 'dark']);
const ACCENT_PREF_STORE_KEY = 'ui.accentPreset';
const ACCENT_PREFS = new Set(['default', 'neutral', 'green', 'yellow', 'red', 'pink']);

function applyNativeTheme(pref) {
  const p = THEME_PREFS.has(pref) ? pref : 'system';
  nativeTheme.themeSource = p;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win =
      (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow) ||
      (dashboardWindow && !dashboardWindow.isDestroyed() && dashboardWindow) ||
      (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow) ||
      null;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createSettingsWindow();
    }
  });
}

/** @type {Set<Object>} 接続中のWebSocketクライアント */
const wsClients = new Set();

/** Discord speaking-update の WS 配信スロットル（ms） */
const SPEAKING_WS_THROTTLE_MS = 100;
const WS_HEARTBEAT_MS = 30_000;
let wsHeartbeatTimer = null;

function startWsHeartbeat() {
  if (wsHeartbeatTimer) return;
  wsHeartbeatTimer = setInterval(() => {
    wsClients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        wsClients.delete(ws);
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* ignore */ }
    });
  }, WS_HEARTBEAT_MS);
  if (typeof wsHeartbeatTimer.unref === 'function') wsHeartbeatTimer.unref();
}

function stopWsHeartbeat() {
  if (wsHeartbeatTimer) {
    clearInterval(wsHeartbeatTimer);
    wsHeartbeatTimer = null;
  }
}
const speakingWsLastSent = new Map();

/** Discord OBS サーバー状態（ポート競合検知用） */
const discordServerStatus = {
  http: { ok: null, error: null },
  ws:   { ok: null, error: null },
};

// ============================================================
// 遅延ロード（lazy-modules 経由）
// ============================================================

function ensureObsService() {
  if (!obsService) {
    const ObsService = lazy.getObsServiceClass();
    obsService = new ObsService(store, () => avatarManager);
    if (!obsBridgeAttached) {
      attachObsBridge(obsService);
      obsBridgeAttached = true;
    }
  }
  return obsService;
}

function ensureRpcManager() {
  if (!rpcManager) {
    const DiscordRPCManager = lazy.getDiscordRPCManagerClass();
    const clientId = store.get('clientId', '');
    const clientSecret = store.getSecret('clientSecret', '');
    rpcManager = new DiscordRPCManager(
      clientId,
      clientSecret,
      lazy.getCreateOAuthSession()(store),
    );
    if (!rpcBridgeAttached) {
      setupRpcBridge();
      rpcBridgeAttached = true;
    }
  }
  return rpcManager;
}

function ensureYtManager() {
  if (!ytManager) {
    const YouTubeChatManager = lazy.getYouTubeChatManagerClass();
    ytManager = new YouTubeChatManager(activePorts.youtube, YT_OVERLAY_HTML, store);
    if (!ytBridgeAttached) {
      setupYtBridge();
      ytBridgeAttached = true;
    }
  }
  return ytManager;
}

function ensureYtOAuthManager() {
  if (!ytOAuthManager) {
    // lazy loader は create 関数そのものを返す（Discord OAuth と同じ）
    const createYoutubeOAuthManager = lazy.getCreateYoutubeOAuthManager();
    ytOAuthManager = createYoutubeOAuthManager({
      store,
      appRoot: path.join(__dirname, '../..'),
      userDataPath: app.getPath('userData'),
      openExternal: (url) => shell.openExternal(url),
      onStatusChanged: () => broadcastYoutubeOAuthChanged(),
    });
  }
  return ytOAuthManager;
}

function ensureYtLiveResolver() {
  if (!ytLiveResolver) {
    const createYoutubeLiveResolver = lazy.getCreateYoutubeLiveResolver();
    const oauth = ensureYtOAuthManager();
    ytLiveResolver = createYoutubeLiveResolver({
      getAccessToken: () => oauth.getValidAccessToken(),
      getApiKey: () => oauth.getConfig().apiKey,
    });
  }
  return ytLiveResolver;
}

function ensureYtChatStartCoordinator() {
  if (!ytChatStartCoordinator) {
    const createYoutubeChatStartCoordinator = lazy.getCreateYoutubeChatStartCoordinator();
    ytChatStartCoordinator = createYoutubeChatStartCoordinator({
      getStore: () => store,
      getOAuthManager: () => ensureYtOAuthManager(),
      getLiveResolver: () => ensureYtLiveResolver(),
      getYtManager: () => ytManager,
      getBroadcastTimer: () => broadcastTimer,
      broadcastYtConfigChanged: () => broadcastYtConfigChanged(),
    });
  }
  return ytChatStartCoordinator;
}

function ensureAvatarManager() {
  if (!avatarManager) {
    const AvatarManager = lazy.getAvatarManagerClass();
    avatarManager = new AvatarManager(activePorts.avatar, AVATAR_OVERLAY_HTML, store, AVATAR_PREVIEW_HTML);
    if (!avatarBridgeAttached) {
      setupAvatarBridge();
      avatarBridgeAttached = true;
    }
  }
  return avatarManager;
}

function ensureRemoteCore() {
  if (remoteCoreReady) return;
  const RemoteEventHub = lazy.getRemoteEventHubClass();
  remoteHub = new RemoteEventHub();
  remoteHub.setDashboardSender((channel, data) => {
    sendToDashboardWindowOnly(channel, data);
  });

  const RemoteSessionStore = lazy.getRemoteSessionStoreClass();
  remoteSessionStore = new RemoteSessionStore(store, {
    sessionTtlHours: getRemoteConfig().sessionTtlHours,
    maxSessions: getRemoteConfig().maxSessions,
    maxWsPerSession: getRemoteConfig().maxWsPerSession,
    onSessionsChanged: () => {
      const list = remoteSessionStore?.listSessions() ?? [];
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('remote-sessions-changed', list);
      }
    },
  });
  remoteCoreReady = true;
}

function ensureRemoteServer() {
  ensureRemoteCore();
  if (!remoteServer) {
    const RemoteDashboardApi = lazy.getRemoteDashboardApiClass();
    const RemoteDashboardServer = lazy.getRemoteDashboardServerClass();
    const api = new RemoteDashboardApi(() => ({
      store,
      hub: remoteHub,
      obsService,
      ytManager,
      avatarManager,
      broadcastTimer,
      rpcManager,
      getSuiteFeaturesSnapshot,
      getSessionLogManager: () => ensureSessionLogManager(),
      SUITE_K,
      applySuiteFeatureFlags,
      broadcastSuiteFeaturesChanged,
      broadcastYtConfigChanged,
      getYoutubeChatStartCoordinator: () => ensureYtChatStartCoordinator(),
      getOAuthManager: () => ensureYtOAuthManager(),
    }));
    remoteServer = new RemoteDashboardServer({
      store,
      api,
      sessionStore: remoteSessionStore,
      hub: remoteHub,
      getConfig: getRemoteConfig,
    });
  }
  return remoteServer;
}

// ============================================================
// WebSocketサーバー（OBS用）
// ============================================================

/**
 * WebSocketサーバー（wsライブラリ使用）
 */
function showPortConflictDialog(lines) {
  if (!lines.length) return;
  dialog.showMessageBox({
    type: 'warning',
    title: 'ポート競合',
    message: '設定したポートが既に使用されているため、一部の OBS 連携を開始できませんでした。',
    detail: suitePorts.formatPortConflictDetail(lines, activePorts),
    buttons: ['OK'],
  });
}

function startWebSocketServer(port) {
  if (wsServer) return;

  wsServer = new WebSocketServer({ port, host: '127.0.0.1' });

  wsServer.on('error', (e) => {
    console.error('[WS] サーバーエラー:', e.message);
    discordServerStatus.ws = { ok: false, error: e.message };
    try { wsServer?.close(); } catch (_) { /* ignore */ }
    wsServer = null;
    updateTrayMenu();
  });

  wsServer.on('listening', () => {
    console.log(`[WS] WebSocketサーバー起動: ws://127.0.0.1:${port}`);
    discordServerStatus.ws = { ok: true, error: null };
    startWsHeartbeat();
    updateTrayMenu();
  });

  wsServer.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    wsClients.add(ws);
    console.log(`[WS] クライアント接続 (合計: ${wsClients.size})`);

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`[WS] クライアント切断 (合計: ${wsClients.size})`);
    });

    ws.on('error', () => wsClients.delete(ws));

    // 接続直後に現在の状態を送信
    const status = isDiscordFeatureEnabled()
      ? (rpcManager?.getStatus() ?? { connected: false, state: 'disconnected' })
      : { connected: false, state: 'disconnected' };
    const users = isDiscordFeatureEnabled() ? (rpcManager?.getVoiceUsers() ?? []) : [];
    ws.send(JSON.stringify({ type: 'init', status, users }));
  });
}

/**
 * 全WebSocketクライアントにブロードキャストする
 * @param {Object} data
 */
function wsBroadcast(data) {
  if (data?.type === 'speaking-update' && data.data?.userId != null) {
    const uid = data.data.userId;
    const now = Date.now();
    const last = speakingWsLastSent.get(uid) || 0;
    if (now - last < SPEAKING_WS_THROTTLE_MS) return;
    speakingWsLastSent.set(uid, now);
  }
  const json = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === 1 /* ws.OPEN */) {
      ws.send(json);
    }
  });
}

// ============================================================
// HTTPサーバー（OBSブラウザソース用HTML配信）
// ============================================================

function readHttpJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function notifySuiteLayoutChanged() {
  const layout = suiteLayout.getLayout(store);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('suite-layout-changed', layout);
  }
  broadcastSuiteFeaturesChanged();
}

function startHttpServer(port) {
  if (httpServer) return;

  httpServer = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];

    if (url === '/' || url === '/overlay') {
      staticFileCache.readUtf8(OBS_HTML, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('obs-overlay.html not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }

    if (url === '/suite' || url === '/rehearsal') {
      const htmlPath = url === '/rehearsal' ? REHEARSAL_HTML : SUITE_COMBINED_HTML;
      staticFileCache.readUtf8(htmlPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('overlay html not found');
        } else {
          const isRehearsal = url === '/rehearsal';
          const html = suiteLayout.injectLayoutIntoHtml(
            data,
            suiteLayout.getLayout(store),
            { rehearsal: isRehearsal },
          );
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          });
          res.end(html);
        }
      });
      return;
    }

    if (url === '/rehearsal-preview.js') {
      staticFileCache.readUtf8(path.join(__dirname, '../renderer/rehearsal-preview.js'), (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(data);
        }
      });
      return;
    }

    if (url === '/rehearsal/layout' && req.method === 'GET') {
      const layout = suiteLayout.getLayout(store);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(layout));
      return;
    }

    if (url === '/rehearsal/layout' && req.method === 'POST') {
      readHttpJsonBody(req).then((body) => {
        const panel = String(body.panel || '');
        const patch = body.layout;
        if (!['discord', 'youtube', 'avatar'].includes(panel) || !patch || typeof patch !== 'object') {
          res.writeHead(400);
          res.end('invalid panel');
          return;
        }
        const current = suiteLayout.getLayout(store);
        current[panel] = suiteLayout.normalizeLayout({ [panel]: patch })[panel];
        suiteLayout.saveLayout(store, current);
        notifySuiteLayoutChanged();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }).catch(() => {
        res.writeHead(400);
        res.end('bad json');
      });
      return;
    }

    if (url === '/rehearsal/focus' && req.method === 'POST') {
      readHttpJsonBody(req).then((body) => {
        const panel = String(body.panel || '');
        const map = { discord: 'suite-layout-discord', youtube: 'suite-layout-youtube', avatar: 'suite-layout-avatar' };
        createSettingsWindow({
          tab: 'overlay',
          messages: [{
            channel: 'focus-suite-layout-panel',
            data: { panel, sectionId: map[panel] },
          }],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }).catch(() => {
        res.writeHead(400);
        res.end('bad json');
      });
      return;
    }

    if (url === '/suite-flags') {
      const flags = getSuiteFeaturesSnapshot();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      res.end(JSON.stringify(flags));
      return;
    }

    if (url === '/discord-overlay.css') {
      staticFileCache.readUtf8(DISCORD_CSS, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('discord-overlay.css not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }

    if (customCss.tryHandleCustomCssRoutes(url, res, store, staticFileCache)) return;

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.on('error', (e) => {
    console.error('[HTTP] サーバーエラー:', e.message);
    discordServerStatus.http = { ok: false, error: e.message };
    httpServer = null;
    updateTrayMenu();
  });

  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`[HTTP] OBSオーバーレイ配信: http://127.0.0.1:${port}/overlay`);
    discordServerStatus.http = { ok: true, error: null };
    updateTrayMenu();
  });
}

// ============================================================
// オーバーレイウィンドウ
// ============================================================

function createOverlayWindow() {
  const savedBounds = store.get('overlayBounds', { x: 20, y: 20, width: 340, height: 500 });

  overlayWindow = new BrowserWindow({
    ...savedBounds,
    minWidth: 200, minHeight: 100,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  overlayWindow.loadFile(OVERLAY_HTML);

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
    if (IS_DEV) overlayWindow.webContents.openDevTools({ mode: 'detach' });
  });

  const saveBounds = () => {
    if (overlayWindow && !overlayWindow.isDestroyed())
      store.set('overlayBounds', overlayWindow.getBounds());
  };
  overlayWindow.on('moved',   saveBounds);
  overlayWindow.on('resized', saveBounds);

  overlayWindow.on('close',  (e) => { e.preventDefault(); overlayWindow.hide(); });
  overlayWindow.on('closed', ()  => { overlayWindow = null; });

  console.log('[Main] オーバーレイウィンドウ作成完了');
}

/** 設定で無効化したときなど、透過ウィンドウを確実に破棄する */
function destroyOverlayWindow() {
  const w = overlayWindow;
  if (!w || w.isDestroyed()) return;
  try {
    w.removeAllListeners('close');
    w.destroy();
  } catch (e) {
    console.warn('[Main] オーバーレイ破棄:', e.message);
  }
  overlayWindow = null;
}

/** ストアの `suite.desktopOverlayEnabled` に合わせてウィンドウを作成 or 破棄 */
function applyDesktopOverlayFromStore() {
  if (!isDesktopOverlayStartupEnabled()) {
    destroyOverlayWindow();
    return;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) return;
  createOverlayWindow();
  const ct = store.get('isClickThrough', false);
  const pl = store.get('isPositionLocked', false);
  if (ct) overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  if (pl) {
    overlayWindow.setMovable(false);
    overlayWindow.setResizable(false);
  }
}

// ============================================================
// ダッシュボードウィンドウ
// ============================================================

function updateObsDashboardPolling() {
  let visible = false;
  try {
    visible = !!(dashboardWindow && !dashboardWindow.isDestroyed()
      && dashboardWindow.isVisible() && !dashboardWindow.isMinimized());
  } catch (_) {
    visible = false;
  }
  if (!visible) {
    obsService?.stopDashboardPolling();
    return;
  }
  const svc = ensureObsService();
  svc.startDashboardPolling(true);
  svc.connect().catch(() => {});
}

function wireObsDashboardLifecycle(win) {
  const tick = () => updateObsDashboardPolling();
  win.on('show', tick);
  win.on('hide', tick);
  win.on('minimize', tick);
  win.on('restore', tick);
  win.on('focus', tick);
  win.webContents.on('did-finish-load', tick);
  win.on('closed', () => {
    obsService?.stopDashboardPolling();
    dashboardWindow = null;
  });
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    updateObsDashboardPolling();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 900, height: 700,
    title: `${APP_DISPLAY_NAME} - ダッシュボード`,
    frame: true, transparent: false, alwaysOnTop: false, resizable: true,
    ...SUITE_UI_WINDOW_OPTS,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  dashboardWindow.loadFile(DASHBOARD_HTML);
  wireObsDashboardLifecycle(dashboardWindow);
}

// ============================================================
// 設定ウィンドウ
// ============================================================

function flushSettingsRendererMessages(opts = {}) {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  const messages = Array.isArray(opts.messages) ? opts.messages : [];
  const deliver = () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    if (opts.tab) settingsWindow.webContents.send('navigate-settings-tab', opts.tab);
    const sendMessages = () => {
      if (!settingsWindow || settingsWindow.isDestroyed()) return;
      for (const msg of messages) {
        if (msg?.channel) settingsWindow.webContents.send(msg.channel, msg.data);
      }
    };
    if (opts.tab && messages.length) setTimeout(sendMessages, 180);
    else sendMessages();
  };
  const wc = settingsWindow.webContents;
  if (wc.isLoadingMainFrame()) wc.once('did-finish-load', deliver);
  else deliver();
}

function createSettingsWindow(opts = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    flushSettingsRendererMessages(opts);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600, height: 820,
    title: `設定 - ${APP_DISPLAY_NAME}`,
    frame: true, transparent: false, alwaysOnTop: false, resizable: true,
    ...SUITE_UI_WINDOW_OPTS,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  settingsWindow.loadFile(SETTINGS_HTML);
  settingsWindow.webContents.once('did-finish-load', () => {
    flushSettingsRendererMessages(opts);
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function stopRehearsalMockFeed() {
  if (rehearsalMockFeed) {
    rehearsalMockFeed.stop();
    rehearsalMockFeed = null;
  }
}

async function startRehearsalPreviewServices() {
  stopRehearsalMockFeed();
  ensureYtManager();
  const ytStarted = await ytManager.startServer();
  if (!ytStarted?.success) {
    return { success: false, error: ytStarted?.error || 'YouTube オーバーレイサーバーを起動できません' };
  }
  rehearsalMockFeed = new RehearsalMockFeed(ytManager);
  rehearsalMockFeed.start();
  const av = ensureAvatarManager();
  await av.startServer().catch((e) => {
    console.warn('[Rehearsal] アバターサーバー起動:', e?.message || e);
  });
  return { success: true };
}

function fitRehearsalWindowZoom(win) {
  if (!win || win.isDestroyed()) return;
  const [cw, ch] = win.getContentSize();
  const zoom = Math.min(cw / 1920, ch / 1080);
  if (zoom > 0 && Number.isFinite(zoom)) {
    win.webContents.setZoomFactor(zoom);
  }
}

function wireRehearsalWindowChrome(win) {
  const refit = () => fitRehearsalWindowZoom(win);
  win.webContents.on('did-finish-load', refit);
  win.on('resize', refit);
}

function createRehearsalPreviewWindow() {
  return startRehearsalPreviewServices().then((prep) => {
    if (!prep.success) return prep;

    const loadRehearsal = () => {
      if (!rehearsalWindow || rehearsalWindow.isDestroyed()) return;
      rehearsalWindow.loadURL(`http://127.0.0.1:${activePorts.discordHttp}/rehearsal?ts=${Date.now()}`);
    };

    if (rehearsalWindow && !rehearsalWindow.isDestroyed()) {
      rehearsalWindow.focus();
      loadRehearsal();
      return { success: true };
    }

    rehearsalWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      title: `リハーサルプレビュー — ${APP_DISPLAY_NAME}`,
      frame: true,
      resizable: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    wireRehearsalWindowChrome(rehearsalWindow);
    loadRehearsal();
    rehearsalWindow.on('closed', () => {
      rehearsalWindow = null;
      stopRehearsalMockFeed();
    });
    return { success: true };
  });
}

function createAvatarPreviewWindow() {
  if (avatarPreviewWindow && !avatarPreviewWindow.isDestroyed()) {
    avatarPreviewWindow.focus();
    return { success: true };
  }
  const st = avatarManager?.getStatus();
  if (!st?.serverRunning) {
    return { success: false, error: 'アバターサーバーが起動していません（ポート3003）' };
  }
  avatarPreviewWindow = new BrowserWindow({
    width: 960,
    height: 520,
    title: 'アバタープレビュー',
    frame: true,
    resizable: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  avatarPreviewWindow.loadURL(`http://127.0.0.1:${activePorts.avatar}/preview`);
  avatarPreviewWindow.on('closed', () => { avatarPreviewWindow = null; });
  return { success: true };
}

// ============================================================
// タスクトレイ
// ============================================================

function refreshTrayToolTip() {
  if (!tray) return;
  tray.setToolTip(`${APP_DISPLAY_NAME}\nダブルクリック: ダッシュボードを開く`);
}

function handleTrayDoubleClick() {
  createDashboardWindow();
}

function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  refreshTrayToolTip();
  updateTrayMenu();
  tray.on('double-click', handleTrayDoubleClick);
}

function getPortWarningMenuItems() {
  const items = [];
  if (discordServerStatus.http.ok === false) {
    items.push({
      label: `注意: ポート ${activePorts.discordHttp} 使用中 (Discord OBS)`,
      enabled: false,
    });
  }
  if (discordServerStatus.ws.ok === false) {
    items.push({
      label: `注意: ポート ${activePorts.discordWs} 使用中 (Discord WS)`,
      enabled: false,
    });
  }
  const ytSt = ytManager?.getStatus();
  if (ytSt && !ytSt.serverRunning && ytSt.error) {
    items.push({
      label: `注意: ポート ${activePorts.youtube} — ${ytSt.error}`,
      enabled: false,
    });
  }
  const avSt = avatarManager?.getStatus();
  if (avSt && !avSt.serverRunning && avSt.error) {
    items.push({
      label: `注意: ポート ${activePorts.avatar} — ${avSt.error}`,
      enabled: false,
    });
  }
  if (items.length) items.push({ type: 'separator' });
  return items;
}

function copyTrayUrlToClipboard(url, tooltipMessage) {
  const { clipboard } = require('electron');
  clipboard.writeText(url);
  tray.setToolTip(tooltipMessage || 'URLをコピーしました！');
  setTimeout(() => refreshTrayToolTip(), 2000);
}

function buildObsUrlSubmenu() {
  return [
    {
      label: '統合 URL（推奨）',
      click: () => copyTrayUrlToClipboard(`http://127.0.0.1:${activePorts.discordHttp}/suite`, '統合 URL をコピーしました！'),
    },
    { type: 'separator' },
    {
      label: 'Discord 個別',
      click: () => copyTrayUrlToClipboard(`http://127.0.0.1:${activePorts.discordHttp}/overlay`),
    },
    {
      label: 'YouTube 個別',
      click: () => copyTrayUrlToClipboard(`http://127.0.0.1:${activePorts.youtube}/overlay`),
    },
    {
      label: 'アバター 個別',
      click: () => copyTrayUrlToClipboard(`http://127.0.0.1:${activePorts.avatar}/overlay`),
    },
  ];
}

function buildDesktopOverlaySubmenu() {
  const overlayVisible = !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
  return [
    {
      label: overlayVisible ? '隠す' : '表示',
      click: toggleOverlayVisibility,
    },
    {
      label: isClickThrough ? 'クリック透過: ON' : 'クリック透過: OFF',
      click: toggleClickThrough,
    },
    {
      label: isPositionLocked ? '位置ロック: ON' : '位置ロック: OFF',
      click: togglePositionLock,
    },
  ];
}

async function trayToggleYtPoller() {
  ensureYtManager();
  const running = !!ytManager?.getStatus()?.pollerRunning;
  if (running) {
    ytManager.stopPoller();
    updateTrayMenu();
    return;
  }
  try {
    const coord = ensureYtChatStartCoordinator();
    const prep = await coord.prepareStart();
    if (prep.step === 'start_manual' && prep.videoId) {
      await coord.confirmStart(prep.videoId);
      updateTrayMenu();
      return;
    }
    if (prep.step === 'confirm_single' && prep.broadcast?.videoId) {
      const { dialog } = require('electron');
      const title = prep.broadcast.title || prep.broadcast.videoId;
      const res = await dialog.showMessageBox({
        type: 'question',
        buttons: ['開始', 'キャンセル'],
        defaultId: 0,
        cancelId: 1,
        title: 'チャット取得',
        message: 'この配信のチャットを取得しますか？',
        detail: title,
      });
      if (res.response === 0) {
        await coord.confirmStart(prep.broadcast.videoId);
      }
      updateTrayMenu();
      return;
    }
    // 確認 UI が必要な場合はダッシュボードへ
    createDashboardWindow();
  } catch (e) {
    console.warn('[Tray] チャット取得開始失敗:', e.message);
    createDashboardWindow();
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const ytSt = ytManager?.getStatus() ?? { pollerRunning: false };
  const ytRunning = !!ytSt.pollerRunning;
  const discordOn = isDiscordFeatureEnabled();

  tray.setContextMenu(Menu.buildFromTemplate([
    ...getPortWarningMenuItems(),
    { label: APP_DISPLAY_NAME, enabled: false },
    { label: 'ダブルクリック: ダッシュボードを開く', enabled: false },
    { type: 'separator' },
    { label: 'ダッシュボード', click: createDashboardWindow },
    { label: '設定', click: () => createSettingsWindow() },
    { label: 'リハーサル', click: () => { createRehearsalPreviewWindow().catch(() => {}); } },
    { type: 'separator' },
    {
      label: ytRunning ? 'チャット取得を停止' : 'チャット取得を開始',
      click: () => { trayToggleYtPoller(); },
    },
    {
      label: 'OBS URL をコピー',
      submenu: buildObsUrlSubmenu(),
    },
    { type: 'separator' },
    {
      label: 'デスクトップ透過',
      submenu: buildDesktopOverlaySubmenu(),
      visible: discordOn,
    },
    {
      label: 'Discord RPC を再接続',
      click: () => { if (discordOn) ensureRpcManager().reconnect(); },
      visible: discordOn,
    },
    { type: 'separator' },
    { label: '終了', click: () => app.exit(0) },
  ]));
}

function toggleOverlayVisibility() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.show();
    updateTrayMenu();
    return;
  }
  overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
  updateTrayMenu();
}

function toggleClickThrough() {
  isClickThrough = !isClickThrough;
  overlayWindow?.setIgnoreMouseEvents(isClickThrough, { forward: true });
  overlayWindow?.webContents.send('click-through-changed', isClickThrough);
  updateTrayMenu();
  store.set('isClickThrough', isClickThrough);
}

function togglePositionLock() {
  isPositionLocked = !isPositionLocked;
  overlayWindow?.setMovable(!isPositionLocked);
  overlayWindow?.setResizable(!isPositionLocked);
  overlayWindow?.webContents.send('position-lock-changed', isPositionLocked);
  updateTrayMenu();
  store.set('isPositionLocked', isPositionLocked);
}

// ============================================================
// IPCハンドラー
// ============================================================

async function applySuiteFeatureFlags() {
  if (!isDiscordFeatureEnabled()) {
    rpcManager?.disconnect();
    wsBroadcast({
      type: 'init',
      status: { connected: false, state: 'disconnected' },
      users: [],
    });
    broadcastToOverlay('rpc-status-changed', { connected: false, state: 'disconnected' });
  } else {
    const clientId = store.get('clientId', '');
    const clientSecret = store.getSecret('clientSecret', '');
    if (clientId && clientSecret) {
      try {
        await ensureRpcManager().connect();
      } catch (e) {
        console.warn('[Main] Discord RPC 再接続失敗:', e.message);
      }
    }
  }

  if (!isYoutubeFeatureEnabled()) {
    ytManager?.stopPoller();
  } else {
    const ytVideoId = store.get('yt.videoId', '');
    if (ytVideoId) {
      ytManager?.startPoller();
    }
  }

  if (avatarManager) {
    await avatarManager.applyEnabledState();
    if (avatarManager._server) {
      avatarManager._broadcast(avatarManager._buildOverlayInit());
    }
  } else if (store.get('avatar.enabled', false)) {
    const av = ensureAvatarManager();
    await av.applyEnabledState();
  }

  updateTrayMenu();
}

/** 設定・ダッシュボードで共有する配信表示フラグのスナップショット */
function getSuiteFeaturesSnapshot() {
  return {
    discordEnabled: isDiscordFeatureEnabled(),
    youtubeEnabled: isYoutubeFeatureEnabled(),
    avatarEnabled: !!store.get('avatar.enabled', false),
    desktopOverlayEnabled: isDesktopOverlayStartupEnabled(),
    dashboardChatLimit: clampDashboardChatLimit(store.get(SUITE_K.dashboardChatLimit, 500)),
    dashboardScLimit: clampDashboardScLimit(store.get(SUITE_K.dashboardScLimit, 50)),
  };
}

function broadcastSuiteFeaturesChanged() {
  const payload = getSuiteFeaturesSnapshot();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('suite-features-changed', payload);
  }
  broadcastToDashboard('suite-features-changed', payload);
}

function broadcastThemePreferenceChanged() {
  const pref = store.get(THEME_PREF_STORE_KEY, 'system');
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('theme-preference-changed', pref);
  }
  broadcastToDashboard('theme-preference-changed', pref);
}

function broadcastAccentPreferenceChanged() {
  const accent = store.get(ACCENT_PREF_STORE_KEY, 'default');
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('accent-preference-changed', accent);
  }
  broadcastToDashboard('accent-preference-changed', accent);
}

function broadcastYtConfigChanged() {
  const cfg = {
    ...(ytManager?.getConfig() ?? {}),
    ...(sessionLogManager?.getConfig() ?? ensureSessionLogManager().getConfig()),
  };
  if (!ytManager) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('yt-config-changed', cfg);
  }
  broadcastToDashboard('yt-config-changed', cfg);
}

function broadcastYoutubeOAuthChanged() {
  const status = ensureYtOAuthManager().getStatus();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('yt-oauth-changed', status);
  }
  broadcastToDashboard('yt-oauth-changed', status);
}

function broadcastTimerStateChanged() {
  const state = broadcastTimer?.getState();
  if (!state) return;
  broadcastToDashboard('broadcast-timer-changed', state);
}

function ensureSessionLogManager() {
  if (!sessionLogManager) {
    sessionLogManager = new SessionLogManager(
      store,
      app.getPath('userData'),
      () => broadcastTimer?.getState() ?? { elapsedMs: 0, running: false, startedAt: null },
      (channel, data) => broadcastToDashboard(channel, data),
    );
  }
  return sessionLogManager;
}

function broadcastSessionLogConfig() {
  const cfg = ensureSessionLogManager().getConfig();
  const yt = ytManager?.getConfig() ?? {};
  const merged = { ...yt, ...cfg };
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('yt-config-changed', merged);
  }
  broadcastToDashboard('yt-config-changed', merged);
}

function getRemoteConfig() {
  return {
    enabled: store.get(REMOTE_K.enabled, false) === true,
    port: Math.max(1024, Math.min(65535, Number(store.get(REMOTE_K.port, 3920)) || 3920)),
    sessionTtlHours: Math.max(1, Math.min(168, Number(store.get(REMOTE_K.sessionTtlHours, 24)) || 24)),
    maxSessions: Math.max(1, Math.min(50, Number(store.get(REMOTE_K.maxSessions, 2)) || 2)),
    maxWsPerSession: Math.max(1, Math.min(5, Number(store.get(REMOTE_K.maxWsPerSession, 2)) || 2)),
    bindHost: String(store.get(REMOTE_K.bindHost, '0.0.0.0') || '0.0.0.0'),
  };
}

function buildRemoteLanUrl() {
  const ip = resolveLanIPv4(store.get(REMOTE_K.lanPreferredAddress, ''));
  const port = getRemoteConfig().port;
  if (!ip) return null;
  return `http://${ip}:${port}/`;
}

async function applyRemoteServerFromStore() {
  if (!getRemoteConfig().enabled) {
    remoteServer?.stop();
    return { success: true };
  }
  await ensureRemoteServer().restart();
  return { success: true };
}

/** データスロット適用・設定インポート後にマネージャへ反映 */
async function syncManagersAfterStoreLayoutChange() {
  applyDesktopOverlayFromStore();
  await applySuiteFeatureFlags();
  if (!avatarManager && store.get('avatar.enabled', false)) {
    ensureAvatarManager();
  }
  if (avatarManager) {
    await avatarManager.applyEnabledState();
    if (avatarManager._server) {
      avatarManager._broadcast(avatarManager._buildOverlayInit());
    }
    const cfg = avatarManager.getConfig();
    avatarManager.emit('config-changed', cfg);
    broadcastToDashboard('avatar-config-changed', {
      p1Label: cfg.p1Label,
      p2Label: cfg.p2Label,
    });
  }
  broadcastSuiteFeaturesChanged();
}

async function refreshAfterSettingsImport(importedKeys = []) {
  applyNativeTheme(store.get(THEME_PREF_STORE_KEY, 'system'));
  if (importedKeys.includes('customCssPath')) {
    customCss.bumpCustomCssRevision(store);
  }
  if (importedKeys.some((k) => k.startsWith('remote.'))) {
    await applyRemoteServerFromStore().catch((e) => {
      console.warn('[Remote] インポート後の再起動:', e.message);
    });
  }
  suitePresets.migratePresets(store);
  if (importedKeys.includes('suite.obsLayout') || importedKeys.some((k) => k.startsWith('suite.'))) {
    suiteLayout.saveLayout(store, suiteLayout.getLayout(store));
  }
  try {
    const avatarSlotConfig = require('./avatar-slot-config');
    avatarSlotConfig.migrateStoreToSlots(store, [
      { storeKey: 'avatar.p1Slot', prefix: 'p1' },
      { storeKey: 'avatar.p2Slot', prefix: 'p2' },
    ]);
    avatarSlotConfig.migrateSlotAudioFromGlobal(
      store,
      'avatar.p1Slot',
      'avatar.p2Slot',
      'avatar.speakThreshold',
      'avatar.sensitivity',
    );
  } catch (e) {
    console.warn('[Avatar] インポート後の移行:', e.message);
  }
  await syncManagersAfterStoreLayoutChange();
  broadcastThemePreferenceChanged();
  broadcastAccentPreferenceChanged();
  const ytCfg = ytManager?.getConfig();
  if (ytCfg && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('yt-config-changed', ytCfg);
  }
  broadcastYtConfigChanged();
}

function broadcastPresetsChanged() {
  const presets = suitePresets.listPresets(store);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('suite-presets-changed', presets);
  }
}

function setupIpcHandlers() {
  ipcMain.handle('get-suite-features', () => ({
    ...getSuiteFeaturesSnapshot(),
    combinedObsUrl: `http://127.0.0.1:${activePorts.discordHttp}/suite`,
    suiteObsPorts: { ...activePorts },
    suiteObsLayout: suiteLayout.getLayout(store),
  }));

  ipcMain.handle('get-suite-presets', () => suitePresets.listPresets(store));

  ipcMain.handle('save-suite-preset', (event, opts) => {
    try {
      const r = suitePresets.saveCurrentAsPreset(store, opts || {});
      if (r.success) broadcastPresetsChanged();
      return r;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('apply-suite-preset', async (event, id) => {
    try {
      const cssBefore = String(store.get('customCssPath', '') || '');
      const r = suitePresets.applyPreset(store, id);
      if (!r.success) return r;
      if (String(store.get('customCssPath', '') || '') !== cssBefore) {
        customCss.bumpCustomCssRevision(store);
      }
      await syncManagersAfterStoreLayoutChange();
      broadcastYtConfigChanged();
      broadcastPresetsChanged();
      return r;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-suite-preset', (event, id) => {
    try {
      const r = suitePresets.deletePreset(store, id);
      if (r.success) broadcastPresetsChanged();
      return r;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-suite-preset', (event, { id, name }) => {
    try {
      const r = suitePresets.renamePreset(store, id, name);
      if (r.success) broadcastPresetsChanged();
      return r;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-settings-dialog', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: '設定をエクスポート',
        defaultPath: 'streamoner-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      const payload = settingsExport.buildExportPayload(store);
      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(payload, null, 2),
        'utf-8',
      );
      return { success: true, path: result.filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('import-settings-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '設定をインポート',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true };
      }
      const stat = await fs.promises.stat(result.filePaths[0]);
      if (stat.size > settingsExport.MAX_IMPORT_BYTES) {
        return { success: false, error: `ファイルが大きすぎます（上限 ${settingsExport.MAX_IMPORT_BYTES} バイト）` };
      }
      const raw = JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf-8'));
      const r = settingsExport.importSettings(store, raw);
      if (!r.success) return r;
      await refreshAfterSettingsImport(r.importedKeys || []);
      broadcastPresetsChanged();
      return { success: true, importedKeys: r.importedKeys, warnings: r.warnings };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-suite-features', async (event, flags) => {
    try {
      if (flags.discordEnabled !== undefined) {
        store.set(SUITE_K.discordEnabled, !!flags.discordEnabled);
      }
      if (flags.youtubeEnabled !== undefined) {
        store.set(SUITE_K.youtubeEnabled, !!flags.youtubeEnabled);
      }
      if (flags.avatarEnabled !== undefined) {
        store.set('avatar.enabled', !!flags.avatarEnabled);
      }
      if (flags.desktopOverlayEnabled !== undefined) {
        store.set(SUITE_K.desktopOverlayEnabled, !!flags.desktopOverlayEnabled);
      }
      if (flags.dashboardChatLimit !== undefined) {
        store.set(SUITE_K.dashboardChatLimit, clampDashboardChatLimit(flags.dashboardChatLimit));
      }
      if (flags.dashboardScLimit !== undefined) {
        store.set(SUITE_K.dashboardScLimit, clampDashboardScLimit(flags.dashboardScLimit));
      }
      if (flags.suiteObsLayout !== undefined) {
        suiteLayout.saveLayout(store, flags.suiteObsLayout);
      }
      applyDesktopOverlayFromStore();
      await applySuiteFeatureFlags();
      broadcastSuiteFeaturesChanged();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-settings', () => ({
    clientId:         store.get('clientId', ''),
    hasClientSecret:  !!store.getSecret('clientSecret', ''),
    customCssPath:    store.get('customCssPath', ''),
    isClickThrough:   store.get('isClickThrough', false),
    isPositionLocked: store.get('isPositionLocked', false),
    themePreference:  store.get(THEME_PREF_STORE_KEY, 'system'),
    accentPreset:     store.get(ACCENT_PREF_STORE_KEY, 'default'),
    obsUrl:           `http://127.0.0.1:${activePorts.discordHttp}/overlay`,
    suiteObsPorts:    { ...activePorts },
    remoteLanPreferredAddress: String(store.get(REMOTE_K.lanPreferredAddress, '') || ''),
    remoteLanCandidates: listLanIPv4Candidates(),
    obsWsHost:        store.get('obs.wsHost', '127.0.0.1'),
    obsWsPort:        Number(store.get('obs.wsPort', 4455)) || 4455,
    hasObsWsPassword: !!store.getSecret('obs.wsPassword', ''),
    remoteEnabled: store.get(REMOTE_K.enabled, false) === true,
    remotePort: Number(store.get(REMOTE_K.port, 3920)) || 3920,
    remoteSessionTtlHours: Number(store.get(REMOTE_K.sessionTtlHours, 24)) || 24,
    remoteMaxSessions: Number(store.get(REMOTE_K.maxSessions, 2)) || 2,
    hasRemotePin: !!store.getSecret('remote.pin', ''),
    remoteLanUrl: buildRemoteLanUrl(),
    remoteSessionCount: remoteSessionStore?.listSessions().length ?? 0,
  }));

  ipcMain.handle('save-settings', (event, settings) => {
    try {
      if (settings.clientId      !== undefined) store.set('clientId',      settings.clientId);
      if (settings.customCssPath !== undefined) {
        store.set('customCssPath', settings.customCssPath);
        customCss.bumpCustomCssRevision(store);
      }
      if (settings.clientSecret)                store.setSecret('clientSecret',  settings.clientSecret);
      if (settings.themePreference !== undefined) {
        const tp = String(settings.themePreference);
        store.set(THEME_PREF_STORE_KEY, THEME_PREFS.has(tp) ? tp : 'system');
        applyNativeTheme(store.get(THEME_PREF_STORE_KEY, 'system'));
        broadcastThemePreferenceChanged();
      }
      if (settings.accentPreset !== undefined) {
        const ap = String(settings.accentPreset);
        store.set(ACCENT_PREF_STORE_KEY, ACCENT_PREFS.has(ap) ? ap : 'default');
        broadcastAccentPreferenceChanged();
      }
      if (settings.obsWsHost !== undefined) {
        store.set('obs.wsHost', String(settings.obsWsHost || '127.0.0.1').trim() || '127.0.0.1');
      }
      if (settings.obsWsPort !== undefined) {
        const p = Math.max(1, Math.min(65535, Number(settings.obsWsPort) || 4455));
        store.set('obs.wsPort', p);
      }
      if (settings.obsWsPassword) {
        store.setSecret('obs.wsPassword', settings.obsWsPassword);
      }
      let remoteNeedsRestart = false;
      if (settings.remoteEnabled !== undefined) {
        store.set(REMOTE_K.enabled, !!settings.remoteEnabled);
        remoteNeedsRestart = true;
      }
      if (settings.remotePort !== undefined) {
        store.set(REMOTE_K.port, Math.max(1024, Math.min(65535, Number(settings.remotePort) || 3920)));
        remoteNeedsRestart = true;
      }
      if (settings.remoteSessionTtlHours !== undefined) {
        store.set(REMOTE_K.sessionTtlHours, Math.max(1, Math.min(168, Number(settings.remoteSessionTtlHours) || 24)));
      }
      if (settings.remoteMaxSessions !== undefined) {
        store.set(REMOTE_K.maxSessions, Math.max(1, Math.min(50, Number(settings.remoteMaxSessions) || 2)));
      }
      if (settings.remoteLanPreferredAddress !== undefined) {
        store.set(REMOTE_K.lanPreferredAddress, String(settings.remoteLanPreferredAddress || '').trim());
      }
      if (settings.suiteObsPorts && typeof settings.suiteObsPorts === 'object') {
        suitePorts.saveSuitePorts(store, settings.suiteObsPorts);
        activePorts = suitePorts.getSuitePorts(store);
      }
      if (settings.remotePin) {
        ensureRemoteCore();
        remoteSessionStore.setPin(settings.remotePin);
        remoteNeedsRestart = false;
      }
      if (remoteNeedsRestart) {
        applyRemoteServerFromStore().catch((e) => console.warn('[Remote] 再起動:', e.message));
      }

      if (settings.clientId) ensureRpcManager().updateClientId(settings.clientId);
      if (settings.clientSecret) ensureRpcManager().updateClientSecret(settings.clientSecret);

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-css-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'カスタムCSSファイルを選択',
      filters: [{ name: 'CSS Files', extensions: ['css'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('load-css-file', (event, filePath) => {
    try {
      const saved = String(store.get('customCssPath', '') || '').trim();
      const target = filePath || saved;
      if (!target || !fs.existsSync(target)) return { success: false, error: 'ファイルが見つかりません' };
      return { success: true, css: fs.readFileSync(path.resolve(target), 'utf-8') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('toggle-click-through',  () => { toggleClickThrough();  return isClickThrough; });
  ipcMain.handle('toggle-position-lock',  () => { togglePositionLock();  return isPositionLocked; });
  ipcMain.handle('reconnect-rpc', async () => {
    if (!isDiscordFeatureEnabled()) {
      return { success: false, error: 'Discord が OFF です。設定の「全般」またはダッシュボードで ON にしてください。' };
    }
    try { await ensureRpcManager().reconnect(); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('clear-discord-oauth', async () => {
    try {
      if (rpcManager) rpcManager.clearSavedAuth();
      if (isDiscordFeatureEnabled()) {
        await ensureRpcManager().reconnect();
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('get-rpc-status', () => rpcManager?.getStatus() ?? { connected: false });
  ipcMain.on('open-external', (event, url) => shell.openExternal(url));

  ipcMain.handle('open-dashboard-window', () => {
    createDashboardWindow();
    return { success: true };
  });

  ipcMain.handle('open-settings-window', (event, opts) => {
    createSettingsWindow(opts && typeof opts === 'object' ? opts : {});
    return { success: true };
  });

  // YouTube チャット
  ipcMain.handle('get-yt-config', () => ({
    ...(ytManager?.getConfig() ?? { obsUrl: 'http://127.0.0.1:3002/overlay' }),
    ...ensureSessionLogManager().getConfig(),
  }));
  ipcMain.handle('save-yt-config', (event, settings) => {
    try {
      ytManager?.saveConfig(settings);
      ensureSessionLogManager().saveConfig(settings || {});
      if (settings?.videoId !== undefined) {
        broadcastTimer?.onVideoIdChanged(String(settings.videoId || '').trim());
      }
      broadcastSessionLogConfig();
      return { success: true };
    }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-session-log-status', () => ensureSessionLogManager().getStatus());
  ipcMain.handle('get-last-session-log', () => ensureSessionLogManager().getLastSession());
  ipcMain.handle('start-session-log', (event, videoId) => {
    const vid = videoId ?? ytManager?.getConfig()?.videoId ?? '';
    return ensureSessionLogManager().startSession(vid, { manual: true });
  });
  ipcMain.handle('end-session-log', () => ensureSessionLogManager().endSession({ reason: 'manual' }));
  ipcMain.handle('mark-session-highlight', (event, entryId) =>
    ensureSessionLogManager().markHighlight(entryId));
  ipcMain.handle('get-broadcast-timer', () => broadcastTimer?.getState() ?? {
    anchorVideoId: '',
    elapsedMs: 0,
    running: false,
    startedAt: null,
  });
  ipcMain.handle('start-yt-poller', () => {
    if (!isYoutubeFeatureEnabled()) {
      return { success: false, error: 'チャットが OFF です。設定の「全般」またはダッシュボードで ON にしてください。' };
    }
    return ytManager?.startPoller() ?? { success: false, error: 'ytManager未初期化' };
  });
  ipcMain.handle('stop-yt-poller',  () => { ytManager?.stopPoller(); return { success: true }; });
  ipcMain.handle('get-yt-status',   () => ytManager?.getStatus() ?? { pollerRunning: false, serverRunning: false });

  ipcMain.handle('get-youtube-oauth-status', () => ensureYtOAuthManager().getStatus());
  ipcMain.handle('start-youtube-oauth', async () => {
    try {
      return await ensureYtOAuthManager().startOAuth();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('clear-youtube-oauth', () => {
    try {
      return ensureYtOAuthManager().clearOAuth();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('cancel-youtube-oauth', () => {
    try {
      return ensureYtOAuthManager().cancelOAuth();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('set-youtube-oauth-nudge-dismissed', (event, value) => {
    try {
      return ensureYtOAuthManager().setNudgeDismissed(!!value);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('resolve-youtube-live-broadcasts', async () => {
    try {
      return await ensureYtLiveResolver().resolveActiveBroadcasts();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('prepare-yt-chat-start', async () => {
    try {
      if (!isYoutubeFeatureEnabled()) {
        return { step: 'error', error: 'チャットが OFF です。設定の「全般」またはダッシュボードで ON にしてください。' };
      }
      ensureYtManager();
      return await ensureYtChatStartCoordinator().prepareStart();
    } catch (e) {
      return { step: 'error', error: e.message };
    }
  });
  ipcMain.handle('confirm-yt-chat-start', async (event, videoId) => {
    try {
      if (!isYoutubeFeatureEnabled()) {
        return { success: false, error: 'チャットが OFF です。' };
      }
      ensureYtManager();
      return await ensureYtChatStartCoordinator().confirmStart(videoId);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pin-yt-message', (event, msg) =>
    ytManager?.pinMessage(msg) ?? { success: false, error: 'ytManager未初期化' });
  ipcMain.handle('unpin-yt-message', (event, msgId) =>
    ytManager?.unpinMessage(msgId) ?? { success: false, error: 'ytManager未初期化' });
  ipcMain.handle('get-yt-pinned', () => ytManager?.getPinnedMessages() ?? []);
  ipcMain.handle('get-yt-session-participants', () =>
    ytManager?.getSessionParticipants() ?? []);
  ipcMain.handle('get-yt-viewer-detail', (event, channelId) =>
    ytManager?.getViewerDetail(channelId) ?? null);
  ipcMain.handle('clear-yt-session', () =>
    ytManager?.clearSession() ?? { success: false, error: 'ytManager未初期化' });
  ipcMain.handle('add-yt-ng-user', (event, channelId) => {
    const r = ytManager?.addNgUser(channelId) ?? { success: false, error: 'ytManager未初期化' };
    if (r.success) broadcastYtConfigChanged();
    return r;
  });
  ipcMain.handle('add-yt-ng-word', (event, word) => {
    const r = ytManager?.addNgWord(word) ?? { success: false, error: 'ytManager未初期化' };
    if (r.success) broadcastYtConfigChanged();
    return r;
  });
  ipcMain.handle('get-avatar-config', () =>
    avatarManager?.getConfig() ?? { obsUrl: 'http://127.0.0.1:3003/overlay' });
  ipcMain.handle('save-avatar-config', async (event, settings) => {
    try {
      return await avatarManager?.saveConfig(settings) ?? { success: false, error: 'AvatarManager 未初期化' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('get-avatar-status', () =>
    avatarManager?.getStatus() ?? { serverRunning: false, audioRunning: false });
  ipcMain.handle('open-avatar-preview', () => createAvatarPreviewWindow());

  ipcMain.handle('obs-connect', async () => {
    try {
      return await ensureObsService().connect();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('obs-disconnect', () => {
    obsService?.disconnect();
    return { success: true };
  });
  ipcMain.handle('obs-get-status', () => obsService?.getStatus() ?? {
    connected: false,
    error: null,
    streaming: false,
    recording: false,
    currentSceneName: '',
    p1Muted: false,
    p2Muted: false,
  });
  ipcMain.handle('obs-list-audio-inputs', async () => {
    try {
      const r = await ensureObsService().listAudioInputs();
      return { success: true, ...r };
    } catch (e) {
      return { success: false, error: e.message, inputs: [], fallbackAll: false };
    }
  });
  ipcMain.handle('obs-list-scenes', async () => {
    try {
      const scenes = await ensureObsService().listScenes();
      return { success: true, scenes };
    } catch (e) {
      return { success: false, error: e.message, scenes: [] };
    }
  });
  ipcMain.handle('obs-set-current-scene', async (event, sceneName) => {
    try {
      await ensureObsService().setCurrentScene(sceneName);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('obs-set-mute', async (event, { slot, muted }) => {
    try {
      await ensureObsService().setMute(slot, muted);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('obs-get-config', () => ensureObsService().getConfig() ?? {});
  ipcMain.handle('obs-detect-suite-source', async () => {
    try {
      return await ensureObsService().detectSuiteBrowserSource();
    } catch (e) {
      return { found: false, connected: false, error: e.message };
    }
  });
  ipcMain.handle('remote-get-config', async () => {
    ensureRemoteCore();
    const remoteLanUrl = buildRemoteLanUrl();
    const pin = remoteSessionStore?.getPin() || '';
    const remoteLanQrDataUrl = await lazy.remoteLanQrDataUrl(remoteLanUrl);
    let remoteLanQrError = '';
    if (remoteLanUrl && !remoteLanQrDataUrl) {
      try {
        const qrMod = require('./remote-lan-qr');
        remoteLanQrError = qrMod.getLastQrError?.() || 'QR 生成に失敗しました';
      } catch (_) {
        remoteLanQrError = 'QR 生成に失敗しました';
      }
      console.warn('[Remote] LAN URL はあるが QR 未生成:', remoteLanUrl, remoteLanQrError);
    }
    return {
      ...getRemoteConfig(),
      hasRemotePin: !!pin,
      pinLength: pin ? pin.length : 0,
      // 設定画面ローカル表示用（マスク制御はレンダラー側）
      pin,
      lanPreferredAddress: String(store.get(REMOTE_K.lanPreferredAddress, '') || ''),
      lanCandidates: listLanIPv4Candidates(),
      remoteLanUrl,
      remoteLanQrDataUrl,
      remoteLanQrError,
      sessions: remoteSessionStore?.listSessions() ?? [],
      serverRunning: remoteServer?.isRunning() ?? false,
    };
  });
  ipcMain.handle('remote-list-sessions', () => remoteSessionStore?.listSessions() ?? []);
  ipcMain.handle('remote-revoke-session', (event, sessionId) => {
    const ok = remoteSessionStore?.revokeSession(sessionId) ?? false;
    return { success: ok };
  });
  ipcMain.handle('remote-regenerate-pin', () => {
    ensureRemoteCore();
    const pin = remoteSessionStore.regeneratePin();
    return { success: true, pin };
  });
  ipcMain.handle('remote-restart-server', async () => {
    try {
      return await applyRemoteServerFromStore();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-obs-event-actions', (event, rules) => {
    try {
      const svc = ensureObsService();
      const saved = svc.saveEventActions(rules || []);
      return { success: true, eventActions: saved };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('test-obs-event-action', async (event, rule) => {
    try {
      return await ensureObsService().runEventAction(rule || {});
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('open-rehearsal-preview', async () => {
    try {
      return await createRehearsalPreviewWindow();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('obs-save-config', (event, partial) => {
    try {
      const svc = ensureObsService();
      svc.saveConfig(partial || {});
      const cfg = svc.getConfig?.() ?? {};
      broadcastToDashboard('obs-config-changed', {
        micSourceP1: cfg.micSourceP1 || '',
        micSourceP2: cfg.micSourceP2 || '',
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-image-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'アバター画像を選択',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// ============================================================
// RPC → オーバーレイ / WebSocket へブロードキャスト
// ============================================================

function broadcastToOverlay(channel, data) {
  if (overlayWindow  && !overlayWindow.isDestroyed())  overlayWindow.webContents.send(channel, data);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(channel, data);
}

function attachObsBridge(service) {
  const forward = (channel) => (data) => broadcastToDashboard(channel, data);
  service.on('connection-changed', (data) => {
    broadcastToDashboard('obs-connection-changed', data);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('obs-connection-changed', data);
    }
  });
  service.on('output-state-changed', forward('obs-output-state-changed'));
  service.on('scene-changed', forward('obs-scene-changed'));
  service.on('mute-state-changed', forward('obs-mute-state-changed'));
}

function setupAvatarBridge() {
  avatarManager.on('status-changed', (data) => {
    broadcastToDashboard('avatar-status-changed', data);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('avatar-status-changed', data);
    }
    updateTrayMenu();
  });
  avatarManager.on('config-changed', (cfg) => {
    broadcastToDashboard('avatar-config-changed', {
      p1Label: cfg.p1Label,
      p2Label: cfg.p2Label,
    });
  });
  avatarManager.on('audio-levels', (levels) => {
    broadcastToDashboard('avatar-audio-levels', levels);
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    try {
      if (!settingsWindow.isVisible() || settingsWindow.isMinimized()) return;
    } catch (_) {
      return;
    }
    settingsWindow.webContents.send('avatar-audio-levels', levels);
  });
}

function sendToDashboardWindowOnly(channel, data) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  const throttleWhenHidden = channel === 'yt-message' || channel === 'yt-session-changed';
  if (throttleWhenHidden) {
    try {
      if (!dashboardWindow.isVisible() || dashboardWindow.isMinimized()) return;
    } catch (_) {
      return;
    }
  }
  try {
    dashboardWindow.webContents.send(channel, data);
  } catch (_) {}
}

function broadcastToDashboard(channel, data) {
  if (remoteHub) {
    remoteHub.publish(channel, data);
  } else {
    sendToDashboardWindowOnly(channel, data);
    remoteServer?.broadcastEvent(channel, data);
  }
}

function setupRpcBridge() {
  const ifDiscord = (handler) => (data) => {
    if (!isDiscordFeatureEnabled()) return;
    handler(data);
  };

  rpcManager.on('status-changed', (data) => {
    broadcastToDashboard('rpc-status-changed', data);
    if (!isDiscordFeatureEnabled()) return;
    broadcastToOverlay('rpc-status-changed', data);
    wsBroadcast({ type: 'status', data });
    updateTrayMenu();
  });

  rpcManager.on('channel-update', ifDiscord((data) => {
    broadcastToOverlay('channel-update', data);
    wsBroadcast({ type: 'channel-update', data });
  }));

  rpcManager.on('voice-state-update', ifDiscord((data) => {
    broadcastToOverlay('voice-state-update', data);
    wsBroadcast({ type: 'voice-state-update', data });
  }));

  rpcManager.on('speaking-update', ifDiscord((data) => {
    broadcastToOverlay('speaking-update', data);
    wsBroadcast({ type: 'speaking-update', data });
  }));
}

function setupYtBridge() {
  ytManager.on('status-changed', (data) => {
    const running = !!data.pollerRunning;
    if (running && !ytPollerWasRunning) {
      const vid = ytManager.getConfig()?.videoId || '';
      broadcastTimer?.onPollerStart(vid);
      ensureSessionLogManager().startSession(vid);
    } else if (!running && ytPollerWasRunning) {
      broadcastTimer?.onPollerStop();
      ensureSessionLogManager().endSession({ reason: 'poller-stop' });
    }
    ytPollerWasRunning = running;

    broadcastToOverlay('yt-status-changed', data);
    broadcastToDashboard('yt-status-changed', data);
    updateTrayMenu();
  });
  ytManager.on('message', (msg) => {
    if (!isYoutubeFeatureEnabled()) return;
    ensureSessionLogManager().recordMessage(msg);
    broadcastToDashboard('yt-message', msg);
    const rules = store.get(obsEventDispatcher.STORE_KEY, []);
    obsEventDispatcher.dispatchObsEventActions(rules, ensureObsService(), { type: 'message', msg });
  });
  ytManager.on('membership-event', (msg) => {
    if (!isYoutubeFeatureEnabled()) return;
    broadcastToDashboard('yt-membership', msg);
    const rules = store.get(obsEventDispatcher.STORE_KEY, []);
    obsEventDispatcher.dispatchObsEventActions(rules, ensureObsService(), { type: 'membership', msg });
  });
  ytManager.on('pin-changed', (list) => {
    if (!isYoutubeFeatureEnabled()) return;
    broadcastToDashboard('yt-pin-changed', list);
  });
  ytManager.on('session-changed', (participants) => {
    if (!isYoutubeFeatureEnabled()) return;
    broadcastToDashboard('yt-session-changed', participants);
  });
}

// ============================================================
// 起動
// ============================================================

if (gotSingleInstanceLock) {
app.whenReady().then(async () => {
  console.log('[Main] アプリケーション起動');

  if (store.loadRecoveredFromBackup) {
    dialog.showMessageBox({
      type: 'warning',
      title: `${APP_DISPLAY_NAME} — 設定の復元`,
      message: 'settings.json の読み込みに失敗したため、バックアップ（settings.json.bak）から復元しました。',
      detail: '設定画面から内容を確認し、必要なら設定のエクスポートでバックアップを取ってください。',
      buttons: ['OK'],
    }).catch(() => {});
  }

  suitePresets.migratePresets(store);
  applyNativeTheme(store.get(THEME_PREF_STORE_KEY, 'system'));

  configureApplicationMenu();
  setupIpcHandlers();
  if (isDesktopOverlayStartupEnabled()) {
    createOverlayWindow();
  } else {
    console.log('[Main] デスクトップ Discord オーバーレイは設定で無効のため起動時は作成しません');
  }
  createTray();

  // 保存済み設定を復元
  isClickThrough   = store.get('isClickThrough',   false);
  isPositionLocked = store.get('isPositionLocked', false);
  if (isClickThrough)   overlayWindow?.setIgnoreMouseEvents(true, { forward: true });
  if (isPositionLocked) { overlayWindow?.setMovable(false); overlayWindow?.setResizable(false); }

  // OBS用サーバー起動（固定ポート。競合時は起動せず通知）
  const portConflicts = [];

  if (await isPortAvailable(activePorts.discordHttp)) {
    startHttpServer(activePorts.discordHttp);
  } else {
    discordServerStatus.http = { ok: false, error: 'ポート使用中' };
    portConflicts.push(`・${activePorts.discordHttp} — Discord OBS（HTTP）`);
    console.warn(`[Main] ポート ${activePorts.discordHttp} は使用中のため HTTP サーバーを起動しません`);
  }

  if (await isPortAvailable(activePorts.discordWs)) {
    startWebSocketServer(activePorts.discordWs);
  } else {
    discordServerStatus.ws = { ok: false, error: 'ポート使用中' };
    portConflicts.push(`・${activePorts.discordWs} — Discord OBS（WebSocket）`);
    console.warn(`[Main] ポート ${activePorts.discordWs} は使用中のため WebSocket サーバーを起動しません`);
  }

  // RPC初期化
  const clientId     = store.get('clientId',     '');
  const clientSecret = store.getSecret('clientSecret', '');

  if (isDiscordFeatureEnabled() && clientId && clientSecret) {
    await ensureRpcManager().connect();
  } else if (!clientId || !clientSecret) {
    console.log('[Main] 未設定のため設定画面を開きます');
    createSettingsWindow();
  } else {
    console.log('[Main] Discord 表示は OFF のため RPC に接続しません');
  }

  // YouTube Chat Manager 初期化
  broadcastTimer = new BroadcastTimer(store, broadcastTimerStateChanged);
  ensureSessionLogManager();
  const ytMgr = ensureYtManager();
  const ytServerResult = await ytMgr.startServer();
  if (!ytServerResult.success) {
    portConflicts.push(`・${activePorts.youtube} — YouTube OBS（${ytServerResult.error}）`);
    console.warn(`[Main] YouTube サーバー起動失敗:`, ytServerResult.error);
  }

  if (portConflicts.length) {
    showPortConflictDialog(portConflicts);
    updateTrayMenu();
  }

  const ytVideoId = store.get('yt.videoId', '');
  const hasYtApiKey = !!store.getSecret('yt.apiKey', '');
  if (isYoutubeFeatureEnabled() && ytVideoId && hasYtApiKey) {
    ytMgr.startPoller();
    ytPollerWasRunning = !!ytMgr.getStatus().pollerRunning;
  } else if (!isYoutubeFeatureEnabled()) {
    console.log('[Main] YouTube コメント表示は OFF のためポーラーを開始しません');
  } else {
    console.log('[Main] YouTube設定未完了。設定画面の YouTube タブから入力してください。');
  }

  const avMgr = ensureAvatarManager();
  avMgr.migrateLegacy();
  const avServerResult = await avMgr.startServer();
  if (!avServerResult.success) {
    portConflicts.push(`・${activePorts.avatar} — アバター OBS（${avServerResult.error}）`);
    console.warn('[Main] アバターサーバー起動失敗:', avServerResult.error);
  }

  if (getRemoteConfig().enabled) {
    const remoteStart = await ensureRemoteServer().start();
    if (!remoteStart.success) {
      console.warn('[Remote] 起動失敗:', remoteStart.error);
    }
  }
});
}

// ============================================================
// 終了
// ============================================================

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  rpcManager?.disconnect();
  httpServer?.close();
  wsServer?.close();
  ytManager?.stopServer();
  avatarManager?.stopServer();
  obsService?.disconnect();
  remoteServer?.stop();
});
if (gotSingleInstanceLock) {
  app.on('activate', () => {
    if (!isDesktopOverlayStartupEnabled()) return;
    if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
    else overlayWindow.show();
  });
}
