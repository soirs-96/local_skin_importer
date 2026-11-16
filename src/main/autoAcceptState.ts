import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_ACCEPT_DELAY_SECONDS } from '../shared/autoAccept';

/**
 * 自动接受的开关设置。
 *
 * 默认**关闭** —— 自动接受会替用户做决定,这个决定得用户自己交出来。
 */

const STATE_FILENAME = 'auto-accept.json';

export interface AutoAcceptPrefs {
  enabled: boolean;
  /** 接受前要等多久(秒)。 */
  delaySeconds: number;
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readAutoAcceptPrefs(): AutoAcceptPrefs {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath(), 'utf-8')) as {
      enabled?: unknown;
      delaySeconds?: unknown;
    };
    return {
      enabled: raw?.enabled === true,
      delaySeconds:
        typeof raw?.delaySeconds === 'number' && Number.isFinite(raw.delaySeconds)
          ? raw.delaySeconds
          : DEFAULT_ACCEPT_DELAY_SECONDS
    };
  } catch {
    // 文件不存在 / 坏了 —— 当没开过,不该挡住启动
    return { enabled: false, delaySeconds: DEFAULT_ACCEPT_DELAY_SECONDS };
  }
}

/** 只改要改的那一项,另一项原样留着。 */
export function writeAutoAcceptPrefs(prefs: Partial<AutoAcceptPrefs>): void {
  try {
    const current = readAutoAcceptPrefs();
    const merged: AutoAcceptPrefs = {
      enabled: prefs.enabled ?? current.enabled,
      delaySeconds: prefs.delaySeconds ?? current.delaySeconds
    };
    fs.writeFileSync(stateFilePath(), JSON.stringify(merged), 'utf-8');
  } catch {
    // 写不进去只影响「下次启动还记着」,不影响本次运行
  }
}
