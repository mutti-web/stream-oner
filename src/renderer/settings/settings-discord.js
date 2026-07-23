async function initDiscord(s) {
  suppressAutoSave++;
  setMdFieldValue(document.getElementById('client-id'), s.clientId || '');
  const clickThrough = document.getElementById('click-through');
  const posLock = document.getElementById('pos-lock');
  if (clickThrough) clickThrough.checked = s.isClickThrough || false;
  if (posLock) posLock.checked = s.isPositionLocked || false;
  const hint = document.getElementById('secret-hint');
  const sec  = document.getElementById('client-secret');
  if (s.hasClientSecret) {
    sec.placeholder = '（保存済み）変更する場合のみ入力';
    hint.textContent = 'Client Secret は保存済みです';
  } else {
    sec.placeholder = 'Client Secret を入力...';
    hint.textContent = '';
  }
  const st = await api.getRpcStatus().catch(() => ({ state: 'disconnected' }));
  setRpcBadge(st);
  suppressAutoSave--;
}

async function persistDiscord() {
  if (suppressAutoSave) return;
  const clientId = readMdValue(document.getElementById('client-id')).trim();
  if (clientId && !/^\d{17,20}$/.test(clientId)) {
    document.getElementById('cid-err').classList.add('show');
    return;
  }
  document.getElementById('cid-err').classList.remove('show');
  const payload = { clientId };
  const sec = readMdValue(document.getElementById('client-secret')).trim();
  if (sec) payload.clientSecret = sec;
  const r = await api.saveSettings(payload).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    showFb('dc-fb', '保存しました。');
    patchSettingsSnapshot({ clientId });
    if (sec) patchSettingsSnapshot({ hasClientSecret: true });
    refreshSetupChecklist({ immediate: true, patch: { s: { ...settingsSnapshot } } });
    if (sec) {
      document.getElementById('client-secret').value = '';
      document.getElementById('client-secret').placeholder = '（保存済み）変更する場合のみ入力';
      document.getElementById('secret-hint').textContent = 'Client Secret は保存済みです';
    }
  } else {
    showFb('dc-fb', '保存エラー: ' + r.error, 'err');
  }
}

const debouncedDiscord = debounce(persistDiscord, 700);

document.getElementById('client-secret')?.addEventListener('blur', () => {
  if (!suppressAutoSave && readMdValue(document.getElementById('client-secret')).trim()) persistDiscord();
});

// ===== Discord 接続操作 =====
function bindDiscordActions() {
  document.getElementById('reconnect-btn').addEventListener('click', async () => {
    setRpcBadge({ state: 'connecting' });
    const r = await api.reconnectRpc().catch(e => ({ success: false, error: e.message }));
    showFb('dc-fb', r.success ? '再接続しました。' : 'エラー: ' + r.error, r.success ? 'ok' : 'err');
  });
  document.getElementById('clear-discord-auth-btn')?.addEventListener('click', async () => {
    setRpcBadge({ state: 'connecting' });
    const r = await api.clearDiscordOAuth().catch((e) => ({ success: false, error: e.message }));
    showFb(
      'dc-fb',
      r.success
        ? '保存済み認証をクリアしました。Discord の承認が必要な場合があります。'
        : 'エラー: ' + r.error,
      r.success ? 'ok' : 'err',
    );
    if (r.success) {
      const st = await api.getRpcStatus().catch(() => ({ state: 'disconnected' }));
      setRpcBadge(st);
    }
  });
  const openPortal = () => api.openExternal('https://discord.com/developers/applications');
  document.getElementById('portal-btn').addEventListener('click', openPortal);
  document.getElementById('portal-link').addEventListener('click', e => { e.preventDefault(); openPortal(); });

  document.getElementById('click-through').addEventListener('change', () => api.toggleClickThrough());
  document.getElementById('pos-lock').addEventListener('change', () => api.togglePositionLock());
}
