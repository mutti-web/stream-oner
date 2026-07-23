'use strict';

const fs = require('fs');
const path = require('path');

const CUSTOM_CSS_LOADER_PATH = path.join(__dirname, '../renderer/shared/custom-css-loader.js');

/** @type {{ filePath: string, mtimeMs: number, content: string }} */
const cache = { filePath: '', mtimeMs: 0, content: '' };

function invalidateCustomCssCache() {
  cache.filePath = '';
  cache.mtimeMs = 0;
  cache.content = '';
}

/**
 * CSS パス保存時にリビジョンを上げ、キャッシュを無効化する
 * @param {import('./simple-store')} store
 * @returns {number}
 */
function bumpCustomCssRevision(store) {
  invalidateCustomCssCache();
  const rev = Number(store?.get?.('customCssRevision', 0)) + 1;
  store?.set?.('customCssRevision', rev);
  return rev;
}

/**
 * 統合 OBS / 個別オーバーレイ向けカスタム CSS（store の customCssPath）
 * @param {import('./simple-store')} store
 * @returns {string}
 */
function getCustomCssContent(store) {
  const filePath = String(store?.get?.('customCssPath', '') || '').trim();
  if (!filePath) {
    invalidateCustomCssCache();
    return '';
  }
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      invalidateCustomCssCache();
      return '';
    }
    const mtimeMs = fs.statSync(resolved).mtimeMs;
    if (cache.filePath === resolved && cache.mtimeMs === mtimeMs) {
      return cache.content;
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    cache.filePath = resolved;
    cache.mtimeMs = mtimeMs;
    cache.content = content;
    return content;
  } catch (_) {
    invalidateCustomCssCache();
    return '';
  }
}

/**
 * @param {import('http').ServerResponse} res
 * @param {import('./simple-store')} store
 */
function writeCustomCssHttpResponse(res, store) {
  const css = getCustomCssContent(store);
  const revision = Number(store?.get?.('customCssRevision', 0)) || 0;
  res.writeHead(200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'X-Css-Revision': String(revision),
  });
  res.end(css);
}

/**
 * /custom-css と custom-css-loader.js を処理する
 * @param {string} url
 * @param {import('http').ServerResponse} res
 * @param {import('./simple-store')} store
 * @param {{ readUtf8: (p: string, cb: (err: Error | null, data?: string) => void) => void }} staticFileCache
 * @returns {boolean}
 */
function tryHandleCustomCssRoutes(url, res, store, staticFileCache) {
  if (url === '/custom-css') {
    writeCustomCssHttpResponse(res, store);
    return true;
  }
  if (url === '/shared/custom-css-loader.js') {
    staticFileCache.readUtf8(CUSTOM_CSS_LOADER_PATH, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('custom-css-loader.js not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(data);
      }
    });
    return true;
  }
  return false;
}

module.exports = {
  getCustomCssContent,
  writeCustomCssHttpResponse,
  bumpCustomCssRevision,
  invalidateCustomCssCache,
  tryHandleCustomCssRoutes,
};
