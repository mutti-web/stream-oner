#!/usr/bin/env node
/**
 * 設定・ダッシュボード・リモート UI を Electron なしでブラウザ確認するローカルサーバー。
 * HTML/CSS の変更は保存後にブラウザをリロードするだけ（electron-builder 不要）。
 * Material bundle (bundle.js) は初回のみ npm run build:ui が必要。
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src/renderer');
const REMOTE = path.join(ROOT, 'src/remote');
const ASSETS = path.join(ROOT, 'assets');
const PORT = Number(process.env.UI_PREVIEW_PORT) || 5190;
const suiteLayout = require(path.join(ROOT, 'src/main/suite-layout.js'));
const PREVIEW_LAYOUT_PATH = path.join(RENDERER, 'dev/preview-obs-layout.json');
const REHEARSAL_HTML = path.join(RENDERER, 'rehearsal-preview.html');
const OVERLAY_PLACEHOLDER_HTML = path.join(RENDERER, 'dev/rehearsal-overlay-placeholder.html');
const REHEARSAL_MOCK_JSON = path.join(RENDERER, 'dev/rehearsal-mock.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const PREVIEW_PAGES = new Set([
  '/renderer/settings.html',
  '/renderer/dashboard.html',
]);

/** 短い URL → 正規パス（相対パス解決のため /renderer/ 配下が実体） */
const PREVIEW_ALIASES = {
  '/settings.html': '/renderer/settings.html',
  '/dashboard.html': '/renderer/dashboard.html',
  '/settings': '/renderer/settings.html',
  '/dashboard': '/renderer/dashboard.html',
};

let remoteQrDataUrl = '';
let previewObsLayout = loadPreviewObsLayout();

let previewSuiteFlags = {
  discordEnabled: true,
  youtubeEnabled: true,
  avatarEnabled: true,
  desktopOverlayEnabled: false,
  dashboardChatLimit: 500,
  dashboardScLimit: 50,
};

function applyPreviewSuiteFlags(patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const key of [
    'discordEnabled', 'youtubeEnabled', 'avatarEnabled',
    'desktopOverlayEnabled', 'dashboardChatLimit', 'dashboardScLimit',
  ]) {
    if (patch[key] !== undefined) previewSuiteFlags[key] = patch[key];
  }
}

function loadPreviewObsLayout() {
  try {
    if (fs.existsSync(PREVIEW_LAYOUT_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PREVIEW_LAYOUT_PATH, 'utf8'));
      return suiteLayout.normalizeLayout(raw);
    }
  } catch (e) {
    console.warn('[preview] layout load skipped:', e.message);
  }
  return suiteLayout.normalizeLayout({});
}

function savePreviewObsLayout(layout) {
  previewObsLayout = suiteLayout.normalizeLayout(layout);
  try {
    fs.writeFileSync(PREVIEW_LAYOUT_PATH, `${JSON.stringify(previewObsLayout, null, 2)}\n`, 'utf8');
  } catch (e) {
    console.warn('[preview] layout save skipped:', e.message);
  }
}

function patchPreviewPanelLayout(panel, patch) {
  const current = { ...previewObsLayout };
  current[panel] = suiteLayout.normalizeLayout({ [panel]: patch })[panel];
  savePreviewObsLayout(current);
  return previewObsLayout;
}

const OVERLAY_PANELS = {
  discord: { label: 'Discord RPC', color: '#5865f2' },
  youtube: { label: 'YouTube Chat', color: '#cc0000' },
  avatar: { label: 'Avatar', color: '#7c3aed' },
};

let rehearsalMockMessages = [];
try {
  const mockRaw = JSON.parse(fs.readFileSync(REHEARSAL_MOCK_JSON, 'utf8'));
  rehearsalMockMessages = Array.isArray(mockRaw.messages) ? mockRaw.messages : [];
} catch (_) { /* optional */ }

