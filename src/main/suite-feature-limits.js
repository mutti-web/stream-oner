'use strict';

/** ダッシュボード保持件数（設定 UI・main で共通） */
const DASHBOARD_CHAT_LIMIT = { min: 50, max: 2000, default: 500 };
const DASHBOARD_SC_LIMIT = { min: 10, max: 200, default: 50 };

function clampDashboardChatLimit(raw) {
  const n = Number(raw);
  return Math.max(
    DASHBOARD_CHAT_LIMIT.min,
    Math.min(DASHBOARD_CHAT_LIMIT.max, Number.isFinite(n) ? n : DASHBOARD_CHAT_LIMIT.default),
  );
}

function clampDashboardScLimit(raw) {
  const n = Number(raw);
  return Math.max(
    DASHBOARD_SC_LIMIT.min,
    Math.min(DASHBOARD_SC_LIMIT.max, Number.isFinite(n) ? n : DASHBOARD_SC_LIMIT.default),
  );
}

module.exports = {
  DASHBOARD_CHAT_LIMIT,
  DASHBOARD_SC_LIMIT,
  clampDashboardChatLimit,
  clampDashboardScLimit,
};
