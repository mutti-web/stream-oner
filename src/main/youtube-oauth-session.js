'use strict';

/**
 * YouTube Data API 用 OAuth セッションの永続化（同梱 Client ID に紐づけ）
 */

const K = {
  boundClientId: 'yt.oauth.boundClientId',
  channelId: 'yt.oauth.channelId',
  channelTitle: 'yt.oauth.channelTitle',
  expiresAt: 'yt.oauth.expiresAt',
  accessToken: 'yt.oauth.accessToken',
  refreshToken: 'yt.oauth.refreshToken',
  nudgeDismissed: 'yt.oauth.nudgeDismissed',
};

/** 有効期限の何秒前から更新するか */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * @param {object} store SimpleStore 互換
 */
function createYoutubeOAuthSession(store) {
  function load(clientId) {
    if (!clientId) return null;
    const bound = store.get(K.boundClientId, '');
    if (bound && bound !== clientId) {
      clear();
      return null;
    }
    if (!bound) return null;
    const accessToken = store.getSecret(K.accessToken, '');
    const refreshToken = store.getSecret(K.refreshToken, '');
    if (!accessToken && !refreshToken) return null;
    return {
      channelId: store.get(K.channelId, '') || '',
      channelTitle: store.get(K.channelTitle, '') || '',
      expiresAt: Number(store.get(K.expiresAt, 0)) || 0,
      accessToken,
      refreshToken,
    };
  }

  /**
   * @param {string} clientId
   * @param {{ accessToken?: string, refreshToken?: string, expiresAt?: number, channelId?: string, channelTitle?: string }} data
   */
  function save(clientId, data) {
    if (!clientId) return;
    store.set(K.boundClientId, clientId);
    if (data.channelId !== undefined) store.set(K.channelId, data.channelId || '');
    if (data.channelTitle !== undefined) store.set(K.channelTitle, data.channelTitle || '');
    if (data.expiresAt !== undefined) store.set(K.expiresAt, data.expiresAt || 0);
    if (data.accessToken) store.setSecret(K.accessToken, data.accessToken);
    if (data.refreshToken) store.setSecret(K.refreshToken, data.refreshToken);
  }

  function clear() {
    store.set(K.boundClientId, '');
    store.set(K.channelId, '');
    store.set(K.channelTitle, '');
    store.set(K.expiresAt, 0);
    store.setSecret(K.accessToken, '');
    store.setSecret(K.refreshToken, '');
  }

  function isAccessTokenFresh(session) {
    if (!session?.accessToken || !session.expiresAt) return false;
    return session.expiresAt > Date.now() + EXPIRY_BUFFER_MS;
  }

  function isNudgeDismissed() {
    return store.get(K.nudgeDismissed, false) === true;
  }

  function setNudgeDismissed(value) {
    store.set(K.nudgeDismissed, !!value);
  }

  return {
    load,
    save,
    clear,
    isAccessTokenFresh,
    isNudgeDismissed,
    setNudgeDismissed,
    EXPIRY_BUFFER_MS,
    K,
  };
}

module.exports = { createYoutubeOAuthSession, K, EXPIRY_BUFFER_MS };
