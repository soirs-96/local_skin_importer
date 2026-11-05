import { describe, expect, it, vi } from 'vitest';
import {
  detectLcu,
  detectLcuDeep,
  LcuNotRunningError,
  LcuUnreachableError,
  resolveLcuAuth,
  type LcuDetectionDeps
} from '../credentials';
import { FAILURE_SUMMARIES } from '../types';
import type { LcuAuth, LcuCandidate, LcuProbeOutcome } from '../types';
import type { LcuProbeResult } from '../client';

// credentials.ts → channels.ts 会 import electron 的 app。这里给个假的,
// 免得依赖真 electron 包在 node 环境下的导出形状。
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() }
}));

const AUTH: LcuAuth = { port: 1234, token: 'tok', protocol: 'https', host: '127.0.0.1' };

const CN_CMD =
  'LeagueClientUx.exe --app-port=1111 --remoting-auth-token=cnTok';
const RIOT_CMD =
  'LeagueClientUx.exe --riotclient-app-port=2222 --riotclient-auth-token=riotTok';
const BOTH_CMD =
  'LeagueClientUx.exe --app-port=1111 --remoting-auth-token=cnTok ' +
  '--riotclient-app-port=2222 --riotclient-auth-token=riotTok';

function makeDeps(overrides: Partial<LcuDetectionDeps> = {}): LcuDetectionDeps {
  const base: LcuDetectionDeps = {
    queryProcesses: vi.fn(async () => ({
      processes: [],
      exeDirs: [],
      liveProcess: false,
      detail: 'no process'
    })),
    readLockfiles: vi.fn(async () => ({ candidates: [], tried: [] })),
    readCachedPaths: vi.fn(async () => []),
    writeCachedPaths: vi.fn(async () => undefined),
    readMemoryAuth: vi.fn(() => null),
    writeMemoryAuth: vi.fn(),
    scanForClients: vi.fn(async () => ({
      candidates: [],
      paths: [],
      timedOut: false,
      detail: 'scan done'
    })),
    probe: vi.fn(async (): Promise<LcuProbeResult> => ({ outcome: 'dead' })),
    readEnvironment: vi.fn(() => ({
      proxyVars: [],
      localAppData: null,
      electron: 'test',
      node: 'test'
    }))
  };
  return { ...base, ...overrides };
}

// 候选参数在这个桩里用不到，但签名要跟 deps.probe 对得上 —— 用 _ 前缀避免 eslint 报未使用参数。
function probeBy(outcome: LcuProbeOutcome): (_c: LcuCandidate) => Promise<LcuProbeResult> {
  return async (_c: LcuCandidate) => {
    if (outcome === 'alive') {
      return { outcome: 'alive', body: { displayName: 'Tester', puuid: 'p-1' } };
    }
    return { outcome };
  };
}

