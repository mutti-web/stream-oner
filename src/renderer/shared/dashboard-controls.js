'use strict';

/**
 * ダッシュボード / スマホリモート共通のサービスランプ・ミュート UI。
 * 依存: window.AppStateUI
 */
window.DashboardControls = {
  /**
   * @param {HTMLElement|null} el
   * @param {'off'|'ok'|'warn'|'err'|'rec'} kind
   * @param {string} title
   * @param {boolean} featureOn 機能 ON のときだけ状態アイコンを表示
   */
  setServiceLamp(el, kind, title, featureOn) {
    if (!el) return;
    if (!featureOn) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    window.StatusIndicator?.apply(el, kind, title, { style: 'icon' });
  },

  /**
   * @param {{
   *   elements: { discord?: HTMLElement|null, youtube?: HTMLElement|null, avatar?: HTMLElement|null },
   *   flags: { discordOn?: boolean, youtubeOn?: boolean, avatarOn?: boolean },
   *   discord: { credsOk?: boolean, rpcState?: string, error?: string|null },
   *   youtube: { ytCfg?: object, pollerRunning?: boolean, error?: string|null },
   *   avatar: { configReady?: boolean, serverRunning?: boolean, audioRunning?: boolean, error?: string|null },
   * }} opts
   */
  updateServiceLamps(opts) {
    const S = window.AppStateUI;
    if (!S) return;
    const { elements, flags, discord, youtube, avatar } = opts;

    const dc = S.discordLamp({
      featureOn: !!flags.discordOn,
      credsOk: !!discord.credsOk,
      rpcState: discord.rpcState,
      error: discord.error,
    });
    this.setServiceLamp(elements.discord, dc.kind, dc.title, !!flags.discordOn);

    const yt = S.youtubeLamp({
      featureOn: !!flags.youtubeOn,
      ytCfg: youtube.ytCfg || {},
      pollerRunning: !!youtube.pollerRunning,
      error: youtube.error,
    });
    this.setServiceLamp(elements.youtube, yt.kind, yt.title, !!flags.youtubeOn);

    const av = S.avatarLamp({
      featureOn: !!flags.avatarOn,
      configReady: !!avatar.configReady,
      serverRunning: !!avatar.serverRunning,
      audioRunning: !!avatar.audioRunning,
      error: avatar.error,
    });
    this.setServiceLamp(elements.avatar, av.kind, av.title, !!flags.avatarOn);
  },

  /**
   * @param {HTMLElement|null} btn
   */
  updateMuteButton(btn, muted, enabled, label) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('is-muted', !!muted);
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const icon = btn.querySelector('md-icon');
    if (icon) icon.textContent = muted ? 'mic_off' : 'mic';
    const name = label || 'マイク';
    btn.title = muted ? `${name}：ミュート中（タップで解除）` : `${name}：ミュートにする`;
    btn.setAttribute('aria-label', muted ? `${name}のミュートを解除` : `${name}をミュート`);
    const row = btn.closest('.mic-row');
    if (row) row.classList.toggle('is-muted', !!muted);
  },

  truncateMicName(name, maxLen = 14) {
    const n = String(name || '').trim();
    if (!n) return '— 未選択 —';
    return n.length > maxLen ? `${n.slice(0, maxLen)}…` : n;
  },
};
