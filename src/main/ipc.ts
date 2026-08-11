import axios from 'axios';
import { ipcMain } from 'electron';
import * as lcu from './lcu';
import * as auth from './auth';
import { syncOwnedSkins } from './backend';

interface AuthCredentials {
  username: string;
  password: string;
}

interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'LCU 请求失败';
}

export function registerIpcHandlers(): void {
  ipcMain.handle('lcu:check-status', async () => {
    try {
      const lockfileAuth = lcu.readLockfile();
      const client = lcu.createLcuClient(lockfileAuth.port, lockfileAuth.token);
      const summoner = await lcu.getCurrentSummoner(client);
      return {
        running: true,
        port: lockfileAuth.port,
        summoner
      };
    } catch (error: unknown) {
      if (error instanceof lcu.LcuNotRunningError) {
        return { running: false };
      }
      return { running: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('lcu:fetch-skins', async () => {
    const lockfileAuth = lcu.readLockfile();
    const client = lcu.createLcuClient(lockfileAuth.port, lockfileAuth.token);
    const summoner = await lcu.getCurrentSummoner(client);
    const ownedSkinIds = await lcu.getOwnedSkinIds(client);
    return { summoner, ownedSkinIds };
  });

  ipcMain.handle('auth:login', async (_event, credentials: AuthCredentials) => {
    const token = await auth.login(credentials.username, credentials.password);
    auth.saveToken(token);
    return auth.getAuthStatus();
  });

  ipcMain.handle('auth:logout', async () => {
    auth.clearStoredToken();
    return { ok: true as const };
  });

  ipcMain.handle('auth:get-status', async () => auth.getAuthStatus());

  ipcMain.handle('backend:sync', async (_event, payload: SyncPayload) =>
    syncOwnedSkins(payload.puuid, payload.summonerName, payload.ownedSkinIds)
  );
}
