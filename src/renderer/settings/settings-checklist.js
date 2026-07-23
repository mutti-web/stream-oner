// ===== 初回セットアップ / 配信前チェック =====
const SETUP_OBS_KEY = 'stream-overlay-suite-setup-obs-done';
const SETUP_CHECKLIST_DEBOUNCE_MS = 300;

let lastObsDet = null;
let checklistPendingPatch = {};
let checklistDebounceTimer = null;
let checklistRefreshPromise = null;

function markSetupObsDone(notify = true) {
  try { localStorage.setItem(SETUP_OBS_KEY, '1'); } catch (_) {}
  refreshSetupChecklist({ immediate: true });
  if (notify) showFb(activeSettingsFbId(), 'OBS セットアップを完了にしました。');
}

function obsWsConfigOk(s) {
  const obsWsHost = String(s?.obsWsHost || '127.0.0.1').trim();
  const obsWsPort = Number(s?.obsWsPort ?? 4455);
  return !!obsWsHost && obsWsPort >= 1 && obsWsPort <= 65535 && !!s?.hasObsWsPassword;
}

/** @param {object} ctx */
function buildInitialSetupSteps(ctx) {
  const S = window.AppStateUI;
  const { f, s, yt, av, obsDet, obsDone, remote, ytOAuth } = ctx;
  const obsWsOk = obsWsConfigOk(s);
  const steps = [];
  const anyFeature = f.discordEnabled !== false || f.youtubeEnabled !== false || !!f.avatarEnabled;

  steps.push({
    id: 'features',
    label: '使う配信表示を選ぶ',
    desc: '下の「配信表示の ON/OFF」で Discord / チャット / アバターを切り替え',
    state: anyFeature ? 'done' : 'pending',
    action: 'scroll',
    sectionId: 'sec-suite-features',
    btnLabel: '配信表示の設定へ',
  });

  if (f.discordEnabled === false) {
    steps.push({ id: 'discord', label: 'Discord を設定', desc: 'Discord が OFF のため不要', state: 'skip', tab: 'accounts' });
  } else {
    const ok = S?.discordCredsOk(s) ?? false;
    steps.push({
      id: 'discord',
      label: 'Discord を設定',
      desc: '接続タブで Client ID と Client Secret を入力（自動保存）',
      state: ok ? 'done' : 'pending',
      tab: 'accounts',
      sectionId: 'discord-connect-details',
      btnLabel: '接続を開く',
    });
  }

  if (f.youtubeEnabled === false) {
    steps.push({ id: 'youtube', label: 'チャット設定', desc: 'チャットが OFF のため不要', state: 'skip', tab: 'accounts' });
  } else {
    const oauthLinked = S?.ytOAuthLinked(ytOAuth) ?? false;
    const videoReady = S?.ytVideoIdReady(yt) ?? false;
    const ok = S?.ytChatStartReady(yt, ytOAuth) ?? false;
    steps.push({
      id: 'youtube',
      label: oauthLinked ? 'YouTube 連携を確認' : 'チャット用の動画 ID を確認',
      desc: oauthLinked
        ? `連携済み（${ytOAuth.channelTitle || 'チャンネル'}）。配信開始後はダッシュボードで自動検出`
        : videoReady
          ? '動画 ID 設定済み。接続タブで YouTube 連携すると ID 入力を省略可能'
          : '接続タブで YouTube と連携（推奨）。手動ならダッシュボードで動画 ID を入力',
      state: ok ? 'done' : 'pending',
      tab: 'accounts',
      sectionId: 'sec-setup-yt-oauth',
      btnLabel: oauthLinked ? '接続を開く' : 'YouTube 連携へ',
    });
  }

  if (!f.avatarEnabled) {
    steps.push({ id: 'avatar', label: 'アバターを設定', desc: 'アバターが OFF のため不要', state: 'skip', tab: 'avatar' });
  } else {
    const ok = S?.avatarConfigReady(av) ?? false;
    steps.push({
      id: 'avatar',
      label: 'アバターを設定',
      desc: '全般で ON、アバタータブでマイクと PNG 素材（いずれか1枚以上）を登録',
      state: ok ? 'done' : 'pending',
      tab: 'avatar',
      btnLabel: 'アバター タブを開く',
    });
  }

  steps.push({
    id: 'obs-ws',
    label: 'OBS WebSocket を設定（推奨）',
    desc: '接続タブでホスト・ポート・パスワードを保存（ダッシュボードから OBS を操作）',
    state: obsWsOk ? 'done' : 'pending',
    action: 'scroll',
    tab: 'accounts',
    sectionId: 'sec-setup-obs-ws',
    btnLabel: 'WebSocket 設定へ',
  });

  steps.push({
    id: 'obs',
    label: 'OBS にブラウザソースを1つ追加',
    desc: obsDet?.found
      ? `OBS 上で統合 URL を検出しました（${obsDet.inputName || 'ブラウザ'}）。手動確認の場合は「OBS に追加した」でも完了にできます`
      : '統合 URL（http://127.0.0.1:3000/suite）を OBS のブラウザソースに貼り付け。WebSocket 接続時は自動検出します',
    state: obsDone ? 'done' : 'pending',
    action: 'scroll',
    tab: 'overlay',
    sectionId: 'sec-setup-obs',
    btnLabel: 'レイアウトへ',
    obs: true,
  });

  steps.push({
    id: 'remote',
    label: 'スマホダッシュボード（任意）',
    desc: remote?.enabled
      ? '有効化済み。LAN URL をスマホのブラウザで開き、PIN でログイン'
      : 'スマホから操作する場合は全般タブで有効化。使わない場合は不要',
    state: remote?.enabled ? 'done' : 'skip',
    action: 'scroll',
    tab: 'general',
    sectionId: 'sec-setup-remote',
    btnLabel: 'スマホ設定へ',
  });

  return steps;
}