const MOCK_REMOTE_STATE = {
  ui: { themePreference: 'system', accentPreset: 'default' },
  suite: { discordEnabled: true, youtubeEnabled: true, avatarEnabled: true },
  obs: {
    connected: true,
    streaming: true,
    recording: false,
    currentSceneName: '配信シーン',
    streamDurationMs: 3_600_000,
    streamDurationAt: Date.now(),
    p1Muted: false,
    p2Muted: true,
    micSourceP1: 'マイク/AUX',
    micSourceP2: 'マイク2',
    error: null,
  },
  yt: { pollerRunning: true, serverRunning: true, error: null, videoId: 'dQw4w9WgXcQ', hasApiKey: true },
  ytOAuth: { configured: true, linked: false, nudgeDismissed: false },
  avatar: {
    serverRunning: true,
    audioRunning: false,
    displayMode: 'both',
    p1Label: '配信者A',
    p2Label: '配信者B',
    ready: true,
  },
  rpc: { state: 'connected' },
  discordCredsOk: true,
  timer: { elapsedMs: 125_000, running: true, startedAt: Date.now() - 125_000 },
  sessionLog: { active: false, entryCount: 0, highlightCount: 0 },
  lastSessionLog: null,
  pinned: [],
  participants: [
    { id: 'UC_preview', name: 'プレビュー視聴者', iconUrl: '', sessionComments: 2 },
  ],
};

/** @type {typeof MOCK_REMOTE_STATE} */
let previewRemoteState = structuredClone(MOCK_REMOTE_STATE);

const MOCK_PREVIEW_CHAT_MESSAGES = [
  {
    id: 'preview-msg-1',
    text: '配信お疲れ様です！初見です。',
    author: {
      name: 'プレビュー視聴者',
      id: 'UC_preview',
      iconUrl: '',
      isFirstTime: true,
    },
  },
  {
    id: 'preview-msg-2',
    text: 'いつも見てます〜',
    author: {
      name: '常連さん',
      id: 'UC_regular',
      iconUrl: '',
      isRegular: true,
    },
  },
  {
    id: 'preview-msg-3',
    text: 'Super Chat テストありがとう！',
    author: { name: '投げ銭ユーザー', id: 'UC_sc', iconUrl: '' },
    superChat: { amountDisplayString: '¥500' },
  },
];

function sendPreviewChatMessages(ws) {
  MOCK_PREVIEW_CHAT_MESSAGES.forEach((msg, i) => {
    setTimeout(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'yt-message', data: msg }));
      }
    }, 350 + i * 400);
  });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function safePath(root, rel) {
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function loadRemoteQr() {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const { remoteLanQrDataUrl } = require(path.join(ROOT, 'src/main/remote-lan-qr.js'));
    remoteQrDataUrl = await remoteLanQrDataUrl('http://192.168.1.42:3920/');
    if (!remoteQrDataUrl) console.warn('[preview] QR sample empty');
  } catch (e) {
    console.warn('[preview] QR sample skipped:', e.message);
    remoteQrDataUrl = '';
  }
}

function injectPreviewScripts(html, { obsLayout } = {}) {
  const layoutScript = obsLayout
    ? `<script>window.__SERVER_PREVIEW_OBS_LAYOUT__=${JSON.stringify(obsLayout)};</script>\n  `
    : '';
  const tags = [
    layoutScript,
    '<script src="/renderer/dev/mock-electron-api.js"></script>',
    '<script>window.__UI_PREVIEW__=true;</script>',
  ].join('\n  ');
  return html.replace('<head>', `<head>\n  ${tags}`);
}

function injectRehearsalPreview(html) {
  let out = suiteLayout.injectLayoutIntoHtml(html, previewObsLayout, { rehearsal: true });
  const boot = [
    '<script>window.__UI_PREVIEW__=true;</script>',
    '<style>',
    '  html.ui-preview-rehearsal { overflow: hidden; width: 100%; height: 100%; }',
    '  html.ui-preview-rehearsal body {',
    '    transform-origin: top left;',
    '    transform: scale(min(100vw / 1920, 100vh / 1080));',
    '  }',
    '</style>',
    '<script>document.documentElement.classList.add("ui-preview-rehearsal");</script>',
  ].join('\n  ');
  return out.replace('<head>', `<head>\n  ${boot}`);
}

