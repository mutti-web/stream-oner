'use strict';

/**
 * OBS の配信開始をきっかけに、連携済み YouTube の配信中ライブから動画 ID を入れる。
 * 確認できないときは保存済み ID を変えず、理由だけ通知する。
 */

const RETRY_DELAYS_MS = [0, 5000, 12000, 25000];

const STOP_RETRY_CODES = new Set(['QUOTA', 'AUTH', 'NOT_LINKED', 'LIVE_NOT_ENABLED']);

function messageFor(result) {
  switch (result.status) {
    case 'filled': {
      const label = result.title || result.videoId || '';
      return label ? `動画 ID を入れました（${label}）` : '動画 ID を入れました';
    }
    case 'multiple':
      return '配信が複数あるため、動画 ID は自動では入れていません。取得する配信を選んでください。';
    case 'needs_link':
      return 'YouTube 未連携のため、動画 ID は自動では入りません。設定の接続から連携するか、手入力してください。';
    case 'searching':
      return '配信の動画 ID を探しています…';
    case 'not_found': {
      const why = String(result.error || '').trim();
      const prefix = why ? `${why} ` : '';
      if (result.keptVideoId) {
        return `${prefix}配信を確認できなかったので、保存済みの動画 ID はそのままです。`.trim();
      }
      return `${prefix}配信を確認できませんでした。動画 ID を手入力してください。`.trim();
    }
    default:
      return '';
  }
}

function createYoutubeVideoIdAutofill(deps) {
  const {
    isEnabled = () => true,
    getOAuthStatus,
    resolveActiveBroadcasts,
    getCurrentVideoId = () => '',
    saveVideoId,
    isPollerRunning = () => false,
    notify = () => {},
    sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    delays = RETRY_DELAYS_MS,
  } = deps;

  let generation = 0;
  let seq = 0;
  let last = { status: 'idle', seq: 0, message: '' };

  function currentVideoId() {
    return String(getCurrentVideoId() || '').trim();
  }

  function publish(next) {
    seq += 1;
    last = { ...next, seq, message: next.message || messageFor(next) };
    notify(last);
  }

  function cancel() {
    generation += 1;
  }

  async function onStreamingStarted() {
    const token = ++generation;
    if (!isEnabled()) return;
    if (isPollerRunning()) return;

    const oauth = getOAuthStatus?.() || {};
    if (!oauth.linked) {
      publish({ status: 'needs_link', keptVideoId: currentVideoId() });
      return;
    }

    publish({ status: 'searching' });

    let lastError = '配信中のライブが見つかりません。';
    for (let i = 0; i < delays.length; i += 1) {
      if (token !== generation) return;
      const delay = delays[i];
      if (delay > 0) await sleep(delay);
      if (token !== generation || isPollerRunning()) return;

      let resolved;
      try {
        resolved = await resolveActiveBroadcasts();
      } catch (err) {
        resolved = { success: false, error: err?.message || String(err) };
      }
      if (token !== generation) return;

      const broadcasts = Array.isArray(resolved?.broadcasts) ? resolved.broadcasts : [];
      if (resolved?.success && resolved.kind === 'single' && broadcasts[0]?.videoId) {
        const broadcast = broadcasts[0];
        const videoId = String(broadcast.videoId).trim();
        if (!videoId) continue;
        saveVideoId(videoId);
        publish({
          status: 'filled',
          videoId,
          title: broadcast.title || '',
        });
        return;
      }

      if (resolved?.success && resolved.kind === 'multiple') {
        publish({
          status: 'multiple',
          broadcasts,
          keptVideoId: currentVideoId(),
        });
        return;
      }

      if (resolved?.error) lastError = String(resolved.error);
      if (STOP_RETRY_CODES.has(resolved?.code)) break;
    }

    if (token !== generation) return;
    publish({
      status: 'not_found',
      keptVideoId: currentVideoId(),
      error: lastError,
    });
  }

  function onStreamingStopped() {
    cancel();
    if (last.status === 'searching') {
      publish({ status: 'idle' });
    }
  }

  return {
    onStreamingStarted,
    onStreamingStopped,
    getLast: () => last,
    cancel,
  };
}

module.exports = {
  createYoutubeVideoIdAutofill,
  messageFor,
  RETRY_DELAYS_MS,
};
