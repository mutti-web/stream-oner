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
   */
  constructor(onPose, onError) {
    this._onPose = onPose;
    this._onError = onError || (() => {});
    this._window = null;
    this._config = null;
    this._ipcBound = false;
  }

  _ensureIpc() {
    if (this._ipcBound) return;
    this._ipcBound = true;
    ipcMain.on('avatar-face-pose', (event, data) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      this._onPose(data || {});
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

  stop() {
    if (this._window && !this._window.isDestroyed()) {
      this._window.close();
    }
    this._window = null;
    this._config = null;
  }

  isRunning() {
    return !!(this._window && !this._window.isDestroyed());
  }
}

module.exports = AvatarFaceManager;
