'use strict';

const api = window.electronAPI;

const chatList = document.getElementById('chat-list');
const scArea = document.getElementById('superchat-area');
const pinPanel = document.getElementById('pin-panel');
const pinSection = document.getElementById('pin-section');
const pinCountEl = document.getElementById('pin-count');
const sessionLogSection = document.getElementById('session-log-section');
const remoteActorToastEl = document.getElementById('remote-actor-toast');
let remoteActorToastTimer = null;
const participantList = document.getElementById('participant-list');
const participantCount = document.getElementById('participant-count');
const btnClearSession = document.getElementById('btn-clear-session');
const ngFilterCount = document.getElementById('ng-filter-count');
const ngWordList = document.getElementById('ng-word-list');
const ngUserList = document.getElementById('ng-user-list');
const ngWordInput = document.getElementById('ng-word-input');
const ngUserInput = document.getElementById('ng-user-input');
const btnNgWordAdd = document.getElementById('btn-ng-word-add');
const btnNgUserAdd = document.getElementById('btn-ng-user-add');
const viewerModal = document.getElementById('viewer-modal');
const ytStatusBadge = document.getElementById('yt-status');
const btnToggleYt = document.getElementById('btn-toggle-yt');
const dashYtVideoId = document.getElementById('dash-yt-video-id');
const dashYtVideoSave = document.getElementById('dash-yt-video-save');
const dashYtVideoSummary = document.getElementById('dash-yt-video-summary');
const lampDiscord = document.getElementById('lamp-discord');
const lampYoutube = document.getElementById('lamp-youtube');
const lampAvatar = document.getElementById('lamp-avatar');
const dashOnAirLbl = document.getElementById('dash-onair-lbl');
const dashBroadcastTimer = document.getElementById('dash-broadcast-timer');
const dashClock = document.getElementById('dash-clock');

let isYtRunning = false;
let pinnedIds = new Set();
let chatLimit = 500;
let scLimit = 50;
let modalChannelId = null;
let badgeLabels = { first: '🔰初見', regular: '⭐常連' };

let rpcStatus = { state: 'disconnected', error: null };
let ytStatus = { pollerRunning: false, error: null };
let avStatus = { serverRunning: false, audioRunning: false, error: null };
let discordCredsOk = false;
let ytConfigCache = { videoId: '', hasApiKey: false };
let avConfigCache = {};
let timerState = { elapsedMs: 0, running: false, startedAt: null };
let clockIntervalId = null;
let sessionLogActive = false;
let lastSessionLog = null;

const sessionLogStatusEl = document.getElementById('session-log-status');
const sessionLogHighlightsEl = document.getElementById('session-log-highlights');
const btnSessionLogStart = document.getElementById('btn-session-log-start');
const btnSessionLogEnd = document.getElementById('btn-session-log-end');

const lampObsConn = document.getElementById('lamp-obs-conn');
const lampObsStream = document.getElementById('lamp-obs-stream');
const lampObsRecord = document.getElementById('lamp-obs-record');
const btnObsConnect = document.getElementById('btn-obs-connect');
const dashObsScene = document.getElementById('dash-obs-scene');
const dashObsMicP1 = document.getElementById('dash-obs-mic-p1');
const dashObsMicP2 = document.getElementById('dash-obs-mic-p2');
const btnObsMuteP1 = document.getElementById('btn-obs-mute-p1');
const btnObsMuteP2 = document.getElementById('btn-obs-mute-p2');
const btnObsRefreshInputs = document.getElementById('btn-obs-refresh-inputs');
const dashObsConnectedWrap = document.getElementById('dash-obs-connected-wrap');
const dashObsMicDetails = document.getElementById('dash-obs-mic-details');
const dashObsSetupHint = document.getElementById('dash-obs-setup-hint');
const dashObsError = document.getElementById('dash-obs-error');
const dashMuteInline = document.getElementById('dash-mute-inline');

let obsState = {
  connected: false,
  error: null,
  streaming: false,
  recording: false,
  currentSceneName: '',
  streamDurationMs: 0,
  streamDurationAt: 0,
  p1Muted: false,
  p2Muted: false,
};
let obsConfig = { micSourceP1: '', micSourceP2: '' };
let obsMicEditing = { p1: false, p2: false };
let suppressObsSceneSync = false;

function getMicSlotEls(slot) {
  const s = slot === 'p2' ? 'p2' : 'p1';
  return {
    select: document.getElementById(`dash-obs-mic-${s}`),
    muteBtn: document.getElementById(`btn-obs-mute-${s}`),
    display: document.getElementById(`obs-mic-src-display-${s}`),
    editPanel: document.getElementById(`obs-mic-edit-${s}`),
    editToggle: document.getElementById(`btn-obs-mic-edit-${s}`),
  };
}

const truncateMicName = (name, maxLen) => window.DashboardControls.truncateMicName(name, maxLen);

function updateObsMicRow(slot) {
  const els = getMicSlotEls(slot);
  const key = slot === 'p2' ? 'micSourceP2' : 'micSourceP1';
  const src = els.select?.value || obsConfig[key] || '';
  const hasSource = !!src;
  const editing = obsMicEditing[slot] || !hasSource;

  if (els.display) {
    els.display.textContent = truncateMicName(src);
    els.display.title = src || 'マイクソース未選択';
  }
  if (els.editPanel) els.editPanel.hidden = !editing;
  if (els.editToggle) els.editToggle.hidden = !hasSource || editing;
}

function updateObsMicRows() {
  updateObsMicRow('p1');
  updateObsMicRow('p2');
}

function setLamp(el, kind, title, opts = {}) {
  window.StatusIndicator?.apply(el, kind, title, opts);
}