/** @param {object} ctx */
function buildBroadcastSetupSteps(ctx) {
  const S = window.AppStateUI;
  const { f, yt, ytSt, rpcSt, obsSt, avSt, ytOAuth } = ctx;
  const steps = [];

  if (f.youtubeEnabled === false) {
    steps.push({ id: 'yt-video', label: '動画 ID を設定', desc: 'チャットが OFF のため不要', state: 'skip' });
  } else {
    const oauthLinked = S?.ytOAuthLinked(ytOAuth) ?? false;
    const videoReady = S?.ytVideoIdReady(yt) ?? false;
    const ok = S?.ytChatStartReady(yt, ytOAuth) ?? false;
    let desc = 'ダッシュボードで動画 ID を入力（または接続タブで YouTube 連携）';
    if (oauthLinked && videoReady) {
      desc = `連携済み・動画 ID 保存済み（${String(yt.videoId || '').trim()}）`;
    } else if (oauthLinked) {
      desc = '連携済み。配信開始後にダッシュボード「開始」で配信を検出';
    } else if (videoReady) {
      desc = `設定済み（${String(yt.videoId || '').trim()}）`;
    }
    steps.push({
      id: 'yt-video',
      label: oauthLinked ? 'YouTube 連携・動画 ID' : '動画 ID を設定',
      desc,
      state: ok ? 'done' : 'pending',
      tab: oauthLinked ? 'accounts' : undefined,
      sectionId: oauthLinked ? 'sec-setup-yt-oauth' : undefined,
      action: oauthLinked || videoReady ? undefined : 'dashboard',
      btnLabel: oauthLinked ? '接続を開く' : videoReady ? undefined : 'ダッシュボードを開く',
    });
  }

  const obsWsConfigured = obsWsConfigOk(ctx.s);
  let obsConnState = 'pending';
  let obsConnDesc = 'ダッシュボードの「OBS 接続」で WebSocket に接続';
  if (!obsWsConfigured) {
    obsConnDesc = '接続タブで WebSocket のホスト・ポート・パスワードを先に設定';
  } else if (obsSt?.connected) {
    obsConnState = 'done';
    obsConnDesc = 'OBS WebSocket に接続済み';
  } else if (obsSt?.error) {
    obsConnState = 'err';
    obsConnDesc = obsSt.error;
  }
  steps.push({
    id: 'obs-conn',
    label: 'OBS WebSocket 接続',
    desc: obsConnDesc,
    state: obsConnState,
  });

  if (f.discordEnabled === false) {
    steps.push({ id: 'discord-rpc', label: 'Discord RPC 接続', desc: 'Discord が OFF のため不要', state: 'skip' });
  } else if (!S?.discordCredsOk(ctx.s)) {
    steps.push({
      id: 'discord-rpc',
      label: 'Discord RPC 接続',
      desc: 'Client ID / Secret が未設定です（初回セットアップを完了してください）',
      state: 'pending',
    });
  } else if (rpcSt?.state === 'connected') {
    steps.push({ id: 'discord-rpc', label: 'Discord RPC 接続', desc: 'RPC 接続済み', state: 'done' });
  } else if (rpcSt?.state === 'connecting') {
    steps.push({ id: 'discord-rpc', label: 'Discord RPC 接続', desc: 'RPC 接続中…', state: 'pending' });
  } else if (rpcSt?.state === 'error') {
    steps.push({
      id: 'discord-rpc',
      label: 'Discord RPC 接続',
      desc: rpcSt.error || 'RPC エラー。Discord デスクトップアプリが起動しているか確認',
      state: 'err',
    });
  } else {
    steps.push({
      id: 'discord-rpc',
      label: 'Discord RPC 接続',
      desc: 'RPC 未接続。Discord デスクトップアプリを起動してください',
      state: 'pending',
    });
  }

  if (f.youtubeEnabled === false) {
    steps.push({ id: 'yt-poll', label: 'チャット取得を開始', desc: 'チャットが OFF のため不要', state: 'skip' });
  } else if (!S?.ytChatStartReady(yt, ytOAuth)) {
    steps.push({
      id: 'yt-poll',
      label: 'チャット取得を開始',
      desc: '接続タブで YouTube と連携するか、動画 ID を設定してからダッシュボードで「開始」',
      state: 'pending',
    });
  } else if (ytSt?.pollerRunning) {
    steps.push({ id: 'yt-poll', label: 'チャット取得を開始', desc: 'チャット取得：稼働中', state: 'done' });
  } else if (ytSt?.error) {
    steps.push({
      id: 'yt-poll',
      label: 'チャット取得を開始',
      desc: ytSt.error,
      state: 'err',
    });
  } else {
    steps.push({
      id: 'yt-poll',
      label: 'チャット取得を開始',
      desc: 'ダッシュボードの「チャット取得開始」で配信中の取得を開始',
      state: 'pending',
    });
  }

  if (!f.avatarEnabled) {
    steps.push({ id: 'avatar-run', label: 'アバターを稼働', desc: 'アバターが OFF のため不要', state: 'skip' });
  } else if (!S?.avatarConfigReady(ctx.av)) {
    steps.push({
      id: 'avatar-run',
      label: 'アバターを稼働',
      desc: 'マイクと PNG 素材が未設定です（初回セットアップを完了してください）',
      state: 'pending',
    });
  } else if (avSt?.error && !avSt?.serverRunning) {
    steps.push({
      id: 'avatar-run',
      label: 'アバターを稼働',
      desc: avSt.error,
      state: 'err',
    });
  } else if (avSt?.serverRunning && avSt?.audioRunning) {
    steps.push({ id: 'avatar-run', label: 'アバターを稼働', desc: 'サーバー・音声解析とも稼働中', state: 'done' });
  } else if (avSt?.serverRunning) {
    steps.push({
      id: 'avatar-run',
      label: 'アバターを稼働',
      desc: 'サーバーのみ稼働（音声解析が停止）。ダッシュボードで開始',
      state: 'pending',
    });
  } else {
    steps.push({
      id: 'avatar-run',
      label: 'アバターを稼働',
      desc: 'ダッシュボードでアバターサーバーを開始',
      state: 'pending',
    });
  }

  return steps;
}

