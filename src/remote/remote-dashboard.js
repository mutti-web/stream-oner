'use strict';

const TOKEN_KEY = 'remoteDashboardToken';
const LABEL_KEY = 'remoteDeviceLabel';
const TAB_KEY = 'remoteActiveTab';

let token = localStorage.getItem(TOKEN_KEY) || '';
let activeTab = 'remote';
let deviceLabel = localStorage.getItem(LABEL_KEY) || '';
let sessionId = '';
let state = null;
let ws = null;
let clockTimer = null;
let actorToastTimer = null;
const chatItems = [];
const pinnedIds = new Set();
const CHAT_LIMIT = 200;

let actionSheetCtx = null;

const SHEET_TITLES = {
  suite: '配信表示',
  pins: 'ピン留め',
  session: 'セッションログ',
  obs: 'OBS に接続',
};

const REMOTE_ACTION_LABELS = {
  'obs-connect': 'OBS に接続',
  'obs-mute': 'ミュートを変更',
  'obs-scene': 'シーンを変更',
  'yt-start': 'チャット取得を開始',
  'yt-confirm-start': 'チャット取得を開始',
  'yt-stop': 'チャット取得を停止',
  'yt-nudge-dismiss': '案内を非表示に設定',
  'suite-flags': '配信表示を変更',
  'yt-pin': 'コメントをピン留め',
  'yt-unpin': 'ピン留めを解除',
  'yt-ng-user': 'NGユーザーを追加',
  'yt-ng-word': 'NGワードを追加',
  'session-log-start': 'セッションログを開始',
  'session-log-end': 'セッションログを終了',
  'session-log-highlight': 'ハイライトを追加',
};

const $ = (id) => document.getElementById(id);

function formatRemoteActionToast(data = {}) {
  const who = String(data.deviceLabel || 'リモート').trim() || 'リモート';
  const base = REMOTE_ACTION_LABELS[data.action] || '操作を実行';
  const detail = String(data.detail || '').trim();
  if (data.action === 'obs-mute' && detail) {
    const [slot, muted] = detail.split('=');
    const slotLabel = slot === 'p2' ? '2人目' : '1人目';
    return `${who}が${slotLabel}を${muted === 'true' ? 'ミュート' : 'ミュート解除'}`;
  }
  if (data.action === 'obs-scene' && detail) {
    return `${who}がシーンを「${detail}」に変更`;
  }
  return `${who}が${base}`;
}

function showActorToast(data) {
  if (!data) return;
  if (data.sessionId && sessionId && data.sessionId === sessionId) return;
  const el = $('actor-toast');
  if (!el) return;
  el.textContent = formatRemoteActionToast(data);
  el.hidden = false;
  if (actorToastTimer) clearTimeout(actorToastTimer);
  actorToastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function applyUiTheme(ui) {
  if (!ui || !window.AppTheme) return;
  window.AppTheme.apply({
    themePreference: ui.themePreference,
    accentPreset: ui.accentPreset,
  });
  updateThemeColorMeta();
}

function updateThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta || !window.AppTheme) return;
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--md-sys-color-background')
    .trim();
  if (bg) meta.content = bg;
}

async function initTheme() {
  if (window.__UI_PREFS__) {
    applyUiTheme(window.__UI_PREFS__);
    return;
  }
  try {
    const res = await fetch('/remote/ui-prefs');
    if (!res.ok) throw new Error('ui-prefs unavailable');
    applyUiTheme(await res.json());
  } catch (_) {
    updateThemeColorMeta();
  }
}

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { ...opts, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout();
      throw new Error('認証の有効期限が切れました');
    }
    return data;
  });
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatSessionElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function getOnAirMs() {
  if (!state) return 0;
  const obs = state.obs || {};
  if (obs.connected && obs.streaming && obs.streamDurationAt > 0) {
    return obs.streamDurationMs + Math.max(0, Date.now() - obs.streamDurationAt);
  }
  const t = state.timer || {};
  let ms = t.elapsedMs || 0;
  if (t.running && t.startedAt) ms += Math.max(0, Date.now() - t.startedAt);
  return ms;
}

function updateOnAir() {
  const obs = state?.obs || {};
  const live = (obs.connected && obs.streaming) || state?.timer?.running;
  $('onair-lbl')?.classList.toggle('live', !!live);
  if ($('onair-time')) $('onair-time').textContent = formatElapsed(getOnAirMs());
}