function updateServiceLamps() {
  const S = window.AppStateUI;
  if (!S) return;
  window.DashboardControls.updateServiceLamps({
    elements: { discord: lampDiscord, youtube: lampYoutube, avatar: lampAvatar },
    flags: {
      discordOn: !!document.getElementById('dash-suite-dc')?.checked,
      youtubeOn: !!document.getElementById('dash-suite-yt')?.checked,
      avatarOn: !!document.getElementById('dash-suite-av')?.checked,
    },
    discord: { credsOk: discordCredsOk, rpcState: rpcStatus.state, error: rpcStatus.error },
    youtube: { ytCfg: ytConfigCache, pollerRunning: ytStatus.pollerRunning, error: ytStatus.error },
    avatar: {
      configReady: S.avatarConfigReady(avConfigCache),
      serverRunning: avStatus.serverRunning,
      audioRunning: avStatus.audioRunning,
      error: avStatus.error,
    },
  });
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getYtTimerDisplayMs() {
  let ms = timerState.elapsedMs || 0;
  if (timerState.running && timerState.startedAt) {
    ms += Math.max(0, Date.now() - timerState.startedAt);
  }
  return ms;
}

function isObsOnAirTimerActive() {
  return obsState.connected && obsState.streaming && obsState.streamDurationAt > 0;
}

function getOnAirDisplayMs() {
  if (isObsOnAirTimerActive()) {
    return obsState.streamDurationMs + Math.max(0, Date.now() - obsState.streamDurationAt);
  }
  return getYtTimerDisplayMs();
}

function updateTimerDisplay() {
  if (!dashBroadcastTimer) return;
  const usingObs = isObsOnAirTimerActive();
  const onAirActive = usingObs || timerState.running;
  dashBroadcastTimer.textContent = formatElapsed(getOnAirDisplayMs());
  if (dashOnAirLbl) dashOnAirLbl.classList.toggle('is-live', onAirActive);
  dashBroadcastTimer.title = usingObs
    ? 'OBS の配信経過時間（WebSocket の outputDuration）'
    : timerState.running
      ? 'YouTube チャット取得中の経過時間（停止すると一時停止）'
      : '停止中。OBS 配信中は OBS の時間を表示。それ以外は同じ動画 ID で再開すると続きからカウント';
}

function updateClockDisplay() {
  if (!dashClock) return;
  dashClock.textContent = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function startClockTick() {
  if (clockIntervalId) return;
  updateClockDisplay();
  updateTimerDisplay();
  clockIntervalId = setInterval(() => {
    updateClockDisplay();
    updateTimerDisplay();
  }, 1000);
}

function applyTimerState(state) {
  if (!state) return;
  timerState = {
    elapsedMs: state.elapsedMs || 0,
    running: !!state.running,
    startedAt: state.startedAt || null,
  };
  updateTimerDisplay();
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ja-JP');
}

function closeViewerModal() {
  viewerModal.classList.add('hidden');
  modalChannelId = null;
}

function renderParticipants(list) {
  participantCount.textContent = `${list.length}人`;
  participantList.innerHTML = '';
  if (!list.length) {
    participantList.className = 'participant-list empty';
    participantList.textContent = 'まだコメントがありません';
    return;
  }
  participantList.className = 'participant-list';
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'participant-item';
    row.dataset.channelId = p.id;
    const img = document.createElement('img');
    img.className = 'p-avatar';
    img.src = p.iconUrl || '';
    const info = document.createElement('div');
    info.className = 'p-info';
    const name = document.createElement('div');
    name.className = 'p-name';
    name.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'p-meta';
    meta.textContent = `今回 ${p.sessionComments} 件`;
    info.append(name, meta);
    row.append(img, info);
    row.addEventListener('click', () => openViewerModal(p.id));
    participantList.appendChild(row);
  }
}

async function openViewerModal(channelId) {
  const d = await api.getYtViewerDetail(channelId);
  if (!d) return;
  modalChannelId = channelId;
  document.getElementById('modal-title').textContent = d.name;
  document.getElementById('modal-channel-id').textContent = d.channelId;
  document.getElementById('modal-first-seen').textContent = formatDate(d.firstSeen);
  document.getElementById('modal-last-seen').textContent = formatDate(d.lastSeen);
  document.getElementById('modal-total').textContent =
    `${d.totalComments} 件` + (d.isRegular ? '（常連）' : '');
  document.getElementById('modal-session').textContent = `${d.sessionComments} 件`;
  viewerModal.classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeViewerModal);
viewerModal.addEventListener('click', (e) => {
  if (e.target === viewerModal) closeViewerModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !viewerModal.classList.contains('hidden')) {
    closeViewerModal();
  }
});
document.getElementById('modal-ng-user').addEventListener('click', async () => {
  if (!modalChannelId) return;
  await addNgUserFromDashboard(modalChannelId);
  closeViewerModal();
});
btnClearSession.addEventListener('click', async () => {
  await api.clearYtSession();
  renderParticipants([]);
});

function applySuiteBarFromRemote(f) {
  const dc = document.getElementById('dash-suite-dc');
  const yt = document.getElementById('dash-suite-yt');
  const av = document.getElementById('dash-suite-av');
  if (dc) dc.checked = f.discordEnabled !== false;
  if (yt) yt.checked = f.youtubeEnabled !== false;
  if (av) av.checked = !!f.avatarEnabled;
}

async function initSuiteBar() {
  const f = await api.getSuiteFeatures().catch(() => ({}));
  applySuiteBarFromRemote(f);
}

async function saveSuiteFromDashboard() {
  await api.saveSuiteFeatures({
    discordEnabled: document.getElementById('dash-suite-dc').checked,
    youtubeEnabled: document.getElementById('dash-suite-yt').checked,
    avatarEnabled: document.getElementById('dash-suite-av').checked,
  });
  updateServiceLamps();
}

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  api.openSettings();
});
document.getElementById('btn-open-rehearsal')?.addEventListener('click', async () => {
  const r = await api.openRehearsalPreview().catch((e) => ({ success: false, error: e.message }));
  if (!r?.success) window.alert(r?.error || 'リハーサルを開けませんでした');
});

