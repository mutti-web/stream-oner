'use strict';

/**
 * Discord RPC 用 OAuth セッションの永続化（Client ID に紐づけ）
 */

const K = {
  boundClientId: 'discord.oauth.boundClientId',
  userId: 'discord.oauth.userId',
  expiresAt: 'discord.oauth.expiresAt',
  accessToken: 'discord.oauth.accessToken',
  refreshToken: 'discord.oauth.refreshToken',
};

/** 有効期限の何秒前から更新するか */
const EXPIRY_BUFFER_MS = 60_000;

function createOAuthSession(store) {
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
      userId: store.get(K.userId, '') || '',
      expiresAt: Number(store.get(K.expiresAt, 0)) || 0,
      accessToken,
      refreshToken,
    };
  }

  function save(clientId, { accessToken, refreshToken, expiresAt, userId }) {
    if (!clientId) return;
    store.set(K.boundClientId, clientId);
    if (userId) store.set(K.userId, userId);
    store.set(K.expiresAt, expiresAt || 0);
    if (accessToken) store.setSecret(K.accessToken, accessToken);
    if (refreshToken) store.setSecret(K.refreshToken, refreshToken);
  }

  function clear() {
    store.set(K.boundClientId, '');
    store.set(K.userId, '');
    store.set(K.expiresAt, 0);
    store.setSecret(K.accessToken, '');
    store.setSecret(K.refreshToken, '');
  }

  function isAccessTokenFresh(session) {
    if (!session?.accessToken || !session.expiresAt) return false;
    return session.expiresAt > Date.now() + EXPIRY_BUFFER_MS;
  }

  return { load, save, clear, isAccessTokenFresh, EXPIRY_BUFFER_MS };
}

module.exports = { createOAuthSession, K };
