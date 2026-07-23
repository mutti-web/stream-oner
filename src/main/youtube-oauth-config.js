'use strict';

/**
 * 開発者同梱の YouTube OAuth / Data API 設定。
 *
 * 各フィールドの優先順（空文字はスキップ）:
 *   1. 環境変数 YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_API_KEY / YOUTUBE_OAUTH_CLIENT_SECRET
 *   2. 開発用 youtube-oauth.local.json（プロジェクトルート）— 開発時の上書き
 *   3. ビルド同梱 src/main/youtube-oauth.bundled.json（inject スクリプト生成）
 *   4. userData/youtube-oauth-config.json
 *
 * ※ bundled に clientId だけあり local に clientSecret だけある、といったマージも可能。
 */

const path = require('path');
const fs = require('fs');

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const BUNDLED_FILENAME = 'youtube-oauth.bundled.json';

/** @type {{ clientId: string, apiKey: string, clientSecret: string, scope: string, isConfigured: boolean } | null} */
let _cached = null;

function readOptionalJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function pickCredentials(json) {
  if (!json) return { clientId: '', apiKey: '', clientSecret: '' };
  return {
    clientId: String(json.clientId || '').trim(),
    apiKey: String(json.apiKey || '').trim(),
    // デスクトップ型でもコンソールにシークレットが表示される場合は必要
    clientSecret: String(json.clientSecret || json.client_secret || '').trim(),
  };
}

/** 空でない最初の値を採用 */
function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * @param {{ appRoot?: string, userDataPath?: string }} [opts]
 */
function getBundledOAuthConfig(opts = {}) {
  if (_cached) return _cached;

  const appRoot = opts.appRoot || path.join(__dirname, '../..');
  const userDataPath = opts.userDataPath || '';

  const fromEnv = {
    clientId: String(process.env.YOUTUBE_OAUTH_CLIENT_ID || '').trim(),
    apiKey: String(process.env.YOUTUBE_API_KEY || '').trim(),
    clientSecret: String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim(),
  };

  const fromLocal = pickCredentials(
    readOptionalJson(path.join(appRoot, 'youtube-oauth.local.json')),
  );
  const fromBundled = pickCredentials(
    readOptionalJson(path.join(__dirname, BUNDLED_FILENAME)),
  );
  const fromUserData = pickCredentials(
    userDataPath
      ? readOptionalJson(path.join(userDataPath, 'youtube-oauth-config.json'))
      : null,
  );

  const clientId = firstNonEmpty(
    fromEnv.clientId,
    fromLocal.clientId,
    fromBundled.clientId,
    fromUserData.clientId,
  );
  const apiKey = firstNonEmpty(
    fromEnv.apiKey,
    fromLocal.apiKey,
    fromBundled.apiKey,
    fromUserData.apiKey,
  );
  const clientSecret = firstNonEmpty(
    fromEnv.clientSecret,
    fromLocal.clientSecret,
    fromBundled.clientSecret,
    fromUserData.clientSecret,
  );

  _cached = {
    clientId,
    apiKey,
    clientSecret,
    scope: SCOPE,
    isConfigured: !!clientId,
  };
  return _cached;
}

function resetBundledOAuthConfigCache() {
  _cached = null;
}

module.exports = {
  SCOPE,
  TOKEN_URL,
  AUTH_URL,
  CHANNELS_URL,
  BUNDLED_FILENAME,
  getBundledOAuthConfig,
  resetBundledOAuthConfigCache,
  pickCredentials,
  firstNonEmpty,
};
