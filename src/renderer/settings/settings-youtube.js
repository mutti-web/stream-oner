// ===== YouTube 初期化 =====
async function initYoutube() {
  suppressAutoSave++;
  const cfg = await api.getYtConfig().catch(() => ({}));
  ytConfigCache = cfg;
  setMdFieldValue(document.getElementById('yt-chat-source'), cfg.chatSource || 'auto');
  setMdFieldValue(document.getElementById('yt-interval'), cfg.pollingIntervalMs || 5000);
  setMdFieldValue(document.getElementById('yt-max'), String(cfg.maxComments || 8));
  setMdFieldValue(document.getElementById('yt-duration'), cfg.showDurationMs || 8000);
  setMdFieldValue(document.getElementById('yt-anim'), cfg.animMode || 'slide-up');
  setMdFieldValue(document.getElementById('yt-pos'), cfg.position || 'bottom-right');
  setMdFieldValue(document.getElementById('yt-width'), String(cfg.width ?? 400));
  setMdFieldValue(document.getElementById('yt-gap'), String(cfg.gap ?? 6));
  setMdFieldValue(document.getElementById('yt-badge-first'), cfg.badgeFirst !== undefined ? cfg.badgeFirst : '🔰初見');
  setMdFieldValue(document.getElementById('yt-badge-regular'), cfg.badgeRegular !== undefined ? cfg.badgeRegular : '⭐常連');
  setMdFieldValue(document.getElementById('yt-badge-threshold'), cfg.badgeThreshold || 10);
  setMdFieldValue(document.getElementById('yt-ng-words'), arrayToLines(cfg.ngWords));
  setMdFieldValue(document.getElementById('yt-ng-users'), arrayToLines(cfg.ngUserIds));
  const allowMembers = document.getElementById('yt-allow-members');
  const scOnly = document.getElementById('yt-sc-only');
  const hideBot = document.getElementById('yt-hide-bot');
  if (allowMembers) allowMembers.checked = !!cfg.allowMembersOnly;
  if (scOnly) scOnly.checked = !!cfg.showSuperChatOnly;
  if (hideBot) hideBot.checked = cfg.hideBotCommands !== false;
  setMdFieldValue(document.getElementById('yt-bot-prefix'), cfg.botCommandPrefix ?? '!');
  renderSuperChatTiers(cfg.superChatTiers);
  setMdFieldValue(document.getElementById('yt-session-lag'), String(Math.round((cfg.sessionLogLagOffsetMs || 0) / 1000)));
  setMdFieldValue(document.getElementById('yt-session-max-sessions'), String(cfg.sessionLogMaxSessions ?? 30));
  setMdFieldValue(document.getElementById('yt-session-max-days'), String(cfg.sessionLogMaxDays ?? 90));
  setMdFieldValue(document.getElementById('yt-obs-url'), cfg.obsUrl || 'http://127.0.0.1:3002/overlay');
  const keyHint = document.getElementById('yt-key-hint');
  keyHint.textContent = cfg.hasApiKey ? 'API キーは保存済みです' : '';
  const st = await api.getYtStatus().catch(() => ({ pollerRunning: false }));
  setYtBadge(st);
  updateYtChatBackendHint(st);
  suppressAutoSave--;
}

function updateYtChatBackendHint(st) {
  const el = document.getElementById('yt-chat-backend-hint');
  if (!el) return;
  if (!st?.pollerRunning) {
    el.textContent = '';
    return;
  }
  const src = st.chatSource || 'auto';
  const backend = st.activeChatBackend;
  const backendLabel = backend === 'innertube' ? 'InnerTube' : backend === 'dataapi' ? 'Data API' : '—';
  el.textContent = `取得中: ${backendLabel}（設定: ${src === 'auto' ? '自動' : src === 'innertube' ? 'InnerTube' : 'Data API'}）`;
}

