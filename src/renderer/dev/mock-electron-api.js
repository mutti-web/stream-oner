'use strict';

/**
 * Electron IPC のモック（UI プレビュー専用）
 * npm run preview:ui で settings / dashboard をブラウザ確認するときに注入される。
 */
(function () {
  if (window.electronAPI) return;

  const PREVIEW_STORE_KEY = '__ui_preview_store__';
  const listeners = new Map();
  const ok = (data) => Promise.resolve({ success: true, ...data });
  const pass = (data) => Promise.resolve(data);

  const SUITE_OBS_LAYOUT_FALLBACK = {
    discord: { anchor: 'top-left', offsetX: 12, offsetY: 12, widthPx: 340, heightPx: 420 },
    youtube: { anchor: 'bottom-right', offsetX: 12, offsetY: 12, widthPx: 440, heightPx: 720 },
    avatar: { anchor: 'bottom-left', offsetX: 0, offsetY: 0, widthPx: 960, heightPx: 420 },
  };

  function currentSuiteObsLayout() {
    return window.__SERVER_PREVIEW_OBS_LAYOUT__ || SUITE_OBS_LAYOUT_FALLBACK;
  }

  const REMOTE_QR = '__REMOTE_QR_DATA_URL__';
  const DATA_SLOT_IDS = ['data-slot-1', 'data-slot-2', 'data-slot-3'];

  function ensureDataSlots(raw) {
    if (raw?.version === 2 && Array.isArray(raw.slots) && raw.slots.length === 3) {
      return raw;
    }
    return {
      version: 2,
      activeId: null,
      slots: DATA_SLOT_IDS.map((id, idx) => ({
        slotIndex: idx + 1,
        id,
        occupied: false,
        name: '',
        savedAt: null,
        summary: '',
      })),
      items: [],
    };
  }

  const DEFAULT_YT_CONFIG = {
    videoId: 'dQw4w9WgXcQ',
    hasApiKey: true,
    pollingIntervalMs: 5000,
    maxComments: 8,
    showDurationMs: 8000,
    animMode: 'slide-up',
    position: 'bottom-right',
    width: 400,
    gap: 6,
    obsUrl: 'http://127.0.0.1:3002/overlay',
    badgeFirst: '🔰初見',
    badgeRegular: '⭐常連',
    badgeThreshold: 10,
    ngWords: [],
    ngUserIds: [],
    allowMembersOnly: false,
    showSuperChatOnly: false,
    hideBotCommands: true,
    botCommandPrefix: '!',
    sessionLogLagOffsetMs: 0,
    sessionLogMaxSessions: 30,
    sessionLogMaxDays: 90,
    superChatTiers: [
      { minAmount: 0, color: '#fbbf24', scale: 1, durationMs: 8000 },
      { minAmount: 500, color: '#f59e0b', scale: 1.05, durationMs: 10000 },
      { minAmount: 2000, color: '#ef4444', scale: 1.1, durationMs: 12000 },
    ],
  };

  const MOCK_CHAT_MESSAGES = [
    {
      id: 'preview-msg-1',
      text: '配信お疲れ様です！初見です。',
      author: {
        name: 'プレビュー視聴者',
        id: 'UC_preview',
        iconUrl: '',
        isFirstTime: true,
      },
    },
    {
      id: 'preview-msg-2',
      text: 'いつも見てます〜',
      author: {
        name: '常連さん',
        id: 'UC_regular',
        iconUrl: '',
        isRegular: true,
      },
    },
    {
      id: 'preview-msg-3',
      text: 'Super Chat テストありがとう！',
      author: { name: '投げ銭ユーザー', id: 'UC_sc', iconUrl: '' },
      superChat: { amountDisplayString: '¥500' },
    },
  ];

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(PREVIEW_STORE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function writeStore(patch) {
    const next = { ...readStore(), ...patch, rev: Date.now() };
    localStorage.setItem(PREVIEW_STORE_KEY, JSON.stringify(next));
    return next;
  }

  function getYtConfigData() {
    const store = readStore();
    return { ...DEFAULT_YT_CONFIG, ...(store.ytConfig || {}) };
  }

  function getPinnedMessages() {
    return Array.isArray(readStore().pinned) ? readStore().pinned : [];
  }

  const DEFAULT_REMOTE_SESSION = {
    sessionId: 'preview-1',
    deviceLabel: 'マイスマホ',
    clientIp: '192.168.1.50',
    lastSeenAt: Date.now(),
    wsConnected: true,
  };

  function getRemoteState() {
    const s = readStore().remote || {};
    const enabled = s.enabled !== undefined ? !!s.enabled : true;
    const pin = String(s.pin || '123456');
    let sessions;
    if (Array.isArray(s.sessions)) sessions = s.sessions;
    else sessions = enabled ? [{ ...DEFAULT_REMOTE_SESSION, lastSeenAt: Date.now() }] : [];
    return {
      enabled,
      port: Number(s.port) || 3920,
      maxSessions: Number(s.maxSessions) || 2,
      pin,
      lanPreferredAddress: String(s.lanPreferredAddress || ''),
      sessions: enabled ? sessions : [],
      serverRunning: enabled,
    };
  }

  function patchRemote(partial) {
    const next = { ...(readStore().remote || {}), ...partial };
    writeStore({ remote: next });
    return next;
  }

  function emit(channel, data) {
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of set) {
      try { cb(data); } catch (_) { /* ignore */ }
    }
  }

  function syncPinState(list) {
    writeStore({ pinned: list });
    emit('yt-pin-changed', list);
  }

  window.electronAPI = {
    getSettings: () => pass({
      clientId: '1234567890123456789',
      hasClientSecret: true,
      customCssPath: '',
      isClickThrough: false,
      isPositionLocked: false,
      themePreference: 'system',
      accentPreset: 'default',
      obsWsHost: '127.0.0.1',
      obsWsPort: 4455,
      hasObsWsPassword: true,
      suiteObsPorts: { discordHttp: 3000, discordWs: 3001, youtube: 3002, avatar: 3003 },
      remoteLanPreferredAddress: '',
      remoteLanCandidates: [
        { interfaceName: 'en0', address: '192.168.1.42' },
        { interfaceName: 'en1', address: '10.0.0.5' },
      ],
    }),
    saveSettings: (settings) => {
      if (settings && typeof settings === 'object') {
        const remotePatch = {};
        if (settings.remoteEnabled !== undefined) remotePatch.enabled = !!settings.remoteEnabled;
        if (settings.remotePort !== undefined) {
          remotePatch.port = Math.max(1024, Math.min(65535, Number(settings.remotePort) || 3920));
        }
        if (settings.remoteMaxSessions !== undefined) {
          remotePatch.maxSessions = Math.max(1, Math.min(50, Number(settings.remoteMaxSessions) || 2));
        }
        if (settings.remoteLanPreferredAddress !== undefined) {
          remotePatch.lanPreferredAddress = String(settings.remoteLanPreferredAddress || '').trim();
        }
        if (Object.keys(remotePatch).length) {
          const cur = getRemoteState();
          const enabled = remotePatch.enabled !== undefined ? remotePatch.enabled : cur.enabled;
          patchRemote({
            ...remotePatch,
            // OFF にしたときは接続一覧も空にして UI を合わせる
            ...(remotePatch.enabled === false ? { sessions: [] } : {}),
            ...(remotePatch.enabled === true && !cur.enabled ? { sessions: [] } : {}),
            enabled,
          });
          if (remotePatch.enabled === false || remotePatch.enabled === true) {
            emit('remote-sessions-changed', enabled ? (readStore().remote?.sessions || []) : []);
          }
        }
      }
      return ok();
    },
    openCssFileDialog: () => pass(null),
    loadCssFile: () => ok({ css: '' }),
    toggleClickThrough: () => pass(false),
    togglePositionLock: () => pass(false),
    reconnectRpc: () => ok(),
    clearDiscordOAuth: () => ok(),
    getRpcStatus: () => pass({ state: 'connected' }),
    getYoutubeOAuthStatus: () => pass(readStore().ytOAuth || {
      configured: true,
      linked: false,
      channelId: '',
      channelTitle: '',
      expiresAt: 0,
      accessTokenFresh: false,
      nudgeDismissed: false,
    }),
    startYoutubeOAuth: () => {
      if (window.__UI_PREVIEW__) {
        console.info('[UI Preview] startYoutubeOAuth — 本番ではブラウザが開きます');
      }
      const status = {
        configured: true,
        linked: true,
        channelId: 'UC_preview_oauth',
        channelTitle: 'プレビューチャンネル',
        expiresAt: Date.now() + 3600_000,
        accessTokenFresh: true,
        nudgeDismissed: false,
      };
      writeStore({ ytOAuth: status });
      emit('yt-oauth-changed', status);
      return ok({ channelId: status.channelId, channelTitle: status.channelTitle });
    },
    clearYoutubeOAuth: () => {
      const status = {
        configured: true,
        linked: false,
        channelId: '',
        channelTitle: '',
        expiresAt: 0,
        accessTokenFresh: false,
        nudgeDismissed: readStore().ytOAuth?.nudgeDismissed || false,
      };
      writeStore({ ytOAuth: status });
      emit('yt-oauth-changed', status);
      return ok();
    },
    cancelYoutubeOAuth: () => ok({ cancelled: true }),
    setYoutubeOAuthNudgeDismissed: (value) => {
      const prev = readStore().ytOAuth || {};
      const status = { ...prev, nudgeDismissed: !!value };
      writeStore({ ytOAuth: status });
      emit('yt-oauth-changed', status);
      return ok();
    },
    resolveYoutubeLiveBroadcasts: () => {
      const oauth = readStore().ytOAuth || {};
      if (!oauth.linked) {
        return Promise.resolve({
          success: false,
          code: 'NOT_LINKED',
          error: 'YouTube と連携されていません',
        });
      }
      const mode = readStore().ytLiveDetectPreview || 'single';
      if (mode === 'none') {
        return pass({
          success: false,
          kind: 'none',
          broadcasts: [],
          code: 'NO_BROADCAST',
          error: '配信中のライブが見つかりません。YouTube で配信を開始してから再度お試しください。',
        });
      }
      if (mode === 'multiple') {
        return pass({
          success: true,
          kind: 'multiple',
          broadcasts: [
            { broadcastId: 'prev-live-1', videoId: 'prev-live-1', title: 'プレビュー配信 A' },
            { broadcastId: 'prev-live-2', videoId: 'prev-live-2', title: 'プレビュー配信 B' },
          ],
        });
      }
      return pass({
        success: true,
        kind: 'single',
        broadcasts: [{
          broadcastId: 'dQw4w9WgXcQ',
          videoId: 'dQw4w9WgXcQ',
          title: 'プレビュー配信中ライブ',
        }],
      });
    },
    prepareYtChatStart: async () => {
      if (readStore().ytPollerRunning) {
        return pass({ step: 'already_running' });
      }
      const oauth = readStore().ytOAuth || {
        configured: true,
        linked: false,
        nudgeDismissed: false,
      };
      const manualVideoId = String(getYtConfigData().videoId || '').trim();
      if (oauth.linked) {
        const resolved = await window.electronAPI.resolveYoutubeLiveBroadcasts();
        if (!resolved.success) {
          if (manualVideoId) {
            return pass({
              step: 'confirm_manual_fallback',
              videoId: manualVideoId,
              detectError: resolved.error || '配信を検出できませんでした',
            });
          }
          return pass({
            step: 'error',
            error: resolved.error || '配信を検出できませんでした',
            code: resolved.code,
          });
        }
        if (resolved.kind === 'single') {
          return pass({ step: 'confirm_single', broadcast: resolved.broadcasts[0] });
        }
        return pass({ step: 'pick_multiple', broadcasts: resolved.broadcasts });
      }
      if (manualVideoId) {
        return pass({ step: 'start_manual', videoId: manualVideoId });
      }
      if (!oauth.nudgeDismissed) {
        return pass({ step: 'nudge', configured: oauth.configured !== false });
      }
      return pass({
        step: 'error',
        error: '動画 ID が未設定です。ダッシュボードで入力するか、接続タブで YouTube と連携してください。',
      });
    },
    confirmYtChatStart: (videoId) => {
      const vid = String(videoId || '').trim();
      if (!vid) return Promise.resolve({ success: false, error: '動画 ID が空です' });
      const ytConfig = { ...getYtConfigData(), videoId: vid };
      writeStore({ ytConfig, ytPollerRunning: true });
      emit('yt-config-changed', ytConfig);
      return ok();
    },
    openExternal: (url) => { console.log('[preview] openExternal', url); },
    getYtConfig: () => pass(getYtConfigData()),
    saveYtConfig: (settings) => {
      const ytConfig = { ...getYtConfigData(), ...(settings || {}) };
      if (settings?.apiKey) ytConfig.hasApiKey = true;
      writeStore({ ytConfig });
      emit('yt-config-changed', ytConfig);
      return ok();
    },
    startYtPoller: () => {
      writeStore({ ytPollerRunning: true });
      return ok();
    },
    stopYtPoller: () => {
      writeStore({ ytPollerRunning: false });
      return ok();
    },
    getYtStatus: () => pass({
      pollerRunning: !!readStore().ytPollerRunning,
      serverRunning: true,
    }),
    pinYtMessage: (msg) => {
      if (!msg?.id) return Promise.resolve({ success: false, error: 'ピン留めできないメッセージです' });
      const pinned = getPinnedMessages();
      const idx = pinned.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        pinned.splice(idx, 1);
      } else {
        if (pinned.length >= 3) pinned.shift();
        pinned.push(msg);
      }
      syncPinState(pinned);
      return ok();
    },
    unpinYtMessage: (msgId) => {
      const pinned = getPinnedMessages();
      const next = msgId
        ? pinned.filter((m) => m.id !== msgId)
        : [];
      syncPinState(next);
      return ok();
    },
    getYtPinned: () => pass(getPinnedMessages()),
    getYtSessionParticipants: () => pass([
      { id: 'UC_preview', name: 'プレビュー視聴者', iconUrl: '', sessionComments: 3 },
      { id: 'UC_regular', name: '常連さん', iconUrl: '', sessionComments: 12 },
    ]),
    getYtViewerDetail: () => pass({
      channelId: 'UC_preview',
      name: 'プレビュー視聴者',
      sessionComments: 3,
      totalComments: 15,
      isRegular: false,
    }),
    clearYtSession: () => ok(),
    getSessionLogStatus: () => pass({ active: false, entryCount: 0, highlightCount: 0 }),
    getLastSessionLog: () => pass(readStore().lastSessionLog || null),
    startSessionLog: () => {
      writeStore({ sessionLogActive: true });
      emit('session-log-changed', { active: true, entryCount: 0, highlightCount: 0 });
      return ok({ sessionId: 'preview-session' });
    },
    endSessionLog: () => {
      const session = {
        id: 'preview-session',
        videoId: getYtConfigData().videoId,
        highlights: [
          {
            id: 'hl-1',
            kind: 'auto-first',
            sessionElapsedMs: 125000,
            label: '初見: プレビュー視聴者',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s',
          },
        ],
      };
      writeStore({ sessionLogActive: false, lastSessionLog: session });
      emit('session-log-changed', { active: false, entryCount: 0 });
      emit('session-log-ended', session);
      return ok({ ended: true, session });
    },
    markSessionHighlight: () => ok(),
    addYtNgUser: (channelId) => {
      const id = String(channelId || '').trim();
      if (!id) return Promise.resolve({ success: false, error: 'channelId が空です' });
      const ytConfig = getYtConfigData();
      const ngUserIds = [...(ytConfig.ngUserIds || [])];
      if (!ngUserIds.includes(id)) ngUserIds.push(id);
      writeStore({ ytConfig: { ...ytConfig, ngUserIds } });
      emit('yt-config-changed', { ...ytConfig, ngUserIds });
      return ok();
    },
    addYtNgWord: (word) => {
      const w = String(word || '').trim();
      if (!w) return Promise.resolve({ success: false, error: 'NGワードが空です' });
      const ytConfig = getYtConfigData();
      const ngWords = [...(ytConfig.ngWords || [])];
      const lower = w.toLowerCase();
      if (!ngWords.some((x) => x.toLowerCase() === lower)) ngWords.push(w);
      writeStore({ ytConfig: { ...ytConfig, ngWords } });
      emit('yt-config-changed', { ...ytConfig, ngWords });
      return ok();
    },
    getSuiteFeatures: () => pass({
      discordEnabled: true,
      youtubeEnabled: true,
      avatarEnabled: true,
      desktopOverlayEnabled: false,
      dashboardChatLimit: 500,
      dashboardScLimit: 50,
      combinedObsUrl: 'http://127.0.0.1:3000/suite',
      suiteObsLayout: currentSuiteObsLayout(),
    }),
    saveSuiteFeatures: (flags) => {
      if (flags?.suiteObsLayout) {
        window.__SERVER_PREVIEW_OBS_LAYOUT__ = flags.suiteObsLayout;
      }
      return fetch('/dev/preview/suite-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flags || {}),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body?.layout) {
            window.__SERVER_PREVIEW_OBS_LAYOUT__ = body.layout;
            emit('suite-layout-changed', body.layout);
          }
          return ok();
        })
        .catch(() => ok());
    },
    exportSettingsDialog: () => ok({ path: 'preview-export.json' }),
    importSettingsDialog: () => ok({ importedKeys: ['ui.themePreference'] }),
    getSuitePresets: () => {
      const store = readStore();
      const presets = ensureDataSlots(store.presets);
      if (!store.presets) writeStore({ presets });
      return pass(presets);
    },
    saveSuitePreset: (opts) => {
      const store = readStore();
      const presets = ensureDataSlots(store.presets);
      const id = String(opts?.id || '');
      const slotIds = ['data-slot-1', 'data-slot-2', 'data-slot-3'];
      if (!slotIds.includes(id)) {
        return Promise.resolve({ success: false, error: 'スロット ID が不正です' });
      }
      const name = String(opts?.name || '').trim().slice(0, 32);
      if (!name) return Promise.resolve({ success: false, error: 'スロット名を入力してください' });
      const now = new Date().toISOString();
      const summary = 'Discord ON · チャット ON · アバター ON';
      presets.slots = presets.slots.map((s) => (
        s.id === id
          ? { ...s, occupied: true, name, savedAt: now, summary }
          : s
      ));
      presets.activeId = id;
      presets.items = presets.slots.filter((s) => s.occupied).map((s) => ({
        id: s.id,
        name: s.name,
        savedAt: s.savedAt,
        summary: s.summary,
      }));
      writeStore({ presets });
      emit('suite-presets-changed', presets);
      return ok({ presets, appliedId: id });
    },
    applySuitePreset: (id) => {
      const store = readStore();
      const presets = ensureDataSlots(store.presets);
      const slot = presets.slots.find((s) => s.id === id);
      if (!slot?.occupied) {
        return Promise.resolve({ success: false, error: '空のスロットは読み込めません' });
      }
      presets.activeId = id;
      writeStore({ presets });
      emit('suite-presets-changed', presets);
      return ok({ presets });
    },
    deleteSuitePreset: (id) => {
      const store = readStore();
      const presets = ensureDataSlots(store.presets);
      const slot = presets.slots.find((s) => s.id === id);
      if (!slot?.occupied) {
        return Promise.resolve({ success: false, error: 'スロットはすでに空です' });
      }
      presets.slots = presets.slots.map((s) => (
        s.id === id
          ? { ...s, occupied: false, name: '', savedAt: null, summary: '' }
          : s
      ));
      if (presets.activeId === id) presets.activeId = null;
      presets.items = presets.slots.filter((s) => s.occupied).map((s) => ({
        id: s.id,
        name: s.name,
        savedAt: s.savedAt,
        summary: s.summary,
      }));
      writeStore({ presets });
      emit('suite-presets-changed', presets);
      return ok({ presets });
    },
    renameSuitePreset: (id, name) => {
      const store = readStore();
      const presets = ensureDataSlots(store.presets);
      const trimmed = String(name || '').trim().slice(0, 32);
      if (!trimmed) return Promise.resolve({ success: false, error: '名前を入力してください' });
      const slot = presets.slots.find((s) => s.id === id);
      if (!slot?.occupied) {
        return Promise.resolve({ success: false, error: '空のスロットは名前変更できません' });
      }
      presets.slots = presets.slots.map((s) => (
        s.id === id ? { ...s, name: trimmed } : s
      ));
      presets.items = presets.slots.filter((s) => s.occupied).map((s) => ({
        id: s.id,
        name: s.name,
        savedAt: s.savedAt,
        summary: s.summary,
      }));
      writeStore({ presets });
      emit('suite-presets-changed', presets);
      return ok({ presets });
    },
    getBroadcastTimer: () => pass({ elapsedMs: 125000, running: true, startedAt: Date.now() - 125000 }),
    getAvatarConfig: () => {
      const av = readStore().avatar || {};
      return pass({
        displayMode: av.displayMode || 'both',
        p1Label: av.p1Label || '配信者A',
        p2Label: av.p2Label || '配信者B',
        smileDetectEnabled: !!av.smileDetectEnabled,
        smileSensitivity: av.smileSensitivity ?? 50,
        obsUrl: 'http://127.0.0.1:3003/overlay',
        micADeviceId: av.micADeviceId || 'preview-mic-a',
        micBDeviceId: av.micBDeviceId || 'preview-mic-b',
      });
    },
    saveAvatarConfig: (settings) => {
      const prev = readStore().avatar || {};
      const next = { ...prev, ...(settings && typeof settings === 'object' ? settings : {}) };
      writeStore({ avatar: next });
      emit('avatar-config-changed', next);
      if (window.__UI_PREVIEW__) {
        fetch('/dev/preview/avatar-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayMode: next.displayMode,
            p1Label: next.p1Label,
            p2Label: next.p2Label,
          }),
        }).catch(() => {});
      }
      return ok();
    },
    getAvatarStatus: () => pass({ serverRunning: true, audioRunning: false }),
    openAvatarPreview: () => ok(),
    openImageFileDialog: () => pass(null),
    openDashboard: () => { window.open('/renderer/dashboard.html', '_blank'); },
    openSettings: () => {},
    obsConnect: () => ok(),
    obsDisconnect: () => ok(),
    obsGetStatus: () => pass({
      connected: true,
      streaming: true,
      recording: false,
      currentSceneName: '配信シーン',
      p1Muted: false,
      p2Muted: true,
      micSourceP1: 'マイク/AUX',
      micSourceP2: 'マイク2',
    }),
    obsListAudioInputs: () => pass({
      success: true,
      inputs: [{ inputName: 'マイク/AUX' }, { inputName: 'マイク2' }],
    }),
    obsListScenes: () => pass({ success: true, scenes: [{ sceneName: '配信シーン' }, { sceneName: '待機' }] }),
    obsSetCurrentScene: () => ok(),
    obsSetMute: () => ok(),
    obsGetConfig: () => {
      const store = readStore();
      return pass({
        micSourceP1: 'マイク/AUX',
        micSourceP2: 'マイク2',
        eventActions: store.obsEventActions || [],
      });
    },
    obsSaveConfig: () => ok(),
    saveObsEventActions: (rules) => {
      writeStore({ obsEventActions: Array.isArray(rules) ? rules : [] });
      return ok({ eventActions: rules });
    },
    testObsEventAction: () => ok({ skipped: true }),
    openRehearsalPreview: () => {
      window.open('/rehearsal', '_blank');
      return ok();
    },
    obsDetectSuiteSource: () => pass({ found: false, connected: false }),
    remoteGetConfig: () => {
      const r = getRemoteState();
      const addr = r.lanPreferredAddress || '192.168.1.42';
      return pass({
        enabled: r.enabled,
        port: r.port,
        maxSessions: r.maxSessions,
        hasRemotePin: !!r.pin,
        pinLength: r.pin.length,
        pin: r.pin,
        lanPreferredAddress: r.lanPreferredAddress,
        lanCandidates: [
          { interfaceName: 'en0', address: '192.168.1.42' },
          { interfaceName: 'en1', address: '10.0.0.5' },
        ],
        remoteLanUrl: r.enabled ? `http://${addr}:${r.port}/` : '',
        remoteLanQrDataUrl: r.enabled ? REMOTE_QR : '',
        sessions: r.sessions,
        serverRunning: r.serverRunning,
      });
    },
    remoteListSessions: () => pass(getRemoteState().sessions),
    remoteRevokeSession: (sessionId) => {
      const cur = getRemoteState();
      const sessions = (cur.sessions || []).filter((s) => s.sessionId !== sessionId);
      patchRemote({ sessions });
      emit('remote-sessions-changed', sessions);
      return ok();
    },
    remoteRegeneratePin: () => {
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      patchRemote({ pin, sessions: [] });
      emit('remote-sessions-changed', []);
      return ok({ pin });
    },
    remoteRestartServer: () => ok({ running: getRemoteState().enabled }),
    on: (channel, callback) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
      return () => listeners.get(channel)?.delete(callback);
    },
    send: () => {},
  };

  window.__UI_PREVIEW__ = true;
  console.info('[UI Preview] electronAPI mock loaded');

  window.addEventListener('storage', (e) => {
    if (e.key !== PREVIEW_STORE_KEY || !e.newValue) return;
    try {
      const store = JSON.parse(e.newValue);
      if (store.ytConfig) emit('yt-config-changed', store.ytConfig);
      if (store.pinned) emit('yt-pin-changed', store.pinned);
      if (store.avatar) emit('avatar-config-changed', store.avatar);
    } catch (_) { /* ignore */ }
  });

  window.addEventListener('DOMContentLoaded', () => {
    MOCK_CHAT_MESSAGES.forEach((msg, i) => {
      setTimeout(() => emit('yt-message', msg), 400 + i * 350);
    });
  });
})();
