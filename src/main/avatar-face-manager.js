'use strict';

/**
 * avatar-face-manager.js - MediaPipe 顔向き（非表示 BrowserWindow）
 *
 * MediaPipe WASM は file:// では取得に失敗するため、
 * avatar HTTP（127.0.0.1:port）経由の URL で読み込む。
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const CAPTURE_PRELOAD = path.join(__dirname, 'avatar-face-preload.js');

class AvatarFaceManager {
  /**
   * @param {(pose: { yaw: number, pitch: number, tracking: boolean }) => void} onPose
   * @param {(message: string) => void} [onError]
   * @param {(preview: object) => void} [onPreview]
   */
  constructor(onPose, onError, onPreview) {
    this._onPose = onPose;
    this._onError = onError || (() => {});
    this._onPreview = onPreview || (() => {});
    this._window = null;
    this._config = null;
    this._ipcBound = false;
    /** 設定プレビュー表示中のみ true */
    this._previewEnabled = false;
  }

  _ensureIpc() {
    if (this._ipcBound) return;
    this._ipcBound = true;
    ipcMain.on('avatar-face-pose', (event, data) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      this._onPose(data || {});
    });
    ipcMain.on('avatar-face-preview', (event, data) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      this._onPreview(data || {});
    });
    ipcMain.on('avatar-face-error', (event, message) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      console.warn('[AvatarFace]', message);
      this._onError(String(message || 'face capture error'));
    });
  }

  /**
   * @param {string} assetBaseUrl e.g. http://127.0.0.1:3003
   */
  _assetUrls(assetBaseUrl) {
    const base = String(assetBaseUrl || '').replace(/\/$/, '');
    return {
      visionModuleUrl: `${base}/vendor/mediapipe/vision_bundle.mjs`,
      wasmRoot: `${base}/vendor/mediapipe/wasm/`,
      modelAssetPath: `${base}/vendor/mediapipe/face_landmarker.task`,
      capturePageUrl: `${base}/face-capture`,
    };
  }

  /**
   * @param {{ cameraDeviceId?: string, enabled?: boolean, assetBaseUrl: string }} config
   */
  async start(config) {
    this._ensureIpc();
    const assetBaseUrl = config?.assetBaseUrl;
    if (!assetBaseUrl) {
      throw new Error('assetBaseUrl is required for face tracking (HTTP-served MediaPipe)');
    }

    this._config = {
      ...(config || {}),
      ...this._assetUrls(assetBaseUrl),
      previewEnabled: this._previewEnabled,
    };

    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send('avatar-face-config', this._config);
      return;
    }

    this._window = new BrowserWindow({
      width: 320,
      height: 240,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        preload: CAPTURE_PRELOAD,
      },
    });

    this._window.on('closed', () => { this._window = null; });
    await this._window.loadURL(this._config.capturePageUrl);
    this._window.webContents.send('avatar-face-config', this._config);
  }

  /** 現在の向きを正面として再サンプリングするよう capture に指示 */
  recalibrate() {
    if (!this._window || this._window.isDestroyed()) return false;
    this._window.webContents.send('avatar-face-recalibrate');
    return true;
  }

  /**
   * 設定プレビュー ON/OFF。OFF 時は capture 側で重い出力を止め、IPC も送らない。
   * @param {boolean} enabled
   */
  setPreviewEnabled(enabled) {
    const next = !!enabled;
    if (this._previewEnabled === next) return this._previewEnabled;
    this._previewEnabled = next;
    if (this._config) this._config.previewEnabled = next;
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send('avatar-face-preview-mode', next);
    }
    return this._previewEnabled;
  }

  isPreviewEnabled() {
    return !!this._previewEnabled;
  }

  stop() {
    if (this._window && !this._window.isDestroyed()) {
      this._window.close();
    }
    this._window = null;
    this._config = null;
    this._previewEnabled = false;
  }

  isRunning() {
    return !!(this._window && !this._window.isDestroyed());
  }
}

module.exports = AvatarFaceManager;
