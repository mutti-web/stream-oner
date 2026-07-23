const SUITE_PORT_DEFAULTS = {
  discordHttp: 3000,
  discordWs: 3001,
  youtube: 3002,
  avatar: 3003,
};

function fillSuiteObsPorts(ports) {
  const p = { ...SUITE_PORT_DEFAULTS, ...(ports || {}) };
  const fields = [
    ['suite-port-discord-http', p.discordHttp],
    ['suite-port-discord-ws', p.discordWs],
    ['suite-port-youtube', p.youtube],
    ['suite-port-avatar', p.avatar],
  ];
  for (const [id, val] of fields) {
    const el = document.getElementById(id);
    if (el) setMdFieldValue(el, String(val));
  }
}

function buildSuiteObsPortsPayload() {
  return {
    discordHttp: readMdNum(document.getElementById('suite-port-discord-http'), SUITE_PORT_DEFAULTS.discordHttp),
    discordWs: readMdNum(document.getElementById('suite-port-discord-ws'), SUITE_PORT_DEFAULTS.discordWs),
    youtube: readMdNum(document.getElementById('suite-port-youtube'), SUITE_PORT_DEFAULTS.youtube),
    avatar: readMdNum(document.getElementById('suite-port-avatar'), SUITE_PORT_DEFAULTS.avatar),
  };
}

function updateSuiteObsUrlFields(ports) {
  const p = { ...SUITE_PORT_DEFAULTS, ...(ports || {}) };
  setMdFieldValue(document.getElementById('suite-url-discord'), `http://127.0.0.1:${p.discordHttp}/overlay`);
  setMdFieldValue(document.getElementById('suite-url-youtube'), `http://127.0.0.1:${p.youtube}/overlay`);
  setMdFieldValue(document.getElementById('suite-url-avatar'), `http://127.0.0.1:${p.avatar}/overlay`);
  const combined = document.getElementById('suite-combined-url');
  if (combined) setMdFieldValue(combined, `http://127.0.0.1:${p.discordHttp}/suite`);
}

const debouncedSuitePorts = debounce(async () => {
  const r = await api.saveSettings({ suiteObsPorts: buildSuiteObsPortsPayload() }).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    showFb('integration-fb', 'ポート設定を保存しました。反映にはアプリの再起動が必要です。');
    updateSuiteObsUrlFields(buildSuiteObsPortsPayload());
  } else {
    showFb('integration-fb', '保存エラー: ' + (r.error || ''), 'err');
  }
}, 700);

const SUITE_LAYOUT_DEFAULTS = {
  discord: { anchor: 'top-left', offsetX: 12, offsetY: 12, widthPx: 340, heightPx: 420 },
  youtube: { anchor: 'bottom-right', offsetX: 12, offsetY: 12, widthPx: 440, heightPx: 720 },
  avatar: { anchor: 'bottom-left', offsetX: 0, offsetY: 0, widthPx: 960, heightPx: 420 },
};

function readSuiteLayoutPanel(prefix) {
  const d = SUITE_LAYOUT_DEFAULTS[prefix] || {};
  const anchorRaw = readMdValue(document.getElementById(`suite-${prefix}-anchor`));
  const widthEl = document.getElementById(`suite-${prefix}-width`);
  return {
    anchor: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(anchorRaw)
      ? anchorRaw
      : (d.anchor || 'top-left'),
    offsetX: readMdNum(document.getElementById(`suite-${prefix}-offset-x`), d.offsetX),
    offsetY: readMdNum(document.getElementById(`suite-${prefix}-offset-y`), d.offsetY),
    widthPx: widthEl ? readMdNum(widthEl, d.widthPx) : d.widthPx,
    heightPx: readMdNum(document.getElementById(`suite-${prefix}-height`), d.heightPx),
  };
}

function buildSuiteObsLayoutPayload() {
  return {
    discord: readSuiteLayoutPanel('discord'),
    youtube: readSuiteLayoutPanel('youtube'),
    avatar: readSuiteLayoutPanel('avatar'),
  };
}