function updatePinUI(list) {
  pinnedIds.clear();
  const pins = Array.isArray(list) ? list : (list ? [list] : []);
  for (const m of pins) {
    if (m?.id) pinnedIds.add(m.id);
  }
  document.querySelectorAll('.chat-item[data-msg-id]').forEach((el) => {
    const isPinned = pinnedIds.has(el.dataset.msgId);
    el.classList.toggle('is-pinned', isPinned);
    const btn = el.querySelector('md-icon-button.btn-pin');
    if (btn) {
      btn.selected = isPinned;
      btn.title = isPinned ? 'ピン留めを解除（クリック）' : 'OBSにピン留め（最大3件）';
    }
  });

  if (pinCountEl) pinCountEl.textContent = `${pins.length}件`;
  if (pinSection && pins.length > 0) pinSection.open = true;

  if (!pins.length) {
    pinPanel.className = 'pin-panel empty';
    pinPanel.textContent = 'ピン留め中のコメントはありません';
    return;
  }

  pinPanel.className = 'pin-panel';
  pinPanel.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'dash-muted-caption';
  head.textContent = pins.length > 1 ? `ピン留め ${pins.length} 件` : 'ピン留め';
  pinPanel.appendChild(head);
  for (const msg of pins) {
    const block = document.createElement('div');
    block.className = 'unpin-block';
    const author = document.createElement('div');
    author.className = 'pin-author';
    author.textContent = msg.author?.name ?? '不明';
    const text = document.createElement('div');
    text.className = 'pin-text';
    text.textContent = msg.text ?? '';
    const unpinBtn = document.createElement('md-text-button');
    unpinBtn.textContent = 'このピンを解除';
    unpinBtn.style.setProperty('--md-text-button-label-text-color', 'var(--md-sys-color-error)');
    unpinBtn.addEventListener('click', () => api.unpinYtMessage(msg.id));
    block.append(author, text, unpinBtn);
    pinPanel.appendChild(block);
  }
  const clearAll = document.createElement('md-outlined-button');
  clearAll.textContent = 'すべて解除';
  clearAll.style.setProperty('--md-outlined-button-label-text-color', 'var(--md-sys-color-error)');
  clearAll.style.setProperty('--md-outlined-button-outline-color', 'var(--md-sys-color-error)');
  clearAll.addEventListener('click', () => api.unpinYtMessage());
  pinPanel.appendChild(clearAll);
}

async function togglePin(msg) {
  if (pinnedIds.has(msg.id)) {
    await api.unpinYtMessage(msg.id);
  } else {
    await api.pinYtMessage(msg);
  }
}

function updateYtVideoSummary() {
  if (!dashYtVideoSummary) return;
  const id = (dashYtVideoId?.value || ytConfigCache.videoId || '').trim();
  if (!id) {
    dashYtVideoSummary.textContent = '動画ID';
    dashYtVideoSummary.title = '動画 ID を設定';
    return;
  }
  const short = id.length > 12 ? `${id.slice(0, 12)}…` : id;
  dashYtVideoSummary.textContent = `ID: ${short}`;
  dashYtVideoSummary.title = id;
}

function setYtToggleButton(running, hasError) {
  if (!btnToggleYt) return;
  if (running) {
    btnToggleYt.innerHTML = '<md-icon slot="icon">stop</md-icon>停止';
    btnToggleYt.title = 'チャット取得を停止';
  } else if (hasError) {
    btnToggleYt.innerHTML = '<md-icon slot="icon">refresh</md-icon>再試行';
    btnToggleYt.title = 'チャット取得を再試行';
  } else {
    btnToggleYt.innerHTML = '<md-icon slot="icon">play_arrow</md-icon>開始';
    btnToggleYt.title = 'チャット取得を開始';
  }
}

function updateYtStatus(st) {
  ytStatus = st || { pollerRunning: false, error: null };
  isYtRunning = st.pollerRunning;
  updateServiceLamps();
  if (!ytStatusBadge || !window.AppStateUI) return;
  const badge = window.AppStateUI.ytBadge({
    ytCfg: ytConfigCache,
    pollerRunning: !!st.pollerRunning,
    error: st.error,
  });
  window.AppStateUI.applyBadge(ytStatusBadge, badge, 'app-badge yt-status-compact');
  if (st.pollerRunning) {
    setYtToggleButton(true, false);
  } else if (st.error) {
    setYtToggleButton(false, true);
  } else {
    setYtToggleButton(false, false);
  }
}

btnToggleYt.addEventListener('click', async () => {
  if (isYtRunning) {
    await api.stopYtPoller();
    updateYtStatus(await api.getYtStatus());
    return;
  }
  if (!window.YoutubeChatStartFlow || !window.DashboardYtStartUi) {
    await api.startYtPoller();
    updateYtStatus(await api.getYtStatus());
    return;
  }
  const ui = window.DashboardYtStartUi.createDashboardYtStartUi(api);
  await window.YoutubeChatStartFlow.runStart({
    prepare: () => api.prepareYtChatStart(),
    confirm: (videoId) => api.confirmYtChatStart(videoId),
    stop: () => api.stopYtPoller(),
    isRunning: () => isYtRunning,
    ui,
  });
  updateYtStatus(await api.getYtStatus());
});

async function applyYtVideoIdToConfig(videoId) {
  const cfg = await api.getYtConfig().catch(() => ({}));
  const payload = { ...cfg, videoId: (videoId || '').trim() };
  const r = await api.saveYtConfig(payload).catch((e) => ({ success: false, error: e.message }));
  return r;
}

