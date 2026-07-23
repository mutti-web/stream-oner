'use strict';

/**
 * メインプロセスの重いモジュールを初回利用時まで require しない。
 * 新機能追加時もここに loader を足す。
 */

const _cache = new Map();

function loadOnce(key, loader) {
  if (!_cache.has(key)) {
    _cache.set(key, loader());
  }
  return _cache.get(key);
}

function getObsServiceClass() {
  return loadOnce('obs-service', () => require('./obs-service').ObsService);
}

function getDiscordRPCManagerClass() {
  return loadOnce('discord-rpc-manager', () => require('./discord-rpc-manager'));
}

function getCreateOAuthSession() {
  return loadOnce('discord-oauth-session', () => require('./discord-oauth-session').createOAuthSession);
}

function getCreateYoutubeOAuthManager() {
  return loadOnce('youtube-oauth-manager', () => require('./youtube-oauth-manager').createYoutubeOAuthManager);
}

function getCreateYoutubeLiveResolver() {
  return loadOnce('youtube-live-resolver', () => require('./youtube-live-resolver').createYoutubeLiveResolver);
}

function getCreateYoutubeChatStartCoordinator() {
  return loadOnce('youtube-chat-start-coordinator', () => require('./youtube-chat-start-coordinator').createYoutubeChatStartCoordinator);
}

function getYouTubeChatManagerClass() {
  return loadOnce('youtube-chat-manager', () => require('./youtube-chat-manager'));
}

function getAvatarManagerClass() {
  return loadOnce('avatar-manager', () => require('./avatar-manager'));
}

function getRemoteEventHubClass() {
  return loadOnce('remote-event-hub', () => require('./remote-event-hub'));
}

function getRemoteSessionStoreClass() {
  return loadOnce('remote-session-store', () => require('./remote-session-store').RemoteSessionStore);
}

function getRemoteDashboardApiClass() {
  return loadOnce('remote-dashboard-api', () => require('./remote-dashboard-api'));
}

function getRemoteDashboardServerClass() {
  return loadOnce('remote-dashboard-server', () => require('./remote-dashboard-server'));
}

/** QR 生成（qrcode）— 設定画面で LAN URL を表示するときだけ */
async function remoteLanQrDataUrl(url) {
  const mod = loadOnce('remote-lan-qr', () => require('./remote-lan-qr'));
  return mod.remoteLanQrDataUrl(url);
}

module.exports = {
  getObsServiceClass,
  getDiscordRPCManagerClass,
  getCreateOAuthSession,
  getCreateYoutubeOAuthManager,
  getCreateYoutubeLiveResolver,
  getCreateYoutubeChatStartCoordinator,
  getYouTubeChatManagerClass,
  getAvatarManagerClass,
  getRemoteEventHubClass,
  getRemoteSessionStoreClass,
  getRemoteDashboardApiClass,
  getRemoteDashboardServerClass,
  remoteLanQrDataUrl,
};
