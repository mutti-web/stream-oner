/**
 * Material Web Components — エントリ
 *
 * このファイルから rollup でバンドルし、`bundle.js` を生成する。
 * 設定・ダッシュボードから `<script type="module" src=".../bundle.js"></script>`
 * で読み込むだけで、必要な md-* カスタム要素が登録される。
 *
 * 全部入りの `@material/web/all.js` は重いので、実際に使うものだけを個別 import する。
 */

import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/icon/icon.js';

import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';

import '@material/web/tabs/tabs.js';
import '@material/web/tabs/primary-tab.js';
import '@material/web/tabs/secondary-tab.js';

// Material 3 タイポトークンを document に適用
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';

if (typeof document !== 'undefined' && document.adoptedStyleSheets) {
  document.adoptedStyleSheets.push(typescaleStyles.styleSheet);
}