dashYtVideoSave?.addEventListener('click', async () => {
  if (!dashYtVideoId) return;
  const r = await applyYtVideoIdToConfig(dashYtVideoId.value);
  if (!r.success) {
    if (ytStatusBadge && window.AppStateUI) {
      window.AppStateUI.applyBadge(
        ytStatusBadge,
        { text: 'IDエラー', cls: 'is-err', title: r.error || '動画 ID の保存に失敗しました' },
        'app-badge yt-status-compact',
      );
    }
  } else {
    ytConfigCache.videoId = dashYtVideoId.value.trim();
    updateYtVideoSummary();
    document.getElementById('dash-yt-video-details')?.removeAttribute('open');
  }
});
dashYtVideoId?.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  dashYtVideoSave?.click();
});

api.on('yt-status-changed', (data) => updateYtStatus(data));
api.on('rpc-status-changed', (data) => {
  rpcStatus = data || { state: 'disconnected' };
  updateServiceLamps();
});
api.on('avatar-status-changed', (data) => {
  avStatus = data || { serverRunning: false, audioRunning: false };
  updateServiceLamps();
});
api.on('broadcast-timer-changed', (state) => applyTimerState(state));
api.on('yt-pin-changed', (list) => updatePinUI(list));
api.on('yt-membership', (msg) => {
  const el = document.createElement('div');
  el.className = 'chat-item chat-item-membership';
  el.textContent = `🎉 ${msg.author?.name || 'メンバー'}: ${(msg.text || '').trim() || 'メンバーシップ'}`;
  scArea.appendChild(el);
  scArea.scrollTop = scArea.scrollHeight;
});
api.on('yt-session-changed', (list) => renderParticipants(list));

api.on('yt-message', (msg) => {
  const el = createMsgElement(msg);

  if (msg.superChat) {
    const scEl = createMsgElement(msg);
    scArea.appendChild(scEl);
    scArea.scrollTop = scArea.scrollHeight;
    while (scArea.children.length > scLimit) {
      scArea.removeChild(scArea.firstChild);
    }
  }

  chatList.appendChild(el);
  chatList.scrollTop = chatList.scrollHeight;
  while (chatList.children.length > chatLimit) {
    chatList.removeChild(chatList.firstChild);
  }
});

function createIconButton(className, iconName, title, onClick) {
  const btn = document.createElement('md-icon-button');
  btn.className = className;
  btn.toggle = true;
  btn.title = title;
  const icon = document.createElement('md-icon');
  icon.textContent = iconName;
  btn.appendChild(icon);
  btn.addEventListener('click', onClick);
  return btn;
}

function createMsgElement(msg) {
  const item = document.createElement('div');
  item.className = 'chat-item' + (msg.superChat ? ' sc-item' : '');
  if (msg.id) {
    item.dataset.msgId = msg.id;
    if (pinnedIds.has(msg.id)) item.classList.add('is-pinned');
  }

  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = msg.author.iconUrl || '';
  avatar.alt = '';

  const content = document.createElement('div');
  content.className = 'msg-content';

  const header = document.createElement('div');
  header.className = 'msg-header';

  const author = document.createElement('span');
  author.className = 'author-name';
  author.textContent = msg.author.name;
  header.appendChild(author);

  if (msg.author.isOwner) header.appendChild(createBadge('配信者', 'owner'));
  if (msg.author.isModerator) header.appendChild(createBadge('MOD', 'mod'));
  if (msg.author.isFirstTime) header.appendChild(createBadge(badgeLabels.first, 'first'));
  if (msg.author.isRegular) header.appendChild(createBadge(badgeLabels.regular, 'regular'));

  if (msg.superChat) {
    const scAmount = document.createElement('span');
    scAmount.className = 'sc-amount';
    scAmount.textContent = ` (${msg.superChat.amountDisplayString})`;
    header.appendChild(scAmount);
  }

  const text = document.createElement('div');
  text.className = 'msg-text';
  text.textContent = msg.text;

  content.appendChild(header);
  content.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'chat-actions';

  const isPinned = pinnedIds.has(msg.id);
  const pinBtn = createIconButton(
    'btn-pin',
    'push_pin',
    isPinned ? 'ピン留めを解除' : 'OBSにピン留め（最大3件）',
    (e) => {
      e.stopPropagation();
      togglePin(msg);
    },
  );
  pinBtn.selected = isPinned;
  actions.appendChild(pinBtn);

  const ngUserBtn = document.createElement('md-icon-button');
  ngUserBtn.className = 'btn-ng';
  ngUserBtn.title = 'NGユーザーに追加';
  const ngIcon = document.createElement('md-icon');
  ngIcon.textContent = 'block';
  ngUserBtn.appendChild(ngIcon);
  ngUserBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (msg.author?.id) await addNgUserFromDashboard(msg.author.id);
  });
  actions.appendChild(ngUserBtn);

  if (sessionLogActive && msg.id) {
    const hlBtn = document.createElement('md-text-button');
    hlBtn.className = 'btn-highlight';
    hlBtn.textContent = '☆';
    hlBtn.title = 'ハイライトに追加';
    hlBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await api.markSessionHighlight(msg.id).catch((err) => ({ success: false, error: err.message }));
      if (r?.success) {
        hlBtn.classList.add('btn-highlight-marked');
        hlBtn.title = 'ハイライト済み';
      }
    });
    actions.appendChild(hlBtn);
  }

  item.appendChild(avatar);
  item.appendChild(content);
  item.appendChild(actions);
  return item;
}

