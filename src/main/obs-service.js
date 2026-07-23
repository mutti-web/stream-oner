'use strict';

const { EventEmitter } = require('events');
const ObsWebSocketClient = require('./obs-websocket-client');

const { STORE_KEY: OBS_EVENT_ACTIONS_KEY, normalizeRules } = require('./obs-event-dispatcher');

const K = {
  wsHost: 'obs.wsHost',
  wsPort: 'obs.wsPort',
  wsPassword: 'obs.wsPassword',
  micSourceP1: 'obs.micSourceP1',
  micSourceP2: 'obs.micSourceP2',
  eventActions: OBS_EVENT_ACTIONS_KEY,
};

/**
 * OBS WebSocket 操作のサービス層（IPC / 将来のリモート API から共用）
 */
class ObsService extends EventEmitter {
  /**
   * @param {object} store SimpleStore 互換（get/set/getSecret/setSecret）
   * @param {() => object | null} getAvatarManager
   */
  constructor(store, getAvatarManager) {
    super();
    this._store = store;
    this._getAvatarManager = getAvatarManager;
    this._client = new ObsWebSocketClient(() => ({
      host: this._store.get(K.wsHost, '127.0.0.1'),
      port: Number(this._store.get(K.wsPort, 4455)) || 4455,
      password: this._store.getSecret(K.wsPassword, ''),
    }));
    this._pollTimer = null;
    this._muteState = { p1Muted: false, p2Muted: false };
    /** @type {Map<string, NodeJS.Timeout>} */
    this._eventActionTimers = new Map();

    this._client.on('connection-changed', (s) => {
      this.emit('connection-changed', s);
      if (s.connected) {
        this._syncMuteStateFromObs().catch(() => {});
      }
    });
    this._client.on('output-state-changed', (s) => {
      this.emit('output-state-changed', s);
    });
    this._client.on('scene-changed', (s) => {
      this.emit('scene-changed', s);
    });
    this._client.on('input-mute-changed', (ev) => {
      this._onObsInputMuteChanged(ev.inputName, ev.inputMuted);
    });
  }

  getConfig() {
    return {
      wsHost: this._store.get(K.wsHost, '127.0.0.1'),
      wsPort: Number(this._store.get(K.wsPort, 4455)) || 4455,
      hasObsWsPassword: !!this._store.getSecret(K.wsPassword, ''),
      micSourceP1: this._store.get(K.micSourceP1, ''),
      micSourceP2: this._store.get(K.micSourceP2, ''),
      eventActions: this.getEventActions(),
    };
  }

  getEventActions() {
    return normalizeRules(this._store.get(K.eventActions, []));
  }

  saveEventActions(rules) {
    const normalized = normalizeRules(rules);
    this._store.set(K.eventActions, normalized);
    return normalized;
  }

  saveConfig(partial) {
    if (partial.wsHost !== undefined) this._store.set(K.wsHost, String(partial.wsHost || '127.0.0.1'));
    if (partial.wsPort !== undefined) {
      const p = Math.max(1, Math.min(65535, Number(partial.wsPort) || 4455));
      this._store.set(K.wsPort, p);
    }
    if (partial.wsPassword !== undefined && partial.wsPassword !== '') {
      this._store.setSecret(K.wsPassword, partial.wsPassword);
    }
    if (partial.micSourceP1 !== undefined) this._store.set(K.micSourceP1, String(partial.micSourceP1 || ''));
    if (partial.micSourceP2 !== undefined) this._store.set(K.micSourceP2, String(partial.micSourceP2 || ''));
  }

  getStatus() {
    const snap = this._client.getSnapshot();
    return {
      connected: snap.connected,
      error: snap.error,
      streaming: snap.streaming,
      recording: snap.recording,
      currentSceneName: snap.currentSceneName,
      streamDurationMs: snap.streamDurationMs || 0,
      streamDurationAt: snap.streamDurationAt || 0,
      p1Muted: this._muteState.p1Muted,
      p2Muted: this._muteState.p2Muted,
      ...this.getConfig(),
    };
  }

  async connect() {
    const result = await this._client.connect();
    if (result.success) {
      await this._syncMuteStateFromObs().catch(() => {});
    }
    return result;
  }

  disconnect() {
    this.stopDashboardPolling();
    this._client.disconnect();
  }

  startDashboardPolling(isDashboardVisible) {
    this.stopDashboardPolling();
    if (!isDashboardVisible) return;
    this._pollTimer = setInterval(() => {
      if (!this._client.isConnected()) return;
      this._client.refreshAllState().catch(() => {});
    }, 3000);
  }

  stopDashboardPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async listAudioInputs() {
    if (!this._client.isConnected()) {
      const c = await this.connect();
      if (!c.success) throw new Error(c.error || 'OBS に接続できません');
    }
    return this._client.listAudioInputs();
  }

  async listScenes() {
    if (!this._client.isConnected()) {
      const c = await this.connect();
      if (!c.success) throw new Error(c.error || 'OBS に接続できません');
    }
    return this._client.listScenes();
  }

