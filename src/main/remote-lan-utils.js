'use strict';

const os = require('os');

/**
 * @typedef {{ address: string, interfaceName: string }} LanIPv4Candidate
 */

/**
 * 同一 LAN 向けのプライベート IPv4 候補一覧
 * @returns {LanIPv4Candidate[]}
 */
function listLanIPv4Candidates() {
  let nets;
  try {
    nets = os.networkInterfaces();
  } catch (_) {
    return [];
  }
  const candidates = [];
  for (const interfaceName of Object.keys(nets)) {
    for (const net of nets[interfaceName] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      const address = net.address;
      if (
        address.startsWith('192.168.')
        || address.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
      ) {
        candidates.push({ address, interfaceName });
      }
    }
  }
  return candidates;
}

/**
 * 優先アドレスが有効ならそれを、なければ先頭候補
 * @param {string} [preferredAddress]
 * @returns {string | null}
 */
function resolveLanIPv4(preferredAddress) {
  const candidates = listLanIPv4Candidates();
  const pref = String(preferredAddress || '').trim();
  if (pref && candidates.some((c) => c.address === pref)) return pref;
  return candidates[0]?.address || null;
}

/** @deprecated resolveLanIPv4 を使用 */
function guessLanIPv4() {
  return resolveLanIPv4('');
}

module.exports = {
  listLanIPv4Candidates,
  resolveLanIPv4,
  guessLanIPv4,
};
