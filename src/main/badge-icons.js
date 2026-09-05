'use strict';

const fs = require('fs');
const path = require('path');

/** @type {readonly ['first', 'regular', 'member', 'moderator', 'owner']} */
const BADGE_ICON_KINDS = Object.freeze(['first', 'regular', 'member', 'moderator', 'owner']);

const PATH_KEYS = {
  first: 'yt.badgeIconFirst',
  regular: 'yt.badgeIconRegular',
  member: 'yt.badgeIconMember',
  moderator: 'yt.badgeIconModerator',
  owner: 'yt.badgeIconOwner',
};

const REV_KEY = 'yt.badgeIconRevision';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const KIND_PATH_RE = new RegExp(`^/badge-icon/(${BADGE_ICON_KINDS.join('|')})$`);

/**
 * @param {string} kind
 * @returns {kind is typeof BADGE_ICON_KINDS[number]}
 */
function isBadgeIconKind(kind) {
  return BADGE_ICON_KINDS.includes(kind);
}

/**
 * @param {object} store
 * @param {string} kind
 * @returns {string}
 */
function getIconPath(store, kind) {
  if (!isBadgeIconKind(kind)) return '';
  return String(store?.get?.(PATH_KEYS[kind], '') || '').trim();
}

/**
 * OBS ブラウザ向け相対 URL。未設定なら空文字。
 * @param {object} store
 * @param {string} kind
 */
function iconUrlForOverlay(store, kind) {
  if (!getIconPath(store, kind)) return '';
  const rev = Number(store?.get?.(REV_KEY, 0)) || 0;
  return `/badge-icon/${kind}?v=${rev}`;
}

/** @param {object} store */
function allIconUrls(store) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const kind of BADGE_ICON_KINDS) {
    out[kind] = iconUrlForOverlay(store, kind);
  }
  return out;
}

function bumpRevision(store) {
  const next = (Number(store?.get?.(REV_KEY, 0)) || 0) + 1;
  store?.set?.(REV_KEY, next);
  return next;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function mimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

/**
 * GET /badge-icon/{first|regular|member|moderator|owner}
 * @returns {boolean} 処理したとき true
 */
function tryHandleBadgeIconRoute(url, res, store, staticFileCache) {
  const pathname = String(url || '').split('?')[0];
  const m = pathname.match(KIND_PATH_RE);
  if (!m) return false;

  const kind = m[1];
  const filePath = getIconPath(store, kind);
  if (!filePath) {
    res.writeHead(404);
    res.end('Not Found');
    return true;
  }

  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !fs.existsSync(resolved)) {
    res.writeHead(404);
    res.end('Not Found');
    return true;
  }

  const read = staticFileCache?.readBuffer
    ? staticFileCache.readBuffer.bind(staticFileCache)
    : (p, cb) => fs.readFile(p, cb);

  read(resolved, (err, data) => {
    if (err || !data) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeForPath(resolved),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
  return true;
}

module.exports = {
  BADGE_ICON_KINDS,
  PATH_KEYS,
  REV_KEY,
  isBadgeIconKind,
  getIconPath,
  iconUrlForOverlay,
  allIconUrls,
  bumpRevision,
  tryHandleBadgeIconRoute,
};
