// ===== YouTube OAuth 連携（設定 › 接続） =====

/** @type {object} */
let _ytOAuthStatus = {};
/** 認可フロー待ち中（ブラウザで許可するまで IPC がブロックする） */
let _ytOAuthLinking = false;

function ytOAuthBadgeMeta(status, linking) {
  if (linking) {
    return { text: '認可中...', cls: 'is-warn', title: 'ブラウザで Google の許可を完了してください' };
  }
  if (!status?.configured) {
    return {
      text: '未設定',
      cls: 'is-warn',
      title: 'OAuth Client ID が未設定です（開発者向け）',
    };
  }
  if (status?.linked) {
    const name = String(status.channelTitle || '').trim();
    return {
      text: '連携済み',
      cls: 'is-ok',
      title: name ? `連携済み: ${name}` : 'YouTube と連携済み',
    };
  }
  return {
    text: '未連携',
    cls: 'is-warn',
    title: '「YouTube と連携」で Google アカウントを許可してください',
  };
}

function setYtOAuthUi(status, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'linking')) {
    _ytOAuthLinking = !!opts.linking;
  }
  const linking = _ytOAuthLinking;
  if (status) _ytOAuthStatus = status;
  const S = window.AppStateUI;
  const badge = document.getElementById('yt-oauth-badge');
  const hint = document.getElementById('yt-oauth-hint');
  const btnConnect = document.getElementById('yt-oauth-connect');
  const btnDisconnect = document.getElementById('yt-oauth-disconnect');
  const btnCancel = document.getElementById('yt-oauth-cancel');
  if (!badge || !S) return;

  S.applyBadge(badge, ytOAuthBadgeMeta(_ytOAuthStatus, linking));

  if (hint) {
    if (!_ytOAuthStatus.configured) {
      hint.textContent = 'アプリに OAuth Client ID が同梱されていません。開発者が youtube-oauth.local.json を設定してください。';
    } else if (linking) {
      hint.textContent = 'ブラウザで Google にログインし、「許可」を押してください。やめる場合は「認可をキャンセル」を押してください。';
    } else if (_ytOAuthStatus.linked) {
      const name = String(_ytOAuthStatus.channelTitle || '').trim();
      hint.textContent = name
        ? `連携チャンネル: ${name}`
        : '連携済みです。配信開始後にダッシュボードからチャット取得を始めると、動画 ID を自動検出します。';
    } else {
      hint.textContent = '推奨: 連携すると動画 ID の手入力が不要になります。手動の場合は下の「手動設定」を開いてください。';
    }
  }

  if (btnConnect) {
    // 連携済みは非表示。認可中も非表示（キャンセルボタンに交代）
    btnConnect.hidden = !!_ytOAuthStatus.linked || linking || !_ytOAuthStatus.configured;
    btnConnect.disabled = linking || !_ytOAuthStatus.configured || !!_ytOAuthStatus.linked;
  }
  if (btnDisconnect) {
    btnDisconnect.hidden = !_ytOAuthStatus.linked || linking;
    btnDisconnect.disabled = linking;
  }
  if (btnCancel) {
    // 「YouTube と連携」押下〜成功/失敗/キャンセルまでだけ表示
    btnCancel.hidden = !linking;
    btnCancel.disabled = false;
  }
  const btnDetect = document.getElementById('yt-oauth-detect');
  if (btnDetect) {
    btnDetect.disabled = linking || !_ytOAuthStatus.linked;
  }
}

async function initYoutubeOAuth() {
  _ytOAuthLinking = false;
  const st = await api.getYoutubeOAuthStatus().catch(() => ({
    configured: false,
    linked: false,
    channelTitle: '',
  }));
  setYtOAuthUi(st, { linking: false });
}

function bindYoutubeOAuthActions() {
  document.getElementById('yt-oauth-connect')?.addEventListener('click', async () => {
    setYtOAuthUi(_ytOAuthStatus, { linking: true });
    try {
      const r = await api.startYoutubeOAuth().catch((e) => ({ success: false, error: e.message }));
      if (r.success) {
        const label = r.channelTitle ? `「${r.channelTitle}」` : 'YouTube';
        showFb('yt-oauth-fb', `${label} と連携しました。`);
      } else if (r.error && !/キャンセル|cancel/i.test(String(r.error))) {
        showFb('yt-oauth-fb', `連携エラー: ${r.error}`, 'err');
      } else {
        showFb('yt-oauth-fb', 'YouTube 連携をキャンセルしました。');
      }
    } finally {
      const st = await api.getYoutubeOAuthStatus().catch(() => _ytOAuthStatus);
      setYtOAuthUi(st, { linking: false });
    }
  });

  document.getElementById('yt-oauth-cancel')?.addEventListener('click', async () => {
    const r = await api.cancelYoutubeOAuth?.().catch((e) => ({ success: false, error: e.message }));
    if (r && r.success === false) {
      showFb('yt-oauth-fb', `キャンセルエラー: ${r.error}`, 'err');
    }
    // startYoutubeOAuth の await が解除され、connect 側の finally で UI を戻す
  });

  document.getElementById('yt-oauth-disconnect')?.addEventListener('click', async () => {
    if (!window.confirm('YouTube 連携を解除しますか？')) return;
    const btnDisconnect = document.getElementById('yt-oauth-disconnect');
    if (btnDisconnect) btnDisconnect.disabled = true;
    try {
      const r = await api.clearYoutubeOAuth().catch((e) => ({ success: false, error: e.message }));
      showFb(
        'yt-oauth-fb',
        r.success ? 'YouTube 連携を解除しました。' : `エラー: ${r.error}`,
        r.success ? 'ok' : 'err',
      );
    } finally {
      const st = await api.getYoutubeOAuthStatus().catch(() => ({
        configured: _ytOAuthStatus.configured,
        linked: false,
        channelTitle: '',
      }));
      setYtOAuthUi(st, { linking: false });
    }
  });

  document.getElementById('yt-oauth-detect')?.addEventListener('click', async () => {
    const btn = document.getElementById('yt-oauth-detect');
    if (btn) btn.disabled = true;
    showFb('yt-oauth-fb', '配信を検出しています…');
    try {
      const r = await api.resolveYoutubeLiveBroadcasts().catch((e) => ({
        success: false,
        error: e.message,
      }));

      if (!r.success) {
        showFb('yt-oauth-fb', r.error || '配信を検出できませんでした', 'err');
        return;
      }

      if (r.kind === 'single' && r.broadcasts?.[0]) {
        const b = r.broadcasts[0];
        const life = b.lifeCycleStatus ? ` / ${b.lifeCycleStatus}` : '';
        const priv = b.privacyStatus ? ` / ${b.privacyStatus}` : '';
        showFb('yt-oauth-fb', `検出: ${b.title}（videoId: ${b.videoId}${life}${priv}）`);
        return;
      }
      if (r.kind === 'multiple' && r.broadcasts?.length) {
        const lines = r.broadcasts.map((b) => `・${b.title}`).join(' ');
        showFb('yt-oauth-fb', `複数配信を検出（${r.broadcasts.length}件）: ${lines}`);
        return;
      }
      showFb('yt-oauth-fb', '配信を検出しました。');
    } finally {
      if (btn) btn.disabled = !_ytOAuthStatus.linked || _ytOAuthLinking;
    }
  });
}