function updateServiceLamps() {
  if (!state) return;
  const suite = state.suite || {};
  const yt = state.yt || {};
  const av = state.avatar || {};
  const rpc = state.rpc || {};
  window.DashboardControls.updateServiceLamps({
    elements: { discord: $('lamp-discord'), youtube: $('lamp-youtube'), avatar: $('lamp-avatar') },
    flags: {
      discordOn: suite.discordEnabled !== false,
      youtubeOn: suite.youtubeEnabled !== false,
      avatarOn: !!suite.avatarEnabled,
    },
    discord: { credsOk: !!state.discordCredsOk, rpcState: rpc.state, error: rpc.error },
    youtube: { ytCfg: yt, pollerRunning: !!yt.pollerRunning, error: yt.error },
    avatar: {
      configReady: !!av.ready,
      serverRunning: !!av.serverRunning,
      audioRunning: !!av.audioRunning,
      error: av.error,
    },
  });
}

function applyObsScene(sceneName) {
  const sceneSel = $('sel-scene');
  const name = sceneName || state?.obs?.currentSceneName || '';
  if (sceneSel && name && sceneSel.value !== name) sceneSel.value = name;
}

function applyObsMuteButtons() {
  const obs = state?.obs || {};
  const av = state?.avatar || {};
  const p1Label = av.p1Label || '1人目';
  const p2Label = av.p2Label || '2人目';
  applyAvatarDisplayModeUi();
  document.querySelectorAll('.btn-mute').forEach((btn) => {
    if (btn.hidden) return;
    const slot = btn.dataset.slot;
    const muted = slot === 'p2' ? obs.p2Muted : obs.p1Muted;
    const src = slot === 'p2' ? obs.micSourceP2 : obs.micSourceP1;
    const ready = obs.connected && !!src;
    const label = slot === 'p2' ? p2Label : p1Label;
    window.DashboardControls.updateMuteButton(btn, muted, ready, label);
  });
}

function applyAvatarDisplayModeUi() {
  const mode = state?.avatar?.displayMode || 'both';
  const showP1 = mode === 'both' || mode === 'p1';
  const showP2 = mode === 'both' || mode === 'p2';
  const b1 = $('btn-mute-p1');
  const b2 = $('btn-mute-p2');
  if (b1) b1.hidden = !showP1;
  if (b2) b2.hidden = !showP2;
  document.querySelector('.remote-hero')?.classList.toggle('is-single-slot', mode !== 'both');
}

function updateObsConnectUi() {
  const obs = state?.obs || {};
  const connected = !!obs.connected;
  const sceneSel = $('sel-scene');
  if (sceneSel) sceneSel.disabled = !connected;
  if ($('obs-hint')) $('obs-hint').hidden = connected;
  const connectBtn = $('btn-obs-connect');
  if (connectBtn) connectBtn.textContent = connected ? '再接続' : 'OBS に接続';
  const statusEl = $('obs-sheet-status');
  if (statusEl) {
    statusEl.textContent = connected
      ? 'OBS に接続済みです。'
      : 'OBS 未接続です。下のボタンで接続してください。';
    statusEl.classList.toggle('is-connected', connected);
  }
}

function updateMenuBadges() {
  const pinCount = state?.pinned?.length || 0;
  const pinBadge = $('menu-pin-badge');
  if (pinBadge) {
    if (pinCount > 0) {
      pinBadge.hidden = false;
      pinBadge.textContent = String(pinCount);
    } else {
      pinBadge.hidden = true;
      pinBadge.textContent = '';
    }
  }
  const sessionBadge = $('menu-session-badge');
  if (sessionBadge) {
    sessionBadge.hidden = !state?.sessionLog?.active;
  }
}

function applySuiteToggles(suite = state?.suite || {}) {
  if ($('sw-discord')) $('sw-discord').checked = suite.discordEnabled !== false;
  if ($('sw-youtube')) $('sw-youtube').checked = suite.youtubeEnabled !== false;
  if ($('sw-avatar')) $('sw-avatar').checked = !!suite.avatarEnabled;
}

