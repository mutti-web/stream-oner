'use strict';

/**
 * 配信表示まわりの状態表示ルール（ランプ・バッジ共通）
 *
 * - off / 中立 … 意図的 OFF・停止待ち
 * - warn … 未設定・要操作・一部稼働
 * - ok   … 正常稼働
 * - err  … 実行したが失敗
 */
(function (global) {
  function discordCredsOk(settings) {
    return /^\d{17,20}$/.test(String(settings?.clientId || '').trim()) && !!settings?.hasClientSecret;
  }

  function ytApiKeyReady(cfg) {
    return !!cfg?.hasApiKey;
  }

  function ytVideoIdReady(cfg) {
    return !!String(cfg?.videoId || '').trim();
  }

  /** YouTube OAuth 連携済み（配信検出で videoId を省略可能） */
  function ytOAuthLinked(oauth) {
    return !!oauth?.linked;
  }

  /** チャット取得開始の準備完了（動画 ID または OAuth 連携） */
  function ytChatStartReady(cfg, oauth) {
    return ytVideoIdReady(cfg) || ytOAuthLinked(oauth);
  }

  /** チャット取得に必要な設定（動画 ID のみ必須。API キーは Data API フォールバック用） */
  function ytConfigReady(cfg) {
    return ytVideoIdReady(cfg);
  }

  function avatarHasAnyPng(av) {
    if (!av || typeof av !== 'object') return false;
    return Object.keys(av).some((k) => {
      if (!k.startsWith('p1_path_') && !k.startsWith('p2_path_')) return false;
      return String(av[k] || '').trim().length > 0;
    });
  }

  function avatarConfigReady(av) {
    return !!(av?.micADeviceId || av?.micBDeviceId) && avatarHasAnyPng(av);
  }

  /** @returns {{ kind: 'off'|'ok'|'warn'|'err', title: string }} */
  function discordLamp({ featureOn, credsOk, rpcState, error }) {
    if (!featureOn) {
      return { kind: 'off', title: 'Discord は OFF です' };
    }
    if (!credsOk) {
      return { kind: 'warn', title: 'Client ID / Client Secret が未設定です（設定の Discord タブ）' };
    }
    if (rpcState === 'connected') {
      return { kind: 'ok', title: 'RPC 接続済み' };
    }
    if (rpcState === 'connecting') {
      return { kind: 'warn', title: 'RPC 接続中…' };
    }
    if (rpcState === 'error') {
      return { kind: 'err', title: error || 'RPC エラー' };
    }
    return { kind: 'warn', title: 'RPC 未接続' };
  }

  /** @returns {{ kind: 'off'|'ok'|'warn'|'err', title: string }} */
  function youtubeLamp({ featureOn, ytCfg, pollerRunning, error, oauthLinked }) {
    if (!featureOn) {
      return { kind: 'off', title: 'チャットは OFF です' };
    }
    if (!ytVideoIdReady(ytCfg) && !oauthLinked) {
      return { kind: 'warn', title: '動画 ID 未設定（接続タブで YouTube 連携も可）' };
    }
    if (error && !pollerRunning) {
      return { kind: 'err', title: error };
    }
    if (pollerRunning) {
      return { kind: 'ok', title: 'チャット取得：稼働中' };
    }
    return { kind: 'warn', title: 'チャット取得：停止中（「開始」で取得）' };
  }

  /** @returns {{ kind: 'off'|'ok'|'warn'|'err', title: string }} */
  function avatarLamp({ featureOn, configReady, serverRunning, audioRunning, error }) {
    if (!featureOn) {
      return { kind: 'off', title: 'アバターは OFF です' };
    }
    if (!configReady) {
      return { kind: 'warn', title: 'マイクまたは PNG 素材が未設定です（設定のアバタータブ）' };
    }
    if (error && !serverRunning) {
      return { kind: 'err', title: error };
    }
    if (serverRunning && audioRunning) {
      return { kind: 'ok', title: 'アバター：サーバー・音声解析とも稼働中' };
    }
    if (serverRunning) {
      return { kind: 'warn', title: 'アバター：サーバーのみ（音声解析停止）' };
    }
    return { kind: 'warn', title: 'アバター：停止中' };
  }

  /** @returns {{ text: string, cls: string, title?: string }} cls = is-ok | is-warn | is-err | '' */
  function rpcBadge({ state, error }) {
    if (state === 'connected') return { text: '接続済み', cls: 'is-ok' };
    if (state === 'connecting') return { text: '接続中...', cls: 'is-warn' };
    if (state === 'error') return { text: 'エラー', cls: 'is-err', title: error || '' };
    return { text: '未接続', cls: 'is-warn' };
  }

  function ytBadge({ ytCfg, pollerRunning, error, oauthLinked }) {
    if (!ytVideoIdReady(ytCfg) && !oauthLinked) {
      return { text: 'ID未設定', cls: 'is-warn', title: '動画 ID を設定するか、接続タブで YouTube と連携' };
    }
    if (pollerRunning) return { text: '稼働中', cls: 'is-ok', title: 'チャット取得：稼働中' };
    if (error) return { text: 'エラー', cls: 'is-err', title: error };
    return { text: '停止中', cls: 'is-warn', title: 'チャット取得：停止中' };
  }

  function avBadge({ featureOn, configReady, serverRunning, audioRunning, error }) {
    if (!featureOn) return { text: 'OFF', cls: '', title: '全般でアバターが OFF です' };
    if (!configReady) return { text: '未設定', cls: 'is-warn', title: 'マイクと PNG 素材を登録してください' };
    if (error && !serverRunning) return { text: 'エラー', cls: 'is-err', title: error };
    if (serverRunning && audioRunning) return { text: '稼働中', cls: 'is-ok' };
    if (serverRunning) return { text: 'サーバーのみ', cls: 'is-warn', title: '音声解析が停止しています' };
    return { text: '停止中', cls: 'is-warn', title: 'アバターサーバー：停止中' };
  }

  function badgeIcon(cls) {
    if (cls === 'is-ok') return 'check_circle';
    if (cls === 'is-warn') return 'info';
    if (cls === 'is-err') return 'error';
    return 'pause_circle';
  }

  function applyBadge(el, badge, extraClass) {
    if (!el || !badge) return;
    const base = extraClass || 'app-badge';
    el.className = badge.cls ? `${base} ${badge.cls}` : base;
    let icon = el.querySelector('md-icon');
    let text = el.querySelector('.app-badge-text');
    if (!icon) {
      el.replaceChildren();
      icon = document.createElement('md-icon');
      text = document.createElement('span');
      text.className = 'app-badge-text';
      el.append(icon, text);
    }
    icon.textContent = badgeIcon(badge.cls);
    text.textContent = badge.text;
    if (badge.title) el.title = badge.title;
    else el.removeAttribute('title');
  }

  global.AppStateUI = {
    discordCredsOk,
    ytApiKeyReady,
    ytVideoIdReady,
    ytOAuthLinked,
    ytChatStartReady,
    ytConfigReady,
    avatarHasAnyPng,
    avatarConfigReady,
    discordLamp,
    youtubeLamp,
    avatarLamp,
    rpcBadge,
    ytBadge,
    avBadge,
    applyBadge,
  };
})(typeof window !== 'undefined' ? window : global);
