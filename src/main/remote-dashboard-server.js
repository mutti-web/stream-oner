'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const staticFileCache = require('./static-file-cache');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const THEME_PREF_KEY = 'ui.themePreference';
const ACCENT_PREF_KEY = 'ui.accentPreset';

function safeJoin(root, rel) {
  if (!rel || rel.includes('..')) return null;
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

function readJsonBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > max) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function getBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
}

class RemoteDashboardServer {
  /**
   * @param {object} opts
   */
  constructor(opts) {
    this._store = opts.store;
    this._api = opts.api;
    this._sessions = opts.sessionStore;
    this._hub = opts.hub;
    this._getConfig = opts.getConfig;
    this._remoteDir = path.join(__dirname, '../remote');
    this._sharedDir = path.join(__dirname, '../renderer/shared');
    this._assetsDir = path.join(__dirname, '../../assets');
    this._server = null;
    this._wss = null;
    /** @type {Map<import('ws').WebSocket, { token: string }>} */
    this._wsClients = new Map();
    this._removeHubSender = null;
    this._apiHits = new Map();
  }

  isRunning() {
    return !!this._server;
  }

  broadcastEvent(channel, data) {
    const payload = JSON.stringify({ type: channel, data });
    for (const [ws] of this._wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(payload); } catch (_) { /* ignore */ }
      }
    }
  }

  _checkApiRate(ip) {
    const now = Date.now();
    const windowMs = 60_000;
    const max = 100;
    const arr = (this._apiHits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    this._apiHits.set(ip, arr);
    return true;
  }

  _actorFromSession(rec) {
    return {
      sessionId: rec.sessionId,
      deviceLabel: rec.deviceLabel,
      clientIp: rec.clientIp,
    };
  }

  _sendFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const isBinary = ext === '.ico' || ext === '.png' || ext === '.woff2';
    const read = isBinary ? staticFileCache.readBuffer.bind(staticFileCache) : staticFileCache.readUtf8.bind(staticFileCache);
    read(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }

  _serveUiPrefs(res) {
    const body = JSON.stringify({
      themePreference: this._store?.get?.(THEME_PREF_KEY, 'system') || 'system',
      accentPreset: this._store?.get?.(ACCENT_PREF_KEY, 'default') || 'default',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  _serveStatic(urlPath, res) {
    if (urlPath === '/favicon.ico') {
      urlPath = '/assets/icon.ico';
    }

    const map = {
      '/': 'remote-dashboard.html',
      '/remote.css': 'remote-dashboard.css',
      '/remote-app.js': 'remote-dashboard.js',
      '/remote-yt-start-ui.js': 'remote-yt-start-ui.js',
    };
    const rel = map[urlPath];
    if (rel) {
      this._sendFile(path.join(this._remoteDir, rel), res);
      return true;
    }

    if (urlPath.startsWith('/shared/')) {
      const filePath = safeJoin(this._sharedDir, urlPath.slice('/shared/'.length));
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        this._sendFile(filePath, res);
        return true;
      }
      return false;
    }

    if (urlPath.startsWith('/assets/')) {
      const filePath = safeJoin(this._assetsDir, urlPath.slice('/assets/'.length));
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        this._sendFile(filePath, res);
        return true;
      }
      return false;
    }

    return false;
  }

  async _handleApi(req, res, urlPath) {
    const ip = getClientIp(req);
    if (urlPath !== '/remote/auth' && !this._checkApiRate(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'リクエストが多すぎます' }));
      return;
    }

    if (req.method === 'POST' && urlPath === '/remote/auth') {
      try {
        const body = await readJsonBody(req);
        const result = this._sessions.createSession(
          body.pin,
          body.deviceLabel,
          ip,
          req.headers['user-agent'] || '',
        );
        const code = result.success ? 200 : 401;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
      return;
    }

    const token = getBearer(req);
    const session = this._sessions.validateToken(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: '認証が必要です' }));
      return;
    }
    const actor = this._actorFromSession(session);

    try {
      if (req.method === 'GET' && urlPath === '/remote/state') {
        const state = await this._api.getState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, state }));
        return;
      }

      if (req.method === 'GET' && urlPath === '/remote/obs/scenes') {
        const r = await this._api.obsListScenes();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }

      if (req.method === 'GET' && urlPath === '/remote/obs/audio-inputs') {
        const r = await this._api.obsListAudioInputs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }

      const body = req.method === 'POST' ? await readJsonBody(req) : {};

      if (req.method === 'POST' && urlPath === '/remote/obs/connect') {
        const r = await this._api.obsConnect(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/obs/mute') {
        const r = await this._api.obsSetMute(actor, body.slot, !!body.muted);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/obs/scene') {
        const r = await this._api.obsSetScene(actor, body.sceneName);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/start') {
        const r = await this._api.ytStart(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/stop') {
        const r = await this._api.ytStop(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/prepare-start') {
        const r = await this._api.ytPrepareStart(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/confirm-start') {
        const r = await this._api.ytConfirmStart(actor, body.videoId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/nudge-dismiss') {
        const r = await this._api.ytDismissNudge(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/suite-flags') {
        const r = await this._api.saveSuiteFlags(actor, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/pin') {
        const r = await this._api.pinMessage(actor, body.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/unpin') {
        const r = await this._api.unpinMessage(actor, body.msgId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/ng-user') {
        const r = await this._api.addNgUser(actor, body.channelId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/yt/ng-word') {
        const r = await this._api.addNgWord(actor, body.word);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/session-log/start') {
        const r = await this._api.sessionLogStart(actor, body.videoId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/session-log/end') {
        const r = await this._api.sessionLogEnd(actor);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }
      if (req.method === 'POST' && urlPath === '/remote/session-log/highlight') {
        const r = await this._api.sessionLogMarkHighlight(actor, body.entryId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  async start() {
    const cfg = this._getConfig();
    if (!cfg.enabled) {
      await this.stop();
      return { success: true, running: false };
    }

    if (this._server) {
      return { success: true, running: true };
    }

    this._sessions.configure({
      sessionTtlHours: cfg.sessionTtlHours,
      maxSessions: cfg.maxSessions,
      maxWsPerSession: cfg.maxWsPerSession,
    });
    this._sessions.ensurePin();

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        if (urlPath === '/remote/ui-prefs' && req.method === 'GET') {
          this._serveUiPrefs(res);
          return;
        }
        if (this._serveStatic(urlPath, res)) return;
        if (urlPath.startsWith('/remote/')) {
          this._handleApi(req, res, urlPath).catch((e) => {
            res.writeHead(500);
            res.end(e.message);
          });
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });

      const wss = new WebSocketServer({ noServer: true });
      const WS_HEARTBEAT_MS = 30_000;
      const heartbeatTimer = setInterval(() => {
        for (const client of wss.clients) {
          if (!this._wsClients.has(client)) continue;
          if (client.isAlive === false) {
            client.terminate();
            continue;
          }
          client.isAlive = false;
          try { client.ping(); } catch (_) { /* ignore */ }
        }
      }, WS_HEARTBEAT_MS);
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
      this._heartbeatTimer = heartbeatTimer;

      wss.on('connection', (ws, req, info) => {
        const token = info?.token || '';
        let authed = false;
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        const authTimer = setTimeout(() => {
          if (!authed) ws.close(4001, 'auth timeout');
        }, 10_000);

        ws.on('message', async (raw) => {
          try {
            const msg = JSON.parse(String(raw));
            if (!authed && msg.type === 'auth') {
              const reg = this._sessions.registerWs(msg.token);
              if (!reg.ok) {
                ws.send(JSON.stringify({ type: 'auth-fail', error: reg.error }));
                ws.close(4003, reg.error);
                return;
              }
              authed = true;
              clearTimeout(authTimer);
              this._wsClients.set(ws, { token: msg.token });
              ws.send(JSON.stringify({ type: 'auth-ok', sessionId: reg.session.sessionId }));
              const state = await this._api.getState();
              ws.send(JSON.stringify({ type: 'state-snapshot', data: state }));
              return;
            }
            if (!authed) {
              ws.close(4003, 'not identified');
            }
          } catch (_) {
            ws.close(4002, 'bad message');
          }
        });

        ws.on('close', () => {
          clearTimeout(authTimer);
          const meta = this._wsClients.get(ws);
          if (meta?.token) this._sessions.unregisterWs(meta.token);
          this._wsClients.delete(ws);
        });
      });

      server.on('upgrade', (req, socket, head) => {
        const urlPath = (req.url || '').split('?')[0];
        if (urlPath !== '/remote/ws') {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req, {});
        });
      });

      server.listen(cfg.port, cfg.bindHost, () => {
        this._server = server;
        this._wss = wss;
        if (!this._removeHubSender) {
          this._removeHubSender = this._hub.addRemoteSender((ch, data) => {
            this.broadcastEvent(ch, data);
          });
        }
        console.log(`[Remote] ダッシュボードサーバー起動: http://${cfg.bindHost}:${cfg.port} (LAN)`);
        resolve({ success: true, running: true, port: cfg.port });
      });

      server.on('error', (e) => {
        console.error('[Remote] サーバー起動失敗:', e.message);
        resolve({ success: false, error: e.message });
      });
    });
  }

  async stop() {
    if (this._removeHubSender) {
      this._removeHubSender();
      this._removeHubSender = null;
    }
    for (const [ws] of this._wsClients) {
      try { ws.close(); } catch (_) { /* ignore */ }
    }
    this._wsClients.clear();
    if (this._wss) {
      try { this._wss.close(); } catch (_) { /* ignore */ }
      this._wss = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._server) {
      await new Promise((resolve) => {
        this._server.close(() => resolve());
      });
      this._server = null;
      console.log('[Remote] ダッシュボードサーバー停止');
    }
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}

module.exports = RemoteDashboardServer;
