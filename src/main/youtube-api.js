'use strict';

const https = require('https');

/** YouTube Web クライアントが使う公開 InnerTube キー（ユーザー API キー不要） */
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHL6lRqiXPj-WDrM7g';
const INNERTUBE_HOST = 'www.youtube.com';
const INNERTUBE_CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20250226.01.00',
  hl: 'ja',
  gl: 'JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const CHAT_SOURCES = new Set(['auto', 'innertube', 'dataapi']);

function normalizeChatSource(raw) {
  const v = String(raw || 'auto').toLowerCase();
  return CHAT_SOURCES.has(v) ? v : 'auto';
}

/**
 * YouTube ライブチャット ポーラー（InnerTube 優先）
 *
 * - 既定: watch ページ + live_chat/get_live_chat（Data API クォータ不要）
 * - 任意: apiKey がある場合は Data API v3 にフォールバック可能
 */
class YouTubeChatPoller {
  constructor(ytConfig, onMessages) {
    this.config = ytConfig || {};
    this.onMessages = onMessages;
    this.continuation = null;
    this.liveChatId = null;
    this.nextPageToken = null;
    this.timer = null;
    this.retryCount = 0;
    this.MAX_RETRY = 10;
    this.running = false;
    this.useDataApi = false;
    this.chatSource = 'auto';
    this.activeBackend = null;
  }

  _resolveStartMode() {
    const chatSource = normalizeChatSource(this.config.chatSource);
    const hasKey = !!String(this.config.apiKey || '').trim();
    this.chatSource = chatSource;

    if (chatSource === 'dataapi') {
      if (!hasKey) throw new Error('Data API を使うには API キーが必要です（接続タブで設定）');
      return { useDataApi: true, allowDataApiFallback: false };
    }
    if (chatSource === 'innertube') {
      return { useDataApi: false, allowDataApiFallback: false };
    }
    return {
      useDataApi: hasKey,
      allowDataApiFallback: hasKey,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.continuation = null;
    this.liveChatId = null;
    this.activeBackend = null;

    let mode;
    try {
      mode = this._resolveStartMode();
    } catch (e) {
      this.running = false;
      throw e;
    }
    this.useDataApi = mode.useDataApi;

    try {
      if (this.useDataApi) {
        this.liveChatId = await this._fetchLiveChatIdDataApi();
        this.activeBackend = 'dataapi';
        console.log('[Poller] liveChatId (Data API):', this.liveChatId);
      } else {
        this.continuation = await this._fetchLiveChatContinuation();
        this.activeBackend = 'innertube';
        console.log('[Poller] InnerTube continuation 取得済み');
      }
      this._poll();
    } catch (err) {
      if (!this.useDataApi && mode.allowDataApiFallback) {
        console.warn('[Poller] InnerTube 失敗、Data API へフォールバック:', err.message);
        try {
          this.useDataApi = true;
          this.liveChatId = await this._fetchLiveChatIdDataApi();
          this.activeBackend = 'dataapi';
          this._poll();
          return;
        } catch (e2) {
          console.error('[Poller] フォールバックも失敗:', e2.message);
        }
      }
      console.error('[Poller] 起動エラー:', err.message);
      this.running = false;
      this.activeBackend = null;
      throw err;
    }
  }

  stop() {
    this.running = false;
    this.activeBackend = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Poller] 停止しました');
  }

  updateConfig(ytConfig) {
    this.config = ytConfig;
  }

  async _fetchLiveChatContinuation() {
    const videoId = String(this.config.videoId || '').trim();
    if (!videoId) throw new Error('videoId が未設定です');

    const html = await this._getText(`https://${INNERTUBE_HOST}/watch?v=${encodeURIComponent(videoId)}`);
    const initial = this._parseYtInitialData(html);
    if (!initial) throw new Error('動画ページの解析に失敗しました');

    const conts = this._findAll(initial, 'continuation');
    for (const c of conts) {
      const token = typeof c === 'string' ? c : c?.continuation;
      if (token && token.length > 20) return token;
    }
    throw new Error('ライブ配信中の動画ではありません（またはチャット continuation が見つかりません）');
  }

