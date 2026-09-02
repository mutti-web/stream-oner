'use strict';

const DEFAULT_DURATION_MS = 4000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 30000;
const MAX_REACTIONS = 8;
const ID_RE = /^react-[a-z0-9]{4,24}$/i;

function clampDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(n)));
}

function newReactionId() {
  return `react-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param {unknown} raw
 * @returns {object[]}
 */
function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim().slice(0, 32);
    const path = String(item.path || '').trim();
    if (!label || !path) continue;
    let id = String(item.id || '').trim();
    if (!ID_RE.test(id)) id = newReactionId();
    out.push({
      id,
      label,
      path,
      durationMs: clampDuration(item.durationMs),
      flipX: !!item.flipX,
    });
    if (out.length >= MAX_REACTIONS) break;
  }
  return out;
}

/**
 * @param {object[]} list
 * @param {string} reactionId
 */
function findById(list, reactionId) {
  const id = String(reactionId || '').trim();
  if (!id) return null;
  return (Array.isArray(list) ? list : []).find((r) => r.id === id) || null;
}

/**
 * リモート UI 向け（ローカルパスは送らない）
 * @param {object[]} list
 * @param {{ slotId?: 'p1'|'p2' }} [opts]
 */
function toRemoteList(list, opts = {}) {
  const slotId = opts.slotId === 'p2' ? 'p2' : opts.slotId === 'p1' ? 'p1' : null;
  return normalizeList(list).map((r) => {
    const item = {
      id: r.id,
      label: r.label,
      durationMs: r.durationMs,
    };
    if (slotId) {
      item.previewUrl = `/remote/avatar-reaction/${slotId}/${encodeURIComponent(r.id)}`;
    }
    return item;
  });
}

module.exports = {
  DEFAULT_DURATION_MS,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  MAX_REACTIONS,
  newReactionId,
  normalizeList,
  findById,
  toRemoteList,
};