function createBadge(text, type) {
  const b = document.createElement('span');
  b.className = `badge badge-${type}`;
  b.textContent = text;
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSessionElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function highlightKindLabel(kind) {
  if (kind === 'auto-first') return '初見';
  if (kind === 'auto-sc') return 'スパチャ';
  if (kind === 'manual') return '手動';
  return 'ハイライト';
}

function applySessionLogStatus(st = {}) {
  sessionLogActive = !!st.active;
  if (sessionLogStatusEl) {
    sessionLogStatusEl.textContent = st.active
      ? `記録中 · ${st.entryCount || 0}件`
      : '停止中';
    sessionLogStatusEl.classList.toggle('is-recording', !!st.active);
  }
  if (btnSessionLogStart) btnSessionLogStart.disabled = !!st.active;
  if (btnSessionLogEnd) btnSessionLogEnd.disabled = !st.active;
  if (sessionLogSection && st.active) sessionLogSection.open = true;
}

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

function showRemoteActorToast(data) {
  if (!remoteActorToastEl || !data) return;
  remoteActorToastEl.textContent = formatRemoteActionToast(data);
  remoteActorToastEl.hidden = false;
  if (remoteActorToastTimer) clearTimeout(remoteActorToastTimer);
  remoteActorToastTimer = setTimeout(() => {
    remoteActorToastEl.hidden = true;
  }, 2800);
}

function renderSessionHighlights(session) {
  if (!sessionLogHighlightsEl) return;
  if (!session || !session.highlights?.length) {
    sessionLogHighlightsEl.className = 'session-log-highlights empty';
    sessionLogHighlightsEl.textContent = session?.videoId
      ? 'ハイライトはありませんでした'
      : 'セッション終了後にハイライトと URL が表示されます';
    return;
  }
  sessionLogHighlightsEl.className = 'session-log-highlights';
  sessionLogHighlightsEl.innerHTML = session.highlights.map((h) => {
    const url = h.url || '';
    const t = formatSessionElapsed(h.sessionElapsedMs);
    return `
      <div class="session-log-item">
        <div class="session-log-item-kind">${escapeHtml(highlightKindLabel(h.kind))}</div>
        <div class="session-log-item-label">${escapeHtml(h.label || '')}</div>
        <div class="session-log-item-meta">${t}${url ? '' : ' · 動画ID未設定'}</div>
        ${url ? `<md-outlined-button type="button" class="btn-session-copy" data-url="${escapeHtml(url)}">URL をコピー</md-outlined-button>` : ''}
      </div>
    `;
  }).join('');
  sessionLogHighlightsEl.querySelectorAll('.btn-session-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url) navigator.clipboard?.writeText(url);
    });
  });
}

function bindSessionLogPanel() {
  btnSessionLogStart?.addEventListener('click', async () => {
    const vid = dashYtVideoId?.value?.trim() || ytConfigCache.videoId || '';
    const r = await api.startSessionLog(vid).catch((e) => ({ success: false, error: e.message }));
    if (!r?.success) window.alert(r?.error || 'セッションを開始できませんでした');
  });
  btnSessionLogEnd?.addEventListener('click', async () => {
    const r = await api.endSessionLog().catch((e) => ({ success: false, error: e.message }));
    if (!r?.success) window.alert(r?.error || 'セッションを終了できませんでした');
  });
  api.on('session-log-changed', (st) => applySessionLogStatus(st || {}));
  api.on('session-log-ended', (session) => {
    lastSessionLog = session;
    applySessionLogStatus({ active: false, entryCount: 0 });
    renderSessionHighlights(session);
    if (sessionLogSection && session?.highlights?.length) sessionLogSection.open = true;
  });
  api.on('remote-action', (data) => showRemoteActorToast(data || {}));
}

function renderNgFilterLists(ngWords = [], ngUserIds = []) {
  const words = Array.isArray(ngWords) ? ngWords : [];
  const users = Array.isArray(ngUserIds) ? ngUserIds : [];
  if (ngFilterCount) {
    ngFilterCount.textContent = `${words.length + users.length}件`;
  }
  if (ngWordList) {
    ngWordList.classList.toggle('empty', words.length === 0);
    ngWordList.innerHTML = words.map((word) => `
      <li class="ng-filter-item">
        <span class="ng-filter-item-text" title="${escapeHtml(word)}">${escapeHtml(word)}</span>
        <md-icon-button type="button" data-ng-remove-word="${escapeHtml(word)}" title="削除" aria-label="NGワードを削除">
          <md-icon>close</md-icon>
        </md-icon-button>
      </li>
    `).join('');
    ngWordList.querySelectorAll('[data-ng-remove-word]').forEach((btn) => {
      btn.addEventListener('click', () => removeNgWord(btn.dataset.ngRemoveWord));
    });
  }
  if (ngUserList) {
    ngUserList.classList.toggle('empty', users.length === 0);
    ngUserList.innerHTML = users.map((id) => `
      <li class="ng-filter-item">
        <span class="ng-filter-item-text" title="${escapeHtml(id)}">${escapeHtml(id)}</span>
        <md-icon-button type="button" data-ng-remove-user="${escapeHtml(id)}" title="削除" aria-label="NGユーザーを削除">
          <md-icon>close</md-icon>
        </md-icon-button>
      </li>
    `).join('');
    ngUserList.querySelectorAll('[data-ng-remove-user]').forEach((btn) => {
      btn.addEventListener('click', () => removeNgUser(btn.dataset.ngRemoveUser));
    });
  }
}

function applyNgFilterFromConfig(cfg) {
  renderNgFilterLists(cfg?.ngWords, cfg?.ngUserIds);
}

async function addNgWordFromDashboard(word) {
  const w = (word || '').trim();
  if (!w) return;
  const r = await api.addYtNgWord(w).catch((e) => ({ success: false, error: e.message }));
  if (r?.success === false) return;
  if (ngWordInput) ngWordInput.value = '';
  const cfg = await api.getYtConfig().catch(() => ({}));
  applyNgFilterFromConfig(cfg);
}

