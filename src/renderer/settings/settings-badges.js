// ===== バッジ更新 =====
let _badgeRpcSt = { state: 'disconnected' };
let _badgeYtSt = { pollerRunning: false };
let _badgeAvSt = {};

function refreshSettingsSuiteIndicators() {
  if (!window.DashboardControls || !window.AppStateUI) return;
  const S = window.AppStateUI;
  window.DashboardControls.updateServiceLamps({
    elements: {
      discord: document.getElementById('lamp-suite-discord'),
      youtube: document.getElementById('lamp-suite-youtube'),
      avatar: document.getElementById('lamp-suite-avatar'),
    },
    flags: {
      discordOn: !!document.getElementById('suite-discord-enabled')?.checked,
      youtubeOn: !!document.getElementById('suite-youtube-enabled')?.checked,
      avatarOn: !!document.getElementById('suite-avatar-enabled')?.checked,
    },
    discord: {
      credsOk: S.discordCredsOk(settingsSnapshot),
      rpcState: _badgeRpcSt.state,
      error: _badgeRpcSt.error,
    },
    youtube: {
      ytCfg: ytConfigCache,
      pollerRunning: !!_badgeYtSt.pollerRunning,
      error: _badgeYtSt.error,
    },
    avatar: {
      configReady: S.avatarConfigReady(avConfigCache),
      serverRunning: !!_badgeAvSt.serverRunning,
      audioRunning: !!_badgeAvSt.audioRunning,
      error: _badgeAvSt.error,
    },
  });
}

function setRpcBadge(status) {
  const S = window.AppStateUI;
  const b = document.getElementById('rpc-badge');
  if (!S || !b) return;
  _badgeRpcSt = status || { state: 'disconnected' };
  S.applyBadge(b, S.rpcBadge({ state: status?.state, error: status?.error }));
  refreshSettingsSuiteIndicators();
}
function setYtBadge(status) {
  const S = window.AppStateUI;
  const b = document.getElementById('yt-badge');
  const errHint = document.getElementById('yt-err-hint');
  if (!S || !b) return;
  _badgeYtSt = status || { pollerRunning: false };
  S.applyBadge(b, S.ytBadge({
    ytCfg: ytConfigCache,
    pollerRunning: !!status?.pollerRunning,
    error: status?.error,
  }));
  if (errHint) {
    errHint.replaceChildren();
    if (status?.error && !status?.pollerRunning) {
      const ic = document.createElement('md-icon');
      ic.textContent = 'info';
      ic.setAttribute('aria-hidden', 'true');
      errHint.append(ic, document.createTextNode(status.error));
    }
  }
  refreshSettingsSuiteIndicators();
}
function setAvBadge(status) {
  const S = window.AppStateUI;
  const b = document.getElementById('av-badge');
  if (!S || !b) return;
  _badgeAvSt = status || {};
  S.applyBadge(b, S.avBadge({
    featureOn: isAvatarFeatureEnabled(),
    configReady: S.avatarConfigReady(avConfigCache),
    serverRunning: !!status?.serverRunning,
    audioRunning: !!status?.audioRunning,
    error: status?.error,
  }));
  if (typeof updateFaceTrackStatus === 'function') updateFaceTrackStatus(status);
  refreshSettingsSuiteIndicators();
}

/** @returns {Promise<{ avSt: object, rpcSt: object, ytSt: object }>} */
async function refreshAllBadges() {
  const [avSt, rpcSt, ytSt] = await Promise.all([
    api.getAvatarStatus().catch(() => ({})),
    api.getRpcStatus().catch(() => ({ state: 'disconnected' })),
    api.getYtStatus().catch(() => ({ pollerRunning: false })),
  ]);
  setAvBadge(avSt);
  setRpcBadge(rpcSt);
  setYtBadge(ytSt);
  return { avSt, rpcSt, ytSt };
}
