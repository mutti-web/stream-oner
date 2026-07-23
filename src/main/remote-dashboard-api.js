'use strict';

/**
 * リモート API 用の状態取得・操作（PC の IPC と同等ロジックを集約）
 */
class RemoteDashboardApi {
  /**
   * @param {() => object} getDeps
   */
  constructor(getDeps) {
    this._getDeps = getDeps;
  }

  _log(actor, action, detail = '') {
    const label = actor?.deviceLabel || actor?.sessionId || '?';
    console.log(`[Remote] ${action}${detail ? ` ${detail}` : ''} by session=${actor?.sessionId || '?'} device="${label}" ip=${actor?.clientIp || ''}`);
  }

  /**
   * 他端末・PC 向けの短い操作通知（失敗時は呼ばない）
   * @param {object} actor
   * @param {string} action
   * @param {string} [detail]
   */
  _notifyAction(actor, action, detail = '') {
    const hub = this._getDeps().hub;
    if (!hub?.publish) return;
    hub.publish('remote-action', {
      deviceLabel: String(actor?.deviceLabel || '').trim() || 'リモート',
      sessionId: actor?.sessionId || null,
      action,
      detail: String(detail || ''),
      at: Date.now(),
    });
  }

  async getState() {
    const d = this._getDeps();
    const obs = d.obsService?.getStatus?.() ?? {};
    const yt = d.ytManager?.getStatus?.() ?? { pollerRunning: false, serverRunning: false };
    const av = d.avatarManager?.getStatus?.() ?? { serverRunning: false, audioRunning: false };
    const avCfg = d.avatarManager?.getConfig?.() ?? {};
    const rpc = d.rpcManager?.getStatus?.() ?? { state: 'disconnected' };
    const timer = d.broadcastTimer?.getState?.() ?? { elapsedMs: 0, running: false, startedAt: null };
    const suite = d.getSuiteFeaturesSnapshot?.() ?? {};
    const ytCfg = d.ytManager?.getConfig?.() ?? {};
    const store = d.store;
    const clientId = String(store?.get?.('clientId', '') || '').trim();
    const discordCredsOk = /^\d{17,20}$/.test(clientId) && !!store?.getSecret?.('clientSecret', '');
    const avatarReady = (!!avCfg.micADeviceId || !!avCfg.micBDeviceId)
      && Object.keys(avCfg).some((k) => {
        if (!k.startsWith('p1_path_') && !k.startsWith('p2_path_')) return false;
        return String(avCfg[k] || '').trim().length > 0;
      });
    return {
      ui: {
        themePreference: store?.get?.('ui.themePreference', 'system') || 'system',
        accentPreset: store?.get?.('ui.accentPreset', 'default') || 'default',
      },
      suite,
      obs: {
        connected: !!obs.connected,
        error: obs.error || null,
        streaming: !!obs.streaming,
        recording: !!obs.recording,
        currentSceneName: obs.currentSceneName || '',
        streamDurationMs: obs.streamDurationMs || 0,
        streamDurationAt: obs.streamDurationAt || 0,
        p1Muted: !!obs.p1Muted,
        p2Muted: !!obs.p2Muted,
        micSourceP1: obs.micSourceP1 || '',
        micSourceP2: obs.micSourceP2 || '',
      },
      yt: {
        pollerRunning: !!yt.pollerRunning,
        serverRunning: !!yt.serverRunning,
        error: yt.error || null,
        videoId: ytCfg.videoId || '',
        hasApiKey: !!ytCfg.hasApiKey,
      },
      avatar: {
        ...av,
        displayMode: avCfg.displayMode || 'both',
        p1Label: avCfg.p1Label || '1人目',
        p2Label: avCfg.p2Label || '2人目',
        ready: avatarReady,
      },
      rpc,
      discordCredsOk,
      timer,
      pinned: d.ytManager?.getPinnedMessages?.() ?? [],
      participants: d.ytManager?.getSessionParticipants?.() ?? [],
      sessionLog: d.getSessionLogManager?.()?.getStatus?.() ?? { active: false },
      lastSessionLog: d.getSessionLogManager?.()?.getLastSession?.() ?? null,
    };
  }

