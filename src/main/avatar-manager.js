'use strict';

/**
 * avatar-manager.js - アバターオーバーレイ（:3003 HTTP/WS）と音声連携
 */

const { EventEmitter } = require('events');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { isPortAvailable } = require('./port-utils');
const staticFileCache = require('./static-file-cache');
const { createRendererStaticHandler } = require('./serve-renderer-static');
const AvatarAudioManager = require('./avatar-audio-manager');
const slotCfg = require('./avatar-slot-config');

require('../renderer/shared/avatar-constants.js');
const AC = global.AvatarConstants || {};
const AUDIO_SEND_MIN_INTERVAL_MS = AC.AUDIO_SEND_MIN_INTERVAL_MS ?? 50;
const AUDIO_LEVEL_DELTA = AC.AUDIO_LEVEL_DELTA ?? 2;

const RENDERER_DIR = path.join(__dirname, '../renderer');
const customCss = require('./custom-css');

const PIXI_OVERLAY_HTML = path.join(RENDERER_DIR, 'avatar-pixi-overlay.html');

const serveAvatarOverlayStatic = createRendererStaticHandler(RENDERER_DIR, {
  '/avatar-overlay.css': 'avatar-overlay.css',
  '/avatar-overlay-runtime.js': 'avatar-overlay-runtime.js',
  '/avatar-pixi-spike.js': 'avatar-pixi-spike.js',
  '/vendor/pixi.min.js': 'vendor/pixi.min.js',
  '/shared/avatar-constants.js': 'shared/avatar-constants.js',
});

const K = {
  enabled:          'avatar.enabled',
  displayMode:      'avatar.displayMode',
  micADeviceId:     'avatar.micADeviceId',
  micBDeviceId:     'avatar.micBDeviceId',
  speakThreshold:   'avatar.speakThreshold',
  sensitivity:      'avatar.sensitivity',
  p1Label:          'avatar.p1Label',
  p2Label:          'avatar.p2Label',
  p1Slot:           'avatar.p1Slot',
  p2Slot:           'avatar.p2Slot',
  smileDetect:      'avatar.smileDetectEnabled',
  smileSensitivity: 'avatar.smileSensitivity',
};

const SLOT_KEYS = [
  { slotId: 'p1', storeKey: K.p1Slot, prefix: 'p1' },
  { slotId: 'p2', storeKey: K.p2Slot, prefix: 'p2' },
];

const DISPLAY_MODES = new Set(['both', 'p1', 'p2']);

class AvatarManager extends EventEmitter {
  constructor(port, htmlPath, store, previewHtmlPath) {
    super();
    this._port = port;
    this._htmlPath = htmlPath;
    this._previewHtmlPath = previewHtmlPath;
    this._store = store;
    this._migrated = false;

    this._server = null;
    this._wss = null;
    this._clients = new Set();
    this._audio = new AvatarAudioManager(
      (levels) => this._onAudioLevels(levels),
      (msg) => this._updateStatus({ error: msg }),
    );

    this._status = { serverRunning: false, audioRunning: false, error: null };
    this._lastLevels = {
      p1: 0, p2: 0,
      p1Speaking: false, p2Speaking: false,
      p1Laughing: false, p2Laughing: false,
      p1Vowel: null, p2Vowel: null,
    };
    /** プレビュー窓から preview-audio を送っている WS（テスト中は実マイクをオーバーレイに流さない） */
    this._previewControlClients = new Set();
    this._pendingAudioLevels = null;
    this._audioFlushTimer = null;
    this._lastAudioSentAt = 0;
    this._lastAudioSentSnapshot = null;
    this._slotMicMuted = { p1: false, p2: false };
  }

  setSlotMicMuted(slotId, muted) {
    if (slotId !== 'p1' && slotId !== 'p2') return;
    this._slotMicMuted[slotId] = !!muted;
    if (this._pendingAudioLevels || this._lastAudioSentSnapshot) {
      this._flushAudioNow();
    }
  }

  _applyMicMuteOverlay(levels) {
    const out = { ...levels };
    if (this._slotMicMuted.p1) {
      out.p1 = 0;
      out.p1Speaking = false;
      out.p1Laughing = false;
      out.p1Vowel = null;
    }
    if (this._slotMicMuted.p2) {
      out.p2 = 0;
      out.p2Speaking = false;
      out.p2Laughing = false;
      out.p2Vowel = null;
    }
    return out;
  }

