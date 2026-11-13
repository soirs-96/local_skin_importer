import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { DevLogLine } from '../../shared/dev';
import * as auth from '../auth';
import { syncOwnedSkins } from '../backend';
import { registerIpcHandlers } from '../ipc';

const mocks = vi.hoisted(() => {
  class MockLcuNotRunningError extends Error {
    readonly details: string[];

    constructor(message = 'League client is not running', details: string[] = []) {
      super(message);
      this.name = 'LcuNotRunningError';
      this.details = details;
    }
  }

  class MockLcuUnreachableError extends Error {
    constructor(message = 'League client is not reachable') {
      super(message);
      this.name = 'LcuUnreachableError';
    }
  }

  return {
    ipcMainHandle: vi.fn(),
    ipcRendererInvoke: vi.fn(),
    exposeInMainWorld: vi.fn(),
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => []),
    clipboardWriteText: vi.fn(),
    resolveLcuAuth: vi.fn(),
    detectLcu: vi.fn(),
    detectLcuDeep: vi.fn(),
    createLcuClient: vi.fn(),
    getCurrentSummoner: vi.fn(),
    getInventoryOwnedSkinIds: vi.fn(),
    getStoreOwnedSkinIds: vi.fn(),
    resolveOwnedSkinIds: vi.fn(),
    LcuNotRunningError: MockLcuNotRunningError,
    LcuUnreachableError: MockLcuUnreachableError,
    redeemSyncCode: vi.fn(),
    saveToken: vi.fn(),
    getAuthStatus: vi.fn(),
    clearStoredToken: vi.fn(),
    getStoredToken: vi.fn(),
    syncOwnedSkins: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchMyOwned: vi.fn(),
    readSyncState: vi.fn(),
    writeSyncState: vi.fn(),
    matchPollerStart: vi.fn(),
    matchPollerGetSnapshot: vi.fn(),
    matchPollerRefreshNow: vi.fn(),
    matchPollerSubscribe: vi.fn(),
    matchPollerLookupPlayer: vi.fn(),
    matchPollerFetchOpponents: vi.fn(),
    getRecommendationState: vi.fn(),
    requestRecommendation: vi.fn(),
    getLlmStatus: vi.fn(),
    saveLlmApiKey: vi.fn(),
    clearLlmApiKey: vi.fn(),
    devLoggerAttach: vi.fn(),
    devLoggerDetach: vi.fn(),
    devLoggerTakeBacklog: vi.fn((_afterSeq: number): DevLogLine[] => [])
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle },
  ipcRenderer: { invoke: mocks.ipcRendererInvoke },
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
    getAllWindows: mocks.getAllWindows
  },
  clipboard: { writeText: mocks.clipboardWriteText }
}));

