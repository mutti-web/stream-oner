'use strict';

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

/** productName 変更後も旧フォルダの settings.json を引き継ぐ */
function adoptLegacyUserDataIfNeeded() {
  const currentPath = app.getPath('userData');
  if (fs.existsSync(path.join(currentPath, 'settings.json'))) return;

  const parent = path.dirname(currentPath);
  const legacyDirNames = [
    'stream-overlay-suite',
    'Stream Overlay Suite',
    'stream_overlay_suite',
    'StreamONER',
  ];
  for (const name of legacyDirNames) {
    const legacyPath = path.join(parent, name);
    if (legacyPath === currentPath) continue;
    if (fs.existsSync(path.join(legacyPath, 'settings.json'))) {
      console.log(`[Store] 旧ユーザーデータを引き継ぎ: ${legacyPath}`);
      app.setPath('userData', legacyPath);
      return;
    }
  }
}

class SimpleStore {
  constructor() {
    this.dataPath = path.join(app.getPath('userData'), 'settings.json');
    this.backupPath = `${this.dataPath}.bak`;
    this.loadRecoveredFromBackup = false;
    this.data = this._load();
    /** 連続 set() 時の保存を直列化（Windows で tmp/rename が競合しやすい） */
    this._saveChain = Promise.resolve();
  }

  _load() {
    const tryParse = (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    };
    try {
      const primary = tryParse(this.dataPath);
      if (primary) return primary;
    } catch (e) {
      console.error('[Store] 読み込みエラー:', e.message);
    }
    try {
      const backup = tryParse(this.backupPath);
      if (backup) {
        console.warn('[Store] settings.json の読み込みに失敗したため .bak から復元しました');
        this.loadRecoveredFromBackup = true;
        return backup;
      }
    } catch (e) {
      console.error('[Store] バックアップ読み込みエラー:', e.message);
    }
    return {};
  }

  get(key, def) { return this.data[key] !== undefined ? this.data[key] : def; }

  set(key, val) {
    this.data[key] = val;
    this._save();
  }

  getSecret(key, def = '') {
    const val = this.data[key];
    if (!val) return def;
    try {
      if (app.isReady() && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(val, 'base64'));
      }
    } catch (e) {
      return val;
    }
    return val;
  }

  setSecret(key, val) {
    if (!val) {
      delete this.data[key];
    } else {
      try {
        if (app.isReady() && safeStorage.isEncryptionAvailable()) {
          this.data[key] = safeStorage.encryptString(val).toString('base64');
        } else {
          this.data[key] = val;
        }
      } catch (e) {
        console.error('[Store] 暗号化エラー:', e.message);
        this.data[key] = val;
      }
    }
    this._save();
  }

  _save() {
    this._saveChain = this._saveChain
      .then(() => this._saveOnce())
      .catch((e) => console.error('[Store] 保存エラー:', e.message));
  }

  _cleanupStaleTmpFiles(dir) {
    const base = path.basename(this.dataPath);
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(`${base}.`) && name.endsWith('.tmp')) {
        fs.unlink(path.join(dir, name), () => {});
      }
    }
  }

  async _saveOnce() {
    const json = JSON.stringify(this.data, null, 2);
    const dir = path.dirname(this.dataPath);
    await fs.promises.mkdir(dir, { recursive: true });
    this._cleanupStaleTmpFiles(dir);

    const tmpPath = path.join(
      dir,
      `${path.basename(this.dataPath)}.${process.pid}.${Date.now()}.tmp`,
    );
    await fs.promises.writeFile(tmpPath, json, 'utf-8');

    if (fs.existsSync(this.dataPath)) {
      try {
        await fs.promises.copyFile(this.dataPath, this.backupPath);
      } catch (e) {
        console.warn('[Store] バックアップ作成をスキップ:', e.message);
      }
    }

    try {
      if (process.platform === 'win32') {
        await fs.promises.copyFile(tmpPath, this.dataPath);
      } else {
        try {
          await fs.promises.rename(tmpPath, this.dataPath);
        } catch (_) {
          await fs.promises.copyFile(tmpPath, this.dataPath);
        }
      }
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }
}

module.exports = { SimpleStore, adoptLegacyUserDataIfNeeded };
