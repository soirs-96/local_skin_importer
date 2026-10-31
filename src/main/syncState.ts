import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILENAME = 'sync-state.json';

export interface SyncState {
  /** 最近一次成功同步的时刻(epoch ms);null = 从没同步过 */
  lastSyncAt: number | null;
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readSyncState(): SyncState {
  try {
    const p = stateFilePath();
    if (!fs.existsSync(p)) return { lastSyncAt: null };
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { lastSyncAt?: unknown };
    return {
      lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : null
    };
  } catch {
    // 文件损坏 / 读不到 = 当作从没同步过,不该挡住启动
    return { lastSyncAt: null };
  }
}

export function writeSyncState(state: SyncState): void {
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(state), 'utf-8');
  } catch {
    // 写不进去只影响节流,不影响同步本身
  }
}