function renderSetupIcon(icon, state, index) {
  icon.className = `setup-icon ${state}`;
  if (state === 'done') icon.textContent = '✓';
  else if (state === 'skip') icon.textContent = '—';
  else if (state === 'err') icon.textContent = '!';
  else icon.textContent = String(index + 1);
}

/** @param {object} st @param {boolean} showActions */
function setupActionsFingerprint(st, showActions) {
  if (!showActions) return '';
  const parts = [];
  if (st.state !== 'skip' && st.state !== 'done' && (st.btnLabel || st.tab || st.action)) {
    parts.push(`goto:${st.btnLabel || '設定へ'}`);
  }
  if (st.obs) {
    parts.push('copy');
    if (st.state !== 'done') parts.push('obs-done');
  }
  return parts.join('|');
}

/** @param {object} st @param {number} index @param {boolean} showActions */
function setupStepFingerprint(st, index, showActions) {
  return [
    st.id,
    st.state,
    st.label,
    st.desc,
    String(index),
    setupActionsFingerprint(st, showActions),
  ].join('\0');
}

/** @param {HTMLElement} actionsEl @param {object} st @param {boolean} showActions */
function fillSetupStepActions(actionsEl, st, showActions) {
  actionsEl.replaceChildren();
  if (!showActions) return;

  if (st.state !== 'skip' && st.state !== 'done' && (st.btnLabel || st.tab || st.action)) {
    const gotoBtn = document.createElement('md-text-button');
    gotoBtn.dataset.setupAction = 'goto';
    gotoBtn.textContent = st.btnLabel || '設定へ';
    actionsEl.appendChild(gotoBtn);
  }

  if (st.obs) {
    const copyBtn = document.createElement('md-text-button');
    copyBtn.dataset.setupAction = 'copy-url';
    copyBtn.textContent = 'URL をコピー';
    actionsEl.appendChild(copyBtn);
    if (st.state !== 'done') {
      const doneBtn = document.createElement('md-outlined-button');
      doneBtn.dataset.setupAction = 'obs-done';
      doneBtn.textContent = 'OBS に追加した';
      actionsEl.appendChild(doneBtn);
    }
  }
}