  /** legacy → p1Slot/p2Slot へ一度だけ移行 */
  migrateLegacy() {
    if (this._migrated) return;
    slotCfg.migrateStoreToSlots(this._store, SLOT_KEYS);
    slotCfg.migrateSlotAudioFromGlobal(
      this._store, K.p1Slot, K.p2Slot, K.speakThreshold, K.sensitivity,
    );
    this._migrated = true;
  }

  getStatus() {
    return { ...this._status, audioRunning: this._audio.isRunning() };
  }

  getSlot(slotId) {
    this.migrateLegacy();
    const key = slotId === 'p1' ? K.p1Slot : K.p2Slot;
    const raw = this._store.get(key, null);
    if (raw && typeof raw === 'object') {
      return slotCfg.normalizeSlotOffsets(slotCfg.deepMerge(slotCfg.defaultSlot(), raw));
    }
    return slotCfg.defaultSlot();
  }

  getDisplayMode() {
    const m = this._store.get(K.displayMode, 'both');
    return DISPLAY_MODES.has(m) ? m : 'both';
  }

  getConfig() {
    this.migrateLegacy();
    const s = this._store;
    const base = `http://127.0.0.1:${this._port}`;
    return {
      enabled: s.get(K.enabled, false),
      displayMode: this.getDisplayMode(),
      micADeviceId: s.get(K.micADeviceId, ''),
      micBDeviceId: s.get(K.micBDeviceId, ''),
      speakThreshold: s.get(K.speakThreshold, 12),
      sensitivity: s.get(K.sensitivity, 1.5),
      p1Label: s.get(K.p1Label, '配信者A'),
      p2Label: s.get(K.p2Label, '配信者B'),
      smileDetectEnabled: s.get(K.smileDetect, false),
      smileSensitivity: s.get(K.smileSensitivity, 50),
      obsUrl: `${base}/overlay`,
      /** Pixi スパイク用（現行 DOM とは別 URL。OBS では ?hud=0） */
      obsUrlPixi: `${base}/overlay-pixi`,
      previewUrl: `${base}/preview`,
      wsUrl: `ws://127.0.0.1:${this._port}`,
      ...slotCfg.slotToFormFlat('p1', this.getSlot('p1')),
      ...slotCfg.slotToFormFlat('p2', this.getSlot('p2')),
    };
  }

  async saveConfig(settings) {
    this.migrateLegacy();
    const s = this._store;
    const audioDirty = [
      'enabled', 'micADeviceId', 'micBDeviceId',
      'smileDetectEnabled', 'smileSensitivity',
    ].some((k) => settings[k] !== undefined);
    const slotAudioDirty = ['p1', 'p2'].some((p) =>
      settings[`${p}_speakThreshold`] !== undefined ||
      settings[`${p}_sensitivity`] !== undefined,
    );

    if (settings.enabled !== undefined) s.set(K.enabled, !!settings.enabled);
    if (settings.displayMode !== undefined) {
      const dm = String(settings.displayMode);
      s.set(K.displayMode, DISPLAY_MODES.has(dm) ? dm : 'both');
    }
    if (settings.micADeviceId !== undefined) s.set(K.micADeviceId, settings.micADeviceId);
    if (settings.micBDeviceId !== undefined) s.set(K.micBDeviceId, settings.micBDeviceId);
    if (settings.p1Label !== undefined) s.set(K.p1Label, settings.p1Label);
    if (settings.p2Label !== undefined) s.set(K.p2Label, settings.p2Label);
    if (settings.smileDetectEnabled !== undefined) s.set(K.smileDetect, !!settings.smileDetectEnabled);
    if (settings.smileSensitivity !== undefined) s.set(K.smileSensitivity, Number(settings.smileSensitivity));

    const saveSlotFromSettings = (slotId, storeKey, prefix) => {
      if (settings[`${prefix}Slot`]) {
        slotCfg.saveSlot(s, storeKey, settings[`${prefix}Slot`]);
        return;
      }
      const hasForm = Object.keys(settings).some((k) => k.startsWith(`${prefix}_`));
      if (hasForm) {
        const existing = this.getSlot(slotId);
        slotCfg.saveSlot(s, storeKey, slotCfg.buildSlotFromForm(existing, prefix, settings));
      }
    };
    saveSlotFromSettings('p1', K.p1Slot, 'p1');
    saveSlotFromSettings('p2', K.p2Slot, 'p2');

    if (audioDirty || slotAudioDirty) await this._syncAudioFromStore();
    if (this._server) this._broadcast(this._buildOverlayInit());
    this.emit('config-changed', this.getConfig());
    return { success: true };
  }

