import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import * as auth from '../auth';
import { syncOwnedSkins } from '../backend';
import { registerIpcHandlers } from '../ipc';

const mocks = vi.hoisted(() => {
  class MockLcuNotRunningError extends Error {
    constructor(message = 'League client is not running') {
      super(message);
      this.name = 'LcuNotRunningError';
    }
  }

  return {
    ipcMainHandle: vi.fn(),
    ipcRendererInvoke: vi.fn(),
    exposeInMainWorld: vi.fn(),
    getFocusedWindow: vi.fn(),
    clipboardWriteText: vi.fn(),
    readLcuAuth: vi.fn(),
    createLcuClient: vi.fn(),
    getCurrentSummoner: vi.fn(),
    getInventoryOwnedSkinIds: vi.fn(),
    getStoreOwnedSkinIds: vi.fn(),
    resolveOwnedSkinIds: vi.fn(),
    LcuNotRunningError: MockLcuNotRunningError,
    redeemSyncCode: vi.fn(),
    saveToken: vi.fn(),
    getAuthStatus: vi.fn(),
    clearStoredToken: vi.fn(),
    getStoredToken: vi.fn(),
    syncOwnedSkins: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchMyOwned: vi.fn(),
    readSyncState: vi.fn(),
    writeSyncState: vi.fn()
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle },
  ipcRenderer: { invoke: mocks.ipcRendererInvoke },
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow },
  clipboard: { writeText: mocks.clipboardWriteText }
}));

vi.mock('../lcu', () => ({
  readLcuAuth: mocks.readLcuAuth,
  createLcuClient: mocks.createLcuClient,
  getCurrentSummoner: mocks.getCurrentSummoner,
  getInventoryOwnedSkinIds: mocks.getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds: mocks.getStoreOwnedSkinIds,
  LcuNotRunningError: mocks.LcuNotRunningError
}));

vi.mock('../owned', () => ({
  resolveOwnedSkinIds: mocks.resolveOwnedSkinIds
}));

vi.mock('../auth', () => ({
  redeemSyncCode: mocks.redeemSyncCode,
  saveToken: mocks.saveToken,
  getAuthStatus: mocks.getAuthStatus,
  clearStoredToken: mocks.clearStoredToken,
  getStoredToken: mocks.getStoredToken
}));

// 只替换真正打网络的 syncOwnedSkins；shouldSkipSync / minIntervalFor 是纯函数，
// 必须留真实实现，否则节流逻辑等于没被测到。
vi.mock('../backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend')>();
  return { ...actual, syncOwnedSkins: mocks.syncOwnedSkins };
});

vi.mock('../catalog', () => ({
  fetchCatalog: mocks.fetchCatalog,
  fetchMyOwned: mocks.fetchMyOwned
}));

vi.mock('../syncState', () => ({
  readSyncState: mocks.readSyncState,
  writeSyncState: mocks.writeSyncState
}));

// Importing the preload module is itself the behavior under test: it exposes the bridge.
await import('../../preload/index');

type Handler = (...args: unknown[]) => Promise<unknown>;

type ExposedApi = {
  checkLcu: () => unknown;
  fetchSkins: () => unknown;
  redeemCode: (code: string) => unknown;
  logout: () => unknown;
  getAuthStatus: () => unknown;
  sync: (payload: { puuid: string; summonerName: string; ownedSkinIds: number[] }) => unknown;
  fetchCatalog: () => unknown;
  fetchMyOwned: () => unknown;
  openDevTools: () => unknown;
  copyText: (text: string) => unknown;
};

function handlerFor(channel: string): Handler {
  const call = mocks.ipcMainHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1] as Handler;
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return handlerFor(channel)(...args);
}