/** @param {object} st @param {number} index @param {boolean} showActions */
function createSetupStepElement(st, index, showActions) {
  const li = document.createElement('li');
  li.className = 'setup-item';
  li.dataset.stepId = st.id;

  const icon = document.createElement('span');
  icon.className = 'setup-icon';
  renderSetupIcon(icon, st.state, index);

  const body = document.createElement('div');
  body.className = 'setup-body';
  const lbl = document.createElement('div');
  lbl.className = 'setup-label';
  lbl.textContent = st.label;
  const desc = document.createElement('div');
  desc.className = 'setup-desc';
  desc.textContent = st.desc;
  const actions = document.createElement('div');
  actions.className = 'setup-actions';

  li.dataset.actionsKey = setupActionsFingerprint(st, showActions);
  fillSetupStepActions(actions, st, showActions);
  body.append(lbl, desc, actions);
  li.append(icon, body);
  li.dataset.fingerprint = setupStepFingerprint(st, index, showActions);
  return li;
}

/** @param {HTMLElement} li @param {object} st @param {number} index @param {boolean} showActions */
function patchSetupStepElement(li, st, index, showActions) {
  const fp = setupStepFingerprint(st, index, showActions);
  if (li.dataset.fingerprint === fp) return;

  const icon = li.querySelector('.setup-icon');
  if (icon) renderSetupIcon(icon, st.state, index);

  const lbl = li.querySelector('.setup-label');
  if (lbl) lbl.textContent = st.label;

  const desc = li.querySelector('.setup-desc');
  if (desc) desc.textContent = st.desc;

  const actionsKey = setupActionsFingerprint(st, showActions);
  if (li.dataset.actionsKey !== actionsKey) {
    const actions = li.querySelector('.setup-actions');
    if (actions) {
      li.dataset.actionsKey = actionsKey;
      fillSetupStepActions(actions, st, showActions);
    }
  }

  li.dataset.fingerprint = fp;
}

const setupListDelegationBound = new WeakSet();

/** @param {HTMLUListElement} list */
function ensureSetupListDelegation(list) {
  if (setupListDelegationBound.has(list)) return;
  setupListDelegationBound.add(list);
  list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-setup-action]');
    if (!btn || !list.contains(btn)) return;
    const stepId = btn.closest('[data-step-id]')?.dataset?.stepId;
    const st = list._setupSteps?.find((s) => s.id === stepId);
    if (!st) return;
    switch (btn.dataset.setupAction) {
      case 'goto':
        runSetupStepAction(st);
        break;
      case 'copy-url':
        document.getElementById('suite-combined-copy')?.click();
        break;
      case 'obs-done':
        markSetupObsDone(true);
        break;
      default:
        break;
    }
  });
}

function renderSetupSteps(list, steps, { showActions = true } = {}) {
  if (!list) return;
  ensureSetupListDelegation(list);
  list._setupSteps = steps;

  const existing = new Map();
  for (const child of list.children) {
    const id = child.dataset?.stepId;
    if (id) existing.set(id, child);
    else child.remove();
  }

  const stepIds = new Set(steps.map((st) => st.id));
  for (const [id, li] of existing) {
    if (!stepIds.has(id)) li.remove();
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    let li = existing.get(st.id);
    if (!li) {
      li = createSetupStepElement(st, i, showActions);
    } else {
      patchSetupStepElement(li, st, i, showActions);
    }
    frag.appendChild(li);
  }
  list.appendChild(frag);
}

/**
 * @param {object} patch
 * @param {{ detectObs?: boolean }} opts
 */
