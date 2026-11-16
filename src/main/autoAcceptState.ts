import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 自动接受的开关设置。
 *
 * 默认**关闭** —— 自动接受会替用户做决定,这个决定得用户自己交出来。
 */

const STATE_FILENAME = 'auto-accept.json';

export interface AutoAcceptPrefs {
  enabled: boolean;
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readAutoAcceptPrefs(): AutoAcceptPrefs {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath(), 'utf-8')) as { enabled?: unknown };
    return { enabled: raw?.enabled === true };
  } catch {
    // 文件不存在 / 坏了 —— 当没开过,不该挡住启动
    return { enabled: false };
  }
}

export function writeAutoAcceptPrefs(prefs: AutoAcceptPrefs): void {
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(prefs), 'utf-8');
  } catch {
    // 写不进去只影响「下次启动还记着」,不影响本次运行
  }
}
