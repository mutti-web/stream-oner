#!/usr/bin/env node
/**
 * ビルド前に YouTube OAuth 設定を src/main/youtube-oauth.bundled.json に書き出す。
 *
 * 入力（優先順）:
 *   1. 環境変数 YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_API_KEY（CI 向け）
 *   2. プロジェクトルートの youtube-oauth.local.json（ローカル開発向け）
 *
 * 使い方:
 *   node scripts/inject-youtube-oauth-config.mjs           # clientId なしでも空ファイルを生成
 *   node scripts/inject-youtube-oauth-config.mjs --strict  # clientId 必須（リリースビルド）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LOCAL_PATH = path.join(ROOT, 'youtube-oauth.local.json');
const OUT_PATH = path.join(ROOT, 'src/main/youtube-oauth.bundled.json');

const strict = process.argv.includes('--strict');

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return json && typeof json === 'object' ? json : null;
  } catch (err) {
    console.error(`[inject-oauth] 読み込み失敗: ${filePath}`, err.message);
    return null;
  }
}

const local = readJson(LOCAL_PATH);
const clientId = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || local?.clientId || '').trim();
const apiKey = String(process.env.YOUTUBE_API_KEY || local?.apiKey || '').trim();
const clientSecret = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || local?.clientSecret || '').trim();

if (strict && !clientId) {
  console.error('[inject-oauth] リリースビルドには OAuth Client ID が必要です。');
  console.error('  - 環境変数 YOUTUBE_OAUTH_CLIENT_ID を設定する');
  console.error('  - または youtube-oauth.local.json を配置する（gitignore 済み）');
  process.exit(1);
}

const payload = {
  clientId,
  apiKey,
  clientSecret,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const mask = (value) => (value ? `${value.slice(0, 8)}…` : '(empty)');
console.log(`[inject-oauth] wrote ${path.relative(ROOT, OUT_PATH)}`);
console.log(`[inject-oauth]   clientId: ${mask(clientId)}`);
console.log(`[inject-oauth]   apiKey:   ${mask(apiKey)}`);
console.log(`[inject-oauth]   clientSecret: ${clientSecret ? 'set' : '(empty)'}`);
