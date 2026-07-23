'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const settingsExport = require('../src/main/settings-export.js');
const { createYoutubeOAuthSession, K } = require('../src/main/youtube-oauth-session.js');
const { generatePkcePair } = require('../src/main/youtube-oauth-http.js');
const {
  getBundledOAuthConfig,
  resetBundledOAuthConfigCache,
} = require('../src/main/youtube-oauth-config.js');
const { createYoutubeOAuthManager } = require('../src/main/youtube-oauth-manager.js');

function mockStore() {
  const data = {};
  const secrets = {};
  return {
    data,
    get(key, def) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : def;
    },
    set(key, val) {
      data[key] = val;
    },
    getSecret(key, def) {
      return Object.prototype.hasOwnProperty.call(secrets, key) ? secrets[key] : def;
    },
    setSecret(key, val) {
      secrets[key] = val;
    },
  };
}

describe('youtube-oauth-session', () => {
  it('saves and loads tokens bound to client id', () => {
    const store = mockStore();
    const session = createYoutubeOAuthSession(store);
    session.save('client-a', {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 120_000,
      channelId: 'UC_test',
      channelTitle: 'Test Channel',
    });
    const loaded = session.load('client-a');
    assert.equal(loaded.accessToken, 'access-1');
    assert.equal(loaded.channelTitle, 'Test Channel');
    assert.equal(session.isAccessTokenFresh(loaded), true);
  });

  it('clears session when client id changes', () => {
    const store = mockStore();
    const session = createYoutubeOAuthSession(store);
    session.save('client-a', { accessToken: 'a', refreshToken: 'r', expiresAt: 0 });
    assert.equal(session.load('client-b'), null);
    assert.equal(store.get(K.boundClientId, ''), '');
  });
});

describe('youtube-oauth-http.generatePkcePair', () => {
  it('returns verifier and S256 challenge', () => {
    const { verifier, challenge } = generatePkcePair();
    assert.ok(verifier.length >= 43);
    assert.ok(challenge.length >= 43);
    assert.notEqual(verifier, challenge);
  });
});

describe('youtube-oauth-config', () => {
  const bundledPath = require('path').join(__dirname, '../src/main/youtube-oauth.bundled.json');

  it('reports not configured without client id', () => {
    resetBundledOAuthConfigCache();
    const prev = process.env.YOUTUBE_OAUTH_CLIENT_ID;
    delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
    const fs = require('fs');
    const hadBundled = fs.existsSync(bundledPath);
    const prevBundled = hadBundled ? fs.readFileSync(bundledPath, 'utf8') : null;
    if (hadBundled) fs.unlinkSync(bundledPath);
    try {
      const cfg = getBundledOAuthConfig({ appRoot: '/tmp/nonexistent' });
      assert.equal(cfg.isConfigured, false);
    } finally {
      resetBundledOAuthConfigCache();
      if (prev !== undefined) process.env.YOUTUBE_OAUTH_CLIENT_ID = prev;
      else delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
      if (hadBundled && prevBundled != null) fs.writeFileSync(bundledPath, prevBundled);
    }
  });

  it('merges local clientSecret over bundled without secret', () => {
    resetBundledOAuthConfigCache();
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-oauth-'));

    const configPath = path.join(__dirname, '../src/main/youtube-oauth-config.js');
    delete require.cache[require.resolve(configPath)];
    const configMod = require(configPath);

    const bundledPath = path.join(path.dirname(configPath), 'youtube-oauth.bundled.json');
    const hadBundled = fs.existsSync(bundledPath);
    const prevBundled = hadBundled ? fs.readFileSync(bundledPath, 'utf8') : null;

    try {
      fs.writeFileSync(
        bundledPath,
        JSON.stringify({ clientId: 'test-bundled-client', apiKey: 'test-bundled-key' }),
      );
      fs.writeFileSync(
        path.join(tmpRoot, 'youtube-oauth.local.json'),
        JSON.stringify({ clientSecret: 'local-secret-value' }),
      );
      configMod.resetBundledOAuthConfigCache();
      const cfg = configMod.getBundledOAuthConfig({ appRoot: tmpRoot });
      assert.equal(cfg.clientId, 'test-bundled-client');
      assert.equal(cfg.apiKey, 'test-bundled-key');
      assert.equal(cfg.clientSecret, 'local-secret-value');
    } finally {
      configMod.resetBundledOAuthConfigCache();
      if (hadBundled && prevBundled != null) fs.writeFileSync(bundledPath, prevBundled);
      else if (fs.existsSync(bundledPath)) fs.unlinkSync(bundledPath);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('prefers local clientId over bundled when both set', () => {
    resetBundledOAuthConfigCache();
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-oauth-'));

    const configPath = path.join(__dirname, '../src/main/youtube-oauth-config.js');
    delete require.cache[require.resolve(configPath)];
    const configMod = require(configPath);

    const bundledPath = path.join(path.dirname(configPath), 'youtube-oauth.bundled.json');
    const hadBundled = fs.existsSync(bundledPath);
    const prevBundled = hadBundled ? fs.readFileSync(bundledPath, 'utf8') : null;

    try {
      fs.writeFileSync(
        bundledPath,
        JSON.stringify({ clientId: 'test-bundled-client', apiKey: 'test-bundled-key' }),
      );
      fs.writeFileSync(
        path.join(tmpRoot, 'youtube-oauth.local.json'),
        JSON.stringify({ clientId: 'local-client', apiKey: 'local-key' }),
      );
      configMod.resetBundledOAuthConfigCache();
      const cfg = configMod.getBundledOAuthConfig({ appRoot: tmpRoot });
      assert.equal(cfg.clientId, 'local-client');
      assert.equal(cfg.apiKey, 'local-key');
    } finally {
      configMod.resetBundledOAuthConfigCache();
      if (hadBundled && prevBundled != null) fs.writeFileSync(bundledPath, prevBundled);
      else if (fs.existsSync(bundledPath)) fs.unlinkSync(bundledPath);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('youtube-oauth-manager.getStatus', () => {
  it('returns linked when refresh token exists', () => {
    resetBundledOAuthConfigCache();
    const store = mockStore();
    const session = createYoutubeOAuthSession(store);
    const clientId = 'test-client-id';
    process.env.YOUTUBE_OAUTH_CLIENT_ID = clientId;
    session.save(clientId, {
      refreshToken: 'refresh',
      accessToken: '',
      expiresAt: 0,
      channelTitle: 'My Channel',
    });
    const manager = createYoutubeOAuthManager({
      store,
      openExternal: async () => {},
    });
    const status = manager.getStatus();
    delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
    resetBundledOAuthConfigCache();
    assert.equal(status.configured, true);
    assert.equal(status.linked, true);
    assert.equal(status.channelTitle, 'My Channel');
  });
});

describe('settings-export SECRET_KEYS', () => {
  it('excludes youtube oauth tokens', () => {
    assert.equal(settingsExport.SECRET_KEYS.has('yt.oauth.accessToken'), true);
    assert.equal(settingsExport.SECRET_KEYS.has('yt.oauth.refreshToken'), true);
    assert.equal(settingsExport.SECRET_KEYS.has('yt.oauth.channelTitle'), false);
  });
});