function buildOverlayPlaceholder(panel) {
  const meta = OVERLAY_PANELS[panel] || { label: panel, color: '#444' };
  let template = readText(OVERLAY_PLACEHOLDER_HTML);
  let body = '';
  let script = '';

  if (panel === 'youtube') {
    const msgs = rehearsalMockMessages
      .filter((m) => m.text)
      .slice(0, 8)
      .map((m) => ({
        author: m.author?.name || '視聴者',
        text: m.text,
        sc: !!m.superChat,
        member: !!m.author?.isMember,
      }));
    body = '<div class="chat-list" id="chat-list"></div>';
    script = `<script>
      const MSGS = ${JSON.stringify(msgs)};
      const list = document.getElementById('chat-list');
      let idx = 0;
      function addOne() {
        if (!list || !MSGS.length) return;
        const m = MSGS[idx % MSGS.length];
        idx += 1;
        const el = document.createElement('div');
        el.className = 'chat-item' + (m.sc ? ' sc' : '') + (m.member ? ' member' : '');
        el.innerHTML = '<span class="author">' + m.author + '</span>' + m.text;
        list.appendChild(el);
        while (list.children.length > 5) list.removeChild(list.firstChild);
      }
      addOne();
      setInterval(addOne, 3500);
    </script>`;
  } else if (panel === 'avatar') {
    body = '<div class="avatar-stage"><div class="avatar-slot">配信者A</div><div class="avatar-slot">配信者B</div></div>';
  } else {
    body = '<p class="hint" style="margin-top:12px">ゲーム名 · ステータス · 経過時間など</p>';
  }

  return template
    .replaceAll('__PANEL_ID__', panel)
    .replaceAll('__PANEL_LABEL__', meta.label)
    .replaceAll('__PANEL_COLOR__', meta.color)
    .replaceAll('__PANEL_BODY__', body)
    .replaceAll('__PANEL_SCRIPT__', script);
}

async function handleRehearsalApi(req, res, urlPath) {
  if (urlPath === '/rehearsal/layout' && req.method === 'GET') {
    sendJson(res, 200, previewObsLayout);
    return true;
  }

  if (urlPath === '/rehearsal/layout' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const panel = String(body.panel || '');
      const patch = body.layout;
      if (!['discord', 'youtube', 'avatar'].includes(panel) || !patch || typeof patch !== 'object') {
        sendJson(res, 400, { success: false, error: 'invalid panel' });
        return true;
      }
      patchPreviewPanelLayout(panel, patch);
      sendJson(res, 200, { success: true });
    } catch (_) {
      sendJson(res, 400, { success: false, error: 'bad json' });
    }
    return true;
  }

  if (urlPath === '/rehearsal/focus' && req.method === 'POST') {
    sendJson(res, 200, { success: true, preview: true });
    return true;
  }

  if (urlPath === '/dev/preview/obs-layout' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (body.layout && typeof body.layout === 'object') {
        savePreviewObsLayout(body.layout);
      }
      sendJson(res, 200, { success: true, layout: previewObsLayout });
    } catch (_) {
      sendJson(res, 400, { success: false });
    }
    return true;
  }

  if (urlPath === '/dev/preview/obs-layout' && req.method === 'GET') {
    sendJson(res, 200, previewObsLayout);
    return true;
  }

  if (urlPath === '/dev/preview/suite-state' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      applyPreviewSuiteFlags(body);
      if (body.suiteObsLayout && typeof body.suiteObsLayout === 'object') {
        savePreviewObsLayout(body.suiteObsLayout);
      }
      sendJson(res, 200, { success: true, layout: previewObsLayout, flags: previewSuiteFlags });
    } catch (_) {
      sendJson(res, 400, { success: false });
    }
    return true;
  }

  if (urlPath === '/dev/preview/avatar-config' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const next = { ...(previewRemoteState.avatar || {}) };
      if (body.displayMode !== undefined) {
        const dm = String(body.displayMode);
        next.displayMode = ['both', 'p1', 'p2'].includes(dm) ? dm : 'both';
      }
      if (body.p1Label !== undefined) next.p1Label = String(body.p1Label || '配信者A');
      if (body.p2Label !== undefined) next.p2Label = String(body.p2Label || '配信者B');
      previewRemoteState.avatar = next;
      broadcastRemoteWs({ type: 'avatar-config-changed', data: next });
      broadcastRemoteWs({ type: 'state-snapshot', data: previewRemoteState });
      sendJson(res, 200, { success: true, avatar: next });
    } catch (_) {
      sendJson(res, 400, { success: false });
    }
    return true;
  }

  if (urlPath === '/dev/preview/avatar-config' && req.method === 'GET') {
    sendJson(res, 200, previewRemoteState.avatar || {});
    return true;
  }

  return false;
}

