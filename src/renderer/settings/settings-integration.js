/** 初回有効化・再生成後に PIN を平文表示するフラグ（ログイン確認で解除） */
let remotePinPlainVisible = false;
/** 直前のリモート有効状態（OFF→ON 判定用） */
let remoteWasEnabled = false;

async function initObsWsSettings(s) {
  suppressAutoSave++;
  const host = document.getElementById('obs-ws-host');
  const port = document.getElementById('obs-ws-port');
  const pw = document.getElementById('obs-ws-password');
  const hint = document.getElementById('obs-ws-password-hint');
  if (host) setMdFieldValue(host, s.obsWsHost || '127.0.0.1');
  if (port) setMdFieldValue(port, String(s.obsWsPort ?? 4455));
  if (pw) pw.placeholder = s.hasObsWsPassword ? '（保存済み）変更する場合のみ入力' : 'OBS の接続情報からコピーしたパスワード';
  if (hint) {
    hint.textContent = s.hasObsWsPassword
      ? 'WebSocket パスワードは保存済みです'
      : '認証が有効な OBS ではパスワードの保存が必須です';
  }
  suppressAutoSave--;
}

async function persistObsWsSettings() {
  if (suppressAutoSave) return;
  const payload = {
    obsWsHost: readMdValue(document.getElementById('obs-ws-host')).trim() || '127.0.0.1',
    obsWsPort: readMdNum(document.getElementById('obs-ws-port'), 4455),
  };
  const pw = readMdValue(document.getElementById('obs-ws-password')).trim();
  if (pw) payload.obsWsPassword = pw;
  const r = await api.saveSettings(payload).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    showFb('integration-fb', 'OBS WebSocket 設定を保存しました。');
    patchSettingsSnapshot({
      obsWsHost: payload.obsWsHost,
      obsWsPort: payload.obsWsPort,
      ...(pw ? { hasObsWsPassword: true } : {}),
    });
    if (pw) {
      document.getElementById('obs-ws-password').value = '';
      await initObsWsSettings(settingsSnapshot);
    }
    refreshSetupChecklist({ immediate: true, patch: { s: { ...settingsSnapshot } } });
  } else {
    showFb('integration-fb', '保存エラー: ' + (r.error || ''), 'err');
  }
}

const debouncedObsWs = debounce(persistObsWsSettings, 700);
const debouncedRemote = debounce(persistRemoteSettings, 700);

function formatRemoteTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function updateRemoteQrUi(dataUrl, opts = {}) {
  const wrap = document.getElementById('remote-lan-qr-wrap');
  const img = document.getElementById('remote-lan-qr');
  const hint = document.getElementById('remote-lan-hint');
  const err = document.getElementById('remote-lan-qr-error');
  if (!wrap || !img) return;

  const enabled = opts.enabled !== false;
  const lanUrl = String(opts.lanUrl || '').trim();
  const hasLanUrl = /^https?:\/\//i.test(lanUrl);
  const qr = String(dataUrl || '').trim();
  const hasQr = qr.startsWith('data:image');

  const showWrap = () => {
    wrap.hidden = false;
    wrap.removeAttribute('hidden');
    wrap.classList.add('is-shown');
  };
  const hideWrap = () => {
    wrap.hidden = true;
    wrap.classList.remove('is-shown', 'is-error');
  };

  if (hasQr) {
    img.hidden = false;
    img.removeAttribute('hidden');
    img.src = qr;
    showWrap();
    wrap.classList.remove('is-error');
    if (err) err.hidden = true;
    if (hint) {
      hint.textContent = '同一 Wi‑Fi 内のスマホで QR を読み取るか、URL をブラウザで開いてください。';
    }
    return;
  }

  img.removeAttribute('src');
  img.hidden = true;

  if (enabled && hasLanUrl) {
    showWrap();
    wrap.classList.add('is-error');
    if (err) {
      err.hidden = false;
      const detail = String(opts.error || '').trim();
      err.textContent = detail
        ? `QR の生成に失敗しました（${detail}）。右の URL をコピーしてスマホのブラウザで開いてください。`
        : 'QR の生成に失敗しました。右の URL をコピーしてスマホのブラウザで開いてください。';
    }
    if (hint) {
      hint.textContent = 'QR が使えない場合は URL コピーで接続できます。「URL を再取得」も試してください。';
    }
    return;
  }

  hideWrap();
  if (err) err.hidden = true;
  if (hint) {
    if (!enabled) {
      hint.textContent = 'スマホダッシュボードを有効にすると、LAN URL と QR が表示されます。';
    } else {
      hint.textContent = 'LAN IP を検出できません。Wi‑Fi 接続を確認し、「URL を再取得」を押してください。';
    }
  }
}

