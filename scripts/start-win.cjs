#!/usr/bin/env node
/**
 * Windows 起動ヘルパー — コンソールを UTF-8 にしてから Electron を起動する。
 * PowerShell / cmd どちらからでも npm run start:win で利用可能。
 */
'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001 >NUL', { shell: true, stdio: 'ignore' });
  } catch (_) { /* ignore */ }
  try {
    if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');
    if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding('utf8');
  } catch (_) { /* ignore */ }
}

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
  },
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