async function addNgUserFromDashboard(channelId) {
  const id = (channelId || '').trim();
  if (!id) return;
  const r = await api.addYtNgUser(id).catch((e) => ({ success: false, error: e.message }));
  if (r?.success === false) return;
  if (ngUserInput) ngUserInput.value = '';
  const cfg = await api.getYtConfig().catch(() => ({}));
  applyNgFilterFromConfig(cfg);
  document.getElementById('ng-filter-section')?.setAttribute('open', '');
}

async function removeNgWord(word) {
  const cfg = await api.getYtConfig().catch(() => ({}));
  const ngWords = (cfg.ngWords || []).filter((w) => w !== word);
  await api.saveYtConfig({ ngWords });
}

async function removeNgUser(channelId) {
  const cfg = await api.getYtConfig().catch(() => ({}));
  const ngUserIds = (cfg.ngUserIds || []).filter((id) => id !== channelId);
  await api.saveYtConfig({ ngUserIds });
}

function bindNgFilterPanel() {
  btnNgWordAdd?.addEventListener('click', () => addNgWordFromDashboard(ngWordInput?.value));
  btnNgUserAdd?.addEventListener('click', () => addNgUserFromDashboard(ngUserInput?.value));
  ngWordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNgWordFromDashboard(ngWordInput.value);
    }
  });
  ngUserInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNgUserFromDashboard(ngUserInput.value);
    }
  });
}

function applyBadgeLabelsFromConfig(cfg) {
  if (!cfg) return;
  if (cfg.badgeFirst !== undefined) badgeLabels.first = cfg.badgeFirst;
  if (cfg.badgeRegular !== undefined) badgeLabels.regular = cfg.badgeRegular;
  document.querySelectorAll('.badge-first').forEach((el) => {
    el.textContent = badgeLabels.first;
  });
  document.querySelectorAll('.badge-regular').forEach((el) => {
    el.textContent = badgeLabels.regular;
  });
}

function fillObsSelectOptions(select, items, selectedValue, emptyLabel) {
  if (!select) return;
  const getName = (item) => item.inputName || item.sceneName || String(item);
  select.innerHTML = '';
  const empty = document.createElement('md-select-option');
  empty.value = '';
  empty.innerHTML = `<div slot="headline">${emptyLabel}</div>`;
  select.appendChild(empty);
  for (const item of items) {
    const name = getName(item);
    const opt = document.createElement('md-select-option');
    opt.value = name;
    opt.innerHTML = `<div slot="headline">${name}</div>`;
    select.appendChild(opt);
  }
  select.value = selectedValue || '';
}

function setObsMuteButton(btn, muted, enabled) {
  const slot = btn?.id?.endsWith('p2') ? 'p2' : 'p1';
  const label = avConfigCache[slot === 'p2' ? 'p2Label' : 'p1Label'] || (slot === 'p2' ? '2人目' : '1人目');
  window.DashboardControls.updateMuteButton(btn, muted, enabled, label);
}

function updateObsMuteButtons() {
  const ready = obsState.connected;
  const p1src = dashObsMicP1?.value || obsConfig.micSourceP1 || '';
  const p2src = dashObsMicP2?.value || obsConfig.micSourceP2 || '';
  setObsMuteButton(btnObsMuteP1, obsState.p1Muted, ready && !!p1src);
  setObsMuteButton(btnObsMuteP2, obsState.p2Muted, ready && !!p2src);
  updateObsMicRows();
}

function showObsError(text) {
  if (!dashObsError) return;
  const msg = (text || '').trim();
  if (msg) {
    dashObsError.hidden = false;
    dashObsError.textContent = msg;
  } else {
    dashObsError.hidden = true;
    dashObsError.textContent = '';
  }
}

function updateObsDisconnectedUi() {
  const connected = obsState.connected;
  if (dashObsConnectedWrap) dashObsConnectedWrap.hidden = !connected;
  if (dashObsMicDetails) dashObsMicDetails.hidden = !connected;
  if (dashObsSetupHint) dashObsSetupHint.hidden = connected || !!obsState.error;
  if (dashMuteInline) dashMuteInline.hidden = !connected;
  showObsError(connected ? (obsState.error || '') : (obsState.error || ''));
}

function updateObsLamps() {
  if (!lampObsConn) return;
  const connTitle = obsState.connected
    ? (obsState.error ? `接続済み（${obsState.error}）` : 'OBS WebSocket 接続済み')
    : (obsState.error || 'OBS 未接続');
  setLamp(lampObsConn, obsState.connected ? 'ok' : (obsState.error ? 'err' : 'off'), connTitle, {
    style: 'chip',
    label: obsState.connected ? '接続' : '未接続',
    icon: obsState.connected ? 'link' : (obsState.error ? 'error' : 'link_off'),
  });
  setLamp(lampObsStream, obsState.streaming ? 'ok' : 'off',
    obsState.streaming ? '配信中（OBS・読み取りのみ）' : '配信していません', {
      style: 'chip',
      label: obsState.streaming ? '配信中' : '停止',
      icon: obsState.streaming ? 'play_circle' : 'pause_circle',
    });
  if (lampObsRecord) {
    setLamp(lampObsRecord, obsState.recording ? 'rec' : 'off',
      obsState.recording ? '録画中（OBS・読み取りのみ）' : '録画していません', {
        style: 'chip',
        label: obsState.recording ? '録画' : '停止',
      });
  }
  if (btnObsConnect) btnObsConnect.textContent = obsState.connected ? '再接続' : '接続';
  if (dashObsScene) dashObsScene.disabled = !obsState.connected;
  if (btnObsRefreshInputs) btnObsRefreshInputs.disabled = !obsState.connected;
  updateObsDisconnectedUi();
  updateObsMuteButtons();
}