  async applyEnabledState() {
    await this._syncAudioFromStore();
  }

  _captureConfig() {
    const c = this.getConfig();
    const p1 = this.getSlot('p1');
    const p2 = this.getSlot('p2');
    return {
      micADeviceId: c.micADeviceId,
      micBDeviceId: c.micBDeviceId,
      p1SpeakThreshold: Number(p1.speakThreshold) || 12,
      p2SpeakThreshold: Number(p2.speakThreshold) || 12,
      p1Sensitivity: Number(p1.sensitivity) || 1.5,
      p2Sensitivity: Number(p2.sensitivity) || 1.5,
      smileDetectEnabled: c.smileDetectEnabled,
      smileSensitivity: c.smileSensitivity,
    };
  }

  _exists(filePath) {
    return !!(filePath && fs.existsSync(filePath));
  }

  _buildOverlayInit() {
    const s = this._store;
    const base = `http://127.0.0.1:${this._port}`;
    const p1 = this.getSlot('p1');
    const p2 = this.getSlot('p2');

    return {
      type: 'init',
      config: {
        displayMode: this.getDisplayMode(),
        p1Label: s.get(K.p1Label, '配信者A'),
        p2Label: s.get(K.p2Label, '配信者B'),
        smileDetectEnabled: s.get(K.smileDetect, false),
        p1: slotCfg.slotToOverlay('p1', p1, base, (fp) => this._exists(fp)),
        p2: slotCfg.slotToOverlay('p2', p2, base, (fp) => this._exists(fp)),
      },
    };
  }

  _imagePathForAsset(slotId, asset) {
    return slotCfg.pathForAsset(this.getSlot(slotId), asset);
  }

  async _syncAudioFromStore() {
    const enabled = this._store.get(K.enabled, false);
    const { micADeviceId, micBDeviceId } = this.getConfig();
    if (!enabled || (!micADeviceId && !micBDeviceId)) {
      this._clearAudioFlushTimer();
      this._pendingAudioLevels = null;
      this._audio.stop();
      this._updateStatus({ audioRunning: false });
      return;
    }
    try {
      await this._audio.start(this._captureConfig());
      this._updateStatus({ audioRunning: true, error: null });
    } catch (e) {
      this._updateStatus({ audioRunning: false, error: e.message });
    }
  }

  _clearAudioFlushTimer() {
    if (this._audioFlushTimer) {
      clearTimeout(this._audioFlushTimer);
      this._audioFlushTimer = null;
    }
  }

  _isSignificantAudioChange(next, prev) {
    if (!prev) return true;
    if (next.p1Speaking !== prev.p1Speaking || next.p2Speaking !== prev.p2Speaking) return true;
    if (next.p1Laughing !== prev.p1Laughing || next.p2Laughing !== prev.p2Laughing) return true;
    if (next.p1Vowel !== prev.p1Vowel || next.p2Vowel !== prev.p2Vowel) return true;
    if (Math.abs((next.p1 || 0) - (prev.p1 || 0)) >= AUDIO_LEVEL_DELTA) return true;
    if (Math.abs((next.p2 || 0) - (prev.p2 || 0)) >= AUDIO_LEVEL_DELTA) return true;
    return false;
  }

  _flushAudioNow() {
    this._clearAudioFlushTimer();
    const p = this._pendingAudioLevels;
    if (!p) return;
    const applied = this._applyMicMuteOverlay(p);
    this._lastAudioSentAt = Date.now();
    this._lastAudioSentSnapshot = { ...applied };
    this._lastLevels = { ...applied };
    this._broadcast({ type: 'audio', ...applied });
    this.emit('audio-levels', applied);
  }

  _scheduleAudioFlush() {
    const pending = this._pendingAudioLevels;
    if (!pending) return;

    const prev = this._lastAudioSentSnapshot;
    const significant = this._isSignificantAudioChange(pending, prev);
    const elapsed = Date.now() - this._lastAudioSentAt;

    if (significant && elapsed >= AUDIO_SEND_MIN_INTERVAL_MS) {
      this._flushAudioNow();
      return;
    }

    if (!significant && prev) return;

    if (this._audioFlushTimer) return;

    const delay = Math.max(0, AUDIO_SEND_MIN_INTERVAL_MS - elapsed);
    this._audioFlushTimer = setTimeout(() => {
      this._audioFlushTimer = null;
      this._flushAudioNow();
    }, delay);
  }

