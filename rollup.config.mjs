import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

/**
 * Material Web のバンドルを生成。
 *
 * - エントリ: src/renderer/shared/material/index.js
 * - 出力:    src/renderer/shared/material/bundle.js（ESM）
 *
 * Electron renderer は Node.js ではなくブラウザ環境なので、
 * `@rollup/plugin-node-resolve` で bare module specifiers を解決する。
 */
export default {
  input: 'src/renderer/shared/material/index.js',
  output: {
    file: 'src/renderer/shared/material/bundle.js',
    format: 'esm',
    sourcemap: false,
    inlineDynamicImports: true,
  },
  plugins: [
    resolve({ browser: true }),
    terser({
      format: { comments: false },
    }),
  ],
  // Lit のロギングを抑制（ビルドログ簡素化）
  onwarn(warning, warn) {
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};