  async obsConnect(actor) {
    this._log(actor, 'obs-connect');
    const { obsService } = this._getDeps();
    if (!obsService) return { success: false, error: 'OBS サービス未初期化' };
    const r = await obsService.connect();
    if (r?.success) this._notifyAction(actor, 'obs-connect');
    return r;
  }

  async obsSetMute(actor, slot, muted) {
    this._log(actor, 'obs-mute', `${slot}=${muted}`);
    const { obsService } = this._getDeps();
    if (!obsService) return { success: false, error: 'OBS サービス未初期化' };
    try {
      await obsService.setMute(slot, muted);
      this._notifyAction(actor, 'obs-mute', `${slot}=${muted}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async obsSetScene(actor, sceneName) {
    this._log(actor, 'obs-scene', sceneName);
    const { obsService } = this._getDeps();
    if (!obsService) return { success: false, error: 'OBS サービス未初期化' };
    try {
      await obsService.setCurrentScene(sceneName);
      this._notifyAction(actor, 'obs-scene', sceneName);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async obsListScenes() {
    const { obsService } = this._getDeps();
    if (!obsService) return { success: false, error: 'OBS サービス未初期化', scenes: [] };
    try {
      const scenes = await obsService.listScenes();
      return { success: true, scenes };
    } catch (e) {
      return { success: false, error: e.message, scenes: [] };
    }
  }

  async obsListAudioInputs() {
    const { obsService } = this._getDeps();
    if (!obsService) return { success: false, error: 'OBS サービス未初期化', inputs: [] };
    try {
      const r = await obsService.listAudioInputs();
      return { success: true, inputs: r.inputs, fallbackAll: r.fallbackAll };
    } catch (e) {
      return { success: false, error: e.message, inputs: [] };
    }
  }

  async ytStart(actor) {
    this._log(actor, 'yt-start');
    const d = this._getDeps();
    const suite = d.getSuiteFeaturesSnapshot?.() ?? {};
    if (suite.youtubeEnabled === false) {
      return { success: false, error: 'チャットが OFF です。設定またはダッシュボードで ON にしてください。' };
    }
    const coord = d.getYoutubeChatStartCoordinator?.();
    if (!coord) return { success: false, error: 'YouTube 未初期化' };
    const prep = await coord.prepareStart();
    if (prep.step === 'start_manual') {
      const r = await coord.confirmStart(prep.videoId);
      if (r?.success) this._notifyAction(actor, 'yt-start', prep.videoId || '');
      return r;
    }
    return {
      success: false,
      error: 'クライアントで開始フローを実行してください',
      prepare: prep,
    };
  }

  async ytPrepareStart(actor) {
    this._log(actor, 'yt-prepare-start');
    const d = this._getDeps();
    const suite = d.getSuiteFeaturesSnapshot?.() ?? {};
    if (suite.youtubeEnabled === false) {
      return { step: 'error', error: 'チャットが OFF です。' };
    }
    const coord = d.getYoutubeChatStartCoordinator?.();
    if (!coord) return { step: 'error', error: 'YouTube 未初期化' };
    return coord.prepareStart();
  }

  async ytConfirmStart(actor, videoId) {
    this._log(actor, 'yt-confirm-start', videoId);
    const coord = this._getDeps().getYoutubeChatStartCoordinator?.();
    if (!coord) return { success: false, error: 'YouTube 未初期化' };
    const r = await coord.confirmStart(videoId);
    if (r?.success) this._notifyAction(actor, 'yt-confirm-start', videoId || '');
    return r;
  }

  async ytDismissNudge(actor) {
    this._log(actor, 'yt-nudge-dismiss');
    const oauth = this._getDeps().getOAuthManager?.();
    if (!oauth) return { success: false, error: 'OAuth 未初期化' };
    const r = await oauth.setNudgeDismissed(true);
    if (r?.success !== false) this._notifyAction(actor, 'yt-nudge-dismiss');
    return r;
  }

  async ytStop(actor) {
    this._log(actor, 'yt-stop');
    const { ytManager } = this._getDeps();
    if (!ytManager) return { success: false, error: 'YouTube 未初期化' };
    ytManager.stopPoller();
    this._notifyAction(actor, 'yt-stop');
    return { success: true };
  }

  async saveSuiteFlags(actor, flags) {
    this._log(actor, 'suite-flags', JSON.stringify(flags));
    const d = this._getDeps();
    try {
      const SUITE_K = d.SUITE_K;
      const store = d.store;
      if (!store || !SUITE_K) throw new Error('store 未初期化');
      if (flags.discordEnabled !== undefined) {
        store.set(SUITE_K.discordEnabled, !!flags.discordEnabled);
      }
      if (flags.youtubeEnabled !== undefined) {
        store.set(SUITE_K.youtubeEnabled, !!flags.youtubeEnabled);
      }
      if (flags.avatarEnabled !== undefined) {
        store.set('avatar.enabled', !!flags.avatarEnabled);
      }
      if (d.applySuiteFeatureFlags) await d.applySuiteFeatureFlags();
      if (d.broadcastSuiteFeaturesChanged) d.broadcastSuiteFeaturesChanged();
      this._notifyAction(actor, 'suite-flags');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async pinMessage(actor, msg) {
    this._log(actor, 'yt-pin', msg?.id);
    const { ytManager } = this._getDeps();
    if (!ytManager) return { success: false, error: 'YouTube 未初期化' };
    const r = ytManager.pinMessage(msg);
    if (r?.success !== false) this._notifyAction(actor, 'yt-pin', msg?.id || '');
    return r;
  }

  async unpinMessage(actor, msgId) {
    this._log(actor, 'yt-unpin', msgId);
    const { ytManager } = this._getDeps();
    if (!ytManager) return { success: false, error: 'YouTube 未初期化' };
    const r = ytManager.unpinMessage(msgId);
    if (r?.success !== false) this._notifyAction(actor, 'yt-unpin', msgId || '');
    return r;
  }

  async addNgUser(actor, channelId) {
    this._log(actor, 'yt-ng-user', channelId);
    const d = this._getDeps();
    if (!d.ytManager) return { success: false, error: 'YouTube 未初期化' };
    const r = d.ytManager.addNgUser(channelId);
    if (r.success && d.broadcastYtConfigChanged) d.broadcastYtConfigChanged();
    if (r.success) this._notifyAction(actor, 'yt-ng-user', channelId || '');
    return r;
  }

  async addNgWord(actor, word) {
    this._log(actor, 'yt-ng-word', word);
    const d = this._getDeps();
    if (!d.ytManager) return { success: false, error: 'YouTube 未初期化' };
    const r = d.ytManager.addNgWord(word);
    if (r.success && d.broadcastYtConfigChanged) d.broadcastYtConfigChanged();
    if (r.success) this._notifyAction(actor, 'yt-ng-word', word || '');
    return r;
  }

  async sessionLogStart(actor, videoId) {
    this._log(actor, 'session-log-start', videoId || '');
    const m = this._getDeps().getSessionLogManager?.();
    if (!m) return { success: false, error: 'セッションログ未初期化' };
    const vid = videoId || this._getDeps().ytManager?.getConfig?.()?.videoId || '';
    const r = m.startSession(vid, { manual: true });
    if (r?.success) this._notifyAction(actor, 'session-log-start', vid);
    return r;
  }

  async sessionLogEnd(actor) {
    this._log(actor, 'session-log-end');
    const m = this._getDeps().getSessionLogManager?.();
    if (!m) return { success: false, error: 'セッションログ未初期化' };
    const r = m.endSession({ reason: 'manual' });
    if (r?.success) this._notifyAction(actor, 'session-log-end');
    return r;
  }

  async sessionLogMarkHighlight(actor, entryId) {
    this._log(actor, 'session-log-highlight', entryId);
    const m = this._getDeps().getSessionLogManager?.();
    if (!m) return { success: false, error: 'セッションログ未初期化' };
    const r = m.markHighlight(entryId);
    if (r?.success !== false) this._notifyAction(actor, 'session-log-highlight', entryId || '');
    return r;
  }
}

module.exports = RemoteDashboardApi;