function servePreviewIndex(res) {
  const mode = previewRemoteState.avatar?.displayMode || 'both';
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UI Preview — StreamONER</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 32px auto; padding: 0 16px; line-height: 1.6; }
    h1 { font-size: 1.25rem; }
    ul { padding-left: 1.2rem; }
    a { color: #6750a4; }
    .note { font-size: 0.9rem; color: #555; background: #f4f0ff; border: 1px solid #d8cff5; padding: 12px; border-radius: 8px; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; }
    .tools { margin: 20px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
    .tools label { display: block; font-size: 0.9rem; margin-bottom: 6px; }
    .tools select { font-size: 1rem; padding: 6px 8px; }
    .tools .hint { font-size: 0.85rem; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>StreamONER — UI プレビュー</h1>
  <p class="note">Electron なしでレイアウト確認用です。IPC・OBS・Discord などの実機能は動きません。HTML/CSS 変更後は <strong>リロード</strong> だけで反映されます。</p>
  <div class="tools">
    <label for="preview-display-mode">アバター表示人数（ダッシュボード／スマホのミュート確認用）</label>
    <select id="preview-display-mode">
      <option value="both"${mode === 'both' ? ' selected' : ''}>2人表示</option>
      <option value="p1"${mode === 'p1' ? ' selected' : ''}>1人目のみ</option>
      <option value="p2"${mode === 'p2' ? ' selected' : ''}>2人目のみ</option>
    </select>
    <p class="hint">変更すると設定モック・開いているダッシュボード／スマホ（ログイン済み）へ反映されます。反映されない場合は各タブをリロードしてください。</p>
  </div>
  <ul>
    <li><a href="/rehearsal" target="_blank">リハーサルプレビュー</a>（レイアウト編集・ドラッグ確認）</li>
    <li><a href="/renderer/settings.html?tab=accounts&amp;focus=sec-setup-yt-oauth" target="_blank">設定 › 接続（YouTube 連携）</a></li>
    <li><a href="/renderer/settings.html?tab=avatar" target="_blank">設定 › アバター</a></li>
    <li><a href="/renderer/dashboard.html" target="_blank">PC ダッシュボード</a></li>
    <li><a href="/mobile/" target="_blank">スマホ用ダッシュボード（ログイン画面）</a> — PIN 任意でログイン可</li>
    <li><a href="/mobile/?autologin=1" target="_blank">スマホ用（ログイン済み UI）</a></li>
  </ul>
  <p>起動: <code>npm run preview:ui</code>（ポート ${PORT}）</p>
  <script>
    const sel = document.getElementById('preview-display-mode');
    const STORE_KEY = '__ui_preview_store__';
    sel?.addEventListener('change', async () => {
      const displayMode = sel.value;
      try {
        const store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        store.avatar = { ...(store.avatar || {}), displayMode };
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (_) {}
      await fetch('/dev/preview/avatar-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayMode }),
      }).catch(() => {});
    });
  </script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function handleRemoteApi(req, res, urlPath) {
  if (req.method === 'GET' && urlPath === '/remote/ui-prefs') {
    sendJson(res, 200, { themePreference: 'system', accentPreset: 'default' });
    return;
  }

  if (req.method === 'POST' && urlPath === '/remote/auth') {
    const body = JSON.parse(await readBody(req) || '{}');
    if (!body.pin) {
      sendJson(res, 400, { success: false, error: 'PIN を入力してください' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      token: 'preview-token',
      deviceLabel: body.deviceLabel || 'プレビュー端末',
    });
    return;
  }

  const auth = req.headers.authorization || '';
  const authed = auth.startsWith('Bearer ') && auth.slice(7);

  if (!authed && urlPath !== '/remote/auth') {
    sendJson(res, 401, { success: false, error: '未認証' });
    return;
  }

  if (req.method === 'GET' && urlPath === '/remote/state') {
    sendJson(res, 200, { success: true, state: previewRemoteState });
    return;
  }
  if (req.method === 'GET' && urlPath === '/remote/obs/scenes') {
    sendJson(res, 200, { success: true, scenes: [{ sceneName: '配信シーン' }, { sceneName: '待機' }] });
    return;
  }
  if (req.method === 'GET' && urlPath === '/remote/obs/audio-inputs') {
    sendJson(res, 200, { success: true, inputs: [{ inputName: 'マイク/AUX' }], fallbackAll: false });
    return;
  }
  if (req.method === 'POST' && urlPath === '/remote/session-log/start') {
    previewRemoteState.sessionLog = { active: true, entryCount: 0, highlightCount: 0 };
    broadcastRemoteWs({ type: 'session-log-changed', data: previewRemoteState.sessionLog });
    sendJson(res, 200, { success: true });
    return;
  }
  if (req.method === 'POST' && urlPath === '/remote/session-log/end') {
    previewRemoteState.lastSessionLog = {
      videoId: previewRemoteState.yt?.videoId || 'dQw4w9WgXcQ',
      highlights: [
        {
          kind: 'manual',
          label: 'プレビュー視聴者: 配信お疲れ様です！',
          sessionElapsedMs: 125_000,
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125',
        },
      ],
    };
    previewRemoteState.sessionLog = { active: false, entryCount: 3, highlightCount: 1 };
    broadcastRemoteWs({ type: 'session-log-ended', data: previewRemoteState.lastSessionLog });
    broadcastRemoteWs({ type: 'session-log-changed', data: previewRemoteState.sessionLog });
    sendJson(res, 200, { success: true, session: previewRemoteState.lastSessionLog });
    return;
  }

  if (req.method === 'POST' && urlPath === '/remote/yt/stop') {
    previewRemoteState.yt = { ...previewRemoteState.yt, pollerRunning: false };
    broadcastRemoteWs({ type: 'state-snapshot', data: previewRemoteState });
    sendJson(res, 200, { success: true });
    return;
  }
  if (req.method === 'POST' && urlPath === '/remote/yt/nudge-dismiss') {
    previewRemoteState.ytOAuth = { ...previewRemoteState.ytOAuth, nudgeDismissed: true };
    sendJson(res, 200, { success: true });
    return;
  }
  if (req.method === 'POST' && urlPath === '/remote/yt/prepare-start') {
    const yt = previewRemoteState.yt || {};
    if (yt.pollerRunning) {
      sendJson(res, 200, { step: 'already_running' });
      return;
    }
    const oauth = previewRemoteState.ytOAuth || {};
    const manualVideoId = String(yt.videoId || '').trim();
    if (oauth.linked) {
      const mode = previewRemoteState.ytLiveDetectPreview || 'single';
      if (mode === 'none') {
        if (manualVideoId) {
          sendJson(res, 200, {
            step: 'confirm_manual_fallback',
            videoId: manualVideoId,
            detectError: '配信中のライブが見つかりません。',
          });
          return;
        }
        sendJson(res, 200, { step: 'error', error: '配信中のライブが見つかりません。' });
        return;
      }
      if (mode === 'multiple') {
        sendJson(res, 200, {
          step: 'pick_multiple',
          broadcasts: [
            { videoId: 'prev-live-1', title: 'プレビュー配信 A' },
            { videoId: 'prev-live-2', title: 'プレビュー配信 B' },
          ],
        });
        return;
      }
      sendJson(res, 200, {
        step: 'confirm_single',
        broadcast: { videoId: 'dQw4w9WgXcQ', title: 'プレビュー配信中ライブ' },
      });
      return;
    }
    if (manualVideoId) {
      sendJson(res, 200, { step: 'start_manual', videoId: manualVideoId });
      return;
    }
    if (!oauth.nudgeDismissed) {
      sendJson(res, 200, { step: 'nudge', configured: oauth.configured !== false });
      return;
    }
    sendJson(res, 200, { step: 'error', error: '動画 ID が未設定です。' });
    return;
  }
  if (req.method === 'POST' && urlPath === '/remote/yt/confirm-start') {
    const body = JSON.parse(await readBody(req) || '{}');
    const videoId = String(body.videoId || '').trim();
    if (!videoId) {
      sendJson(res, 200, { success: false, error: '動画 ID が空です' });
      return;
    }
    previewRemoteState.yt = {
      ...previewRemoteState.yt,
      pollerRunning: true,
      videoId,
    };
    broadcastRemoteWs({ type: 'state-snapshot', data: previewRemoteState });
    sendJson(res, 200, { success: true });
    return;
  }
  if (req.method === 'POST' && urlPath.startsWith('/remote/')) {
    sendJson(res, 200, { success: true });
    return;
  }
  sendJson(res, 404, { success: false, error: 'Not found' });
}

function adaptMobileHtmlForPreview(html) {
  // プレビューは従来どおり /renderer/shared/ を使う（/shared/ は本番リモートサーバー向け）
  return html.replace(/\/shared\//g, '/renderer/shared/');
}

function serveMobileHtml(res, autologin) {
  const filePath = path.join(REMOTE, 'remote-dashboard.html');
  let html = adaptMobileHtmlForPreview(readText(filePath));
  const previewBoot = `<script>
      window.__UI_PREFS__ = { themePreference: 'system', accentPreset: 'default' };
    </script>`;
  if (autologin) {
    const boot = `<script>
      localStorage.setItem('remoteDashboardToken', 'preview-token');
      localStorage.setItem('remoteDeviceLabel', 'プレビュー端末');
    </script>`;
    html = html.replace('</head>', `${previewBoot}${boot}</head>`);
  } else {
    html = html.replace('</head>', `${previewBoot}</head>`);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const query = new URL(req.url || '/', `http://127.0.0.1:${PORT}`).searchParams;

  if (PREVIEW_ALIASES[urlPath]) {
    res.writeHead(302, { Location: PREVIEW_ALIASES[urlPath] });
    res.end();
    return;
  }

  if (urlPath === '/') {
    servePreviewIndex(res);
    return;
  }

  if (urlPath === '/rehearsal') {
    let html = readText(REHEARSAL_HTML);
    html = injectRehearsalPreview(html);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    });
    res.end(html);
    return;
  }

  if (urlPath === '/rehearsal-preview.js') {
    const jsPath = path.join(RENDERER, 'rehearsal-preview.js');
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(jsPath));
    return;
  }

  if (urlPath === '/suite-flags') {
    sendJson(res, 200, { ...previewSuiteFlags });
    return;
  }

  if (urlPath.startsWith('/dev/overlay/')) {
    const panel = urlPath.slice('/dev/overlay/'.length).split('/')[0];
    if (!OVERLAY_PANELS[panel]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buildOverlayPlaceholder(panel));
    return;
  }

  if (await handleRehearsalApi(req, res, urlPath)) {
    return;
  }

  if (urlPath === '/mobile/' || urlPath === '/mobile') {
    serveMobileHtml(res, query.get('autologin') === '1');
    return;
  }

  if (urlPath === '/remote.css') {
    const p = path.join(REMOTE, 'remote-dashboard.css');
    res.writeHead(200, { 'Content-Type': MIME['.css'] });
    res.end(fs.readFileSync(p));
    return;
  }
  if (urlPath === '/remote-app.js') {
    const p = path.join(REMOTE, 'remote-dashboard.js');
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(fs.readFileSync(p));
    return;
  }
  if (urlPath === '/remote-yt-start-ui.js') {
    const p = path.join(REMOTE, 'remote-yt-start-ui.js');
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(fs.readFileSync(p));
    return;
  }

  if (urlPath.startsWith('/remote/')) {
    await handleRemoteApi(req, res, urlPath);
    return;
  }

  if (urlPath === '/renderer/dev/mock-electron-api.js') {
    let js = readText(path.join(RENDERER, 'dev/mock-electron-api.js'));
    js = js.replace('__REMOTE_QR_DATA_URL__', remoteQrDataUrl.replace(/'/g, "\\'"));
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(js);
    return;
  }

  if (urlPath.startsWith('/shared/')) {
    const rel = urlPath.slice('/shared/'.length);
    const filePath = safePath(path.join(RENDERER, 'shared'), rel);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
    return;
  }

  if (urlPath.startsWith('/renderer/')) {
    const rel = urlPath.slice('/renderer/'.length);
    const filePath = safePath(RENDERER, rel);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let data = ext === '.html' ? readText(filePath) : fs.readFileSync(filePath);
    if (ext === '.html' && PREVIEW_PAGES.has(urlPath)) {
      data = injectPreviewScripts(data, { obsLayout: previewObsLayout });
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
    return;
  }

  if (urlPath.startsWith('/assets/')) {
    const rel = urlPath.slice('/assets/'.length);
    const filePath = safePath(ASSETS, rel);
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true });

function broadcastRemoteWs(payload) {
  const json = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(json);
  }
}

server.on('upgrade', (req, socket, head) => {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath !== '/remote/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'auth') {
          ws.send(JSON.stringify({ type: 'auth-ok', sessionId: 'preview' }));
          ws.send(JSON.stringify({ type: 'state-snapshot', data: previewRemoteState }));
          sendPreviewChatMessages(ws);
        }
      } catch (_) { /* ignore */ }
    });
  });
});

await loadRemoteQr();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`UI preview: http://127.0.0.1:${PORT}/`);
  console.log('  リハーサル  → /rehearsal');
  console.log('  設定      → /renderer/settings.html');
  console.log('  ダッシュボード → /renderer/dashboard.html');
  console.log('  スマホ    → /mobile/  (?autologin=1 でログイン省略)');
});