  _parseYtInitialData(html) {
    const markers = ['var ytInitialData = ', 'ytInitialData = '];
    for (const m of markers) {
      const idx = html.indexOf(m);
      if (idx < 0) continue;
      const start = idx + m.length;
      const json = this._extractJsonObject(html, start);
      if (json) {
        try { return JSON.parse(json); } catch (_) { /* try next */ }
      }
    }
    return null;
  }

  _extractJsonObject(str, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return str.slice(start, i + 1);
      }
    }
    return null;
  }

  _findAll(obj, key, out = []) {
    if (!obj || typeof obj !== 'object') return out;
    if (Object.prototype.hasOwnProperty.call(obj, key)) out.push(obj[key]);
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') this._findAll(v, key, out);
    }
    return out;
  }

  async _fetchLiveChatIdDataApi() {
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=liveStreamingDetails` +
      `&id=${encodeURIComponent(this.config.videoId)}` +
      `&key=${encodeURIComponent(this.config.apiKey)}`;
    const data = await this._getJson(url);
    if (!data.items?.length) throw new Error(`動画が見つかりません: ${this.config.videoId}`);
    const chatId = data.items[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!chatId) throw new Error('ライブ配信中の動画ではありません（または既に終了）');
    return chatId;
  }

  async _poll() {
    if (!this.running) return;

    try {
      let messages = [];
      let interval = this.config.pollingIntervalMs || 3000;

      if (this.useDataApi) {
        const r = await this._pollDataApi();
        messages = r.messages;
        interval = Math.max(interval, r.intervalMs);
        this.retryCount = 0;
      } else {
        const r = await this._pollInnerTube();
        messages = r.messages;
        interval = Math.max(interval, r.intervalMs);
        if (r.continuation) this.continuation = r.continuation;
        this.retryCount = 0;
      }

      if (messages.length) this.onMessages(messages);

      this.timer = setTimeout(() => this._poll(), interval);
    } catch (err) {
      console.error('[Poller] ポーリングエラー:', err.message);
      this.retryCount++;
      if (this.retryCount > this.MAX_RETRY) {
        console.error('[Poller] リトライ上限に達しました。停止します。');
        this.running = false;
        return;
      }
      const backoff = Math.min(5000 * 2 ** this.retryCount, 300_000);
      this.timer = setTimeout(() => this._poll(), backoff);
    }
  }

  async _pollInnerTube() {
    const body = {
      context: { client: INNERTUBE_CLIENT },
      continuation: this.continuation,
    };
    const data = await this._postInnerTube('/youtubei/v1/live_chat/get_live_chat', body);
    const messages = [];
    let intervalMs = 3000;
    let nextContinuation = this.continuation;

    const cont = data?.continuationContents?.liveChatContinuation;
    if (cont?.continuations?.[0]?.timedContinuationData?.continuation) {
      nextContinuation = cont.continuations[0].timedContinuationData.continuation;
      intervalMs = Number(cont.continuations[0].timedContinuationData.timeoutMs) || intervalMs;
    } else if (cont?.continuations?.[0]?.invalidationContinuationData?.continuation) {
      nextContinuation = cont.continuations[0].invalidationContinuationData.continuation;
    }

    const actions = cont?.actions || data?.actions || [];
    for (const act of actions) {
      const item = act?.addChatItemAction?.item || act?.item;
      if (!item) continue;
      const norm = this._normalizeInnerTubeItem(item);
      if (norm) messages.push(norm);
    }

    return { messages, intervalMs, continuation: nextContinuation };
  }

  async _pollDataApi() {
    let url =
      `https://www.googleapis.com/youtube/v3/liveChat/messages` +
      `?liveChatId=${encodeURIComponent(this.liveChatId)}` +
      `&part=snippet,authorDetails` +
      `&maxResults=200` +
      `&key=${encodeURIComponent(this.config.apiKey)}`;
    if (this.nextPageToken) {
      url += `&pageToken=${encodeURIComponent(this.nextPageToken)}`;
    }
    const data = await this._getJson(url);
    this.nextPageToken = data.nextPageToken;
    const messages = (data.items || []).map((item) => this._normalizeDataApiItem(item));
    return {
      messages,
      intervalMs: data.pollingIntervalMillis ?? 5000,
    };
  }

  _normalizeInnerTubeItem(item) {
    const renderer =
      item.liveChatTextMessageRenderer ||
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer ||
      item.liveChatViewerEngagementMessageRenderer;
    if (!renderer) return null;

    const id = renderer.id || `innertube-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runs = renderer.message?.runs || renderer.headerText?.runs || [];
    const text = runs.map((r) => r.text || '').join('').trim();
    const authorName = renderer.authorName?.simpleText || '—';
    const channelId = renderer.authorExternalChannelId || renderer.authorPhoto?.thumbnails?.[0]?.url || '';

    let type = 'textMessageEvent';
    let superChat = null;
    if (item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer) {
      type = 'superChatEvent';
      const sc = item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer;
      superChat = {
        amountDisplayString: sc.purchaseAmountText?.simpleText || '',
        userComment: text,
      };
    }
    if (item.liveChatMembershipItemRenderer) {
      type = 'newSponsorEvent';
    }

    const emojiOnlyRegex = /^[\p{Extended_Pictographic}\s]+$/u;
    const isMembershipEvent = type.includes('memberMilestone') || type === 'newSponsorEvent';

    return {
      id,
      type,
      isMembershipEvent,
      text: superChat?.userComment || text,
      isEmojiOnly: text.length > 0 && emojiOnlyRegex.test(text),
      publishedAt: new Date(Number(renderer.timestampUsec || 0) / 1000).toISOString(),
      author: {
        name: authorName,
        id: typeof channelId === 'string' && channelId.startsWith('UC') ? channelId : '',
        isModerator: !!renderer.authorBadges?.some((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType === 'MODERATOR'),
        isMember: !!renderer.authorBadges?.some((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType === 'MEMBER'),
        isOwner: !!renderer.authorBadges?.some((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType === 'OWNER'),
        iconUrl: renderer.authorPhoto?.thumbnails?.[0]?.url || '',
      },
      superChat,
    };
  }

  _normalizeDataApiItem(item) {
    const sn = item.snippet;
    const au = item.authorDetails;
    const text = sn.displayMessage ?? '';
    const emojiOnlyRegex = /^[\p{Extended_Pictographic}\s]+$/u;
    const type = sn.type || 'unknown';
    return {
      id: item.id,
      type,
      isMembershipEvent: type.includes('memberMilestone') || type === 'newSponsorEvent',
      text,
      isEmojiOnly: text.length > 0 && emojiOnlyRegex.test(text),
      publishedAt: sn.publishedAt,
      author: {
        name: au.displayName,
        id: au.channelId,
        isModerator: au.isChatModerator ?? false,
        isMember: au.isChatSponsor ?? false,
        isOwner: au.isChatOwner ?? false,
        iconUrl: au.profileImageUrl ?? '',
      },
      superChat: sn.superChatDetails ?? null,
    };
  }

  _postInnerTube(path, body) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: INNERTUBE_HOST,
        path: `${path}?key=${INNERTUBE_KEY}&prettyPrint=false`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': INNERTUBE_CLIENT.userAgent,
          Origin: `https://${INNERTUBE_HOST}`,
        },
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`InnerTube HTTP ${res.statusCode}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error.message || 'InnerTube error'));
            else resolve(json);
          } catch (e) {
            reject(new Error(`JSON解析エラー: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('リクエストタイムアウト')));
      req.write(payload);
      req.end();
    });
  }

  _getJson(url) {
    return this._getText(url).then((t) => {
      const json = JSON.parse(t);
      if (json.error) throw new Error(`YouTube API: ${json.error.message}`);
      return json;
    });
  }

  _getText(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': INNERTUBE_CLIENT.userAgent },
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('リクエストタイムアウト')));
    });
  }
}

module.exports = YouTubeChatPoller;
module.exports.normalizeChatSource = normalizeChatSource;
module.exports.CHAT_SOURCES = CHAT_SOURCES;