function applyYtUi(yt = state?.yt || {}) {
  const ytBadge = $('yt-badge');
  if (ytBadge && window.AppStateUI) {
    window.AppStateUI.applyBadge(
      ytBadge,
      window.AppStateUI.ytBadge({
        ytCfg: yt,
        pollerRunning: !!yt.pollerRunning,
        error: yt.error,
      }),
      'app-badge yt-status-compact',
    );
  }
  const ytBtn = $('btn-yt-toggle');
  if (ytBtn) ytBtn.textContent = yt.pollerRunning ? '停止' : '開始';
}

function updateMicLabels() {
  const av = state?.avatar || {};
  const p1 = av.p1Label || '1人目';
  const p2 = av.p2Label || '2人目';
  if ($('mute-lbl-p1')) $('mute-lbl-p1').textContent = p1;
  if ($('mute-lbl-p2')) $('mute-lbl-p2').textContent = p2;
}

function highlightKindLabel(kind) {
  if (kind === 'auto-first') return '初見';
  if (kind === 'auto-sc') return 'スパチャ';
  if (kind === 'manual') return '手動';
  return 'ハイライト';
}

function applySessionLogStatus(st = state?.sessionLog || {}) {
  const active = !!st.active;
  const statusEl = $('session-log-status');
  if (statusEl) {
    statusEl.textContent = active
      ? `記録中 · ${st.entryCount || 0}件`
      : '停止中';
    statusEl.classList.toggle('is-recording', active);
  }
  if ($('btn-session-start')) $('btn-session-start').disabled = active;
  if ($('btn-session-end')) $('btn-session-end').disabled = !active;
  updateMenuBadges();
}

function renderSessionHighlights(session) {
  const panel = $('session-highlights');
  if (!panel) return;
  if (!session || !session.highlights?.length) {
    panel.className = 'session-highlights empty';
    panel.textContent = session?.videoId
      ? 'ハイライトはありませんでした'
      : '記録終了後にハイライトと URL が表示されます';
    return;
  }
  panel.className = 'session-highlights';
  panel.innerHTML = session.highlights.map((h) => {
    const url = h.url || '';
    const t = formatSessionElapsed(h.sessionElapsedMs);
    return `
      <div class="session-item">
        <div class="session-item-kind">${escapeHtml(highlightKindLabel(h.kind))}</div>
        <div class="session-item-label">${escapeHtml(h.label || '')}</div>
        <div class="session-item-meta">${t}${url ? '' : ' · 動画ID未設定'}</div>
        ${url ? `<button type="button" class="btn btn-copy-url" data-url="${escapeHtml(url)}">URL をコピー</button>` : ''}
      </div>
    `;
  }).join('');
  panel.querySelectorAll('.btn-copy-url').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) navigator.clipboard?.writeText(url);
    });
  });
}

function syncPinnedIds(list = []) {
  pinnedIds.clear();
  for (const p of list) {
    if (p?.id) pinnedIds.add(p.id);
  }
  document.querySelectorAll('.chat-item[data-msg-id]').forEach((el) => {
    el.classList.toggle('is-pinned-outline', pinnedIds.has(el.dataset.msgId));
  });
}

function applyState(s) {
  state = s;
  if (s.ui) applyUiTheme(s.ui);
  applyObsScene();
  updateMicLabels();
  applyObsMuteButtons();
  updateObsConnectUi();
  applySuiteToggles(s.suite || {});
  applyYtUi(s.yt || {});
  updateServiceLamps();
  applySessionLogStatus(s.sessionLog || {});
  renderSessionHighlights(s.lastSessionLog || null);
  syncPinnedIds(s.pinned || []);
  renderPins(s.pinned || []);
  updateMenuBadges();
  updateOnAir();
}

function renderPins(list) {
  const panel = $('pin-panel');
  if (!panel) return;
  if (!list.length) {
    panel.className = 'pin-sheet-list empty';
    panel.textContent = 'ピン留めはありません';
    updateMenuBadges();
    return;
  }
  panel.className = 'pin-sheet-list';
  panel.innerHTML = list.map((p) => `
    <div class="pin-item">
      <div class="author">${escapeHtml(p.author?.name || '—')}</div>
      <div class="text">${escapeHtml(p.text || '')}</div>
      <button type="button" class="btn btn-unpin" data-unpin="${escapeHtml(p.id)}">解除</button>
    </div>
  `).join('');
  panel.querySelectorAll('[data-unpin]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      api('/remote/yt/unpin', { method: 'POST', body: JSON.stringify({ msgId: btn.dataset.unpin }) });
    });
  });
  updateMenuBadges();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pinMessage(msg) {
  if (!msg?.id) return;
  api('/remote/yt/pin', { method: 'POST', body: JSON.stringify({ message: msg }) });
}

