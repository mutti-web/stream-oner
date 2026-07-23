'use strict';

/**
 * メインプロセスの想定外例外をログに残す（クラッシュ直前の手がかり用）
 * @param {string} [appName]
 */
function installProcessGuards(appName = 'StreamONER') {
  let fatalShown = false;

  const logFatal = (label, err) => {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    console.error(`[${label}]`, msg);
  };

  process.on('uncaughtException', (err) => {
    logFatal('uncaughtException', err);
    if (fatalShown) return;
    fatalShown = true;
    try {
      const { dialog } = require('electron');
      if (dialog?.showErrorBox) {
        dialog.showErrorBox(
          `${appName} — 予期しないエラー`,
          'アプリを再起動してください。詳細はログを確認してください。',
        );
      }
    } catch (_) { /* electron 未準備 */ }
  });

  process.on('unhandledRejection', (reason) => {
    logFatal('unhandledRejection', reason);
  });
}

module.exports = { installProcessGuards };
