'use strict';

/**
 * YouTube OAuth マネージャ — 認可フロー・トークン更新・状態取得
 */

const {
  AUTH_URL,
  TOKEN_URL,
  CHANNELS_URL,
  getBundledOAuthConfig,
} = require('./youtube-oauth-config');
const { createYoutubeOAuthSession } = require('./youtube-oauth-session');
const {
  generatePkcePair,
  randomBase64Url,
  postForm,
  getJson,
  createOAuthCallbackServer,
} = require('./youtube-oauth-http');

/**
 * @param {{
 *   store: object,
 *   appRoot?: string,
 *   userDataPath?: string,
 *   openExternal: (url: string) => Promise<void> | void,
 *   onStatusChanged?: () => void,
 * }} deps
 */
function createYoutubeOAuthManager(deps) {
  const {
    store,
    appRoot,
    userDataPath,
    openExternal,
    onStatusChanged,
  } = deps;

  const session = createYoutubeOAuthSession(store);
  /** @type {{ cancel?: () => void } | null} */
  let activeFlow = null;

  function getConfig() {
    return getBundledOAuthConfig({ appRoot, userDataPath });
  }

  function getStatus() {
    const cfg = getConfig();
    const saved = cfg.clientId ? session.load(cfg.clientId) : null;
    const linked = !!(saved && (saved.refreshToken || session.isAccessTokenFresh(saved)));
    return {
      configured: cfg.isConfigured,
      linked,
      channelId: saved?.channelId || '',
      channelTitle: saved?.channelTitle || '',
      expiresAt: saved?.expiresAt || 0,
      accessTokenFresh: saved ? session.isAccessTokenFresh(saved) : false,
      nudgeDismissed: session.isNudgeDismissed(),
    };
  }

  function notifyChanged() {
    onStatusChanged?.();
  }

  async function fetchChannelMeta(accessToken) {
    const url = `${CHANNELS_URL}?part=snippet&mine=true`;
    const json = await getJson(url, accessToken);
    const item = json.items?.[0];
    if (!item) return { channelId: '', channelTitle: '' };
    return {
      channelId: item.id || '',
      channelTitle: item.snippet?.title || '',
    };
  }

  async function exchangeCode({ code, redirectUri, verifier, clientId, clientSecret }) {
    const body = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    };
    // Web アプリケーション型は client_secret 必須。デスクトップ型は PKCE のみで可
    if (clientSecret) body.client_secret = clientSecret;
    const json = await postForm(TOKEN_URL, body);
    if (!json.access_token) {
      throw new Error('トークン応答に access_token がありません');
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || '',
      expiresIn: Number(json.expires_in) || 3600,
    };
  }

  async function refreshAccessToken(clientId, refreshToken, clientSecret) {
    const body = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    };
    if (clientSecret) body.client_secret = clientSecret;
    const json = await postForm(TOKEN_URL, body);
    if (!json.access_token) {
      throw new Error('トークン更新に失敗しました（access_token なし）');
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresIn: Number(json.expires_in) || 3600,
    };
  }

  /**
   * 有効な access token を返す（必要ならリフレッシュ）
   * @returns {Promise<string>}
   */
  async function getValidAccessToken() {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      throw new Error('YouTube OAuth が設定されていません（開発者向け Client ID が未設定）');
    }
    const saved = session.load(cfg.clientId);
    if (!saved) throw new Error('YouTube と連携されていません');

    if (session.isAccessTokenFresh(saved)) return saved.accessToken;

    if (!saved.refreshToken) {
      throw new Error('YouTube の認可が期限切れです。設定から再連携してください。');
    }

    const tokens = await refreshAccessToken(cfg.clientId, saved.refreshToken, cfg.clientSecret);
    session.save(cfg.clientId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      channelId: saved.channelId,
      channelTitle: saved.channelTitle,
    });
    notifyChanged();
    return tokens.accessToken;
  }

  async function startOAuth() {
    // 設定変更（local.json への clientSecret 追加など）を反映
    const { resetBundledOAuthConfigCache } = require('./youtube-oauth-config');
    resetBundledOAuthConfigCache();
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return {
        success: false,
        error: 'YouTube OAuth Client ID が未設定です。開発者が youtube-oauth.local.json を配置するか、環境変数 YOUTUBE_OAUTH_CLIENT_ID を設定してください。',
      };
    }

    console.log(
      '[YouTube OAuth] 開始 — clientSecret:',
      cfg.clientSecret ? 'あり' : 'なし',
    );

    if (activeFlow?.cancel) {
      activeFlow.cancel();
      activeFlow = null;
    }

    const state = randomBase64Url(16);
    const { verifier, challenge } = generatePkcePair();

    let callback;
    try {
      callback = await createOAuthCallbackServer({ expectedState: state });
    } catch (err) {
      return { success: false, error: err.message };
    }

    activeFlow = { cancel: callback.cancel };

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: callback.redirectUri,
      response_type: 'code',
      scope: cfg.scope,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const authUrl = `${AUTH_URL}?${params.toString()}`;

    try {
      await openExternal(authUrl);
      const { code, redirectUri } = await callback.waitForCode();
      activeFlow = null;

      const tokens = await exchangeCode({
        code,
        redirectUri,
        verifier,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
      });

      let channelId = '';
      let channelTitle = '';
      try {
        const meta = await fetchChannelMeta(tokens.accessToken);
        channelId = meta.channelId;
        channelTitle = meta.channelTitle;
      } catch (err) {
        console.warn('[YouTube OAuth] チャンネル情報の取得に失敗:', err.message);
      }

      const previous = session.load(cfg.clientId);
      session.save(cfg.clientId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || previous?.refreshToken || '',
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        channelId,
        channelTitle,
      });

      const verified = session.load(cfg.clientId);
      if (!verified?.accessToken && !verified?.refreshToken) {
        return {
          success: false,
          error: 'トークンの保存に失敗しました。アプリを再起動してもう一度お試しください。',
        };
      }
      if (!verified.refreshToken) {
        console.warn('[YouTube OAuth] refresh_token がありません。再連携時は「同意」を求め直してください。');
      }

      notifyChanged();
      return {
        success: true,
        channelId,
        channelTitle,
      };
    } catch (err) {
      activeFlow = null;
      callback.cancel();
      const msg = String(err.message || err);
      console.error('[YouTube OAuth] 失敗:', msg);
      let hint = msg;
      if (/client_secret|unauthorized_client|invalid_client/i.test(msg)) {
        hint = `${msg} — youtube-oauth.local.json に Cloud Console の「クライアント シークレット」を clientSecret として追加し、アプリを再起動してから再連携してください（デスクトップ型でもシークレットが表示されることがあります）。同梱の bundled.json より local.json が優先されます。`;
      }
      return { success: false, error: hint };
    }
  }

  function clearOAuth() {
    if (activeFlow?.cancel) {
      activeFlow.cancel();
      activeFlow = null;
    }
    session.clear();
    notifyChanged();
    return { success: true };
  }

  /** ブラウザを閉じた場合など、進行中の認可を中断する */
  function cancelOAuth() {
    if (!activeFlow?.cancel) {
      return { success: true, cancelled: false };
    }
    activeFlow.cancel();
    activeFlow = null;
    return { success: true, cancelled: true };
  }

  function setNudgeDismissed(value) {
    session.setNudgeDismissed(!!value);
    notifyChanged();
    return { success: true };
  }

  return {
    getStatus,
    startOAuth,
    clearOAuth,
    cancelOAuth,
    getValidAccessToken,
    setNudgeDismissed,
    getConfig,
  };
}

module.exports = { createYoutubeOAuthManager };
