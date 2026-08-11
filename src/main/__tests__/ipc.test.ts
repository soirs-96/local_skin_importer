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
    readLockfile: vi.fn(),
    createLcuClient: vi.fn(),
    getCurrentSummoner: vi.fn(),
    getOwnedSkinIds: vi.fn(),
    LcuNotRunningError: MockLcuNotRunningError,
    login: vi.fn(),
    saveToken: vi.fn(),
    getAuthStatus: vi.fn(),
    clearStoredToken: vi.fn(),
    syncOwnedSkins: vi.fn()
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle },
  ipcRenderer: { invoke: mocks.ipcRendererInvoke },
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld }
}));

vi.mock('../lcu', () => ({
  readLockfile: mocks.readLockfile,
  createLcuClient: mocks.createLcuClient,
  getCurrentSummoner: mocks.getCurrentSummoner,
  getOwnedSkinIds: mocks.getOwnedSkinIds,
  LcuNotRunningError: mocks.LcuNotRunningError
}));

vi.mock('../auth', () => ({
  login: mocks.login,
  saveToken: mocks.saveToken,
  getAuthStatus: mocks.getAuthStatus,
  clearStoredToken: mocks.clearStoredToken
}));

vi.mock('../backend', () => ({ syncOwnedSkins: mocks.syncOwnedSkins }));

// Importing the preload module is itself the behavior under test: it exposes the bridge.
await import('../../preload/index');

type Handler = (...args: unknown[]) => Promise<unknown>;

type ExposedApi = {
  checkLcu: () => unknown;
  fetchSkins: () => unknown;
  login: (username: string, password: string) => unknown;
  logout: () => unknown;
  getAuthStatus: () => unknown;
  sync: (payload: { puuid: string; summonerName: string; ownedSkinIds: number[] }) => unknown;
};

function handlerFor(channel: string): Handler {
  const call = mocks.ipcMainHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1] as Handler;
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return handlerFor(channel)(...args);
}

describe('Task 15 IPC wiring', () => {
  beforeEach(() => {
    mocks.ipcMainHandle.mockReset();
    mocks.ipcRendererInvoke.mockReset();
    mocks.readLockfile.mockReset();
    mocks.createLcuClient.mockReset();
    mocks.getCurrentSummoner.mockReset();
    mocks.getOwnedSkinIds.mockReset();
    mocks.login.mockReset();
    mocks.saveToken.mockReset();
    mocks.getAuthStatus.mockReset();
    mocks.clearStoredToken.mockReset();
    mocks.syncOwnedSkins.mockReset();
    registerIpcHandlers();
  });

  it('exposes all renderer methods through contextBridge', async () => {
    const exposeCall = mocks.exposeInMainWorld.mock.calls[0];
    expect(exposeCall?.[0]).toBe('api');
    const api = exposeCall?.[1] as ExposedApi;

    api.checkLcu();
    api.fetchSkins();
    api.login('alice', 'password');
    api.logout();
    api.getAuthStatus();
    api.sync({ puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2] });

    expect(mocks.ipcRendererInvoke.mock.calls).toEqual([
      ['lcu:check-status'],
      ['lcu:fetch-skins'],
      ['auth:login', { username: 'alice', password: 'password' }],
      ['auth:logout'],
      ['auth:get-status'],
      ['backend:sync', { puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2] }]
    ]);
  });

  it('registers all 6 ipc channels on call to registerIpcHandlers', () => {
    expect(mocks.ipcMainHandle.mock.calls.map(([channel]) => channel)).toEqual([
      'lcu:check-status',
      'lcu:fetch-skins',
      'auth:login',
      'auth:logout',
      'auth:get-status',
      'backend:sync'
    ]);
  });

  it('lcu:check-status returns running false when lockfile is missing', async () => {
    mocks.readLockfile.mockImplementation(() => {
      throw new mocks.LcuNotRunningError();
    });

    await expect(invoke('lcu:check-status')).resolves.toEqual({ running: false });
  });

  it('lcu:check-status returns running true with the current summoner', async () => {
    const lcuAuth = { port: 1234, token: 'secret' };
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    const client = {} as AxiosInstance;
    mocks.readLockfile.mockReturnValue(lcuAuth);
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
    mocks.readLockfile.mockReturnValue({ port: 1234, token: 'secret' });
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
    mocks.readLockfile.mockReturnValue({ port: 1234, token: 'secret' });
    mocks.createLcuClient.mockReturnValue(client);
    mocks.getCurrentSummoner.mockResolvedValue(summoner);
    mocks.getOwnedSkinIds.mockResolvedValue([1001, 2005]);

    await expect(invoke('lcu:fetch-skins')).resolves.toEqual({
      summoner,
      ownedSkinIds: [1001, 2005]
    });
    expect(mocks.getOwnedSkinIds).toHaveBeenCalledWith(client);
  });

  it('auth:login saves the token and returns the refreshed auth status', async () => {
    const status = { loggedIn: true, tokenPreview: 'jwt-preview...' };
    mocks.login.mockResolvedValue('jwt-token');
    mocks.getAuthStatus.mockReturnValue(status);

    await expect(invoke('auth:login', {}, { username: 'alice', password: 'password' })).resolves.toBe(status);
    expect(mocks.login).toHaveBeenCalledWith('alice', 'password');
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
    const payload = { puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2, 3] };

    await expect(invoke('backend:sync', {}, payload)).resolves.toBe(result);
    expect(mocks.syncOwnedSkins).toHaveBeenCalledWith('p', 'Alice', [1, 2, 3]);
  });
});
