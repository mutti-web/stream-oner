'use strict';

/**
 * YouTube OAuth 用 HTTP / HTTPS ユーティリティ（PKCE・トークン交換）
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const OAUTH_TIMEOUT_MS = 5 * 60_000;

function randomBase64Url(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function generatePkcePair() {
  const verifier = randomBase64Url(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * @param {string} url
 * @param {Record<string, string>} bodyParams
 */
function postForm(url, bodyParams) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(bodyParams).toString();
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error_description || json.error));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * @param {string} url
 * @param {string} accessToken
 */
function getJson(url, accessToken) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const reason = json.error.errors?.[0]?.reason || '';
            const detail = json.error.message || reason || 'API error';
            reject(new Error(reason ? `${detail} (${reason})` : detail));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function oauthResultHtml(success, message) {
  const title = success ? '認可を受け付けました' : '連携エラー';
  const text = success
    ? 'Google の許可は完了しました。このタブを閉じ、StreamONER の設定画面で「連携済み」になっているか確認してください。エラー表示がある場合はトークン交換に失敗しています。'
    : `連携に失敗しました: ${message || '不明なエラー'}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — StreamONER</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.6; max-width: 32rem; margin: 0 auto; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${text}</p>
</body>
</html>`;
}

/**
 * 127.0.0.1 の空きポートで OAuth コールバックを待つ。
 *
 * @param {{ expectedState: string, timeoutMs?: number }} opts
 * @returns {Promise<{
 *   redirectUri: string,
 *   waitForCode: () => Promise<{ code: string, redirectUri: string }>,
 *   cancel: () => void,
 * }>}
 */
function createOAuthCallbackServer(opts) {
  const { expectedState, timeoutMs = OAUTH_TIMEOUT_MS } = opts;

  return new Promise((resolve, reject) => {
    let redirectUri = '';
    let settled = false;
    let codeResolve;
    let codeReject;
    const codePromise = new Promise((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    const server = http.createServer((req, res) => {
      try {
        const base = redirectUri || 'http://127.0.0.1/';
        const url = new URL(req.url || '/', base);
        const oauthError = url.searchParams.get('error');
        if (oauthError) {
          const desc = url.searchParams.get('error_description') || oauthError;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(oauthResultHtml(false, desc));
          finish(new Error(desc));
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid OAuth response');
          finish(new Error('認可応答が不正です'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(oauthResultHtml(true));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close(() => {});
          codeResolve({ code, redirectUri });
        }
      } catch (err) {
        finish(err);
      }
    });

    const timer = setTimeout(() => {
      finish(new Error('認可がタイムアウトしました。ブラウザで許可を完了してください。'));
    }, timeoutMs);

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => {});
      if (err) {
        codeReject(err);
        reject(err);
      }
    }

    server.on('error', (err) => finish(err));

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      redirectUri = `http://127.0.0.1:${port}/`;
      resolve({
        redirectUri,
        waitForCode: () => codePromise,
        cancel: () => {
          if (!settled) finish(new Error('認可がキャンセルされました'));
        },
      });
    });
  });
}

module.exports = {
  generatePkcePair,
  randomBase64Url,
  postForm,
  getJson,
  oauthResultHtml,
  createOAuthCallbackServer,
  OAUTH_TIMEOUT_MS,
};