function maskRemotePinText(c) {
  if (c?.hasRemotePin || c?.pin) {
    const len = c.pinLength || String(c.pin || '').length || 6;
    return '•'.repeat(Math.min(Math.max(len, 1), 8));
  }
  return c?.enabled ? '（生成中…）' : '（有効化後に表示）';
}

function maskRemotePinAfterLogin(list) {
  if (!remotePinPlainVisible || !list?.length) return false;
  remotePinPlainVisible = false;
  const pin = document.getElementById('remote-pin-display');
  if (pin) {
    const cur = readMdValue(pin);
    const len = /^\d+$/.test(cur) ? cur.length : 6;
    setMdFieldValue(pin, '•'.repeat(Math.min(len, 8)));
  }
  const details = document.getElementById('remote-pin-details');
  if (details) details.open = false;
  const hint = document.getElementById('remote-pin-hint');
  if (hint) {
    hint.textContent = 'ログイン確認のため PIN を非表示にしました。再表示は再生成時のみ。';
  }
  return true;
}

function applyRemotePinUi(c) {
  const sessions = c.sessions || [];
  if (remotePinPlainVisible && sessions.length > 0) {
    remotePinPlainVisible = false;
  }
  const pin = document.getElementById('remote-pin-display');
  if (pin) {
    if (remotePinPlainVisible && c.pin) setMdFieldValue(pin, c.pin);
    else setMdFieldValue(pin, maskRemotePinText(c));
  }
  const details = document.getElementById('remote-pin-details');
  if (details) {
    if (remotePinPlainVisible) details.open = true;
    else if (sessions.length > 0) details.open = false;
  }
  const hint = document.getElementById('remote-pin-hint');
  if (hint) {
    if (remotePinPlainVisible) {
      hint.textContent = 'この PIN をスマホで入力。ログイン確認で非表示になります。';
    } else if (c?.enabled && (c.hasRemotePin || c.pin)) {
      hint.textContent = 'PIN は非表示。忘れた場合は再生成（接続中端末はログアウト）。';
    } else {
      hint.textContent = '再生成後に表示。ログイン確認で非表示';
    }
  }
}

function renderRemoteSessions(list) {
  const el = document.getElementById('remote-sessions-list');
  if (!el) return;
  if (!list?.length) {
    el.className = 'remote-sessions-list empty';
    el.textContent = '接続中の端末はありません';
    return;
  }
  el.className = 'remote-sessions-list';
  el.innerHTML = '';
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'remote-session-row';
    const meta = document.createElement('div');
    meta.className = 'remote-session-meta';
    const name = document.createElement('div');
    name.className = 'remote-session-name';
    name.textContent = s.deviceLabel || 'マイスマホ';
    const sub = document.createElement('div');
    sub.className = 'remote-session-sub';
    sub.textContent = `${s.clientIp || '—'} · 最終 ${formatRemoteTime(s.lastSeenAt)}${s.wsConnected ? ' · 接続中' : ''}`;
    meta.append(name, sub);
    const btn = document.createElement('md-text-button');
    btn.textContent = '切断';
    btn.addEventListener('click', async () => {
      await api.remoteRevokeSession(s.sessionId);
      await initRemoteSettings();
    });
    row.append(meta, btn);
    el.appendChild(row);
  }
}

function fillRemoteLanInterfaceSelect(candidates, selectedAddress) {
  const sel = document.getElementById('remote-lan-interface');
  if (!sel) return;
  const prev = selectedAddress || readMdValue(sel) || '';
  sel.innerHTML = '';
  const auto = document.createElement('md-select-option');
  auto.value = '';
  auto.innerHTML = '<div slot="headline">自動（最初の LAN IP）</div>';
  sel.appendChild(auto);
  for (const c of candidates || []) {
    const opt = document.createElement('md-select-option');
    opt.value = c.address;
    const label = `${c.interfaceName} — ${c.address}`;
    opt.innerHTML = `<div slot="headline">${label}</div>`;
    sel.appendChild(opt);
  }
  queueMicrotask(() => {
    try { setMdFieldValue(sel, prev); } catch (_) { setMdFieldValue(sel, ''); }
  });
}

function setRemoteBodyVisible(enabled) {
  const body = document.getElementById('remote-body');
  if (!body) return;
  body.hidden = !enabled;
}

async function initRemoteSettings() {
  const c = await api.remoteGetConfig().catch(() => ({}));
  suppressAutoSave++;
  const en = document.getElementById('remote-enabled');
  const port = document.getElementById('remote-port');
  const maxS = document.getElementById('remote-max-sessions');
  const url = document.getElementById('remote-lan-url');
  if (en) en.checked = !!c.enabled;
  setRemoteBodyVisible(!!c.enabled);
  if (port) setMdFieldValue(port, String(c.port ?? 3920));
  if (maxS) setMdFieldValue(maxS, String(c.maxSessions ?? 2));
  fillRemoteLanInterfaceSelect(c.lanCandidates, c.lanPreferredAddress);
  if (url) setMdFieldValue(url, c.remoteLanUrl || (c.enabled ? '（LAN IP を検出できません）' : '—'));
  applyRemotePinUi(c);
  updateRemoteQrUi(c.enabled ? (c.remoteLanQrDataUrl || '') : '', {
    enabled: !!c.enabled,
    lanUrl: c.remoteLanUrl || '',
    error: c.remoteLanQrError || '',
  });
  renderRemoteSessions(c.sessions || []);
  remoteWasEnabled = !!c.enabled;
  patchSettingsSnapshot({ remoteEnabled: !!c.enabled });
  suppressAutoSave--;
}