function fillSuiteLayoutPanel(prefix, panel) {
  const d = SUITE_LAYOUT_DEFAULTS[prefix] || {};
  const p = { ...d, ...(panel || {}) };
  const anchor = document.getElementById(`suite-${prefix}-anchor`);
  if (anchor) setMdFieldValue(anchor, p.anchor || d.anchor);
  const ox = document.getElementById(`suite-${prefix}-offset-x`);
  if (ox) setMdFieldValue(ox, String(p.offsetX ?? d.offsetX));
  const oy = document.getElementById(`suite-${prefix}-offset-y`);
  if (oy) setMdFieldValue(oy, String(p.offsetY ?? d.offsetY));
  const w = document.getElementById(`suite-${prefix}-width`);
  if (w) setMdFieldValue(w, String(p.widthPx ?? d.widthPx));
  const h = document.getElementById(`suite-${prefix}-height`);
  if (h) setMdFieldValue(h, String(p.heightPx ?? d.heightPx));
}

function syncDiscordConnectPanel(discordEnabled) {
  const on = discordEnabled !== false;
  const details = document.getElementById('discord-connect-details');
  const summary = document.getElementById('discord-connect-summary');
  if (summary) {
    summary.textContent = on
      ? 'Discord 接続'
      : 'Discord 接続（配信表示 OFF・任意）';
  }
  if (details) {
    // OFF 時は閉じる。ON に戻したときだけ自動で開く（手動で閉じた状態は尊重しない＝ON 時は開く）
    details.open = on;
  }
}

// ===== 配信表示 ON/OFF =====
function applySuiteFeaturesToSettingsUi(f, { includeLayout = false, layout = null } = {}) {
  const dc = document.getElementById('suite-discord-enabled');
  const yt = document.getElementById('suite-youtube-enabled');
  const dox = document.getElementById('suite-desktop-overlay-enabled');
  if (dc) dc.checked = f.discordEnabled !== false;
  if (yt) yt.checked = f.youtubeEnabled !== false;
  syncAvatarEnableToggles(!!f.avatarEnabled);
  if (dox) dox.checked = f.desktopOverlayEnabled !== false;
  syncDiscordConnectPanel(f.discordEnabled !== false);
  const dcl = document.getElementById('suite-dash-chat-limit');
  const dsl = document.getElementById('suite-dash-sc-limit');
  if (dcl && f.dashboardChatLimit !== undefined) setMdFieldValue(dcl, f.dashboardChatLimit ?? 500);
  if (dsl && f.dashboardScLimit !== undefined) setMdFieldValue(dsl, f.dashboardScLimit ?? 50);
  if (includeLayout && layout) {
    fillSuiteLayoutPanel('discord', layout.discord);
    fillSuiteLayoutPanel('youtube', layout.youtube);
    fillSuiteLayoutPanel('avatar', layout.avatar);
  }
  refreshSettingsSuiteIndicators();
}

async function syncSuiteFeaturesFromStore(opts = {}) {
  const f = await api.getSuiteFeatures().catch(() => ({}));
  suppressAutoSave++;
  applySuiteFeaturesToSettingsUi(f, {
    includeLayout: !!opts.includeLayout,
    layout: f.suiteObsLayout,
  });
  const curl = document.getElementById('suite-combined-url');
  if (curl && f.combinedObsUrl) setMdFieldValue(curl, f.combinedObsUrl);
  suppressAutoSave--;
  if (opts.refreshBadges) await refreshAllBadges();
  if (opts.refreshChecklist) refreshSetupChecklist({ immediate: true, detectObs: true });
}

function initSuiteObsUrls() {
  const ports = settingsSnapshot?.suiteObsPorts || SUITE_PORT_DEFAULTS;
  updateSuiteObsUrlFields(ports);
}

async function initSuiteFeatures() {
  await syncSuiteFeaturesFromStore({ includeLayout: true });
  const snap = await api.getSettings().catch(() => ({}));
  fillSuiteObsPorts(snap.suiteObsPorts);
  initSuiteObsUrls();
}

async function onSuiteFeaturesChangedRemote(f) {
  suppressAutoSave++;
  applySuiteFeaturesToSettingsUi(f);
  suppressAutoSave--;
  const { avSt, rpcSt, ytSt } = await refreshAllBadges();
  refreshSetupChecklist({
    immediate: true,
    patch: { f, avSt, rpcSt, ytSt },
  });
}

