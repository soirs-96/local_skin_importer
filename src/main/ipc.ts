import axios from 'axios';
import { BrowserWindow, clipboard, ipcMain } from 'electron';
import * as lcu from './lcu';
import * as auth from './auth';
import { syncOwnedSkins, shouldSkipSync, minIntervalFor } from './backend';
import { fetchCatalog, fetchMyOwned } from './catalog';
import { resolveOwnedSkinIds } from './owned';
import { readSyncState, writeSyncState } from './syncState';

interface RedeemPayload {
  code: string;
}

interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
}

/**
 * JSON-safe Error shape thrown across the IPC boundary. Electron serializes
 * thrown values via the structured-clone algorithm, which strips axios-specific
 * fields like `isAxiosError`, `code`, and `response.status`. Wrapping as a real
 * Error (not a plain object) is what lets the renderer keep `error.message`,
 * `error.name`, and `error.stack`; throwing a bare `{...}` from an IPC handler
 * surfaces as `[object Object]` in the renderer.
 */
interface NormalizedSyncError extends Error {
  status?: number;
  code?: string;
}

/**
 * 面向用户的中文化错误文案 —— **只给游戏客户端相关的错误用**。
 *
 * axios 的原始 message 是给开发者看的("connect ECONNREFUSED 127.0.0.1:55102"),
 * 直接甩到界面上没人知道该干什么 —— 这类错误九成是「游戏客户端没开 / 重启后换了端口」。
 * 后端/目录接口的网络错误不归这套管,那边连的是服务器,说成"游戏客户端"是误导。
 */
const FRIENDLY_LCU_MESSAGES: Record<string, string> = {
  ECONNREFUSED: '连不上游戏客户端:端口没人监听。请先启动游戏客户端,等它进到主界面再重试。',
  ENOTFOUND: '找不到游戏客户端地址。',
  EHOSTUNREACH: '游戏客户端地址不可达。',
  ENETUNREACH: '网络不可达,连不上游戏客户端。',
  ETIMEDOUT: '连接游戏客户端超时。',
  ECONNRESET: '连接被游戏客户端中断。'
};

const LCU_UNREACHABLE_MESSAGE =
  '游戏客户端未运行,或端口已失效(客户端重启后会换端口)。请先启动游戏客户端,等它进到主界面再重试。';

function normalizeSyncError(e: unknown): NormalizedSyncError {
  if (axios.isAxiosError(e)) {
    const err = new Error(e.message) as NormalizedSyncError;
    err.name = e.name;
    err.status = e.response?.status;
    err.code = (e as { code?: string }).code;
    return err;
  }
  if (e instanceof Error) {
    return e as NormalizedSyncError;
  }
  const err = new Error(String(e)) as NormalizedSyncError;
  err.name = 'UnknownError';
  return err;
}

/** 游戏客户端专属的错误包装:把网络错误码换成用户看得懂的话。 */
function normalizeLcuError(e: unknown): NormalizedSyncError {
  if (e instanceof lcu.LcuUnreachableError) {
    const err = new Error(LCU_UNREACHABLE_MESSAGE) as NormalizedSyncError;
    err.name = e.name;
    err.code = 'LCU_UNREACHABLE';
    return err;
  }
  if (axios.isAxiosError(e)) {
    const code = (e as { code?: string }).code;
    const friendly = code ? FRIENDLY_LCU_MESSAGES[code] : undefined;
    const err = new Error(friendly ?? e.message) as NormalizedSyncError;
    err.name = e.name;
    err.status = e.response?.status;
    err.code = code;
    return err;
  }
  return normalizeSyncError(e);
}

function assertSyncPayload(p: unknown): asserts p is SyncPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.puuid !== 'string' || obj.puuid.length < 32) throw new Error('invalid puuid');
  if (typeof obj.summonerName !== 'string') throw new Error('invalid summonerName');
  if (!Array.isArray(obj.ownedSkinIds)) throw new Error('invalid ownedSkinIds');
  if (!(obj.ownedSkinIds as unknown[]).every((n) => typeof n === 'number')) {
    throw new Error('invalid ownedSkinIds');
  }
  if (obj.mode !== undefined && obj.mode !== 'auto' && obj.mode !== 'manual') {
    throw new Error('invalid mode');
  }
}

function assertRedeemPayload(p: unknown): asserts p is RedeemPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.code !== 'string' || !/^\d{6}$/.test(obj.code)) {
    throw new Error('invalid code (must be 6 digits)');
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('lcu:check-status', async () => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth.port, lcuAuth.token);
      const summoner = await lcu.getCurrentSummoner(client);
      return {
        running: true,
        port: lcuAuth.port,
        summoner
      };
    } catch (error: unknown) {
      if (error instanceof lcu.LcuNotRunningError) {
        return { running: false };
      }
      return { running: false, error: normalizeLcuError(error).message };
    }
  });

  ipcMain.handle('lcu:fetch-skins', async () => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth.port, lcuAuth.token);
      const summoner = await lcu.getCurrentSummoner(client);
      const owned = await resolveOwnedSkinIds(client);
      return {
        summoner,
        ownedSkinIds: owned.ownedSkinIds,
        source: owned.source,
        catalogFiltered: owned.catalogFiltered
      };
    } catch (e) {
      throw normalizeLcuError(e);
    }
  });

  ipcMain.handle('auth:login', async (_event, payload: RedeemPayload) => {
    assertRedeemPayload(payload);
    const token = await auth.redeemSyncCode(payload.code);
    auth.saveToken(token);
    return auth.getAuthStatus();
  });

  ipcMain.handle('auth:logout', async () => {
    auth.clearStoredToken();
    return { ok: true as const };
  });

  ipcMain.handle('auth:get-status', async () => auth.getAuthStatus());

  ipcMain.handle('backend:sync', async (_event, payload: SyncPayload) => {
    try {
      assertSyncPayload(payload);
      const mode = payload.mode ?? 'manual';
      const minInterval = minIntervalFor(mode);
      const state = readSyncState();
      const now = Date.now();

      if (shouldSkipSync(state.lastSyncAt, now, minInterval)) {
        return {
          skipped: true,
          lastSyncAt: state.lastSyncAt,
          result: null
        };
      }

      const result = await syncOwnedSkins(payload.puuid, payload.summonerName, payload.ownedSkinIds);
      // 只在成功后记时间戳 —— 失败不能算「已同步」
      writeSyncState({ lastSyncAt: now });
      return {
        skipped: false,
        lastSyncAt: now,
        result
      };
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  ipcMain.handle('catalog:fetch-all', async () => {
    try {
      return await fetchCatalog();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  ipcMain.handle('catalog:fetch-owned', async () => {
    try {
      return await fetchMyOwned();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  // 开发者面板的快捷操作。渲染进程没有 Node 能力,这两件事得走主进程。
  ipcMain.handle('dev:open-devtools', async () => {
    BrowserWindow.getFocusedWindow()?.webContents.openDevTools();
    return { ok: true as const };
  });

  ipcMain.handle('dev:copy-text', async (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('invalid text');
    clipboard.writeText(text);
    return { ok: true as const };
  });
}