function applyObsStatus(st) {
  if (!st) return;
  obsState = {
    connected: !!st.connected,
    error: st.error || null,
    streaming: !!st.streaming,
    recording: !!st.recording,
    currentSceneName: st.currentSceneName || '',
    streamDurationMs: Math.max(0, Number(st.streamDurationMs) || 0),
    streamDurationAt: Math.max(0, Number(st.streamDurationAt) || 0),
    p1Muted: !!st.p1Muted,
    p2Muted: !!st.p2Muted,
  };
  updateObsLamps();
  updateTimerDisplay();
  if (st.currentSceneName && dashObsScene && dashObsScene.value !== st.currentSceneName) {
    suppressObsSceneSync = true;
    dashObsScene.value = st.currentSceneName;
    suppressObsSceneSync = false;
  }
}

async function refreshObsScenes() {
  const r = await api.obsListScenes().catch(() => ({ success: false, scenes: [] }));
  if (!r.success) return;
  suppressObsSceneSync = true;
  fillObsSelectOptions(dashObsScene, r.scenes || [], obsState.currentSceneName, '—');
  suppressObsSceneSync = false;
}

async function refreshObsAudioInputs() {
  const r = await api.obsListAudioInputs().catch(() => ({ success: false, inputs: [] }));
  if (!r.success) return;
  fillObsSelectOptions(dashObsMicP1, r.inputs || [], obsConfig.micSourceP1, '— 未選択 —');
  fillObsSelectOptions(dashObsMicP2, r.inputs || [], obsConfig.micSourceP2, '— 未選択 —');
  updateObsMuteButtons();
  updateObsMicRows();
}

function updateObsMicLabels() {
  const p1 = avConfigCache.p1Label || '1人目';
  const p2 = avConfigCache.p2Label || '2人目';
  const el1 = document.getElementById('dash-obs-mic-label-p1');
  const el2 = document.getElementById('dash-obs-mic-label-p2');
  const mute1 = document.getElementById('dash-mute-label-p1');
  const mute2 = document.getElementById('dash-mute-label-p2');
  if (el1) el1.textContent = p1;
  if (el2) el2.textContent = p2;
  if (mute1) mute1.textContent = p1;
  if (mute2) mute2.textContent = p2;
  applyAvatarDisplayModeUi();
  updateObsMuteButtons();
}

/** アバター表示人数に合わせて未使用スロットのミュート／マイク行を隠す */
function applyAvatarDisplayModeUi() {
  const mode = avConfigCache.displayMode || 'both';
  const showP1 = mode === 'both' || mode === 'p1';
  const showP2 = mode === 'both' || mode === 'p2';
  if (btnObsMuteP1) btnObsMuteP1.hidden = !showP1;
  if (btnObsMuteP2) btnObsMuteP2.hidden = !showP2;
  const rowP1 = document.getElementById('obs-mic-row-p1');
  const rowP2 = document.getElementById('obs-mic-row-p2');
  if (rowP1) rowP1.hidden = !showP1;
  if (rowP2) rowP2.hidden = !showP2;
}

async function initObsDashboard() {
  obsConfig = await api.obsGetConfig().catch(() => ({}));
  updateObsMicLabels();
  updateObsMicRows();
  applyObsStatus(await api.obsGetStatus().catch(() => ({})));
  const conn = await api.obsConnect().catch(() => ({ success: false, error: '接続失敗' }));
  if (!conn.success && conn.error) {
    obsState.error = conn.error;
    updateObsLamps();
    return;
  }
  applyObsStatus(await api.obsGetStatus().catch(() => ({})));
  await Promise.all([refreshObsScenes(), refreshObsAudioInputs()]);
}

function bindObsDashboard() {
  btnObsConnect?.addEventListener('click', async () => {
    const r = await api.obsConnect().catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      obsState.connected = false;
      obsState.error = r.error || '接続失敗';
      updateObsLamps();
      return;
    }
    applyObsStatus(await api.obsGetStatus());
    await Promise.all([refreshObsScenes(), refreshObsAudioInputs()]);
  });

  btnObsRefreshInputs?.addEventListener('click', () => refreshObsAudioInputs());

  dashObsScene?.addEventListener('change', async () => {
    if (suppressObsSceneSync) return;
    const name = dashObsScene.value;
    if (!name || name === obsState.currentSceneName) return;
    const r = await api.obsSetCurrentScene(name).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      obsState.error = r.error;
      updateObsLamps();
      suppressObsSceneSync = true;
      dashObsScene.value = obsState.currentSceneName || '';
      suppressObsSceneSync = false;
    }
  });

  const onMicSourceChange = async (slot, selectEl) => {
    const key = slot === 'p2' ? 'micSourceP2' : 'micSourceP1';
    obsConfig[key] = selectEl?.value || '';
    await api.obsSaveConfig({ [key]: obsConfig[key] });
    obsMicEditing[slot] = !obsConfig[key];
    updateObsMuteButtons();
  };
  dashObsMicP1?.addEventListener('change', () => onMicSourceChange('p1', dashObsMicP1));
  dashObsMicP2?.addEventListener('change', () => onMicSourceChange('p2', dashObsMicP2));

  const bindMicEditToggle = (slot) => {
    const els = getMicSlotEls(slot);
    els.editToggle?.addEventListener('click', () => {
      obsMicEditing[slot] = true;
      updateObsMicRow(slot);
    });
  };
  bindMicEditToggle('p1');
  bindMicEditToggle('p2');

  btnObsMuteP1?.addEventListener('click', async () => {
    const r = await api.obsSetMute('p1', !obsState.p1Muted).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      obsState.error = r.error;
      updateObsLamps();
    }
  });
  btnObsMuteP2?.addEventListener('click', async () => {
    const r = await api.obsSetMute('p2', !obsState.p2Muted).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      obsState.error = r.error;
      updateObsLamps();
    }
  });

  api.on('obs-connection-changed', (s) => {
    obsState.connected = !!s?.connected;
    obsState.error = s?.error || null;
    updateObsLamps();
    if (s?.connected) {
      refreshObsScenes();
      refreshObsAudioInputs();
    }
  });
  api.on('obs-output-state-changed', (s) => {
    if (!s) return;
    obsState.streaming = !!s.streaming;
    obsState.recording = !!s.recording;
    if (s.streamDurationMs !== undefined) {
      obsState.streamDurationMs = Math.max(0, Number(s.streamDurationMs) || 0);
    }
    if (s.streamDurationAt !== undefined) {
      obsState.streamDurationAt = Math.max(0, Number(s.streamDurationAt) || 0);
    }
    updateObsLamps();
    updateTimerDisplay();
  });
  api.on('obs-scene-changed', (s) => {
    if (!s?.sceneName) return;
    obsState.currentSceneName = s.sceneName;
    if (dashObsScene && dashObsScene.value !== s.sceneName) {
      suppressObsSceneSync = true;
      dashObsScene.value = s.sceneName;
      suppressObsSceneSync = false;
    }
  });
  api.on('obs-mute-state-changed', (s) => {
    if (!s) return;
    obsState.p1Muted = !!s.p1Muted;
    obsState.p2Muted = !!s.p2Muted;
    updateObsMuteButtons();
  });
}