function readSuperChatTiersFromDom() {
  const rows = document.querySelectorAll('#yt-sc-tiers-list .yt-sc-tier-row');
  return Array.from(rows).map((row) => ({
    minAmount: Number(readMdValue(row.querySelector('[data-field="minAmount"]'))) || 0,
    color: readMdValue(row.querySelector('[data-field="color"]')) || '#fbbf24',
    scale: Number(readMdValue(row.querySelector('[data-field="scale"]'))) || 1,
    durationMs: Number(readMdValue(row.querySelector('[data-field="durationMs"]'))) || 8000,
  }));
}

function renderSuperChatTiers(tiers) {
  const list = document.getElementById('yt-sc-tiers-list');
  if (!list) return;
  const items = Array.isArray(tiers) && tiers.length
    ? tiers
    : [
      { minAmount: 0, color: '#fbbf24', scale: 1, durationMs: 8000 },
      { minAmount: 500, color: '#f59e0b', scale: 1.05, durationMs: 10000 },
      { minAmount: 2000, color: '#ef4444', scale: 1.1, durationMs: 12000 },
    ];
  list.innerHTML = items.map((t, i) => `
    <div class="yt-sc-tier-row app-grid-2" data-tier-idx="${i}">
      <md-outlined-text-field data-field="minAmount" type="number" label="しきい値（円）" min="0" step="100" value="${Number(t.minAmount) || 0}"></md-outlined-text-field>
      <md-outlined-text-field data-field="color" label="色（#hex）" value="${String(t.color || '#fbbf24')}"></md-outlined-text-field>
      <md-outlined-text-field data-field="scale" type="number" label="拡大率" min="0.5" max="2" step="0.05" value="${Number(t.scale) || 1}"></md-outlined-text-field>
      <md-outlined-text-field data-field="durationMs" type="number" label="表示時間（ms）" min="1000" max="120000" step="500" value="${Number(t.durationMs) || 8000}"></md-outlined-text-field>
    </div>
  `).join('');
  list.querySelectorAll('md-outlined-text-field').forEach((el) => {
    el.addEventListener('change', () => debouncedYoutube());
    el.addEventListener('input', () => debouncedYoutube());
  });
}

function buildYtOverlayPayload() {
  return {
    maxComments: Number(readMdValue(document.getElementById('yt-max'))),
    showDurationMs: Number(readMdValue(document.getElementById('yt-duration'))),
    animMode: readMdValue(document.getElementById('yt-anim')),
    position: readMdValue(document.getElementById('yt-pos')),
    width: Number(readMdValue(document.getElementById('yt-width'))),
    gap: Number(readMdValue(document.getElementById('yt-gap'))),
    badgeFirst: readMdValue(document.getElementById('yt-badge-first')),
    badgeRegular: readMdValue(document.getElementById('yt-badge-regular')),
    badgeThreshold: Number(readMdValue(document.getElementById('yt-badge-threshold'))),
    superChatTiers: readSuperChatTiersFromDom(),
  };
}