function unpinMessage(msgId) {
  if (!msgId) return;
  api('/remote/yt/unpin', { method: 'POST', body: JSON.stringify({ msgId }) });
}

function ngUserFromMessage(msg) {
  const channelId = msg?.author?.id || '';
  if (!channelId || !channelId.startsWith('UC')) return;
  api('/remote/yt/ng-user', { method: 'POST', body: JSON.stringify({ channelId }) });
}

function markHighlight(msgId, el) {
  if (!msgId || !state?.sessionLog?.active) return;
  el?.classList.add('is-highlight-pending');
  api('/remote/session-log/highlight', { method: 'POST', body: JSON.stringify({ entryId: msgId }) })
    .then((r) => {
      if (r?.success) el?.classList.remove('is-highlight-pending');
    })
    .catch(() => el?.classList.remove('is-highlight-pending'));
}

function bindChatTap(el, msg) {
  el.addEventListener('click', () => openActionSheet(msg, el));
}

function openActionSheet(msg, el) {
  if (!msg) return;
  actionSheetCtx = { msg, el };
  const preview = $('action-sheet-preview');
  if (preview) {
    preview.innerHTML = `
      <div class="author">${escapeHtml(msg.author?.name || '—')}</div>
      <div class="text">${escapeHtml(msg.text || '')}</div>
    `;
  }
  const isPinned = msg.id && pinnedIds.has(msg.id);
  const channelId = msg.author?.id || '';
  const canNg = channelId.startsWith('UC');
  const canHighlight = !!(state?.sessionLog?.active && msg.id);
  if ($('action-pin')) $('action-pin').hidden = !msg.id || isPinned;
  if ($('action-unpin')) $('action-unpin').hidden = !isPinned;
  if ($('action-highlight')) $('action-highlight').hidden = !canHighlight;
  if ($('action-ng-user')) $('action-ng-user').hidden = !canNg;
  if ($('action-sheet-overlay')) $('action-sheet-overlay').hidden = false;
}

function closeActionSheet() {
  actionSheetCtx = null;
  if ($('action-sheet-overlay')) $('action-sheet-overlay').hidden = true;
}

function closeUtilSheet() {
  if ($('util-sheet-overlay')) $('util-sheet-overlay').hidden = true;
  document.querySelectorAll('.sheet-pane').forEach((p) => { p.hidden = true; });
}

function openUtilSheet(name) {
  setTopMenuOpen(false);
  const title = SHEET_TITLES[name] || '';
  if ($('util-sheet-title')) $('util-sheet-title').textContent = title;
  document.querySelectorAll('.sheet-pane').forEach((p) => { p.hidden = true; });
  const pane = $(`sheet-${name}`);
  if (pane) pane.hidden = false;
  if (name === 'obs') updateObsConnectUi();
  if ($('util-sheet-overlay')) $('util-sheet-overlay').hidden = false;
}

function buildChatItemEl(msg) {
  const el = document.createElement('div');
  el.className = 'chat-item' + (msg.superChat ? ' is-sc' : '');
  el.dataset.msgId = msg.id || '';
  el.setAttribute('role', 'listitem');
  if (msg.id && pinnedIds.has(msg.id)) el.classList.add('is-pinned-outline');
  el.innerHTML = `
    <div class="author">${escapeHtml(msg.author?.name || '—')}</div>
    <div class="text">${escapeHtml(msg.text || '')}</div>
  `;
  bindChatTap(el, msg);
  return el;
}

function appendChat(msg) {
  if (!msg) return;
  chatItems.unshift(msg);
  if (chatItems.length > CHAT_LIMIT) chatItems.length = CHAT_LIMIT;
  const list = $('chat-list');
  if (list) {
    list.prepend(buildChatItemEl(msg));
    while (list.children.length > CHAT_LIMIT) list.lastChild?.remove();
  }
}