async function applySuiteFeatures(feedbackId = 'general-fb') {
  const payload = {
    discordEnabled: document.getElementById('suite-discord-enabled')?.checked,
    youtubeEnabled: document.getElementById('suite-youtube-enabled')?.checked,
    avatarEnabled: document.getElementById('suite-avatar-enabled')?.checked,
    desktopOverlayEnabled: document.getElementById('suite-desktop-overlay-enabled')?.checked,
    dashboardChatLimit: readMdNum(document.getElementById('suite-dash-chat-limit'), 500),
    dashboardScLimit: readMdNum(document.getElementById('suite-dash-sc-limit'), 50),
    suiteObsLayout: buildSuiteObsLayoutPayload(),
  };
  syncDiscordConnectPanel(payload.discordEnabled !== false);
  const r = await api.saveSuiteFeatures(payload).catch((e) => ({ success: false, error: e.message }));
  if (!r.success) {
    showFb(feedbackId, '機能ON/OFFの反映に失敗: ' + (r.error || ''), 'err');
    return r;
  }
  showFb(feedbackId, '機能設定を反映しました。');
  const { avSt, rpcSt, ytSt } = await refreshAllBadges();
  refreshSetupChecklist({
    immediate: true,
    patch: { avSt, rpcSt, ytSt },
  });
  return r;
}

function bindGeneralActions() {
  document.getElementById('browse-btn')?.addEventListener('click', async () => {
    const p = await api.openCssFileDialog();
    if (p) {
      document.getElementById('css-path').value = p;
      await persistCustomCssSettings();
    }
  });
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    document.getElementById('css-path').value = '';
    await persistCustomCssSettings();
  });

  document.getElementById('suite-combined-copy')?.addEventListener('click', () => {
    const url = readMdValue(document.getElementById('suite-combined-url'));
    if (url) {
      navigator.clipboard?.writeText(url).then(() => {
        showFb(activeSettingsFbId(), '統合 URL をコピーしました。');
        markSetupObsDone(false);
      });
    }
  });

  document.getElementById('setup-obs-done')?.addEventListener('click', () => markSetupObsDone(true));

  document.querySelectorAll('.suite-url-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.urlId);
      const url = readMdValue(input);
      if (url) {
        navigator.clipboard?.writeText(url).then(() => showFb('integration-fb', 'URL をコピーしました。'));
      }
    });
  });

  ['obs-ws-host', 'obs-ws-port'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (suppressAutoSave) return;
      debouncedObsWs();
    });
  });
  document.getElementById('obs-ws-password')?.addEventListener('blur', () => {
    if (!suppressAutoSave && readMdValue(document.getElementById('obs-ws-password')).trim()) {
      persistObsWsSettings();
    }
  });

  ['suite-discord-enabled', 'suite-youtube-enabled', 'suite-avatar-enabled', 'suite-desktop-overlay-enabled'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (id === 'suite-avatar-enabled') {
        syncAvatarEnableToggles(el.checked);
      }
      applySuiteFeatures('general-fb');
    });
  });
  ['suite-dash-chat-limit', 'suite-dash-sc-limit'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => applySuiteFeatures('integration-fb'));
  });

  const SUITE_LAYOUT_FIELD_IDS = [
    'suite-discord-anchor', 'suite-discord-width', 'suite-discord-offset-x', 'suite-discord-offset-y', 'suite-discord-height',
    'suite-youtube-anchor', 'suite-youtube-width', 'suite-youtube-offset-x', 'suite-youtube-offset-y', 'suite-youtube-height',
    'suite-avatar-anchor', 'suite-avatar-width', 'suite-avatar-height', 'suite-avatar-offset-x', 'suite-avatar-offset-y',
  ];
  SUITE_LAYOUT_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const saveLayout = () => {
      if (suppressAutoSave) return;
      debouncedIntegrationFeatures();
    };
    el.addEventListener('change', saveLayout);
    el.addEventListener('input', saveLayout);
  });

  ['suite-port-discord-http', 'suite-port-discord-ws', 'suite-port-youtube', 'suite-port-avatar'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => debouncedSuitePorts());
  });
}

const debouncedSuiteFeatures = debounce(() => applySuiteFeatures('general-fb'), 700);

const debouncedIntegrationFeatures = debounce(() => applySuiteFeatures('integration-fb'), 700);