describe('detectLcu', () => {
  it('有候选实测通过就返回凭据', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.auth.port).toBe(1111);
    expect(result.auth.token).toBe('cnTok');
    expect(result.summoner.displayName).toBe('Tester');
  });

  it('内存缓存命中时不查进程', async () => {
    const deps = makeDeps({
      readMemoryAuth: vi.fn(() => ({ auth: AUTH, origin: 'cn' as const, at: Date.now() })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    expect(deps.queryProcesses).not.toHaveBeenCalled();
  });

  it('内存缓存超过 60 秒就不当新鲜凭据用', async () => {
    const deps = makeDeps({
      readMemoryAuth: vi.fn(() => ({
        auth: AUTH,
        origin: 'cn' as const,
        at: Date.now() - 120_000
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    expect(deps.queryProcesses).toHaveBeenCalled();
  });

  it('国服候选优先于国际服候选', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: BOTH_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    if (!result.ok) throw new Error('expected ok');
    expect(result.auth.port).toBe(1111);
  });

  it('同一个凭据只实测一次', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      readLockfiles: vi.fn(async () => ({
        candidates: [
          {
            port: 1111,
            token: 'cnTok',
            protocol: 'https' as const,
            host: '127.0.0.1',
            origin: 'cn' as const,
            source: 'lockfile' as const
          }
        ],
        tried: ['E:\\a\\lockfile']
      })),
      probe: vi.fn(probeBy('dead'))
    });

    await detectLcu(deps);

    // 进程命令行和 lockfile 给出的是同一份凭据 —— 只该实测一次。
    const calls = vi.mocked(deps.probe).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].port).toBe(1111);
  });

  it('候选返回 401 时判为凭据失效', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('unauthorized'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('stale-credentials');
    expect(result.summary).toBe(FAILURE_SUMMARIES['stale-credentials']);
  });

  it('读到国际服目录下的 lockfile、探测不是 LCU 时判为 not-cn-client', async () => {
    // 进程命令行区分不了国服和国际服 —— 能分开的只有 lockfile 的安装路径:
    // 国际服在 `Riot Games\` 下面,国服在 `wegameapps\英雄联盟\` 下面。
    const deps = makeDeps({
      readLockfiles: vi.fn(async () => ({
        candidates: [
          {
            port: 2222,
            token: 'riotTok',
            protocol: 'https' as const,
            host: '127.0.0.1',
            origin: 'riot' as const,
            source: 'lockfile' as const
          }
        ],
        tried: ['C:\\Users\\x\\AppData\\Local\\Riot Games\\League of Legends\\lockfile']
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not-cn-client');
  });

  it('Riot 参数来自进程命令行时,不足以判成国际服客户端', async () => {
    // 国服 LeagueClientUx.exe 的命令行里本来就带 --riotclient-* 这一对参数。
    // 只凭它就告诉用户「你装的是国际服」,是在冤枉国服用户。
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: RIOT_CMD }],
        gameProcesses: [],
        exeDirs: [],
        liveProcess: false,
        detail: '只找到 1 个 Riot 客户端进程,没找到游戏客户端进程'
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).not.toBe('not-cn-client');
  });

  it('同时存在国服和国际服候选时,国际服探测失败不能判为国际服客户端', async () => {
    // 国服客户端也带 --riotclient-* 参数,把它探测失败当成国际服是在冤枉国服用户。
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: BOTH_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not-a-lcu');
  });

  it('国服端口连上的不是 LCU 时判为 not-a-lcu', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not-a-lcu');
  });

  it('有活进程但连不上判为 client-starting', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('dead'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-starting');
  });

  it('没有活进程也没有候选判为 client-not-running', async () => {
    const result = await detectLcu(makeDeps());

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-not-running');
  });

  it('进程查询失败时判为 client-query-failed,而不是「没检测到客户端」', async () => {
    // 这是用户最常踩的坑:PowerShell 被安全软件拦了,明明开着客户端却被告知没客户端。
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [],
        gameProcesses: [],
        exeDirs: [],
        liveProcess: false,
        queryFailed: true,
        detail: 'PowerShell 查询失败:超时'
      }))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-query-failed');
    expect(result.summary).toBe(FAILURE_SUMMARIES['client-query-failed']);
  });

  it('进程查询失败但扫盘找到了客户端,以扫盘结果为准', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [],
        gameProcesses: [],
        exeDirs: [],
        liveProcess: false,
        queryFailed: true,
        detail: 'PowerShell 查询失败'
      })),
      scanForClients: vi.fn(async () => ({
        candidates: [
          {
            port: 3333,
            token: 'scanTok',
            protocol: 'https' as const,
            host: '127.0.0.1',
            origin: 'cn' as const,
            source: 'disk-scan' as const
          }
        ],
        paths: ['E:\\a\\lockfile'],
        timedOut: false,
        detail: '磁盘扫描完成'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcuDeep(deps);

    if (!result.ok) throw new Error('expected ok');
    expect(result.auth.port).toBe(3333);
  });

  it('只有 Riot 客户端进程、没有游戏客户端进程时不算「客户端在跑」', async () => {
    // Riot 客户端那层进程在游戏没开的时候也在跑 —— 算成「在跑」的话,
    // 用户会被告知「找到了客户端但它还没准备好」,而实际上他根本没开游戏。
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: RIOT_CMD }],
        gameProcesses: [],
        exeDirs: [],
        liveProcess: false,
        detail: '只找到 1 个 Riot 客户端进程,没找到游戏客户端进程'
      })),
      probe: vi.fn(probeBy('dead'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-not-running');
  });

  it('浅检测不扫盘', async () => {
    const deps = makeDeps();
    await detectLcu(deps);
    expect(deps.scanForClients).not.toHaveBeenCalled();
  });

  it('深度检测才扫盘', async () => {
    const deps = makeDeps();
    await detectLcuDeep(deps);
    expect(deps.scanForClients).toHaveBeenCalled();
  });

  it('有活进程时不扫盘 —— 客户端在,只是没就绪', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      }))
    });
    await detectLcuDeep(deps);
    expect(deps.scanForClients).not.toHaveBeenCalled();
  });

  it('扫盘超时判为 scan-timeout', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [],
        paths: [],
        timedOut: true,
        detail: '磁盘扫描超时'
      }))
    });

    const result = await detectLcuDeep(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('scan-timeout');
  });

  it('扫盘找到的路径写进路径缓存', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [],
        // 缓存里存的必须是 lockfile **文件**路径 —— 下次检测要拿它去 readFile。
        paths: ['E:\\wegameapps\\英雄联盟\\lockfile'],
        timedOut: false,
        detail: '磁盘扫描完成'
      }))
    });

    await detectLcuDeep(deps);

    expect(deps.writeCachedPaths).toHaveBeenCalledWith([
      'E:\\wegameapps\\英雄联盟\\lockfile'
    ]);
  });

  it('扫盘找到的凭据也能被裁决', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [
          {
            port: 3333,
            token: 'scanTok',
            protocol: 'https' as const,
            host: '127.0.0.1',
            origin: 'cn' as const,
            source: 'disk-scan' as const
          }
        ],
        paths: ['E:\\a'],
        timedOut: false,
        detail: '磁盘扫描完成'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcuDeep(deps);

    if (!result.ok) throw new Error('expected ok');
    expect(result.auth.port).toBe(3333);
  });

  it('成功时把凭据写进内存缓存', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    await detectLcu(deps);

    expect(deps.writeMemoryAuth).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1111, token: 'cnTok' }),
      'cn'
    );
  });

  it('失败结果里带诊断明细', async () => {
    const result = await detectLcu(makeDeps());

    if (result.ok) throw new Error('unreachable');
    expect(result.diagnosis.channels.length).toBeGreaterThan(0);
    expect(result.diagnosis.environment.node).toBe('test');
  });
});

describe('resolveLcuAuth(旧接口兼容)', () => {
  it('成功时返回凭据', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    await expect(resolveLcuAuth(deps)).resolves.toEqual(
      expect.objectContaining({ port: 1111, token: 'cnTok' })
    );
  });

  it('压根没有客户端时抛 LcuNotRunningError', async () => {
    await expect(resolveLcuAuth(makeDeps())).rejects.toBeInstanceOf(LcuNotRunningError);
  });

  it('凭据失效时抛 LcuUnreachableError', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('unauthorized'))
    });

    await expect(resolveLcuAuth(deps)).rejects.toBeInstanceOf(LcuUnreachableError);
  });

  it('抛出的错误带上失败分类和中文结论', async () => {
    const err = await resolveLcuAuth(makeDeps()).catch((e: unknown) => e);
    expect((err as LcuNotRunningError).code).toBe('client-not-running');
    expect((err as LcuNotRunningError).summary).toBe(FAILURE_SUMMARIES['client-not-running']);
  });
});
