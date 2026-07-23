# Third-Party Notices

StreamONER（本ソフトウェア）は MIT ライセンスです。詳細は [LICENSE](./LICENSE) を参照してください。

本ソフトウェアは次の第三者コンポーネントを利用しています。各ライセンスの全文は、各プロジェクトのリポジトリまたは `node_modules/<package>/` 内の LICENSE を参照してください。

---

## 実行時・同梱

### Electron

- **License:** MIT
- **Copyright:** Electron contributors / OpenJS Foundation
- **Homepage:** https://www.electronjs.org/

### ws

- **License:** MIT
- **Copyright:** Einar Otto Stangvik and contributors
- **Homepage:** https://github.com/websockets/ws

### qrcode（および同梱 `src/main/vendor/qrcode-lib`）

- **License:** MIT
- **Copyright:** Ryan Day and contributors
- **Homepage:** https://github.com/soldair/node-qrcode

### dijkstra（`src/main/vendor/dijkstra.js`）

- **License:** MIT
- **Copyright:** Wyatt Baldwin (2008). Adapted from the Dijkstar Python project.
- **Note:** QR 関連パス計算用に同梱

### PixiJS（`pixi.js` / `src/renderer/vendor/pixi.min.js`）

- **License:** MIT
- **Copyright:** PixiJS Contributors
- **Homepage:** https://pixijs.com/
- **Note:** アバター Pixi 実験（`feature/avatar-pixi` の `/overlay-pixi`）で使用

### Material Web（`@material/web`）

- **License:** Apache License 2.0
- **Copyright:** Google LLC
- **Homepage:** https://github.com/material-components/material-web

### Material Symbols（`assets/fonts/MaterialSymbolsOutlined.woff2`）

- **License:** Apache License 2.0
- **Copyright:** Google LLC
- **Homepage:** https://fonts.google.com/icons
- **Note:** サブセット化したフォントファイルを同梱

---

## ビルド・開発時（配布バイナリにはソースとして同梱されない場合あり）

| パッケージ | License |
|------------|---------|
| rollup | MIT |
| @rollup/plugin-node-resolve | MIT |
| @rollup/plugin-terser | MIT |
| electron-builder | MIT |

---

## Apache License 2.0 について

Apache-2.0 コンポーネント（Material Web / Material Symbols）を利用するにあたり、当該ライセンスの条件に従います。ライセンス全文: https://www.apache.org/licenses/LICENSE-2.0

---

このファイルは依存関係の変更に合わせて更新してください。
