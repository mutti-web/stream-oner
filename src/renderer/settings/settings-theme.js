// ===== UI（テーマ） =====
function currentUiThemeOptions() {
  return {
    themePreference: window.AppTheme?.normalize(
      readMdValue(document.getElementById('ui-theme-preference')) || 'system',
    ) || 'system',
    accentPreset: window.AppTheme?.normalizeAccent(
      readMdValue(document.getElementById('ui-accent-preference')) || 'default',
    ) || 'default',
  };
}

async function initUiTheme(s) {
  const pref = window.AppTheme?.normalize(s.themePreference) || 'system';
  const accent = window.AppTheme?.normalizeAccent(s.accentPreset) || 'default';
  const themeSel = document.getElementById('ui-theme-preference');
  const accentSel = document.getElementById('ui-accent-preference');
  if (themeSel) themeSel.value = pref;
  if (accentSel) accentSel.value = accent;
  window.AppTheme?.apply({ themePreference: pref, accentPreset: accent });
}

async function persistUiTheme() {
  if (suppressAutoSave) return;
  const opts = currentUiThemeOptions();
  const r = await api.saveSettings(opts).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    patchSettingsSnapshot(opts);
    window.AppTheme?.apply(opts);
    showFb('general-fb', '保存しました。');
  } else {
    showFb('general-fb', '保存エラー: ' + (r.error || ''), 'err');
  }
}

// ===== Discord 初期化 =====
function applyCustomCssSettings(s) {
  const el = document.getElementById('css-path');
  if (el) el.value = s.customCssPath || '';
}

async function persistCustomCssSettings() {
  const pathVal = readMdValue(document.getElementById('css-path'));
  const r = await api.saveSettings({ customCssPath: pathVal }).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    patchSettingsSnapshot({ customCssPath: pathVal });
    showFb('integration-fb', pathVal ? 'カスタム CSS を保存しました。' : 'カスタム CSS をクリアしました。');
  } else {
    showFb('integration-fb', '保存エラー: ' + (r.error || ''), 'err');
  }
  return r;
}

const debouncedUiTheme = debounce(persistUiTheme, 700);