async function refreshRemoteLanUi() {
  const c = await api.remoteGetConfig().catch(() => ({}));
  fillRemoteLanInterfaceSelect(c.lanCandidates, c.lanPreferredAddress);
  if (c.remoteLanUrl) setMdFieldValue(document.getElementById('remote-lan-url'), c.remoteLanUrl);
  else {
    setMdFieldValue(
      document.getElementById('remote-lan-url'),
      c.enabled ? '（LAN IP を検出できません）' : '—',
    );
  }
  updateRemoteQrUi(c.enabled ? (c.remoteLanQrDataUrl || '') : '', {
    enabled: !!c.enabled,
    lanUrl: c.remoteLanUrl || '',
    error: c.remoteLanQrError || '',
  });
  showFb('integration-fb', 'LAN URL を更新しました。');
}

async function persistRemoteLanPreference() {
  if (suppressAutoSave) return;
  const addr = readMdValue(document.getElementById('remote-lan-interface')).trim();
  const r = await api.saveSettings({ remoteLanPreferredAddress: addr }).catch((e) => ({ success: false, error: e.message }));
  if (r.success) await refreshRemoteLanUi();
  else showFb('integration-fb', 'LAN 設定の保存に失敗: ' + (r.error || ''), 'err');
}

const debouncedRemoteLan = debounce(persistRemoteLanPreference, 500);

async function persistRemoteSettings() {
  if (suppressAutoSave) return;
  const wantEnabled = !!document.getElementById('remote-enabled')?.checked;
  const turningOn = wantEnabled && !remoteWasEnabled;
  const payload = {
    remoteEnabled: wantEnabled,
    remotePort: readMdNum(document.getElementById('remote-port'), 3920),
    remoteMaxSessions: readMdNum(document.getElementById('remote-max-sessions'), 2),
  };
  const r = await api.saveSettings(payload).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    if (turningOn) remotePinPlainVisible = true;
    if (!wantEnabled) remotePinPlainVisible = false;
    showFb('integration-fb', 'リモート設定を保存しました。');
    await initRemoteSettings();
  } else {
    showFb('integration-fb', '保存エラー: ' + (r.error || ''), 'err');
  }
}

function bindRemoteSettings() {
  document.getElementById('remote-enabled')?.addEventListener('change', () => {
    // 保存完了前でも UI を即反映（デバウンス待ちで空欄が残らないようにする）
    setRemoteBodyVisible(!!document.getElementById('remote-enabled')?.checked);
    debouncedRemote();
  });
  ['remote-port', 'remote-max-sessions'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => debouncedRemote());
  });
  document.getElementById('remote-lan-interface')?.addEventListener('change', () => debouncedRemoteLan());
  document.getElementById('btn-remote-refresh-lan')?.addEventListener('click', () => refreshRemoteLanUi());
  document.getElementById('btn-remote-regenerate-pin')?.addEventListener('click', async () => {
    if (!window.confirm('PIN を再生成しますか？接続中のスマホはすべてログアウトされます。')) return;
    const r = await api.remoteRegeneratePin().catch((e) => ({ success: false, error: e.message }));
    if (r.success) {
      remotePinPlainVisible = true;
      showFb('integration-fb', 'PIN を再生成しました。全端末は再ログインが必要です。');
      await initRemoteSettings();
    } else {
      showFb('integration-fb', r.error || '失敗', 'err');
    }
  });
  document.getElementById('btn-remote-restart-server')?.addEventListener('click', async () => {
    const r = await api.remoteRestartServer().catch((e) => ({ success: false, error: e.message }));
    showFb('integration-fb', r.success ? 'リモートサーバーを再起動しました。' : (r.error || '失敗'), r.success ? '' : 'err');
    await initRemoteSettings();
  });
  document.querySelectorAll('.remote-url-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-url-id');
      const field = document.getElementById(id);
      const v = readMdValue(field).trim();
      if (v && v !== '—') navigator.clipboard?.writeText(v);
    });
  });
  api.on('remote-sessions-changed', (list) => {
    renderRemoteSessions(list || []);
    if (maskRemotePinAfterLogin(list)) {
      showFb('integration-fb', 'ログインを確認したため PIN を非表示にしました。');
    }
  });
}
