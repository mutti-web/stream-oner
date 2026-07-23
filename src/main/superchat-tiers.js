'use strict';

/** @typedef {{ minAmount: number, color: string, scale: number, durationMs: number }} SuperChatTier */

const DEFAULT_SUPER_CHAT_TIERS = [
  { minAmount: 0, color: '#fbbf24', scale: 1.0, durationMs: 8000 },
  { minAmount: 500, color: '#f59e0b', scale: 1.05, durationMs: 10000 },
  { minAmount: 2000, color: '#ef4444', scale: 1.1, durationMs: 12000 },
];

const STORE_KEY = 'yt.superChatTiers';

/**
 * @param {unknown} tiers
 * @returns {SuperChatTier[]}
 */
function normalizeTiers(tiers) {
  const src = Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_SUPER_CHAT_TIERS;
  const out = src.map((t, i) => ({
    minAmount: Math.max(0, Number(t?.minAmount) || 0),
    color: String(t?.color || DEFAULT_SUPER_CHAT_TIERS[i]?.color || '#fbbf24'),
    scale: Math.max(0.5, Math.min(2, Number(t?.scale) || 1)),
    durationMs: Math.max(1000, Math.min(120000, Number(t?.durationMs) || 8000)),
  }));
  out.sort((a, b) => a.minAmount - b.minAmount);
  return out.length ? out : [...DEFAULT_SUPER_CHAT_TIERS];
}

/**
 * @param {object} msg
 * @returns {number} 円換算（概算）
 */
function parseSuperChatAmountYen(msg) {
  const sc = msg?.superChat;
  if (!sc) return 0;
  const micros = Number(sc.amountMicros);
  if (Number.isFinite(micros) && micros > 0) {
    return Math.floor(micros / 1_000_000);
  }
  const display = String(sc.amountDisplayString || sc.amountDisplay || '');
  const digits = display.replace(/[^\d]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {SuperChatTier[]} tiers
 * @param {object} msg
 * @returns {{ tier: SuperChatTier, amountYen: number }}
 */
function resolveSuperChatTier(tiers, msg) {
  const normalized = normalizeTiers(tiers);
  const amountYen = parseSuperChatAmountYen(msg);
  let tier = normalized[0];
  for (const t of normalized) {
    if (amountYen >= t.minAmount) tier = t;
  }
  return { tier, amountYen };
}

module.exports = {
  STORE_KEY,
  DEFAULT_SUPER_CHAT_TIERS,
  normalizeTiers,
  parseSuperChatAmountYen,
  resolveSuperChatTier,
};