(async () => {
  const ui = await api.getSettings().catch(() => ({}));
  const uiTheme = {
    themePreference: window.AppTheme?.normalize(ui.themePreference) || 'system',
    accentPreset: window.AppTheme?.normalizeAccent(ui.accentPreset) || 'default',
  };
  window.AppTheme?.apply(uiTheme);

  await window.appUI.waitForMaterialReady();
  window.appUI.patchAllSwitches();

  ['dash-suite-dc', 'dash-suite-yt', 'dash-suite-av'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => { saveSuiteFromDashboard(); });
  });

  const st = await api.getYtStatus();
  updateYtStatus(st);
  updatePinUI(await api.getYtPinned());
  const cfg = await api.getYtConfig();
  ytConfigCache = { videoId: cfg.videoId || '', hasApiKey: !!cfg.hasApiKey };
  if (dashYtVideoId) dashYtVideoId.value = cfg.videoId || '';
  updateYtVideoSummary();
  applyBadgeLabelsFromConfig(cfg);
  applyNgFilterFromConfig(cfg);
  bindNgFilterPanel();
  bindSessionLogPanel();
  applySessionLogStatus(await api.getSessionLogStatus().catch(() => ({})));
  renderSessionHighlights(await api.getLastSessionLog().catch(() => null));
  renderParticipants(await api.getYtSessionParticipants());

  const settings = await api.getSettings().catch(() => ({}));
  discordCredsOk = /^\d{17,20}$/.test((settings.clientId || '').trim()) && !!settings.hasClientSecret;
  rpcStatus = await api.getRpcStatus().catch(() => ({ state: 'disconnected' }));
  avStatus = await api.getAvatarStatus().catch(() => ({ serverRunning: false, audioRunning: false }));
  avConfigCache = await api.getAvatarConfig().catch(() => ({}));
  updateObsMicLabels();
  await initObsDashboard();

  applyTimerState(await api.getBroadcastTimer().catch(() => null));
  startClockTick();

  await initSuiteBar();
  updateServiceLamps();
  bindObsDashboard();
  const suite = await api.getSuiteFeatures().catch(() => ({}));
  chatLimit = suite.dashboardChatLimit || 500;
  scLimit = suite.dashboardScLimit || 50;

  api.on('suite-features-changed', (f) => {
    if (!f) return;
    applySuiteBarFromRemote(f);
    if (f.dashboardChatLimit !== undefined) chatLimit = f.dashboardChatLimit || 500;
    if (f.dashboardScLimit !== undefined) scLimit = f.dashboardScLimit || 50;
    updateServiceLamps();
  });
  api.on('theme-preference-changed', (pref) => {
    uiTheme.themePreference = window.AppTheme?.normalize(pref) || 'system';
    window.AppTheme?.apply(uiTheme);
  });
  api.on('yt-config-changed', (cfg) => {
    ytConfigCache = { videoId: cfg?.videoId || '', hasApiKey: !!cfg?.hasApiKey };
    if (dashYtVideoId) dashYtVideoId.value = cfg?.videoId || '';
    updateYtVideoSummary();
    applyBadgeLabelsFromConfig(cfg);
    applyNgFilterFromConfig(cfg);
    if (cfg?.sessionLogLagOffsetMs !== undefined && lastSessionLog) {
      api.getLastSessionLog().then((s) => {
        lastSessionLog = s;
        renderSessionHighlights(s);
      }).catch(() => {});
    }
    updateServiceLamps();
  });
  api.on('accent-preference-changed', (accent) => {
    uiTheme.accentPreset = window.AppTheme?.normalizeAccent(accent) || 'default';
    window.AppTheme?.apply(uiTheme);
  });
  api.on('avatar-config-changed', (cfg) => {
    if (!cfg) return;
    avConfigCache = { ...avConfigCache, ...cfg };
    updateObsMicLabels();
    updateServiceLamps();
  });
  api.on('obs-config-changed', (cfg) => {
    if (!cfg) return;
    if (cfg.micSourceP1 !== undefined) obsConfig.micSourceP1 = cfg.micSourceP1 || '';
    if (cfg.micSourceP2 !== undefined) obsConfig.micSourceP2 = cfg.micSourceP2 || '';
    updateObsMuteButtons();
    updateObsMicRows();
  });
})();
