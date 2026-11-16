#!/usr/bin/env node
/**
 * 开发模式启动器。
 *
 * Windows 控制台默认代码页是 GBK(936),而 Node 往管道里写的是 UTF-8 字节 ——
 * 控制台拿 GBK 去解,中文就成了「鍚姩」那样的乱码。
 *
 * 这里在跑起来之前把控制台切到 UTF-8(65001),退出时再切回去:
 * 只影响这一次开发会话,不会把你的终端改坏。
 *
 * 只在 Windows 上动手 —— 别的平台终端本来就是 UTF-8。
 */

import { exec, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');

const isWindows = process.platform === 'win32';

/** 当前控制台的代码页;拿不到就返回 null。 */
function readCodePage() {
  return new Promise((resolve) => {
    exec('chcp.com', { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      // 输出形如「活动代码页: 936」/「Active code page: 936」—— 取末尾那个数字。
      const match = /(\d+)\s*$/.exec(String(stdout).trim());
      resolve(match ? Number(match[1]) : null);
    });
  });
}

function setCodePage(codePage) {
  return new Promise((resolve) => {
    exec(`chcp.com ${codePage}`, { windowsHide: true }, () => resolve());
  });
}

const originalCodePage = isWindows ? await readCodePage() : null;
if (originalCodePage !== null && originalCodePage !== 65001) {
  await setCodePage(65001);
}

const child = spawn(process.execPath, [CLI, 'dev'], { stdio: 'inherit' });

let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  if (originalCodePage !== null && originalCodePage !== 65001) {
    await setCodePage(originalCodePage);
  }
}

child.on('exit', (code) => {
  void restore().then(() => process.exit(code ?? 0));
});

// Ctrl+C / 任务管理器结束 —— 也把代码页还回去。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
    void restore().then(() => process.exit(0));
  });
}