describe('IPC wiring', () => {
  beforeEach(() => {
    mocks.ipcMainHandle.mockReset();
    mocks.ipcRendererInvoke.mockReset();
    mocks.readLcuAuth.mockReset();
    mocks.createLcuClient.mockReset();
    mocks.getCurrentSummoner.mockReset();
    mocks.getInventoryOwnedSkinIds.mockReset();
    mocks.getStoreOwnedSkinIds.mockReset();
    mocks.resolveOwnedSkinIds.mockReset();
    mocks.redeemSyncCode.mockReset();
    mocks.saveToken.mockReset();
    mocks.getAuthStatus.mockReset();
    mocks.clearStoredToken.mockReset();
    mocks.getStoredToken.mockReset();
    mocks.syncOwnedSkins.mockReset();
    mocks.fetchCatalog.mockReset();
    mocks.fetchMyOwned.mockReset();
    mocks.readSyncState.mockReset();
    mocks.writeSyncState.mockReset();
    mocks.getFocusedWindow.mockReset();
    mocks.clipboardWriteText.mockReset();
    mocks.readSyncState.mockReturnValue({ lastSyncAt: null });
    registerIpcHandlers();
  });

  it('exposes all renderer methods through contextBridge', async () => {
    const exposeCall = mocks.exposeInMainWorld.mock.calls[0];
    expect(exposeCall?.[0]).toBe('api');
    const api = exposeCall?.[1] as ExposedApi;

    api.checkLcu();
    api.fetchSkins();
    api.redeemCode('482931');
    api.logout();
    api.getAuthStatus();
    api.sync({ puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2] });
    api.fetchCatalog();
    api.fetchMyOwned();
    api.openDevTools();
    api.copyText('诊断信息');

    expect(mocks.ipcRendererInvoke.mock.calls).toEqual([
      ['lcu:check-status'],
      ['lcu:fetch-skins'],
      ['auth:login', { code: '482931' }],
      ['auth:logout'],
      ['auth:get-status'],
      ['backend:sync', { puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2] }],
      ['catalog:fetch-all'],
      ['catalog:fetch-owned'],
      ['dev:open-devtools'],
      ['dev:copy-text', '诊断信息']
    ]);
  });

  it('registers all 10 ipc channels on call to registerIpcHandlers', () => {
    expect(mocks.ipcMainHandle.mock.calls.map(([channel]) => channel)).toEqual([
      'lcu:check-status',
      'lcu:fetch-skins',
      'auth:login',
      'auth:logout',
      'auth:get-status',
      'backend:sync',
      'catalog:fetch-all',
      'catalog:fetch-owned',
      'dev:open-devtools',
      'dev:copy-text'
    ]);
  });

  it('lcu:check-status returns running false when LCU is not detected', async () => {
    mocks.readLcuAuth.mockImplementation(() => {
      throw new mocks.LcuNotRunningError();
    });

    await expect(invoke('lcu:check-status')).resolves.toEqual({ running: false });
  });

  it('lcu:check-status returns running true with the current summoner', async () => {
    const lcuAuth = { port: 1234, token: 'secret' };
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    const client = {} as AxiosInstance;
    mocks.readLcuAuth.mockReturnValue(lcuAuth);
    mocks.createLcuClient.mockReturnValue(client);
    mocks.getCurrentSummoner.mockResolvedValue(summoner);

    await expect(invoke('lcu:check-status')).resolves.toEqual({
      running: true,
      port: 1234,
      summoner
    });
    expect(mocks.createLcuClient).toHaveBeenCalledWith(1234, 'secret');
    expect(mocks.getCurrentSummoner).toHaveBeenCalledWith(client);
  });

  it('lcu:check-status reports axios failures without hiding the message', async () => {
    mocks.readLcuAuth.mockReturnValue({ port: 1234, token: 'secret' });
    mocks.createLcuClient.mockReturnValue({} as AxiosInstance);
    mocks.getCurrentSummoner.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true })
    );

    await expect(invoke('lcu:check-status')).resolves.toEqual({
      running: false,
      error: 'connect ECONNREFUSED'
    });
  });

  it('lcu:fetch-skins returns the summoner and owned skin IDs', async () => {
    const client = {} as AxiosInstance;
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    mocks.readLcuAuth.mockReturnValue({ port: 1234, token: 'secret' });
    mocks.createLcuClient.mockReturnValue(client);
    mocks.getCurrentSummoner.mockResolvedValue(summoner);
    mocks.resolveOwnedSkinIds.mockResolvedValue({
      ownedSkinIds: [1001, 2005],
      source: 'inventory',
      catalogFiltered: true
    });

    await expect(invoke('lcu:fetch-skins')).resolves.toEqual({
      summoner,
      ownedSkinIds: [1001, 2005],
      source: 'inventory',
      catalogFiltered: true
    });
    expect(mocks.resolveOwnedSkinIds).toHaveBeenCalledWith(client);
  });

  it('lcu:fetch-skins propagates LCU-not-detected error as a real Error', async () => {
    mocks.readLcuAuth.mockImplementation(() => {
      throw new mocks.LcuNotRunningError();
    });

    const err = await invoke('lcu:fetch-skins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('League client is not running');
    expect((err as Error).name).toBe('LcuNotRunningError');
  });

  it('lcu:fetch-skins throws a real Error (not a plain object) on axios failures', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 500, data: { message: 'oops' } },
      code: 'ERR_BAD_RESPONSE'
    });
    mocks.readLcuAuth.mockReturnValue({ port: 1234, token: 'secret' });
    mocks.createLcuClient.mockReturnValue({} as AxiosInstance);
    mocks.getCurrentSummoner.mockRejectedValue(axiosError);

    const err = await invoke('lcu:fetch-skins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Request failed with status code 500');
    expect((err as Error & { status?: number }).status).toBe(500);
    expect((err as Error & { code?: string }).code).toBe('ERR_BAD_RESPONSE');
  });

  it('auth:login redeems the code, saves the token and returns the refreshed auth status', async () => {
    const status = { loggedIn: true, tokenPreview: 'jwt-preview...' };
    mocks.redeemSyncCode.mockResolvedValue('jwt-token');
    mocks.getAuthStatus.mockReturnValue(status);

    await expect(invoke('auth:login', {}, { code: '482931' })).resolves.toBe(status);
    expect(mocks.redeemSyncCode).toHaveBeenCalledWith('482931');
    expect(mocks.saveToken).toHaveBeenCalledWith('jwt-token');
    expect(mocks.getAuthStatus).toHaveBeenCalledOnce();
  });

  it('auth:logout clears the token and acknowledges success', async () => {
    await expect(invoke('auth:logout')).resolves.toEqual({ ok: true });
    expect(mocks.clearStoredToken).toHaveBeenCalledOnce();
  });

  it('auth:get-status delegates to getAuthStatus', async () => {
    const status = { loggedIn: false, tokenPreview: null };
    mocks.getAuthStatus.mockReturnValue(status);
    await expect(invoke('auth:get-status')).resolves.toBe(status);
  });

  it('backend:sync delegates the payload and returns its result', async () => {
    const result = { added: 2, updated: 1, totalOwned: 3 };
    mocks.syncOwnedSkins.mockResolvedValue(result);
    const payload = {
      puuid: 'p'.padEnd(32, 'x'),
      summonerName: 'Alice',
      ownedSkinIds: [1, 2, 3]
    };

    const outcome = await invoke('backend:sync', {}, payload);

    expect(outcome).toMatchObject({ skipped: false, result });
    expect(mocks.syncOwnedSkins).toHaveBeenCalledWith(
      payload.puuid,
      'Alice',
      [1, 2, 3]
    );
    expect(mocks.writeSyncState).toHaveBeenCalledOnce();
  });

  it('backend:sync skips the request when the throttle window has not elapsed', async () => {
    mocks.readSyncState.mockReturnValue({ lastSyncAt: Date.now() });

    const outcome = await invoke('backend:sync', {}, {
      puuid: 'p'.padEnd(32, 'x'),
      summonerName: 'Alice',
      ownedSkinIds: [1]
    });

    expect(outcome).toMatchObject({ skipped: true, result: null });
    expect(mocks.syncOwnedSkins).not.toHaveBeenCalled();
  });

  it('backend:sync does not record a timestamp when the request fails', async () => {
    mocks.syncOwnedSkins.mockRejectedValue(new Error('网络炸了'));

    await expect(
      invoke('backend:sync', {}, {
        puuid: 'p'.padEnd(32, 'x'),
        summonerName: 'Alice',
        ownedSkinIds: [1]
      })
    ).rejects.toThrow('网络炸了');

    expect(mocks.writeSyncState).not.toHaveBeenCalled();
  });

  it('backend:sync rejects an unknown mode', async () => {
    await expect(
      invoke('backend:sync', {}, {
        puuid: 'p'.padEnd(32, 'x'),
        summonerName: 'Alice',
        ownedSkinIds: [1],
        mode: 'weird'
      })
    ).rejects.toThrow('invalid mode');
    expect(mocks.syncOwnedSkins).not.toHaveBeenCalled();
  });

  it('backend:sync preserves axios error status code in thrown payload', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 500, data: { message: 'oops' } },
      code: 'ERR_BAD_RESPONSE'
    });
    mocks.syncOwnedSkins.mockRejectedValue(axiosError);

    await expect(
      invoke('backend:sync', {}, {
        puuid: 'p'.padEnd(32, 'x'),
        summonerName: 'Alice',
        ownedSkinIds: [1, 2]
      })
    ).rejects.toMatchObject({
      status: 500,
      code: 'ERR_BAD_RESPONSE',
      name: 'AxiosError'
    });
  });

  it('backend:sync rejects invalid payload with TypeError', async () => {
    await expect(
      invoke('backend:sync', {}, { puuid: 'too-short', summonerName: 'Alice', ownedSkinIds: [1] })
    ).rejects.toMatchObject({ message: 'invalid puuid' });
    expect(mocks.syncOwnedSkins).not.toHaveBeenCalled();
  });

  it('auth:login rejects non-6-digit code', async () => {
    await expect(invoke('auth:login', {}, { code: 'abc' })).rejects.toMatchObject(
      { message: 'invalid code (must be 6 digits)' }
    );
    expect(mocks.redeemSyncCode).not.toHaveBeenCalled();
  });

  it('catalog:fetch-all delegates to fetchCatalog', async () => {
    const result = { total: 1, records: [], skinIdFieldPresent: true };
    mocks.fetchCatalog.mockResolvedValue(result);

    await expect(invoke('catalog:fetch-all')).resolves.toBe(result);
    expect(mocks.fetchCatalog).toHaveBeenCalledOnce();
  });

  it('catalog:fetch-owned delegates to fetchMyOwned', async () => {
    const result = { totalOwnedCount: 87, ownedSkinIds: [1, 2] };
    mocks.fetchMyOwned.mockResolvedValue(result);

    await expect(invoke('catalog:fetch-owned')).resolves.toBe(result);
    expect(mocks.fetchMyOwned).toHaveBeenCalledOnce();
  });

  it('catalog:fetch-all surfaces failures as a real Error', async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error('服务端响应超时'));

    const err = await invoke('catalog:fetch-all').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('服务端响应超时');
  });

  it('dev:open-devtools opens the devtools of the focused window', async () => {
    const openDevTools = vi.fn();
    mocks.getFocusedWindow.mockReturnValue({ webContents: { openDevTools } });

    await expect(invoke('dev:open-devtools')).resolves.toEqual({ ok: true });
    expect(openDevTools).toHaveBeenCalledOnce();
  });

  it('dev:copy-text writes the text to the system clipboard', async () => {
    await expect(invoke('dev:copy-text', {}, '诊断信息')).resolves.toEqual({ ok: true });
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('诊断信息');
  });

  it('dev:copy-text rejects a non-string payload', async () => {
    await expect(invoke('dev:copy-text', {}, 42)).rejects.toMatchObject({
      message: 'invalid text'
    });
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
  });
});