function buildYtPayload() {
  let ngWords = linesToArray(readMdValue(document.getElementById('yt-ng-words')));
  let ngUserIds = linesToArray(readMdValue(document.getElementById('yt-ng-users')));
  if (!ngWords.length && ytConfigCache?.ngWords?.length) ngWords = [...ytConfigCache.ngWords];
  if (!ngUserIds.length && ytConfigCache?.ngUserIds?.length) ngUserIds = [...ytConfigCache.ngUserIds];

  const payload = {
    // 動画 ID はダッシュボード側。設定保存で空上書きしない
    videoId: String(ytConfigCache?.videoId || '').trim(),
    chatSource: readMdValue(document.getElementById('yt-chat-source')) || 'auto',
    pollingIntervalMs: Number(readMdValue(document.getElementById('yt-interval'))),
    maxComments: Number(readMdValue(document.getElementById('yt-max'))),
    showDurationMs: Number(readMdValue(document.getElementById('yt-duration'))),
    animMode: readMdValue(document.getElementById('yt-anim')),
    position: readMdValue(document.getElementById('yt-pos')),
    width: Number(readMdValue(document.getElementById('yt-width'))),
    gap: Number(readMdValue(document.getElementById('yt-gap'))),
    badgeFirst: readMdValue(document.getElementById('yt-badge-first')),
    badgeRegular: readMdValue(document.getElementById('yt-badge-regular')),
    badgeThreshold: Number(readMdValue(document.getElementById('yt-badge-threshold'))),
    ngWords,
    ngUserIds,
    allowMembersOnly: document.getElementById('yt-allow-members').checked,
    showSuperChatOnly: document.getElementById('yt-sc-only').checked,
    hideBotCommands: document.getElementById('yt-hide-bot').checked,
    botCommandPrefix: readMdValue(document.getElementById('yt-bot-prefix')).trim() || '!',
    superChatTiers: readSuperChatTiersFromDom(),
    sessionLogLagOffsetMs: Math.round(readMdNum(document.getElementById('yt-session-lag'), 0)) * 1000,
    sessionLogMaxSessions: readMdNum(document.getElementById('yt-session-max-sessions'), 30),
    sessionLogMaxDays: readMdNum(document.getElementById('yt-session-max-days'), 90),
  };
  const key = readMdValue(document.getElementById('yt-api-key')).trim();
  if (key) payload.apiKey = key;
  return payload;
}

async function persistYoutube() {
  if (suppressAutoSave) return;
  const key = readMdValue(document.getElementById('yt-api-key')).trim();
  const r = await api.saveYtConfig(buildYtPayload()).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    showFb('yt-fb', '保存しました。');
    ytConfigCache = {
      ...ytConfigCache,
      ...buildYtPayload(),
      hasApiKey: !!key || !!document.getElementById('yt-key-hint').textContent,
    };
    const ytSt = await api.getYtStatus().catch(() => ({ pollerRunning: false }));
    setYtBadge(ytSt);
    updateYtChatBackendHint(ytSt);
    refreshSetupChecklist({
      immediate: true,
      patch: { yt: { ...ytConfigCache }, ytSt },
    });
    if (key) {
      document.getElementById('yt-api-key').value = '';
      document.getElementById('yt-api-key').placeholder = '（保存済み）変更する場合のみ入力';
      document.getElementById('yt-key-hint').textContent = 'API キーは保存済みです';
    }
  } else {
    showFb('yt-fb', '保存エラー: ' + r.error, 'err');
  }
}

const debouncedYoutube = debounce(persistYoutube, 700);

document.getElementById('yt-api-key')?.addEventListener('blur', () => {
  if (!suppressAutoSave && readMdValue(document.getElementById('yt-api-key')).trim()) persistYoutube();
});

// ===== ポーラー制御 =====
function bindYoutubeActions() {
  document.getElementById('yt-start').addEventListener('click', async () => {
    const r = await api.startYtPoller().catch(e => ({ success: false, error: e.message }));
    if (!r.success) showFb('yt-conn-fb', 'エラー: ' + r.error, 'err');
    else {
      const st = await api.getYtStatus().catch(() => ({}));
      updateYtChatBackendHint(st);
    }
    refreshSetupChecklist({ immediate: true });
  });
  document.getElementById('yt-stop').addEventListener('click', async () => {
    await api.stopYtPoller();
    showFb('yt-conn-fb', 'ポーリングを停止しました。');
    updateYtChatBackendHint({ pollerRunning: false });
    refreshSetupChecklist({ immediate: true });
  });

  document.getElementById('yt-copy-url').addEventListener('click', () => {
    const url = readMdValue(document.getElementById('yt-obs-url'));
    navigator.clipboard?.writeText(url).then(() => showFb('yt-fb', 'URL をコピーしました。'));
  });
  document.getElementById('yt-go-suite-obs')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToSettingsSection('overlay', 'sec-setup-obs');
  });
  document.getElementById('gcloud-link').addEventListener('click', e => {
    e.preventDefault();
    api.openExternal('https://console.cloud.google.com/');
  });
}
