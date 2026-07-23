'use strict';

/**
 * 配信中 YouTube ライブの検出（liveBroadcasts.list）
 *
 * 注意: mine と broadcastStatus は同時指定不可（API 制約）。
 * Studio のテスト配信は lifeCycleStatus=testing になり、broadcastStatus=active に出ないことがある。
 */

const { getJson } = require('./youtube-oauth-http');

const LIVE_BROADCASTS_URL = 'https://www.googleapis.com/youtube/v3/liveBroadcasts';
const MAX_RESULTS = 25;

const ERR = {
  NOT_LINKED: 'NOT_LINKED',
  NO_BROADCAST: 'NO_BROADCAST',
  QUOTA: 'QUOTA',
  AUTH: 'AUTH',
  LIVE_NOT_ENABLED: 'LIVE_NOT_ENABLED',
};

/** チャット取得の対象にする配信ライフサイクル */
const ACTIVE_LIFE_CYCLES = new Set([
  'live',
  'liveStarting',
  'testing',
  'testStarting',
]);

/**
 * @param {object} item YouTube LiveBroadcast resource
 * @returns {{ broadcastId: string, videoId: string, title: string, scheduledStartTime: string, actualStartTime: string, lifeCycleStatus: string, privacyStatus: string } | null}
 */
function normalizeBroadcastItem(item) {
  if (!item?.id) return null;
  const broadcastId = String(item.id).trim();
  return {
    broadcastId,
    /** Studio 経由の標準ライブは broadcast id = 動画 id（v1） */
    videoId: broadcastId,
    title: String(item.snippet?.title || '').trim() || '（タイトルなし）',
    scheduledStartTime: item.snippet?.scheduledStartTime || '',
    actualStartTime: item.snippet?.actualStartTime || '',
    lifeCycleStatus: item.status?.lifeCycleStatus || '',
    privacyStatus: item.status?.privacyStatus || '',
  };
}

function isActivelyStreaming(item) {
  const life = String(item?.status?.lifeCycleStatus || item?.lifeCycleStatus || '');
  return ACTIVE_LIFE_CYCLES.has(life);
}

/**
 * @param {object[]} items
 * @returns {'none' | 'single' | 'multiple'}
 */
function classifyBroadcastCount(items) {
  const n = Array.isArray(items) ? items.length : 0;
  if (n <= 0) return 'none';
  if (n === 1) return 'single';
  return 'multiple';
}

function mapApiError(err) {
  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();
  if (lower.includes('quota') || lower.includes('quotaexceeded')) {
    return {
      success: false,
      code: ERR.QUOTA,
      error: 'YouTube Data API の利用上限に達しました。しばらく待つか、手動で動画 ID を指定してください。',
    };
  }
  if (lower.includes('livestreamingnotenabled') || lower.includes('live streaming not enabled')) {
    return {
      success: false,
      code: ERR.LIVE_NOT_ENABLED,
      error: 'このチャンネルは YouTube ライブ配信が有効ではありません。YouTube Studio でライブ配信機能を有効にしてください。',
    };
  }
  if (lower.includes('連携') || lower.includes('not linked') || lower.includes('未設定')) {
    return { success: false, code: ERR.NOT_LINKED, error: msg };
  }
  if (lower.includes('invalid') && lower.includes('token')
    || lower.includes('unauthorized')
    || lower.includes('auth')
    || lower.includes('再連携')
    || lower.includes('insufficient')) {
    return {
      success: false,
      code: ERR.AUTH,
      error: 'YouTube の認可が無効か権限不足です。設定 › 接続から再連携してください。',
    };
  }
  return { success: false, code: 'API_ERROR', error: msg || '配信の検出に失敗しました' };
}

/**
 * @param {{
 *   getAccessToken: () => Promise<string>,
 *   getApiKey?: () => string,
 *   fetchBroadcasts?: (accessToken: string, params: URLSearchParams) => Promise<object>,
 * }} deps
 */
function createYoutubeLiveResolver(deps) {
  const {
    getAccessToken,
    fetchBroadcasts: fetchOverride,
    fetchActiveBroadcasts: legacyOverride,
  } = deps;

  async function listBroadcasts(accessToken, filterParams) {
    if (legacyOverride) return legacyOverride(accessToken);
    const params = new URLSearchParams({
      part: 'snippet,status,contentDetails',
      broadcastType: 'all',
      maxResults: String(MAX_RESULTS),
      ...filterParams,
    });
    // OAuth 利用時は key なしでも可。無効な key 併用で失敗することがあるため付けない
    const url = `${LIVE_BROADCASTS_URL}?${params.toString()}`;
    if (fetchOverride) return fetchOverride(accessToken, params);
    return getJson(url, accessToken);
  }

  /**
   * 配信中（live / testing 含む）のライブ一覧を取得する。
   */
  async function resolveActiveBroadcasts() {
    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (err) {
      return mapApiError(err);
    }

    try {
      // 1) broadcastStatus=active（mine とは併用不可）
      let json;
      try {
        json = await listBroadcasts(accessToken, { broadcastStatus: 'active' });
      } catch (err) {
        const msg = String(err?.message || err);
        // 一部環境では active 指定が失敗するため mine へフォールバック
        console.warn('[YouTube Live] broadcastStatus=active 失敗、mine にフォールバック:', msg);
        json = { items: [] };
      }

      let rawItems = Array.isArray(json.items) ? json.items : [];

      // 2) 空なら mine=true で取得し、lifeCycleStatus で絞る（テスト配信 testing を拾う）
      if (rawItems.length === 0) {
        json = await listBroadcasts(accessToken, { mine: 'true' });
        rawItems = (Array.isArray(json.items) ? json.items : [])
          .filter(isActivelyStreaming);
      }

      const broadcasts = rawItems
        .map(normalizeBroadcastItem)
        .filter(Boolean);
      const kind = classifyBroadcastCount(broadcasts);

      if (kind === 'none') {
        return {
          success: false,
          kind: 'none',
          broadcasts: [],
          code: ERR.NO_BROADCAST,
          error: '配信中のライブが見つかりません。YouTube Studio で配信（またはテスト配信）を開始してから再度お試しください。待機中・終了済みは対象外です。',
        };
      }

      return {
        success: true,
        kind,
        broadcasts,
      };
    } catch (err) {
      console.error('[YouTube Live] 検出エラー:', err?.message || err);
      return mapApiError(err);
    }
  }

  return {
    resolveActiveBroadcasts,
    normalizeBroadcastItem,
    classifyBroadcastCount,
    isActivelyStreaming,
  };
}

module.exports = {
  createYoutubeLiveResolver,
  normalizeBroadcastItem,
  classifyBroadcastCount,
  isActivelyStreaming,
  ACTIVE_LIFE_CYCLES,
  LIVE_BROADCASTS_URL,
  ERR,
};