function setActiveTab(tab) {
  activeTab = tab === 'chat' ? 'chat' : 'remote';
  localStorage.setItem(TAB_KEY, activeTab);
  $('tab-remote')?.classList.toggle('is-active', activeTab === 'remote');
  $('tab-chat')?.classList.toggle('is-active', activeTab === 'chat');
  if ($('tab-remote')) $('tab-remote').hidden = activeTab !== 'remote';
  if ($('tab-chat')) $('tab-chat').hidden = activeTab !== 'chat';
  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    const on = btn.dataset.tab === activeTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (ws) {
    try { ws.close(); } catch (_) { /* ignore */ }
    ws = null;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/remote/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
  };
  ws.onmessage = (ev) => {
    try {
      handleWs(JSON.parse(ev.data));
    } catch (_) { /* ignore */ }
  };
  ws.onclose = () => {
    ws = null;
    if (token) setTimeout(connectWs, 3000);
  };
}

function handleWs(msg) {
  switch (msg.type) {
    case 'auth-ok':
      if (msg.sessionId) sessionId = msg.sessionId;
      break;
    case 'auth-fail':
      logout();
      break;
    case 'state-snapshot':
      applyState(msg.data);
      break;
    case 'obs-output-state-changed':
      if (state) {
        state.obs = { ...state.obs, ...msg.data };
        updateOnAir();
      }
      break;
    case 'obs-mute-state-changed':
      if (state) {
        state.obs = { ...state.obs, ...msg.data };
        applyObsMuteButtons();
      }
      break;
    case 'obs-scene-changed':
      if (state?.obs) {
        state.obs.currentSceneName = msg.data?.sceneName || '';
        applyObsScene(state.obs.currentSceneName);
      }
      break;
    case 'obs-connection-changed':
      if (state) {
        state.obs = {
          ...state.obs,
          connected: !!msg.data?.connected,
          error: msg.data?.error ?? null,
        };
        applyObsMuteButtons();
        updateObsConnectUi();
        updateOnAir();
      }
      break;
    case 'obs-config-changed':
      if (state?.obs && msg.data) {
        state.obs = { ...state.obs, ...msg.data };
        applyObsMuteButtons();
      }
      break;
    case 'broadcast-timer-changed':
      if (state) {
        state.timer = msg.data;
        updateOnAir();
      }
      break;
    case 'suite-features-changed':
      if (state) {
        state.suite = { ...state.suite, ...msg.data };
        applySuiteToggles(state.suite);
        updateServiceLamps();
      }
      break;
    case 'yt-status-changed':
      if (state) {
        state.yt = { ...state.yt, ...msg.data };
        applyYtUi(state.yt);
        updateServiceLamps();
      }
      break;
    case 'rpc-status-changed':
      if (state) {
        state.rpc = { ...state.rpc, ...msg.data };
        updateServiceLamps();
      }
      break;
    case 'avatar-status-changed':
      if (state) {
        state.avatar = { ...state.avatar, ...msg.data };
        updateServiceLamps();
      }
      break;
    case 'avatar-config-changed':
      if (state) {
        state.avatar = { ...state.avatar, ...msg.data };
        updateMicLabels();
        applyObsMuteButtons();
        updateServiceLamps();
      }
      break;
    case 'yt-config-changed':
      if (state && msg.data) {
        state.yt = {
          ...state.yt,
          videoId: msg.data.videoId || '',
          hasApiKey: !!msg.data.hasApiKey,
        };
        applyYtUi(state.yt);
        updateServiceLamps();
      }
      break;
    case 'session-log-changed':
      if (state) {
        state.sessionLog = msg.data;
        applySessionLogStatus(msg.data);
      }
      break;
    case 'session-log-ended':
      if (state) {
        state.lastSessionLog = msg.data;
        state.sessionLog = { active: false, entryCount: 0, highlightCount: 0 };
        applySessionLogStatus(state.sessionLog);
        renderSessionHighlights(msg.data);
      }
      break;
    case 'yt-message':
      appendChat(msg.data);
      break;
    case 'yt-pin-changed':
      if (state) {
        state.pinned = msg.data;
        syncPinnedIds(msg.data);
        renderPins(msg.data);
        updateMenuBadges();
      }
      break;
    case 'remote-action':
      showActorToast(msg.data);
      break;
    case 'theme-preference-changed':
      if (state) {
        state.ui = { ...(state.ui || {}), themePreference: msg.data };
        applyUiTheme(state.ui);
      } else {
        applyUiTheme({ themePreference: msg.data, accentPreset: document.documentElement.dataset.accent || 'default' });
      }
      break;
    case 'accent-preference-changed':
      if (state) {
        state.ui = { ...(state.ui || {}), accentPreset: msg.data };
        applyUiTheme(state.ui);
      } else {
        applyUiTheme({
          themePreference: document.documentElement.dataset.theme || 'system',
          accentPreset: msg.data,
        });
      }
      break;
    default:
      break;
  }
}