async function fetchChecklistContext(patch = {}, { detectObs = false } = {}) {
  const [
    f,
    s,
    yt,
    av,
    ytSt,
    obsDet,
    rpcSt,
    obsSt,
    avSt,
    remote,
    ytOAuth,
  ] = await Promise.all([
    patch.f ? Promise.resolve(patch.f) : api.getSuiteFeatures().catch(() => ({})),
    patch.s
      ? Promise.resolve(patch.s)
      : (settingsSnapshot
        ? Promise.resolve(settingsSnapshot)
        : api.getSettings().catch(() => ({}))),
    patch.yt ? Promise.resolve(patch.yt) : api.getYtConfig().catch(() => ({})),
    patch.av ? Promise.resolve(patch.av) : api.getAvatarConfig().catch(() => ({})),
    patch.ytSt !== undefined ? Promise.resolve(patch.ytSt) : api.getYtStatus().catch(() => ({})),
    detectObs
      ? api.obsDetectSuiteSource().catch(() => ({})).then((d) => {
        lastObsDet = d;
        return d;
      })
      : Promise.resolve(lastObsDet ?? {}),
    patch.rpcSt !== undefined ? Promise.resolve(patch.rpcSt) : api.getRpcStatus().catch(() => ({ state: 'disconnected' })),
    patch.obsSt !== undefined ? Promise.resolve(patch.obsSt) : api.obsGetStatus().catch(() => ({})),
    patch.avSt !== undefined ? Promise.resolve(patch.avSt) : api.getAvatarStatus().catch(() => ({})),
    patch.remote ? Promise.resolve(patch.remote) : api.remoteGetConfig().catch(() => ({})),
    patch.ytOAuth !== undefined
      ? Promise.resolve(patch.ytOAuth)
      : api.getYoutubeOAuthStatus().catch(() => ({})),
  ]);
  return { f, s, yt, av, ytSt, obsDet, rpcSt, obsSt, avSt, remote, ytOAuth };
}

function scheduleRefreshSetupChecklist() {
  clearTimeout(checklistDebounceTimer);
  checklistDebounceTimer = setTimeout(() => {
    checklistDebounceTimer = null;
    refreshSetupChecklistInternal({ detectObs: false });
  }, SETUP_CHECKLIST_DEBOUNCE_MS);
}

/**
 * @param {{ immediate?: boolean, detectObs?: boolean, patch?: object }} [opts]
 */
function refreshSetupChecklist(opts = {}) {
  if (opts.patch) Object.assign(checklistPendingPatch, opts.patch);
  if (opts.immediate || opts.detectObs) {
    clearTimeout(checklistDebounceTimer);
    checklistDebounceTimer = null;
    return refreshSetupChecklistInternal(opts);
  }
  scheduleRefreshSetupChecklist();
}

async function refreshSetupChecklistInternal(opts = {}) {
  if (checklistRefreshPromise) {
    return checklistRefreshPromise.then(() => refreshSetupChecklistInternal(opts));
  }

  checklistRefreshPromise = (async () => {
    const initialList = document.getElementById('setup-initial');
    const broadcastList = document.getElementById('setup-broadcast');
    const details = document.getElementById('setup-initial-details');
    if (!initialList && !broadcastList) return;

    const patch = { ...checklistPendingPatch };
    checklistPendingPatch = {};
    const ctx = await fetchChecklistContext(patch, { detectObs: !!opts.detectObs });
    const { f, s, yt, av, ytSt, obsDet, rpcSt, obsSt, avSt, remote, ytOAuth } = ctx;

    let obsDone = false;
    try { obsDone = localStorage.getItem(SETUP_OBS_KEY) === '1'; } catch (_) {}
    if (obsDet?.found && !obsDone) {
      try { localStorage.setItem(SETUP_OBS_KEY, '1'); } catch (_) {}
      obsDone = true;
    }

    const checklistCtx = { f, s, yt, av, ytSt, obsDet, obsDone, rpcSt, obsSt, avSt, remote, ytOAuth };
    const initialSteps = buildInitialSetupSteps(checklistCtx);
    const broadcastSteps = buildBroadcastSetupSteps(checklistCtx);

    renderSetupSteps(initialList, initialSteps, { showActions: true });
    renderSetupSteps(broadcastList, broadcastSteps, { showActions: true });

    if (details) {
      const initialComplete = initialSteps.every((st) => st.state === 'done' || st.state === 'skip');
      details.open = !initialComplete;
    }
  })().finally(() => {
    checklistRefreshPromise = null;
  });

  return checklistRefreshPromise;
}
