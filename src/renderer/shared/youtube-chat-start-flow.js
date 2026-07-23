/**
 * YouTube チャット取得開始フロー（renderer 共通ロジック）
 */
(function initYoutubeChatStartFlow(global) {
  /**
   * @param {object} prep prepareStart の戻り値
   * @param {(videoId: string) => Promise<object>} confirm
   * @param {object} ui UI コールバック
   */
  async function handlePrep(prep, confirm, ui) {
    switch (prep?.step) {
      case 'already_running':
        return { ok: true };
      case 'start_manual':
        return confirm(prep.videoId);
      case 'confirm_manual_fallback': {
        const ok = await ui.confirmFallback(prep);
        if (!ok) return { cancelled: true };
        return confirm(prep.videoId);
      }
      case 'confirm_single': {
        const ok = await ui.confirmSingle(prep.broadcast);
        if (!ok) return { cancelled: true };
        return confirm(prep.broadcast.videoId);
      }
      case 'pick_multiple': {
        const picked = await ui.pickMultiple(prep.broadcasts);
        if (!picked) return { cancelled: true };
        return confirm(picked.videoId);
      }
      case 'nudge':
        return { nudge: await ui.nudge(prep) };
      case 'error':
        await ui.error(prep.error || '開始できませんでした');
        return { error: prep.error };
      default:
        await ui.error('開始準備の応答が不正です');
        return { error: 'invalid_step' };
    }
  }

  /**
   * @param {{
   *   prepare: () => Promise<object>,
   *   confirm: (videoId: string) => Promise<object>,
   *   stop: () => Promise<void>,
   *   isRunning: () => boolean,
   *   ui: object,
   * }} opts
   */
  async function runStart(opts) {
    const { prepare, confirm, stop, isRunning, ui } = opts;
    if (isRunning()) {
      await stop();
      return { stopped: true };
    }

    let prep = await prepare();
    for (let guard = 0; guard < 4; guard += 1) {
      const result = await handlePrep(prep, confirm, ui);
      if (result?.nudge === 'connect') {
        if (ui.onConnect) {
          const linked = await ui.onConnect();
          if (linked) {
            prep = await prepare();
            continue;
          }
        }
        return { nudge: 'connect' };
      }
      if (result?.nudge === 'manual') {
        if (ui.onManual) ui.onManual();
        return { nudge: 'manual' };
      }
      if (result?.nudge === 'dismiss') {
        if (ui.onDismiss) await ui.onDismiss();
        return { nudge: 'dismiss' };
      }
      return result;
    }
    await ui.error('開始処理がループしました。もう一度お試しください。');
    return { error: 'loop' };
  }

  global.YoutubeChatStartFlow = { runStart, handlePrep };
}(typeof window !== 'undefined' ? window : globalThis));