async function refreshScenes() {
  const r = await api('/remote/obs/scenes');
  if (!r.success) return;
  const sel = $('sel-scene');
  if (!sel) return;
  const cur = state?.obs?.currentSceneName || '';
  sel.innerHTML = (r.scenes || []).map((s) => {
    const n = s.sceneName || s;
    return `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`;
  }).join('');
  if (cur) sel.value = cur;
  updateObsConnectUi();
}

async function loadInitial() {
  const r = await api('/remote/state');
  if (!r.success) throw new Error(r.error || '状態取得失敗');
  applyState(r.state);
  await refreshScenes();
}

function showApp() {
  $('login-screen').hidden = true;
  $('app-screen').hidden = false;
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(updateOnAir, 1000);
}

function logout() {
  setTopMenuOpen(false);
  closeActionSheet();
  closeUtilSheet();
  token = '';
  sessionId = '';
  localStorage.removeItem(TOKEN_KEY);
  if (ws) try { ws.close(); } catch (_) { /* ignore */ }
  ws = null;
  if (clockTimer) clearInterval(clockTimer);
  $('app-screen').hidden = true;
  $('login-screen').hidden = false;
}

async function login() {
  const pin = $('inp-pin')?.value?.trim();
  const label = $('inp-device-label')?.value?.trim() || '';
  const errEl = $('login-error');
  if (!pin) {
    if (errEl) { errEl.hidden = false; errEl.textContent = 'PIN を入力してください'; }
    return;
  }
  const r = await fetch('/remote/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, deviceLabel: label }),
  }).then((res) => res.json());
  if (!r.success) {
    if (errEl) { errEl.hidden = false; errEl.textContent = r.error || 'ログイン失敗'; }
    return;
  }
  token = r.token;
  deviceLabel = r.deviceLabel || label;
  sessionId = r.sessionId || '';
  localStorage.setItem(TOKEN_KEY, token);
  if (deviceLabel) localStorage.setItem(LABEL_KEY, deviceLabel);
  if (errEl) errEl.hidden = true;
  showApp();
  await loadInitial();
  connectWs();
}

function setTopMenuOpen(open) {
  const btn = $('btn-top-menu');
  const panel = $('top-menu-panel');
  if (!btn || !panel) return;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}

