'use strict';

const fs = require('fs');

/**
 * OBS 用静的 HTML/CSS のメモリキャッシュ（初回 readFile 後は保持）
 */
class StaticFileCache {
  constructor() {
    /** @type {Map<string, { data: string, mtimeMs: number }>} */
    this._cache = new Map();
    /** @type {Map<string, { data: Buffer, mtimeMs: number }>} */
    this._binaryCache = new Map();
  }

  /**
   * @param {string} filePath
   * @param {(err: Error | null, data?: string) => void} callback
   */
  readUtf8(filePath, callback) {
    fs.stat(filePath, (statErr, stat) => {
      if (statErr) {
        callback(statErr);
        return;
      }
      const cached = this._cache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        callback(null, cached.data);
        return;
      }
      fs.readFile(filePath, 'utf-8', (readErr, data) => {
        if (readErr) {
          callback(readErr);
          return;
        }
        this._cache.set(filePath, { data, mtimeMs: stat.mtimeMs });
        callback(null, data);
      });
    });
  }

  /**
   * @param {string} filePath
   * @param {(err: Error | null, data?: Buffer) => void} callback
   */
  readBuffer(filePath, callback) {
    fs.stat(filePath, (statErr, stat) => {
      if (statErr) {
        callback(statErr);
        return;
      }
      const cached = this._binaryCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        callback(null, cached.data);
        return;
      }
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          callback(readErr);
          return;
        }
        this._binaryCache.set(filePath, { data, mtimeMs: stat.mtimeMs });
        callback(null, data);
      });
    });
  }

  invalidate(filePath) {
    if (filePath) {
      this._cache.delete(filePath);
      this._binaryCache.delete(filePath);
    } else {
      this._cache.clear();
      this._binaryCache.clear();
    }
  }
}

module.exports = new StaticFileCache();