  _onAudioLevels(levels) {
    if (!this._store.get(K.enabled, false)) return;
    if (this._previewControlClients.size > 0) return;
    this._pendingAudioLevels = {
      p1: levels.p1,
      p2: levels.p2,
      p1Speaking: !!levels.p1Speaking,
      p2Speaking: !!levels.p2Speaking,
      p1Laughing: !!levels.p1Laughing,
      p2Laughing: !!levels.p2Laughing,
      p1Vowel: levels.p1Vowel || null,
      p2Vowel: levels.p2Vowel || null,
    };
    this._scheduleAudioFlush();
  }

  _applyPreviewAudio(levels) {
    this._lastLevels = levels;
    this._broadcast({ type: 'audio', ...levels });
  }

  _broadcast(data) {
    const json = JSON.stringify(data);
    for (const ws of this._clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  _updateStatus(partial) {
    this._status = { ...this._status, ...partial };
    this.emit('status-changed', this.getStatus());
  }

  async startServer() {
    if (this._server) return { success: true };

    this.migrateLegacy();

    if (!(await isPortAvailable(this._port))) {
      const err = `ポート ${this._port} は既に使用されています`;
      this._updateStatus({ serverRunning: false, error: err });
      return { success: false, error: err };
    }

    const previewPath = this._previewHtmlPath;

    this._server = http.createServer((req, res) => {
      const url = (req.url || '').split('?')[0];

      if (url === '/' || url === '/overlay') {
        staticFileCache.readUtf8(this._htmlPath, (err, data) => {
          if (err) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
        return;
      }

      if (url === '/preview' && previewPath) {
        staticFileCache.readUtf8(previewPath, (err, data) => {
          if (err) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
        return;
      }

      if (customCss.tryHandleCustomCssRoutes(url, res, this._store, staticFileCache)) return;

      if (serveAvatarOverlayStatic(url, res)) return;

      const assetMatch = url.match(/^\/avatar\/(p1|p2)\/([a-z0-9-]+)$/);
      if (assetMatch) {
        const filePath = this._imagePathForAsset(assetMatch[1], assetMatch[2]);
        if (!this._exists(filePath)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const types = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp',
        };
        staticFileCache.readBuffer(filePath, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
          res.end(data);
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this._wss = new WebSocketServer({ server: this._server });
    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      ws.send(JSON.stringify(this._buildOverlayInit()));
      ws.send(JSON.stringify({ type: 'audio', ...this._lastLevels }));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg.type === 'preview-audio') {
            this._previewControlClients.add(ws);
            this._applyPreviewAudio({
              p1: Number(msg.p1) || 0,
              p2: Number(msg.p2) || 0,
              p1Speaking: !!msg.p1Speaking,
              p2Speaking: !!msg.p2Speaking,
              p1Laughing: !!msg.p1Laughing,
              p2Laughing: !!msg.p2Laughing,
            });
          }
        } catch (_) { /* ignore */ }
      });
      const dropWs = () => {
        this._clients.delete(ws);
        this._previewControlClients.delete(ws);
      };
      ws.on('close', dropWs);
      ws.on('error', dropWs);
    });

    this._server.on('error', (e) => {
      console.error('[Avatar-HTTP]', e.message);
      this.stopServer();
      this._updateStatus({ serverRunning: false, error: e.message });
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (e) => { this._server.removeListener('listening', onListening); reject(e); };
        const onListening = () => { this._server.removeListener('error', onError); resolve(); };
        this._server.once('error', onError);
        this._server.once('listening', onListening);
        this._server.listen(this._port, '127.0.0.1');
      });
    } catch (e) {
      this.stopServer();
      return { success: false, error: e.message || String(e) };
    }

    console.log(`[Avatar-HTTP] http://127.0.0.1:${this._port}/overlay`);
    this._updateStatus({ serverRunning: true, error: null });
    await this._syncAudioFromStore();
    return { success: true };
  }

  stopServer() {
    this._audio.stop();
    if (this._wss) { try { this._wss.close(); } catch (_) { /* */ } this._wss = null; }
    if (this._server) { try { this._server.close(); } catch (_) { /* */ } this._server = null; }
    this._clients.clear();
    this._updateStatus({ serverRunning: false, audioRunning: false });
  }

  async restartAudio() {
    await this._syncAudioFromStore();
  }
}

module.exports = AvatarManager;
