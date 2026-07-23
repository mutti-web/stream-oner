'use strict';

const STORE_KEY = 'obs.eventActions';

const EVENT_TYPES = new Set(['superchat', 'membership', 'keyword']);

/**
 * @param {unknown} rules
 * @returns {object[]}
 */
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((r) => ({
      event: String(r?.event || '').toLowerCase(),
      sourceName: String(r?.sourceName || '').trim(),
      action: r?.action === 'toggle' ? 'toggle' : 'show',
      durationMs: Math.max(0, Math.min(120000, Number(r?.durationMs) || 3000)),
      keyword: String(r?.keyword || '').trim(),
    }))
    .filter((r) => EVENT_TYPES.has(r.event) && r.sourceName);
}

/**
 * @param {object} rule
 * @param {{ type: string, msg?: object }} ctx
 */
function ruleMatches(rule, ctx) {
  if (rule.event === 'superchat') {
    return ctx.type === 'message' && !!ctx.msg?.superChat;
  }
  if (rule.event === 'membership') {
    return ctx.type === 'membership';
  }
  if (rule.event === 'keyword') {
    if (ctx.type !== 'message' || !rule.keyword) return false;
    const text = String(ctx.msg?.text || '');
    return text.toLowerCase().includes(rule.keyword.toLowerCase());
  }
  return false;
}

/**
 * @param {object[]} rules
 * @param {import('./obs-service').ObsService | null} obsService
 * @param {{ type: string, msg?: object }} ctx
 */
async function dispatchObsEventActions(rules, obsService, ctx) {
  if (!obsService) return;
  const normalized = normalizeRules(rules);
  for (const rule of normalized) {
    if (!ruleMatches(rule, ctx)) continue;
    try {
      await obsService.runEventAction(rule);
    } catch (e) {
      console.warn('[OBS] イベント連動:', e.message);
    }
  }
}

module.exports = {
  STORE_KEY,
  EVENT_TYPES,
  normalizeRules,
  ruleMatches,
  dispatchObsEventActions,
};
