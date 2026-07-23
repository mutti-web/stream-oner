'use strict';

const { app, Menu } = require('electron');

/** ユーザー向け表示名（package.json productName と揃える） */
const APP_DISPLAY_NAME = 'StreamONER';

/** 設定・ダッシュボード用（File/Edit 等のメニューバーを出さない） */
const SUITE_UI_WINDOW_OPTS = { autoHideMenuBar: true };

/**
 * Electron 既定の File/Edit/View メニューを抑止する。
 * macOS はアプリメニュー最小限、Windows/Linux はメニューバー非表示。
 */
function configureApplicationMenu() {
  app.setName(APP_DISPLAY_NAME);
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about', label: `${app.name} について` },
          { type: 'separator' },
          { role: 'quit', label: '終了' },
        ],
      },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

module.exports = { APP_DISPLAY_NAME, SUITE_UI_WINDOW_OPTS, configureApplicationMenu };
