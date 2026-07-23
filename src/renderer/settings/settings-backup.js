'use strict';

function bindSettingsBackup() {
  document.getElementById('btn-settings-export')?.addEventListener('click', async () => {
    const r = await api.exportSettingsDialog().catch((e) => ({ success: false, error: e.message }));
    if (r.canceled) return;
    if (!r.success) {
      showFb('general-fb', r.error || 'エクスポートに失敗しました', 'err');
      return;
    }
    showFb('general-fb', '設定をエクスポートしました。');
  });

  document.getElementById('btn-settings-import')?.addEventListener('click', async () => {
    if (!window.confirm(
      'インポートした設定で上書きします。シークレット（API キー等）は引き続きこの PC の値が使われます。続行しますか？',
    )) {
      return;
    }
    const r = await api.importSettingsDialog().catch((e) => ({ success: false, error: e.message }));
    if (r.canceled) return;
    if (!r.success) {
      showFb('general-fb', r.error || 'インポートに失敗しました', 'err');
      return;
    }
    suppressAutoSave++;
    const settingsSnap = await api.getSettings().catch(() => ({}));
    await initUiTheme(settingsSnap);
    applyCustomCssSettings(settingsSnap);
    await syncSuiteFeaturesFromStore({ includeLayout: true, refreshBadges: true });
    if (typeof initAvatar === 'function') await initAvatar();
    if (typeof initYoutube === 'function') await initYoutube();
    if (typeof initRemoteSettings === 'function') await initRemoteSettings();
    if (typeof initObsWsSettings === 'function') {
      await initObsWsSettings(await loadSettingsSnapshot());
    }
    if (typeof initSuitePresets === 'function') await initSuitePresets();
    suppressAutoSave--;
    showFb('general-fb', `設定をインポートしました（${(r.importedKeys || []).length} 項目）。`);
    refreshSetupChecklist({ immediate: true, detectObs: true });
  });
}