function bindUi() {
  $('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    login().catch((err) => {
      const errEl = $('login-error');
      if (errEl) { errEl.hidden = false; errEl.textContent = err.message; }
    });
  });
  $('btn-top-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setTopMenuOpen(!!$('top-menu-panel')?.hidden);
  });
  document.addEventListener('click', () => setTopMenuOpen(false));
  $('top-menu-wrap')?.addEventListener('click', (e) => e.stopPropagation());
  document.querySelectorAll('[data-open-sheet]').forEach((btn) => {
    btn.addEventListener('click', () => openUtilSheet(btn.dataset.openSheet));
  });
  $('util-sheet-close')?.addEventListener('click', closeUtilSheet);
  $('util-sheet-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('util-sheet-overlay')) closeUtilSheet();
  });
  $('action-sheet-close')?.addEventListener('click', closeActionSheet);
  $('action-cancel')?.addEventListener('click', closeActionSheet);
  $('action-sheet-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('action-sheet-overlay')) closeActionSheet();
  });
  $('yt-start-sheet-close')?.addEventListener('click', () => {
    window.RemoteYtStartUi?.closeSheet?.();
  });
  $('yt-start-sheet-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('yt-start-sheet-overlay')) {
      window.RemoteYtStartUi?.closeSheet?.();
    }
  });
  $('action-pin')?.addEventListener('click', () => {
    if (actionSheetCtx?.msg) pinMessage(actionSheetCtx.msg);
    closeActionSheet();
  });
  $('action-unpin')?.addEventListener('click', () => {
    if (actionSheetCtx?.msg?.id) unpinMessage(actionSheetCtx.msg.id);
    closeActionSheet();
  });
  $('action-highlight')?.addEventListener('click', () => {
    if (actionSheetCtx?.msg?.id) {
      markHighlight(actionSheetCtx.msg.id, actionSheetCtx.el);
    }
    closeActionSheet();
  });
  $('action-ng-user')?.addEventListener('click', () => {
    if (actionSheetCtx?.msg) ngUserFromMessage(actionSheetCtx.msg);
    closeActionSheet();
  });
  $('btn-logout')?.addEventListener('click', () => {
    setTopMenuOpen(false);
    logout();
  });

  document.querySelectorAll('.bottom-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  $('btn-obs-connect')?.addEventListener('click', () => {
    api('/remote/obs/connect', { method: 'POST', body: '{}' }).then(() => refreshScenes());
  });
  $('sel-scene')?.addEventListener('change', (e) => {
    const sceneName = e.target.value;
    if (sceneName) {
      api('/remote/obs/scene', { method: 'POST', body: JSON.stringify({ sceneName }) });
    }
  });
  document.querySelectorAll('.btn-mute').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.slot;
      const muted = slot === 'p2' ? state?.obs?.p2Muted : state?.obs?.p1Muted;
      api('/remote/obs/mute', { method: 'POST', body: JSON.stringify({ slot, muted: !muted }) });
    });
  });
  $('btn-yt-toggle')?.addEventListener('click', async () => {
    const running = state?.yt?.pollerRunning;
    if (running) {
      api('/remote/yt/stop', { method: 'POST', body: '{}' });
      return;
    }
    if (!window.YoutubeChatStartFlow || !window.RemoteYtStartUi) {
      api('/remote/yt/start', { method: 'POST', body: '{}' });
      return;
    }
    const ui = window.RemoteYtStartUi.createRemoteYtStartUi({
      dismissNudge: () => api('/remote/yt/nudge-dismiss', { method: 'POST', body: '{}' }),
    });
    await window.YoutubeChatStartFlow.runStart({
      prepare: () => api('/remote/yt/prepare-start', { method: 'POST', body: '{}' }),
      confirm: (videoId) => api('/remote/yt/confirm-start', {
        method: 'POST',
        body: JSON.stringify({ videoId }),
      }),
      stop: () => api('/remote/yt/stop', { method: 'POST', body: '{}' }),
      isRunning: () => !!state?.yt?.pollerRunning,
      ui,
    });
  });
  $('btn-session-start')?.addEventListener('click', () => {
    const vid = state?.yt?.videoId || '';
    api('/remote/session-log/start', { method: 'POST', body: JSON.stringify({ videoId: vid }) })
      .catch((e) => window.alert(e.message));
  });
  $('btn-session-end')?.addEventListener('click', () => {
    api('/remote/session-log/end', { method: 'POST', body: '{}' })
      .catch((e) => window.alert(e.message));
  });

  const suiteHandler = () => {
    api('/remote/suite-flags', {
      method: 'POST',
      body: JSON.stringify({
        discordEnabled: $('sw-discord')?.checked,
        youtubeEnabled: $('sw-youtube')?.checked,
        avatarEnabled: $('sw-avatar')?.checked,
      }),
    });
  };
  ['sw-discord', 'sw-youtube', 'sw-avatar'].forEach((id) => {
    $(id)?.addEventListener('change', suiteHandler);
  });
  if ($('inp-device-label') && deviceLabel) $('inp-device-label').value = deviceLabel;
}

async function boot() {
  await initTheme();
  const savedTab = localStorage.getItem(TAB_KEY);
  if (savedTab === 'chat' || savedTab === 'remote') activeTab = savedTab;
  setActiveTab(activeTab);
  bindUi();
  try {
    await window.appUI.waitForMaterialReady();
    window.appUI.patchAllSwitches();
  } catch (_) { /* Material 未読込 */ }
  if (token) {
    loadInitial().then(() => {
      showApp();
      connectWs();
    }).catch(logout);
  }
}

boot();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && token) connectWs();
});