  async setCurrentScene(sceneName) {
    await this._client.setCurrentScene(sceneName);
  }

  /** 統合 OBS URL（/suite）のブラウザソースが OBS 上にあるか */
  async detectSuiteBrowserSource() {
    if (!this._client.isConnected()) {
      const conn = await this.connect();
      if (!conn.success) {
        return { found: false, connected: false, error: conn.error || null };
      }
    }
    const hit = await this._client.detectBrowserSourceUrl('/suite');
    return { ...hit, connected: true };
  }

  _sourceForSlot(slot) {
    return slot === 'p2'
      ? this._store.get(K.micSourceP2, '')
      : this._store.get(K.micSourceP1, '');
  }

  _slotForSource(inputName) {
    const p1 = this._store.get(K.micSourceP1, '');
    const p2 = this._store.get(K.micSourceP2, '');
    const slots = [];
    if (p1 && p1 === inputName) slots.push('p1');
    if (p2 && p2 === inputName) slots.push('p2');
    return slots;
  }

  _applyAvatarMute(slot, muted) {
    const am = this._getAvatarManager();
    if (am && typeof am.setSlotMicMuted === 'function') {
      am.setSlotMicMuted(slot, muted);
    }
  }

  _emitMuteState() {
    this.emit('mute-state-changed', { ...this._muteState });
  }

  _onObsInputMuteChanged(inputName, inputMuted) {
    for (const slot of this._slotForSource(inputName)) {
      this._muteState[slot === 'p1' ? 'p1Muted' : 'p2Muted'] = !!inputMuted;
      this._applyAvatarMute(slot, !!inputMuted);
    }
    this._emitMuteState();
  }

  async _syncMuteStateFromObs() {
    const p1Name = this._store.get(K.micSourceP1, '');
    const p2Name = this._store.get(K.micSourceP2, '');
    const [p1Muted, p2Muted] = await Promise.all([
      p1Name ? this._client.getInputMute(p1Name) : false,
      p2Name ? this._client.getInputMute(p2Name) : false,
    ]);
    this._muteState = { p1Muted: !!p1Muted, p2Muted: !!p2Muted };
    this._applyAvatarMute('p1', this._muteState.p1Muted);
    this._applyAvatarMute('p2', this._muteState.p2Muted);
    this._emitMuteState();
  }

  _clearEventActionTimer(key) {
    const t = this._eventActionTimers.get(key);
    if (t) {
      clearTimeout(t);
      this._eventActionTimers.delete(key);
    }
  }

  /**
   * OBS イベント連動ルールを実行
   * @param {{ event: string, sourceName: string, action?: string, durationMs?: number }} rule
   */
  async runEventAction(rule) {
    const sourceName = String(rule?.sourceName || '').trim();
    if (!sourceName) return { success: false, error: 'ソース名が空です' };

    if (!this._client.isConnected()) {
      console.log('[OBS] イベント連動スキップ（未接続）:', rule.event, sourceName);
      return { success: false, error: 'OBS 未接続', skipped: true };
    }

    let item;
    try {
      item = await this._client.findSceneItemBySourceName(sourceName);
    } catch (e) {
      console.warn('[OBS] イベント連動:', e.message);
      return { success: false, error: e.message };
    }

    const action = rule.action === 'toggle' ? 'toggle' : 'show';
    const durationMs = Math.max(0, Math.min(120000, Number(rule.durationMs) || 3000));
    const timerKey = `${item.sceneName}:${item.sceneItemId}`;
    this._clearEventActionTimer(timerKey);

    const wasEnabled = item.sceneItemEnabled;
    const targetEnabled = action === 'toggle' ? !wasEnabled : true;

    try {
      await this._client.setSceneItemEnabled(item.sceneName, item.sceneItemId, targetEnabled);
    } catch (e) {
      return { success: false, error: e.message };
    }

    if (durationMs > 0) {
      const revertTo = action === 'toggle' ? wasEnabled : false;
      const timer = setTimeout(() => {
        this._eventActionTimers.delete(timerKey);
        if (!this._client.isConnected()) return;
        this._client.setSceneItemEnabled(item.sceneName, item.sceneItemId, revertTo).catch((err) => {
          console.warn('[OBS] イベント連動の復帰失敗:', err.message);
        });
      }, durationMs);
      this._eventActionTimers.set(timerKey, timer);
    }

    return { success: true };
  }

  async setMute(slot, muted) {
    const source = this._sourceForSlot(slot);
    if (!source) throw new Error('マイクソースが未選択です');
    if (!this._client.isConnected()) {
      const c = await this.connect();
      if (!c.success) throw new Error(c.error || 'OBS に接続できません');
    }
    await this._client.setInputMute(source, muted);
    const key = slot === 'p2' ? 'p2Muted' : 'p1Muted';
    this._muteState[key] = !!muted;
    this._applyAvatarMute(slot, !!muted);
    this._emitMuteState();
  }
}

module.exports = { ObsService, OBS_STORE_KEYS: K };
