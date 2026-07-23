'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const OP = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Event: 5,
  Request: 6,
  RequestResponse: 7,
};

/** OBS WebSocketCloseCode */
const CLOSE = {
  AuthenticationFailed: 4009,
  UnsupportedRpcVersion: 4010,
};

/** Scenes + Inputs + Outputs */
const EVENT_SUBSCRIPTIONS = 4 | 8 | 64;

const SUPPORTED_RPC_VERSION = 1;

const AUDIO_INPUT_KINDS = new Set([
  'wasapi_input_capture',
  'coreaudio_input_capture',
  'pulse_input_capture',
  'alsa_input_capture',
  'jack_input_capture',
]);

const REQUEST_TIMEOUT_MS = 8000;
const CONNECT_TIMEOUT_MS = 12000;

function buildAuth(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

function formatConnectError(message, closeCode) {
  if (closeCode === CLOSE.AuthenticationFailed) {
    return '認証に失敗しました。OBS の WebSocket パスワードと、設定「全般→詳細」のパスワードが一致するか確認してください（OBS の「接続情報を表示」からコピー）';
  }
  if (closeCode === CLOSE.UnsupportedRpcVersion) {
    return 'OBS WebSocket のバージョンが非対応です。OBS Studio 28 以降をご利用ください';
  }
  const msg = String(message || '');
  if (msg.includes('ECONNREFUSED')) {
    return 'OBS に接続できません。OBS の「ツール → WebSocket サーバー設定」で「WebSocket サーバーを有効にする」にチェックを入れ、ポート（既定 4455）を確認してください';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('タイムアウト')) {
    return 'OBS への接続がタイムアウトしました。OBS が起動しているか、ホスト・ポート設定を確認してください';
  }
  return msg || 'OBS 接続エラー';
}

/**
 * OBS WebSocket v5 クライアント（obs-websocket プラグイン / OBS 28+）
 */
class ObsWebSocketClient extends EventEmitter {
  /**
   * @param {() => { host: string, port: number, password: string }} getConfig
   */
  constructor(getConfig) {
    super();
    this._getConfig = getConfig;
    this._ws = null;
    this._identified = false;
    this._pending = new Map();
    this._connectPromise = null;
    this._connectFinish = null;
    this._serverRpcVersion = SUPPORTED_RPC_VERSION;
    this._state = {
      connected: false,
      error: null,
      streaming: false,
      recording: false,
      currentSceneName: '',
      streamDurationMs: 0,
      streamDurationAt: 0,
    };
    this._inputMuteCache = new Map();
    /** @type {{ streaming: boolean, recording: boolean } | null} */
    this._lastEmittedOutput = null;
    /** @type {string | null} */
    this._lastEmittedScene = null;
  }

  getSnapshot() {
    return { ...this._state };
  }

  isConnected() {
    return this._identified && this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  /**
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async connect() {
    if (this.isConnected()) return { success: true };
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve) => {
      const { host, port } = this._getConfig();
      const url = `ws://${host || '127.0.0.1'}:${port || 4455}`;
      console.log(`[OBS-WS] 接続試行: ${url}`);
      this._cleanupSocket();

      let settled = false;
      this._connectFinish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._connectFinish = null;
        this._connectPromise = null;
        if (!result.success) {
          console.warn('[OBS-WS] 接続失敗:', result.error);
        } else {
          console.log('[OBS-WS] 接続成功');
        }
        resolve(result);
      };

      const timer = setTimeout(() => {
        this._cleanupSocket();
        const err = formatConnectError('OBS 接続タイムアウト');
        this._setDisconnected(err);
        this._connectFinish?.({ success: false, error: err });
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(url);
      this._ws = ws;

      ws.on('error', (err) => {
        if (!this._identified && !settled) {
          const msg = formatConnectError(err.message);
          this._setDisconnected(msg);
          this._connectFinish?.({ success: false, error: msg });
        }
      });

      ws.on('close', (code, reason) => {
        const reasonStr = reason ? String(reason) : '';
        if (this._identified) {
          this._setDisconnected('OBS 接続が切断されました');
        } else if (!settled) {
          const msg = formatConnectError(reasonStr || 'OBS 接続が切断されました', code);
          this._setDisconnected(msg);
          this._connectFinish?.({ success: false, error: msg });
        }
        this._identified = false;
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          this._onMessage(msg);
        } catch (e) {
          if (!settled) {
            const err = formatConnectError(e.message);
            this._setDisconnected(err);
            this._connectFinish?.({ success: false, error: err });
          }
        }
      });
    });

    return this._connectPromise;
  }

  disconnect() {
    this._cleanupSocket();
    this._setDisconnected(null);
  }

  _cleanupSocket() {
    if (!this._ws) return;
    try {
      this._ws.removeAllListeners();
      if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
        this._ws.close();
      }
    } catch (_) { /* ignore */ }
    this._ws = null;
    this._identified = false;
    for (const [, p] of this._pending) {
      p.reject(new Error('OBS 接続が切断されました'));
    }
    this._pending.clear();
  }

  _setDisconnected(error) {
    const wasConnected = this._state.connected;
    this._identified = false;
    this._state.connected = false;
    this._state.error = error || null;
    this._lastEmittedOutput = null;
    this._lastEmittedScene = null;
    if (wasConnected || error) {
      this.emit('connection-changed', { connected: false, error: error || null });
    }
  }

  _onMessage(msg) {
    switch (msg.op) {
      case OP.Hello:
        this._serverRpcVersion = Number(msg.d?.rpcVersion) || SUPPORTED_RPC_VERSION;
        console.log('[OBS-WS] Hello', {
          obsWebSocketVersion: msg.d?.obsWebSocketVersion,
          rpcVersion: this._serverRpcVersion,
          authRequired: !!(msg.d?.authentication?.challenge),
        });
        this._sendIdentify(msg.d?.authentication);
        break;
      case OP.Identified:
        this._identified = true;
        this._state.connected = true;
        this._state.error = null;
        this.refreshAllState()
          .then(() => {
            this.emit('connection-changed', { connected: true, error: null });
            this._connectFinish?.({ success: true });
          })
          .catch((e) => {
            this._state.error = e.message;
            this.emit('connection-changed', { connected: true, error: e.message });
            this._connectFinish?.({ success: true, error: e.message });
          });
        break;
      case OP.RequestResponse:
        this._onRequestResponse(msg.d);
        break;
      case OP.Event:
        this._onEvent(msg.d);
        break;
      default:
        break;
    }
  }

  _sendIdentify(authentication) {
    const { password } = this._getConfig();
    const authRequired = !!(authentication?.challenge && authentication?.salt);

    if (authRequired && !password) {
      const err = 'OBS で認証が有効です。設定の「OBS連携 → 詳細設定」に WebSocket パスワードを入力してください（OBS の「接続情報を表示」からコピー）';
      this._cleanupSocket();
      this._setDisconnected(err);
      this._connectFinish?.({ success: false, error: err });
      return;
    }

    const rpcVersion = Math.min(SUPPORTED_RPC_VERSION, this._serverRpcVersion);
    const payload = {
      rpcVersion,
      eventSubscriptions: EVENT_SUBSCRIPTIONS,
    };
    if (authRequired && password) {
      payload.authentication = buildAuth(
        password,
        authentication.salt,
        authentication.challenge,
      );
    }

    try {
      this._ws.send(JSON.stringify({ op: OP.Identify, d: payload }));
    } catch (e) {
      const err = formatConnectError(e.message);
      this._cleanupSocket();
      this._setDisconnected(err);
      this._connectFinish?.({ success: false, error: err });
    }
  }

  _onRequestResponse(d) {
    const pending = this._pending.get(d?.requestId);
    if (!pending) return;
    this._pending.delete(d.requestId);
    const ok = d?.requestStatus?.result;
    if (ok) pending.resolve(d.responseData || {});
    else pending.reject(new Error(d?.requestStatus?.comment || 'OBS リクエスト失敗'));
  }

  _applyStreamStatus(stream) {
    const active = !!stream?.outputActive;
    this._state.streaming = active;
    if (active) {
      this._state.streamDurationMs = Math.max(0, Number(stream.outputDuration) || 0);
      this._state.streamDurationAt = Date.now();
    } else {
      this._state.streamDurationMs = 0;
      this._state.streamDurationAt = 0;
    }
  }

  _emitOutputState(force = false) {
    const payload = {
      streaming: this._state.streaming,
      recording: this._state.recording,
      streamDurationMs: this._state.streamDurationMs,
      streamDurationAt: this._state.streamDurationAt,
    };
    if (!force && this._lastEmittedOutput) {
      const prev = this._lastEmittedOutput;
      if (prev.streaming === payload.streaming && prev.recording === payload.recording) {
        return;
      }
    }
    this._lastEmittedOutput = {
      streaming: payload.streaming,
      recording: payload.recording,
    };
    this.emit('output-state-changed', payload);
  }

  _emitSceneChanged(sceneName, force = false) {
    const name = String(sceneName || '');
    if (!force && this._lastEmittedScene === name) return;
    this._lastEmittedScene = name;
    this.emit('scene-changed', { sceneName: name });
  }

  _onEvent(d) {
    const type = d?.eventType;
    const data = d?.eventData || {};
    switch (type) {
      case 'StreamStateChanged':
        this._state.streaming = !!data.outputActive;
        if (data.outputActive) {
          this.request('GetStreamStatus')
            .then((stream) => {
              this._applyStreamStatus(stream);
              this._emitOutputState();
            })
            .catch(() => this._emitOutputState());
        } else {
          this._state.streamDurationMs = 0;
          this._state.streamDurationAt = 0;
          this._emitOutputState();
        }
        break;
      case 'RecordStateChanged':
        this._state.recording = !!data.outputActive;
        this._emitOutputState();
        break;
      case 'CurrentProgramSceneChanged':
        if (data.sceneName) {
          this._state.currentSceneName = data.sceneName;
          this._emitSceneChanged(data.sceneName);
        }
        break;
      case 'InputMuteStateChanged':
        if (data.inputName != null) {
          this._inputMuteCache.set(data.inputName, !!data.inputMuted);
          this.emit('input-mute-changed', {
            inputName: data.inputName,
            inputMuted: !!data.inputMuted,
          });
        }
        break;
      default:
        break;
    }
  }

  /**
   * @param {string} requestType
   * @param {Object} [requestData]
   */
  request(requestType, requestData = {}) {
    if (!this.isConnected()) {
      return Promise.reject(new Error('OBS に未接続です'));
    }
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this._pending.set(requestId, { resolve, reject });
      this._ws.send(JSON.stringify({
        op: OP.Request,
        d: { requestType, requestId, requestData },
      }));
      setTimeout(() => {
        if (!this._pending.has(requestId)) return;
        this._pending.delete(requestId);
        reject(new Error(`OBS リクエストタイムアウト: ${requestType}`));
      }, REQUEST_TIMEOUT_MS);
    });
  }

  async refreshAllState() {
    const [stream, record, scene] = await Promise.all([
      this.request('GetStreamStatus').catch(() => ({})),
      this.request('GetRecordStatus').catch(() => ({})),
      this.request('GetCurrentProgramScene').catch(() => ({})),
    ]);
    this._applyStreamStatus(stream);
    this._state.recording = !!record.outputActive;
    this._state.currentSceneName = scene.currentProgramSceneName || '';
    this._emitOutputState();
    if (this._state.currentSceneName) {
      this._emitSceneChanged(this._state.currentSceneName);
    }
  }

  async listAudioInputs() {
    const res = await this.request('GetInputList');
    const inputs = Array.isArray(res.inputs) ? res.inputs : [];
    const audio = inputs.filter((i) => AUDIO_INPUT_KINDS.has(i.inputKind));
    const list = (audio.length ? audio : inputs).map((i) => ({
      inputName: i.inputName,
      inputUuid: i.inputUuid,
      inputKind: i.inputKind,
    }));
    return { inputs: list, fallbackAll: audio.length === 0 && inputs.length > 0 };
  }

  async listScenes() {
    const res = await this.request('GetSceneList');
    const scenes = Array.isArray(res.scenes) ? res.scenes : [];
    return scenes.map((s) => ({
      sceneName: s.sceneName,
      sceneUuid: s.sceneUuid,
    }));
  }

  async getInputMute(inputName) {
    if (!inputName) return false;
    if (this._inputMuteCache.has(inputName)) {
      return this._inputMuteCache.get(inputName);
    }
    const res = await this.request('GetInputMute', { inputName });
    const muted = !!res.inputMuted;
    this._inputMuteCache.set(inputName, muted);
    return muted;
  }

  async setInputMute(inputName, inputMuted) {
    if (!inputName) throw new Error('入力ソースが未選択です');
    await this.request('SetInputMute', { inputName, inputMuted: !!inputMuted });
    this._inputMuteCache.set(inputName, !!inputMuted);
    this.emit('input-mute-changed', { inputName, inputMuted: !!inputMuted });
  }

  async setCurrentScene(sceneName) {
    if (!sceneName) throw new Error('シーン名が空です');
    await this.request('SetCurrentProgramScene', { sceneName });
    this._state.currentSceneName = sceneName;
    this.emit('scene-changed', { sceneName });
  }

  /**
   * ブラウザソースの URL に指定文字列を含む入力があるか探す
   * @param {string} urlNeedle
   */
  async getCurrentProgramSceneName() {
    const scene = await this.request('GetCurrentProgramScene');
    return scene.currentProgramSceneName || '';
  }

  /**
   * 現在のプログラムシーンで sourceName に一致するシーンアイテムを探す
   * @param {string} sourceName
   */
  async findSceneItemBySourceName(sourceName) {
    const name = String(sourceName || '').trim();
    if (!name) throw new Error('ソース名が空です');
    const sceneName = await this.getCurrentProgramSceneName();
    if (!sceneName) throw new Error('現在のシーンを取得できません');
    const res = await this.request('GetSceneItemList', { sceneName });
    const items = Array.isArray(res.sceneItems) ? res.sceneItems : [];
    const item = items.find((i) => i.sourceName === name);
    if (!item) {
      throw new Error(`ソース「${name}」がシーン「${sceneName}」に見つかりません`);
    }
    return {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: !!item.sceneItemEnabled,
    };
  }

  async setSceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled) {
    await this.request('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled: !!sceneItemEnabled,
    });
  }

  async detectBrowserSourceUrl(urlNeedle) {
    const needle = String(urlNeedle || '').trim();
    if (!needle) return { found: false };
    const res = await this.request('GetInputList');
    const inputs = (Array.isArray(res.inputs) ? res.inputs : []).filter((i) =>
      String(i.inputKind || '').toLowerCase().includes('browser'));
    for (const inp of inputs) {
      try {
        const st = await this.request('GetInputSettings', { inputName: inp.inputName });
        const url = String(st?.inputSettings?.url || st?.inputSettings?.URL || '');
        if (url.includes(needle)) {
          return { found: true, inputName: inp.inputName, url };
        }
      } catch (_) { /* 入力ごとに失敗しても続行 */ }
    }
    return { found: false };
  }
}

module.exports = ObsWebSocketClient;
