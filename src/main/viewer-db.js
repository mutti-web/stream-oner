const fs = require('fs');
const path = require('path');

class ViewerDB {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'viewers.json');
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      }
    } catch (e) {
      console.error('[ViewerDB] ロード失敗:', e.message);
    }
    return {};
  }

  _save() {
    fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8', (err) => {
      if (err) console.error('[ViewerDB] 保存失敗:', err.message);
    });
  }

  /**
   * @param {string} channelId
   * @param {string} name
   * @returns {{ commentCount: number, isFirstTime: boolean }}
   */
  trackUser(channelId, name) {
    if (!channelId) return { commentCount: 1, isFirstTime: false };

    let user = this.data[channelId];
    let isFirstTime = false;

    if (!user) {
      isFirstTime = true;
      user = {
        name: name,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        commentCount: 0,
      };
      this.data[channelId] = user;
    }

    user.name = name;
    user.lastSeen = Date.now();
    user.commentCount += 1;

    this._scheduleSave();

    return {
      commentCount: user.commentCount,
      isFirstTime: isFirstTime,
    };
  }

  /**
   * @param {string} channelId
   * @returns {object|null}
   */
  getUser(channelId) {
    if (!channelId || !this.data[channelId]) return null;
    const u = this.data[channelId];
    return {
      channelId,
      name: u.name,
      firstSeen: u.firstSeen,
      lastSeen: u.lastSeen,
      commentCount: u.commentCount,
    };
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._save();
      this._saveTimer = null;
    }, 5000);
  }
}

module.exports = ViewerDB;