vi.mock('../lcu', () => ({
  resolveLcuAuth: mocks.resolveLcuAuth,
  detectLcu: mocks.detectLcu,
  detectLcuDeep: mocks.detectLcuDeep,
  createLcuClient: mocks.createLcuClient,
  getCurrentSummoner: mocks.getCurrentSummoner,
  getInventoryOwnedSkinIds: mocks.getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds: mocks.getStoreOwnedSkinIds,
  LcuNotRunningError: mocks.LcuNotRunningError,
  LcuUnreachableError: mocks.LcuUnreachableError
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

// 轮询器会去真的连 LCU / 拉 DDragon,单测里必须换掉。
vi.mock('../match/poller', () => ({
  matchPoller: {
    start: mocks.matchPollerStart,
    stop: vi.fn(),
    getSnapshot: mocks.matchPollerGetSnapshot,
    refreshNow: mocks.matchPollerRefreshNow,
    subscribe: mocks.matchPollerSubscribe,
    lookupPlayer: mocks.matchPollerLookupPlayer,
    fetchOpponents: mocks.matchPollerFetchOpponents
  }
}));

vi.mock('../match/recommendationService', () => ({
  getRecommendationState: mocks.getRecommendationState,
  requestRecommendation: mocks.requestRecommendation
}));

vi.mock('../llm', () => ({
  getLlmStatus: mocks.getLlmStatus,
  saveLlmApiKey: mocks.saveLlmApiKey,
  clearLlmApiKey: mocks.clearLlmApiKey
}));

vi.mock('../devLogger', () => ({
  attachConsole: mocks.devLoggerAttach,
  detachConsole: mocks.devLoggerDetach,
  takeConsoleBacklog: mocks.devLoggerTakeBacklog
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
  attachConsole: (afterSeq?: number) => unknown;
  detachConsole: () => unknown;
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
    mocks.resolveLcuAuth.mockReset();
    mocks.detectLcu.mockReset();
    mocks.detectLcuDeep.mockReset();
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
    mocks.matchPollerStart.mockReset();
    mocks.matchPollerGetSnapshot.mockReset();
    mocks.matchPollerRefreshNow.mockReset();
    mocks.matchPollerSubscribe.mockReset();
    mocks.matchPollerLookupPlayer.mockReset();
    mocks.matchPollerFetchOpponents.mockReset();
    mocks.getRecommendationState.mockReset();
    mocks.requestRecommendation.mockReset();
    mocks.getLlmStatus.mockReset();
    mocks.saveLlmApiKey.mockReset();
    mocks.clearLlmApiKey.mockReset();
    mocks.devLoggerAttach.mockReset();
    mocks.devLoggerDetach.mockReset();
    mocks.devLoggerTakeBacklog.mockReset();
    mocks.devLoggerTakeBacklog.mockReturnValue([]);
    mocks.getFocusedWindow.mockReset();
    mocks.clipboardWriteText.mockReset();
    mocks.readSyncState.mockReturnValue({ lastSyncAt: null });
    mocks.matchPollerSubscribe.mockReturnValue(() => undefined);
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
    api.attachConsole(5);
    api.detachConsole();

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
      ['dev:copy-text', '诊断信息'],
      ['dev:console-attach', 5],
      ['dev:console-detach']
    ]);
  });

  it('registers all 22 ipc channels on call to registerIpcHandlers', () => {
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
      'dev:copy-text',
      'dev:console-attach',
      'dev:console-detach',
      'match:get-state',
      'match:refresh',
      'match:get-top-champions',
      'match:lookup-player',
      'match:get-opponents',
      'match:get-recommendation',
      'match:recommend',
      'llm:get-status',
      'llm:set-key',
      'llm:clear-key'
    ]);
  });

  it('lcu:check-status returns running true with the current summoner', async () => {
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    mocks.detectLcu.mockResolvedValue({
      ok: true,
      auth: { port: 1234, token: 'secret', protocol: 'https', host: '127.0.0.1' },
      summoner
    });

    await expect(invoke('lcu:check-status')).resolves.toEqual({
      running: true,
      port: 1234,
      summoner
    });
  });

  it('lcu:check-status reports the failure code and the plain-language summary', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'client-not-running',
      summary: '没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。',
      diagnosis: {
        code: 'client-not-running',
        summary: '没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as {
      running: boolean;
      code?: string;
      summary?: string;
    };
    expect(outcome.running).toBe(false);
    expect(outcome.code).toBe('client-not-running');
    expect(outcome.summary).toContain('没检测到');
  });

  it('lcu:check-status without the deep flag only runs the shallow detection', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'client-not-running',
      summary: 'x',
      diagnosis: {
        code: 'client-not-running',
        summary: 'x',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    await invoke('lcu:check-status', {});

    expect(mocks.detectLcu).toHaveBeenCalled();
    expect(mocks.detectLcuDeep).not.toHaveBeenCalled();
  });

  it('lcu:check-status with the deep flag runs the deep detection', async () => {
    mocks.detectLcuDeep.mockResolvedValue({
      ok: false,
      code: 'scan-timeout',
      summary: '没在常见位置找到客户端 —— 可能装在非标准位置。',
      diagnosis: {
        code: 'scan-timeout',
        summary: '没在常见位置找到客户端 —— 可能装在非标准位置。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status', {}, true)) as { code?: string };
    expect(mocks.detectLcuDeep).toHaveBeenCalled();
    expect(mocks.detectLcu).not.toHaveBeenCalled();
    expect(outcome.code).toBe('scan-timeout');
  });

  it('lcu:check-status reports stale credentials in plain language', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'stale-credentials',
      summary: '客户端重启过、凭据失效 —— 点检测重试。',
      diagnosis: {
        code: 'stale-credentials',
        summary: '客户端重启过、凭据失效 —— 点检测重试。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as {
      running: boolean;
      code?: string;
      summary?: string;
    };
    expect(outcome.running).toBe(false);
    expect(outcome.code).toBe('stale-credentials');
    expect(outcome.summary).toBe('客户端重启过、凭据失效 —— 点检测重试。');
  });

  it('lcu:check-status reports not-cn-client for the international client', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'not-cn-client',
      summary: '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
      diagnosis: {
        code: 'not-cn-client',
        summary: '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as { code?: string; summary?: string };
    expect(outcome.code).toBe('not-cn-client');
    expect(outcome.summary).toContain('国际服');
  });

  it('lcu:fetch-skins returns the summoner and owned skin IDs', async () => {
    const client = {} as AxiosInstance;
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    mocks.resolveLcuAuth.mockResolvedValue({
      port: 1234,
      token: 'secret',
      protocol: 'https',
      host: '127.0.0.1'
    });
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
    expect(mocks.createLcuClient).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1234, token: 'secret' })
    );
  });

  it('lcu:fetch-skins propagates LCU-not-detected error as a real Error', async () => {
    mocks.resolveLcuAuth.mockRejectedValue(new mocks.LcuNotRunningError());

    const err = await invoke('lcu:fetch-skins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // 界面直接弹给用户看,所以得是人话,不是英文原文
    expect((err as Error).message).toMatch(/游戏客户端/);
    expect((err as Error).name).toBe('LcuNotRunningError');
  });

  it('lcu:fetch-skins turns a refused connection into a readable message', async () => {
    mocks.resolveLcuAuth.mockResolvedValue({
      port: 1234,
      token: 'secret',
      protocol: 'https',
      host: '127.0.0.1'
    });
    mocks.createLcuClient.mockReturnValue({} as AxiosInstance);
    mocks.getCurrentSummoner.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:55102'), {
        isAxiosError: true,
        name: 'AxiosError',
        code: 'ECONNREFUSED'
      })
    );

    const err = await invoke('lcu:fetch-skins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/游戏客户端/);
    expect((err as Error).message).not.toMatch(/55102/);
    expect((err as Error & { code?: string }).code).toBe('ECONNREFUSED');
  });

  it('lcu:fetch-skins explains an unreachable client port in plain language', async () => {
    mocks.resolveLcuAuth.mockRejectedValue(new mocks.LcuUnreachableError());

    const err = await invoke('lcu:fetch-skins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/游戏客户端/);
    expect((err as Error).name).toBe('LcuUnreachableError');
    expect((err as Error & { code?: string }).code).toBe('LCU_UNREACHABLE');
  });

  it('lcu:fetch-skins throws a real Error (not a plain object) on axios failures', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 500, data: { message: 'oops' } },
      code: 'ERR_BAD_RESPONSE'
    });
    mocks.resolveLcuAuth.mockResolvedValue({
      port: 1234,
      token: 'secret',
      protocol: 'https',
      host: '127.0.0.1'
    });
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
      [1, 2, 3],
      []
    );
    expect(mocks.writeSyncState).toHaveBeenCalledOnce();
  });

  it('backend:sync forwards the top champions to the backend', async () => {
    mocks.syncOwnedSkins.mockResolvedValue({ added: 0, updated: 0, totalOwned: 0 });
    const topChampions = [
      { championId: 1, championName: '安妮', championNameEn: 'Annie', championPoints: 231381 }
    ];

    await invoke('backend:sync', {}, {
      puuid: 'p'.padEnd(32, 'x'),
      summonerName: 'Alice',
      ownedSkinIds: [1],
      topChampions
    });

    expect(mocks.syncOwnedSkins).toHaveBeenCalledWith(
      'p'.padEnd(32, 'x'),
      'Alice',
      [1],
      topChampions
    );
  });

  it('backend:sync rejects a malformed top champions list', async () => {
    await expect(
      invoke('backend:sync', {}, {
        puuid: 'p'.padEnd(32, 'x'),
        summonerName: 'Alice',
        ownedSkinIds: [1],
        topChampions: [{ championId: 'x' }]
      })
    ).rejects.toThrow(/topChampions/);
    expect(mocks.syncOwnedSkins).not.toHaveBeenCalled();
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

  it('dev:console-attach hangs the listener on and hands back the backlog', async () => {
    const backlog: DevLogLine[] = [{ seq: 1, ts: 1000, level: 'INFO', src: 'main', msg: '启动完成' }];
    mocks.devLoggerTakeBacklog.mockReturnValue(backlog);

    await expect(invoke('dev:console-attach', {}, 7)).resolves.toEqual(backlog);
    expect(mocks.devLoggerAttach).toHaveBeenCalledOnce();
    expect(mocks.devLoggerTakeBacklog).toHaveBeenCalledWith(7);
  });

  it('dev:console-attach defaults to the whole backlog when no cursor is given', async () => {
    await invoke('dev:console-attach', {});
    expect(mocks.devLoggerTakeBacklog).toHaveBeenCalledWith(0);
  });

  it('dev:console-detach releases the listener', async () => {
    await expect(invoke('dev:console-detach', {})).resolves.toEqual({ ok: true });
    expect(mocks.devLoggerDetach).toHaveBeenCalledOnce();
  });

  it('match:get-state wakes the poller up and returns the current snapshot', async () => {
    const snapshot = { state: 'idle', summoner: null, live: null, champSelect: null, ranked: [], recent: null, lastError: null, updatedAt: 0 };
    mocks.matchPollerGetSnapshot.mockReturnValue(snapshot);

    expect(await invoke('match:get-state')).toEqual(snapshot);
    expect(mocks.matchPollerStart).toHaveBeenCalledOnce();
  });

  it('match:refresh re-collects and returns the fresh snapshot', async () => {
    const snapshot = { state: 'lobby', summoner: null, live: null, champSelect: null, ranked: [], recent: null, lastError: null, updatedAt: 1 };
    mocks.matchPollerRefreshNow.mockResolvedValue(snapshot);

    expect(await invoke('match:refresh')).toEqual(snapshot);
    expect(mocks.matchPollerStart).toHaveBeenCalledOnce();
  });

  it('match:get-recommendation returns the recommendation kept in the main process', async () => {
    const state = { markdown: '## 主推英雄', usedFallback: false, error: null, inflight: false, generatedAt: 5 };
    mocks.getRecommendationState.mockReturnValue(state);

    expect(await invoke('match:get-recommendation')).toEqual(state);
  });

  it('match:recommend refuses to run outside champ select', async () => {
    mocks.matchPollerGetSnapshot.mockReturnValue({ champSelect: null });

    await expect(invoke('match:recommend')).rejects.toThrow(/英雄选择/);
    expect(mocks.requestRecommendation).not.toHaveBeenCalled();
  });

  it('match:recommend asks the service for the current session', async () => {
    const session = { myTeam: [], theirTeam: [], myRole: 'MIDDLE', myChampionId: 1, myCellId: 3, bannedChampions: [] };
    const state = { markdown: 'x', usedFallback: false, error: null, inflight: false, generatedAt: 1 };
    mocks.matchPollerGetSnapshot.mockReturnValue({ champSelect: session });
    mocks.requestRecommendation.mockResolvedValue(state);

    expect(await invoke('match:recommend')).toEqual(state);
    expect(mocks.requestRecommendation).toHaveBeenCalledWith(session, 'MIDDLE');
  });

  it('match:lookup-player forwards the query to the poller', async () => {
    const result = {
      query: '林俊杰#18557',
      found: true,
      riotId: '林俊杰#18557',
      displayName: '林俊杰',
      tagLine: '18557',
      summonerId: 17785561676,
      puuid: 'puuid-1',
      summonerLevel: 300,
      rankedDisplay: '荣耀黄金 III',
      isSelf: false,
      games: null,
      gamesError: null,
      error: null
    };
    mocks.matchPollerLookupPlayer.mockResolvedValue(result);

    expect(await invoke('match:lookup-player', {}, { query: '林俊杰#18557' })).toEqual(result);
    expect(mocks.matchPollerLookupPlayer).toHaveBeenCalledWith('林俊杰#18557');
  });

  it('match:lookup-player rejects a payload without a string query', async () => {
    await expect(invoke('match:lookup-player', {}, { query: 42 })).rejects.toThrow('invalid query');
    expect(mocks.matchPollerLookupPlayer).not.toHaveBeenCalled();
  });

  it('match:get-opponents returns the two teams of the current game', async () => {
    const snapshot = {
      phase: 'InProgress',
      queueType: 'CLASSIC',
      inGame: true,
      opponents: [{ summonerId: 1, puuid: 'p1', summonerName: '对手甲', championId: 523, championName: '亚索', championIconUrl: null, side: 'enemy', isSelf: false }]
    };
    mocks.matchPollerFetchOpponents.mockResolvedValue(snapshot);

    expect(await invoke('match:get-opponents')).toEqual(snapshot);
  });

  it('llm:set-key saves the key and returns the refreshed status', async () => {
    const status = { configured: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persisted: true };
    mocks.getLlmStatus.mockReturnValue(status);

    expect(await invoke('llm:set-key', {}, { apiKey: 'sk-test' })).toEqual(status);
    expect(mocks.saveLlmApiKey).toHaveBeenCalledWith('sk-test');
  });

  it('llm:set-key rejects a payload without a string apiKey', async () => {
    await expect(invoke('llm:set-key', {}, { apiKey: 42 })).rejects.toThrow('invalid apiKey');
    expect(mocks.saveLlmApiKey).not.toHaveBeenCalled();
  });

  it('llm:clear-key wipes the stored key', async () => {
    const status = { configured: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persisted: true };
    mocks.getLlmStatus.mockReturnValue(status);

    expect(await invoke('llm:clear-key')).toEqual(status);
    expect(mocks.clearLlmApiKey).toHaveBeenCalledOnce();
  });
});
