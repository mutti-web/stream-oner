'use strict';

/**
 * チャット取得開始の共通フロー（OAuth 検出・確認・手動フォールバック）
 */

function createYoutubeChatStartCoordinator(deps) {
  const {
    getStore,
    getOAuthManager,
    getLiveResolver,
    getYtManager,
    getBroadcastTimer,
    broadcastYtConfigChanged,
  } = deps;

  function getManualVideoId() {
    const yt = getYtManager();
    const cfg = yt?.getConfig?.() ?? {};
    const fromCfg = String(cfg.videoId || '').trim();
    if (fromCfg) return fromCfg;
    return String(getStore()?.get?.('yt.videoId', '') || '').trim();
  }

  async function prepareStart() {
    const ytManager = getYtManager();
    if (!ytManager) {
      return { step: 'error', error: 'YouTube 未初期化' };
    }

    const st = ytManager.getStatus?.() ?? {};
    if (st.pollerRunning) {
      return { step: 'already_running' };
    }

    const oauth = getOAuthManager().getStatus();
    const manualVideoId = getManualVideoId();

    if (oauth.linked) {
      const resolved = await getLiveResolver().resolveActiveBroadcasts();
      if (!resolved.success) {
        if (manualVideoId) {
          return {
            step: 'confirm_manual_fallback',
            videoId: manualVideoId,
            detectError: resolved.error || '配信を検出できませんでした',
          };
        }
        return {
          step: 'error',
          error: resolved.error || '配信を検出できませんでした',
          code: resolved.code,
        };
      }
      if (resolved.kind === 'single') {
        return { step: 'confirm_single', broadcast: resolved.broadcasts[0] };
      }
      return { step: 'pick_multiple', broadcasts: resolved.broadcasts };
    }

    if (manualVideoId) {
      return { step: 'start_manual', videoId: manualVideoId };
    }

    if (!oauth.nudgeDismissed) {
      return { step: 'nudge', configured: oauth.configured };
    }

    return {
      step: 'error',
      error: '動画 ID が未設定です。ダッシュボードで入力するか、接続タブで YouTube と連携してください。',
    };
  }

  async function confirmStart(videoId) {
    const ytManager = getYtManager();
    if (!ytManager) return { success: false, error: 'YouTube 未初期化' };

    const vid = String(videoId || '').trim();
    if (!vid) return { success: false, error: '動画 ID が空です' };

    ytManager.saveConfig({ videoId: vid });
    const timer = getBroadcastTimer?.();
    timer?.onVideoIdChanged?.(vid);
    if (broadcastYtConfigChanged) broadcastYtConfigChanged();

    return ytManager.startPoller();
  }

  return { prepareStart, confirmStart };
}

module.exports = { createYoutubeChatStartCoordinator };
