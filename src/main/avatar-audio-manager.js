'use strict';

/**
 * avatar-audio-manager.js - マイクA/B の音量解析（非表示 BrowserWindow）
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const CAPTURE_HTML   = path.join(__dirname, '../renderer/avatar-audio-capture.html');
const CAPTURE_PRELOAD = path.join(__dirname, 'avatar-audio-preload.js');

class AvatarAudioManager {
  /**
   * @param {(levels: object) => void} onLevels
   * @param {(message: string) => void} [onError]
   */
  constructor(onLevels, onError) {
    this._onLevels = onLevels;
    this._onError = onError || (() => {});
    this._window = null;
    this._config = null;
    this._ipcBound = false;
  }

  _ensureIpc() {
    if (this._ipcBound) return;
    this._ipcBound = true;
    ipcMain.on('avatar-audio-levels', (event, data) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      this._onLevels(data);
    });
    ipcMain.on('avatar-audio-error', (event, message) => {
      if (!this._window || event.sender !== this._window.webContents) return;
      console.warn('[AvatarAudio]', message);
      this._onError(message);
    });
  }

  /**
   * @param {{ micADeviceId?: string, micBDeviceId?: string, speakThreshold?: number, sensitivity?: number }} config
   */
  async start(config) {
    this._ensureIpc();
    this._config = config;

    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send('avatar-capture-config', config);
      return;
    }

    this._window = new BrowserWindow({
      width: 320,
      height: 120,
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

    await this._window.loadFile(CAPTURE_HTML);
    this._window.webContents.send('avatar-capture-config', config);
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

module.exports = AvatarAudioManager;
