#!/usr/bin/env node
/**
 * StreamONER 開発用: 既存 Electron プロセスを終了して npm start する。
 * git pull 後に古い main プロセスが残っていると UI が更新されないため。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = path.join(root, 'src/main/main.js');

function killExisting() {
  const patterns = [
    `"${mainJs}"`,
    'stream_overlay_suite/node_modules/electron',
    'stream-overlay-suite/node_modules/electron',
  ];
  for (const pattern of patterns) {
    try {
      execSync(`pkill -f ${pattern} 2>/dev/null || true`, { shell: true, stdio: 'ignore' });
    } catch (_) { /* */ }
  }
}

killExisting();
console.log('[restart-dev] 起動中:', root);
const child = spawn('npm', ['start'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
