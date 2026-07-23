'use strict';

/**
 * OBS オーバーレイ用ローカル HTTP/WS ポート（既定値 + settings 上書き）
 */

/** @typedef {{ discordHttp: number, discordWs: number, youtube: number, avatar: number }} SuitePorts */

const DEFAULT_PORTS = {
  discordHttp: 3000,
  discordWs: 3001,
  youtube: 3002,
  avatar: 3003,
};

const STORE_KEYS = {
  discordHttp: 'suite.ports.discordHttp',
  discordWs: 'suite.ports.discordWs',
  youtube: 'suite.ports.youtube',
  avatar: 'suite.ports.avatar',
};

const PORT_LABELS = {
  discordHttp: 'Discord OBS（HTTP）',
  discordWs: 'Discord OBS（WebSocket）',
  youtube: 'YouTube OBS',
  avatar: 'アバター OBS',
};

function clampPort(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(1024, Math.min(65535, Math.round(v)));
}

/**
 * @param {object} store SimpleStore 互換
 * @returns {SuitePorts}
 */
function getSuitePorts(store) {
  return {
    discordHttp: clampPort(store?.get(STORE_KEYS.discordHttp), DEFAULT_PORTS.discordHttp),
    discordWs: clampPort(store?.get(STORE_KEYS.discordWs), DEFAULT_PORTS.discordWs),
    youtube: clampPort(store?.get(STORE_KEYS.youtube), DEFAULT_PORTS.youtube),
    avatar: clampPort(store?.get(STORE_KEYS.avatar), DEFAULT_PORTS.avatar),
  };
}

/**
 * @param {object} store
 * @param {Partial<SuitePorts>} patch
 */
function saveSuitePorts(store, patch) {
  if (!store || !patch) return;
  if (patch.discordHttp !== undefined) {
    store.set(STORE_KEYS.discordHttp, clampPort(patch.discordHttp, DEFAULT_PORTS.discordHttp));
  }
  if (patch.discordWs !== undefined) {
    store.set(STORE_KEYS.discordWs, clampPort(patch.discordWs, DEFAULT_PORTS.discordWs));
  }
  if (patch.youtube !== undefined) {
    store.set(STORE_KEYS.youtube, clampPort(patch.youtube, DEFAULT_PORTS.youtube));
  }
  if (patch.avatar !== undefined) {
    store.set(STORE_KEYS.avatar, clampPort(patch.avatar, DEFAULT_PORTS.avatar));
  }
}

/**
 * @param {string[]} conflictLines
 * @param {SuitePorts} ports
 */
function formatPortConflictDetail(conflictLines, ports) {
  const p = ports || DEFAULT_PORTS;
  return (
    `${conflictLines.join('\n')}\n\n` +
    '対処:\n' +
    '1. タスクマネージャー等で該当ポートを使用しているアプリを終了\n' +
    '2. または 設定 → レイアウト →「OBS オーバーレイポート」で番号を変更しアプリを再起動\n' +
    `   （現在の設定: HTTP ${p.discordHttp} / WS ${p.discordWs} / YouTube ${p.youtube} / Avatar ${p.avatar}）`
  );
}

module.exports = {
  DEFAULT_PORTS,
  STORE_KEYS,
  PORT_LABELS,
  clampPort,
  getSuitePorts,
  saveSuitePorts,
  formatPortConflictDetail,
};
