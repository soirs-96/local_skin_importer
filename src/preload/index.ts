import { contextBridge, ipcRenderer } from 'electron';

export interface LcuStatus {
  running: boolean;
  port?: number;
  summoner?: {
    displayName: string;
    puuid: string;
  };
  error?: string;
}

export interface FetchSkinsResult {
  summoner: {
    displayName: string;
    puuid: string;
  };
  ownedSkinIds: number[];
}

export interface AuthStatus {
  loggedIn: boolean;
  tokenPreview: string | null;
}

export interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
}

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api = {
  checkLcu: (): Promise<LcuStatus> => invoke('lcu:check-status'),
  fetchSkins: (): Promise<FetchSkinsResult> => invoke('lcu:fetch-skins'),
  redeemCode: (code: string): Promise<AuthStatus> =>
    invoke('auth:login', { code }),
  logout: (): Promise<{ ok: true }> => invoke('auth:logout'),
  getAuthStatus: (): Promise<AuthStatus> => invoke('auth:get-status'),
  sync: (payload: SyncPayload): Promise<SyncResult> => invoke('backend:sync', payload)
};

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
