// ===== リアルタイム更新 =====
api.on('rpc-status-changed', (st) => {
  setRpcBadge(st);
  refreshSetupChecklist({ patch: { rpcSt: st } });
});
api.on('yt-status-changed', (st) => {
  setYtBadge(st);
  if (typeof updateYtChatBackendHint === 'function') updateYtChatBackendHint(st);
  refreshSetupChecklist({ patch: { ytSt: st } });
});
api.on('avatar-status-changed', (st) => {
  setAvBadge(st);
  refreshSetupChecklist({ patch: { avSt: st } });
});
api.on('avatar-config-changed', (cfg) => {
  if (!cfg) return;
  avConfigCache = { ...avConfigCache, ...cfg };
  api.getAvatarStatus().then((st) => {
    setAvBadge(st);
    refreshSetupChecklist({ patch: { av: { ...avConfigCache }, avSt: st } });
  }).catch(() => {});
});
api.on('avatar-audio-levels', updateAvVuMeters);
api.on('click-through-changed', v => { document.getElementById('click-through').checked = v; });
api.on('position-lock-changed', v => { document.getElementById('pos-lock').checked = v; });
api.on('suite-features-changed', (f) => { if (f) onSuiteFeaturesChangedRemote(f); });
api.on('obs-connection-changed', () => {
  refreshSetupChecklist({ immediate: true, detectObs: true });
});
api.on('yt-config-changed', (cfg) => {
  if (!cfg) return;
  ytConfigCache = { ...ytConfigCache, ...cfg };
  api.getYtStatus().then((st) => {
    setYtBadge(st);
    refreshSetupChecklist({
      immediate: true,
      patch: { yt: { ...ytConfigCache }, ytSt: st },
    });
  }).catch(() => {});
});
api.on('yt-oauth-changed', (status) => {
  if (typeof setYtOAuthUi === 'function') setYtOAuthUi(status);
  refreshSetupChecklist({ immediate: true, patch: { ytOAuth: status } });
});
api.on('theme-preference-changed', (pref) => {
  const p = window.AppTheme?.normalize(pref) || 'system';
  const sel = document.getElementById('ui-theme-preference');
  if (sel && sel.value !== p) sel.value = p;
  window.AppTheme?.apply({ ...currentUiThemeOptions(), themePreference: p });
});
api.on('accent-preference-changed', (accent) => {
  const a = window.AppTheme?.normalizeAccent(accent) || 'default';
  const sel = document.getElementById('ui-accent-preference');
  if (sel && sel.value !== a) sel.value = a;
  window.AppTheme?.apply({ ...currentUiThemeOptions(), accentPreset: a });
});

// ===== 起動 =====
(async () => {
  try {
  // Material Web の upgrade 完了を待ち、md-switch の .checked shim を当てる
  await window.appUI.waitForMaterialReady();
  window.appUI.patchAllSwitches();
  window.appUI.setMdFieldInitLocked(true);
  suppressAutoSave++;

  bindMainTabs();
  document.querySelectorAll('details').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) flushPendingMdFields(d);
    });
  });
  bindAvSubtabs();
  window.avatarSettingsUI?.ensureBuilt?.();
  bindDiscordActions();
  bindYoutubeActions();
  bindYoutubeOAuthActions();
  bindAvatarActions();
  bindGeneralActions();
  bindSuitePresets();
  bindSettingsBackup();
  bindRemoteSettings();
  bindObsEventActions();
  document.getElementById('btn-open-rehearsal')?.addEventListener('click', async () => {
    const r = await api.openRehearsalPreview().catch((e) => ({ success: false, error: e.message }));
    if (!r?.success) showFb('integration-fb', r?.error || 'リハーサルを開けませんでした', 'err');
  });

  wireAutoSavePanel('panel-general', debouncedSuiteFeatures, {
    getSuppress: () => suppressAutoSave,
    skipIds: [
      'suite-discord-enabled',
      'suite-youtube-enabled',
      'suite-avatar-enabled',
      'ui-theme-preference',
      'ui-accent-preference',
      'remote-enabled',
      'remote-port',
      'remote-max-sessions',
      'remote-lan-url',
      'remote-pin-display',
    ],
  });
  wireAutoSavePanel('panel-overlay', debouncedIntegrationFeatures, {
    getSuppress: () => suppressAutoSave,
    skipIds: [
      'suite-combined-url',
      'suite-dash-chat-limit',
      'suite-dash-sc-limit',
      'suite-url-discord',
      'suite-url-youtube',
      'suite-url-avatar',
      'click-through',
      'pos-lock',
    ],
  });
  document.getElementById('ui-theme-preference')?.addEventListener('change', () => {
    if (suppressAutoSave) return;
    debouncedUiTheme();
  });
  document.getElementById('ui-accent-preference')?.addEventListener('change', () => {
    if (suppressAutoSave) return;
    debouncedUiTheme();
  });
  wireAutoSavePanel('panel-accounts', debouncedDiscord, { getSuppress: () => suppressAutoSave });
  wireAutoSavePanel('panel-chat', debouncedYoutube, { getSuppress: () => suppressAutoSave });
  wireAutoSavePanel('panel-avatar', debouncedAvatar, { getSuppress: () => suppressAutoSave });

  const settingsSnap = await loadSettingsSnapshot();
  await initUiTheme(settingsSnap);
  applyCustomCssSettings(settingsSnap);
  await initObsWsSettings(settingsSnap);
  await initObsEventRules();
  await initRemoteSettings();
  await initSuiteFeatures();
  await initSuitePresets();
  await initDiscord(settingsSnap);
  await initYoutube();
  await initYoutubeOAuth();
  await initAvatar();
  // レイアウト確定後に保留中の value/label を一括適用（NaN keyframe 回避）
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  window.appUI.setMdFieldInitLocked(false);
  flushPendingMdFields(document.body);
  suppressAutoSave--;
  await refreshSetupChecklist({ immediate: true, detectObs: true });
  if (window.__UI_PREVIEW__) {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const focus = params.get('focus');
    if (tab) switchSettingsTab(tab);
    if (focus) setTimeout(() => scrollToSettingsSection(tab || 'overlay', focus), 350);

    let lastPreviewLayoutJson = '';
    setInterval(async () => {
      try {
        const res = await fetch(`/dev/preview/obs-layout?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const layout = await res.json();
        const json = JSON.stringify(layout);
        if (json === lastPreviewLayoutJson) return;
        lastPreviewLayoutJson = json;
        window.__SERVER_PREVIEW_OBS_LAYOUT__ = layout;
        suppressAutoSave++;
        fillSuiteLayoutPanel('discord', layout.discord);
        fillSuiteLayoutPanel('youtube', layout.youtube);
        fillSuiteLayoutPanel('avatar', layout.avatar);
        suppressAutoSave--;
      } catch (_) { /* retry */ }
    }, 1500);
  }
  } catch (e) {
    console.error('[Settings] 初期化エラー:', e);
    const snap = settingsSnapshot || await loadSettingsSnapshot().catch(() => ({}));
    if (typeof initDiscord === 'function') {
      await initDiscord(snap).catch(() => {});
    }
    if (typeof initYoutube === 'function') {
      await initYoutube().catch(() => {});
    }
    if (typeof initAvatar === 'function') {
      await initAvatar().catch(() => {});
    }
    if (typeof initSuitePresets === 'function') {
      await initSuitePresets().catch(() => {});
    }
    if (typeof initObsEventRules === 'function') {
      await initObsEventRules().catch(() => {});
    }
    window.appUI?.setMdFieldInitLocked?.(false);
    suppressAutoSave = 0;
  }
})();
