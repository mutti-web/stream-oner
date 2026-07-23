'use strict';

const path = require('path');
const staticFileCache = require('./static-file-cache');

const MIME_BY_EXT = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

/**
 * OBS 用レンダラーの静的ファイルを URL パスで配信する（パストラバーサル防止）
 *
 * @param {string} rendererDir - 例: .../src/renderer
 * @param {Record<string, string>} routeMap - リクエストパス → renderer からの相対パス
 * @returns {(url: string, res: import('http').ServerResponse) => boolean} 処理したら true
 */
function createRendererStaticHandler(rendererDir, routeMap) {
  const root = path.resolve(rendererDir);
  const routes = new Map();
  for (const [urlPath, relPath] of Object.entries(routeMap)) {
    routes.set(urlPath, relPath);
  }

  return function tryServeRendererStatic(url, res) {
    const rel = routes.get(url);
    if (!rel) return false;

    const filePath = path.resolve(root, rel);
    const relToRoot = path.relative(root, filePath);
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return true;
    }

    const ext = path.extname(filePath).toLowerCase();
    staticFileCache.readUtf8(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_BY_EXT[ext] || 'text/plain; charset=utf-8' });
      res.end(data);
    });
    return true;
  };
}

module.exports = { createRendererStaticHandler };
