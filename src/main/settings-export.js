'use strict';

/**
 * @typedef {Object} SettingsExportPayload
 * @property {number} version
 * @property {string} exportedAt
 * @property {string} app
 * @property {Record<string, unknown>} settings
 *
 * @typedef {Object} ImportValidationResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string[]} [warnings]
 */

const EXPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** エクスポート対象外（シークレット・トークン） */
const SECRET_KEYS = new Set([
  'clientSecret',
  'yt.apiKey',
  'obs.wsPassword',
  'remote.pin',
  'discord.oauth.accessToken',
  'discord.oauth.refreshToken',
  'yt.oauth.accessToken',
  'yt.oauth.refreshToken',
]);

function isExportableKey(key) {
  return key && !SECRET_KEYS.has(key);
}

/**
 * @param {object} store SimpleStore 互換（data または get）
 */
function buildExportPayload(store) {
  const data = store.data || {};
  const settings = {};
  for (const key of Object.keys(data)) {
    if (isExportableKey(key)) settings[key] = data[key];
  }
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'stream-overlay-suite',
    settings,
  };
}

/**
 * @param {object} payload import JSON
 * @returns {{ ok: boolean, error?: string, warnings?: string[] }}
 */
function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: '不正なファイル形式です' };
  }
  const settings = payload.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, error: 'settings オブジェクトがありません' };
  }
  const warnings = [];
  if (payload.version != null && Number(payload.version) > EXPORT_VERSION) {
    warnings.push(`エクスポート version ${payload.version} はこのアプリより新しい可能性があります`);
  }
  const unknown = Object.keys(settings).filter((k) => !isExportableKey(k));
  if (unknown.length) {
    warnings.push(`読み飛ばしたキー: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`);
  }
  return { ok: true, warnings };
}

/**
 * @param {object} store
 * @param {object} payload import JSON
 * @returns {{ success: boolean, importedKeys?: string[], warnings?: string[], error?: string }}
 */
function importSettings(store, payload) {
  const v = validateImportPayload(payload);
  if (!v.ok) return { success: false, error: v.error };
  const settings = payload.settings;
  const importedKeys = [];
  for (const [key, val] of Object.entries(settings)) {
    if (!isExportableKey(key)) continue;
    store.set(key, val);
    importedKeys.push(key);
  }
  return { success: true, importedKeys, warnings: v.warnings };
}

module.exports = {
  EXPORT_VERSION,
  MAX_IMPORT_BYTES,
  SECRET_KEYS,
  buildExportPayload,
  validateImportPayload,
  importSettings,
};
