import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 大厅的本地设置。
 *
 * <p>桌面端没有 electron-store —— 照 `src/main/autoAcceptState.ts` 的做法:
 * `userData` 下一个 JSON 文件,读坏了当默认值。
 */

const STATE_FILENAME = 'lobby-prefs.json';

export interface LobbyPrefs {
  /** 「在大厅公开我的信息」—— 默认开。 */
  publicVisible: boolean;
}

/**
 * 解析设置文件的内容。
 *
 * <p>单独拆出来是为了能直接测 —— 读文件的壳只有 `app.getPath` 一个依赖,
 * 测它就得把 electron 整个 mock 掉,不值当。
 */
export function parseLobbyPrefs(raw: string): LobbyPrefs {
  try {
    const parsed = JSON.parse(raw) as { publicVisible?: unknown };
    if (typeof parsed?.publicVisible === 'boolean') {
      return { publicVisible: parsed.publicVisible };
    }
  } catch {
    // 文件不存在 / 坏了 —— 当默认值
  }
  return { publicVisible: true };
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readLobbyPrefs(): LobbyPrefs {
  try {
    return parseLobbyPrefs(fs.readFileSync(stateFilePath(), 'utf-8'));
  } catch {
    return { publicVisible: true };
  }
}

export function writeLobbyPrefs(prefs: Partial<LobbyPrefs>): LobbyPrefs {
  const current = readLobbyPrefs();
  const merged: LobbyPrefs = {
    publicVisible: prefs.publicVisible ?? current.publicVisible
  };
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(merged), 'utf-8');
  } catch {
    // 写不进去只影响「下次启动还记着」
  }
  return merged;
}
