/**
 * 裁决层:候选池 → 实测 → 结论。
 *
 * 发现层(各通道)只负责吐候选,这里负责决定「哪个是真的」以及「全挂了为什么」。
 * 判定顺序是固定的 —— 顺序变了,用户看到的结论就会变。
 */
import {
  exeDerivedLockfilePaths,
  queryLcuProcesses,
  readEnvironment,
  readLockfileCandidates,
  readMemoryAuth,
  readPathCache,
  scanLockfileCandidates,
  staticLockfilePaths,
  writeMemoryAuth,
  writePathCache,
  type LockfileReadResult,
  type MemoryAuth,
  type ProcessChannelResult,
  type ScanChannelResult
} from './channels';
import { probeCandidate, toSummoner, type LcuProbeResult } from './client';
import { parseCommandLineCandidates } from './parse';
import { listDriveRoots } from './scan';
import { FAILURE_SUMMARIES } from './types';
import type {
  CurrentSummoner,
  LcuAuth,
  LcuAuthOrigin,
  LcuCandidate,
  LcuCandidateSource,
  LcuChannelReport,
  LcuDetectionResult,
  LcuDiagnosis,
  LcuEnvironment,
  LcuFailureCode,
  LcuProbeOutcome,
  LcuProbeRecord
} from './types';

/**
 * 没找到能用的客户端。
 *
 * `details` 里是各条通道各自失败的原因,`summary` 是给用户看的一句话。
 */
export class LcuNotRunningError extends Error {
  readonly details: string[];
  readonly code: LcuFailureCode;
  readonly summary: string;

  constructor(
    message = 'League client is not running.',
    details: string[] = [],
    code: LcuFailureCode = 'client-not-running',
    summary: string = message
  ) {
    super(message);
    this.name = 'LcuNotRunningError';
    this.details = details;
    this.code = code;
    this.summary = summary;
  }
}

/**
 * 找到了客户端,但连不上 —— 客户端重启过、换了端口,或者还没就绪。
 */
export class LcuUnreachableError extends Error {
  readonly code: LcuFailureCode;
  readonly summary: string;

  constructor(
    message = 'League client is not reachable.',
    code: LcuFailureCode = 'unknown',
    summary: string = message
  ) {
    super(message);
    this.name = 'LcuUnreachableError';
    this.code = code;
    this.summary = summary;
  }
}

/** 内存凭据缓存的有效期。 */
export const MEMORY_TTL_MS = 60_000;

/**
 * 裁决层依赖。全部可注入 —— 裁决逻辑是这个功能的价值所在,
 * 必须能脱离真实的 PowerShell / 磁盘 / 网络单测。
 */
export interface LcuDetectionDeps {
  queryProcesses(): Promise<ProcessChannelResult>;
  readLockfiles(paths: string[]): Promise<LockfileReadResult>;
  readCachedPaths(): Promise<string[]>;
  writeCachedPaths(paths: string[]): Promise<void>;
  readMemoryAuth(): MemoryAuth | null;
  writeMemoryAuth(auth: LcuAuth, origin: LcuAuthOrigin): void;
  scanForClients(): Promise<ScanChannelResult>;
  probe(candidate: LcuCandidate): Promise<LcuProbeResult>;
  readEnvironment(): LcuEnvironment;
}

/** 真实实现。 */
export const DEFAULT_DEPS: LcuDetectionDeps = {
  queryProcesses: queryLcuProcesses,
  readLockfiles: readLockfileCandidates,
  readCachedPaths: readPathCache,
  writeCachedPaths: writePathCache,
  readMemoryAuth,
  writeMemoryAuth,
  scanForClients: scanLockfileCandidates,
  probe: probeCandidate,
  readEnvironment
};

/** 一条候选的实测记录。 */
interface ProbeRecord {
  origin: LcuAuthOrigin;
  port: number;
  probe: LcuProbeOutcome;
  source: LcuCandidateSource;
}

/** 一个待裁决的候选批次。 */
interface CandidateStage {
  source: LcuCandidateSource;
  candidates: LcuCandidate[];
  detail: string;
  liveProcess: boolean;
  paths?: string[];
  timedOut?: boolean;
  /** PowerShell 查询失败 —— 我们根本没查成,不能断言「客户端没启动」。 */
  queryFailed?: boolean;
}

/**
 * 按优先级产出候选批次。
 *
 * 用生成器是因为「一个批次实测通过就该立刻停下来」—— 后面几条通道
 * 完全没必要跑(尤其是磁盘扫描)。
 */
async function* stageSequence(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): AsyncGenerator<CandidateStage> {
  const memory = deps.readMemoryAuth();
  const fresh = memory && Date.now() - memory.at < MEMORY_TTL_MS ? memory : null;
  const stale = memory && !fresh ? memory : null;

  // C5 内存凭据缓存(60 秒内)
  if (fresh) {
    yield {
      source: 'memory',
      candidates: [{ ...fresh.auth, origin: fresh.origin, source: 'memory' }],
      detail: '内存凭据缓存(60 秒内)',
      liveProcess: false
    };
  }

  // C1 进程命令行。国服和国际服分成两批,国服在前 —— 国际服的 Riot Client API
  // 对游戏端点一律 404,实测就能识破,但没必要让它抢在国服前面。
  //
  // **候选从全部客户端进程里取**(不只是游戏客户端那两个)—— 有的机器上
  // 持有端口的是 LeagueClient.exe 而不是 LeagueClientUx.exe,只认一个名字
  // 就等于漏掉一条能自愈的路。
  const proc = await deps.queryProcesses();
  const cnCandidates: LcuCandidate[] = [];
  const riotCandidates: LcuCandidate[] = [];
  for (const info of proc.processes) {
    for (const parsed of parseCommandLineCandidates(info.commandLine)) {
      const candidate: LcuCandidate = { ...parsed, source: 'process' };
      if (parsed.origin === 'cn') cnCandidates.push(candidate);
      else riotCandidates.push(candidate);
    }
  }
  yield {
    source: 'process',
    candidates: cnCandidates,
    detail: proc.detail,
    liveProcess: proc.liveProcess,
    queryFailed: proc.queryFailed === true
  };

  // C2 lockfile 候选集:exe 派生路径 + 常见安装位置
  const lockPaths = [
    ...exeDerivedLockfilePaths(proc.exeDirs),
    ...staticLockfilePaths(
      listDriveRoots(),
      process.env.LOCALAPPDATA ?? null,
      process.env.ProgramFiles ?? null
    )
  ];
  const lock = await deps.readLockfiles(lockPaths);
  yield {
    source: 'lockfile',
    candidates: lock.candidates,
    detail:
      lock.candidates.length > 0
        ? 'lockfile 读到 ' + lock.candidates.length + ' 份凭据'
        : '常见位置没找到 lockfile',
    liveProcess: proc.liveProcess,
    paths: lock.tried
  };

  // C4 上一次找到的路径
  const cachedPaths = await deps.readCachedPaths();
  if (cachedPaths.length > 0) {
    const cached = await deps.readLockfiles(cachedPaths);
    yield {
      source: 'cache',
      candidates: cached.candidates,
      detail:
        cached.candidates.length > 0 ? '路径缓存命中' : '路径缓存里的路径已失效',
      liveProcess: proc.liveProcess,
      paths: cached.tried
    };
  }

  // C5 内存凭据缓存(超期)。端口多半已经死了,但试一下也就一次 readFile 的成本。
  if (stale) {
    yield {
      source: 'memory',
      candidates: [{ ...stale.auth, origin: stale.origin, source: 'memory' }],
      detail: '内存凭据缓存(已超期)',
      liveProcess: false
    };
  }

  // C1 国际服命令行
  yield {
    source: 'process',
    candidates: riotCandidates,
    detail:
      riotCandidates.length > 0 ? '国际服命令行候选' : '没有国际服命令行候选',
    liveProcess: proc.liveProcess
  };

  // C3 磁盘扫描。只在深度检测里跑。
  //
  // **不再要求「没有活进程」了** —— 那个假设是错的:
  // 「进程在跑」只说明客户端活着,不代表我们知道它的端口在哪。
  // 用户把游戏装在 F 盘自定义目录、或者客户端以管理员身份运行(读不到命令行)
  // 时,前面几条通道一个候选都吐不出来,扫盘是最后一条能拿到凭据的路 ——
  // 恰好在这个场景下被跳过,用户就永远卡在「找到了客户端但还没准备好」。
  //
  // 扫到的路径会写进路径缓存(C4),所以「用户手点一次深检测」之后,后面的
  // 浅检测(轮询器、图标代理)也能通过 C4 通道找到同一个客户端 —— 不需要每轮扫全盘。
  if (allowDiskScan) {
    const scan = await deps.scanForClients();
    yield {
      source: 'disk-scan',
      candidates: scan.candidates,
      detail: scan.detail,
      liveProcess: proc.liveProcess,
      paths: scan.paths,
      timedOut: scan.timedOut
    };
  }
}

/** 失败分类。顺序固定 —— 改了顺序,用户看到的结论就变了。 */
function classify(
  records: ProbeRecord[],
  liveProcess: boolean,
  scanTimedOut: boolean,
  queryFailed: boolean
): LcuFailureCode {
  /**
   * 有没有国服候选(`--app-port` + `--remoting-auth-token`,或国服目录下的 lockfile)。
   *
   * 只要有一个,就说明这台机器上装的是国服客户端 —— 「装的是国际服客户端」
   * 这个结论不成立。
   */
  const hasCnCandidate = records.some((r) => r.origin === 'cn');

  if (records.some((r) => r.probe === 'unauthorized')) return 'stale-credentials';
  /**
   * 「装的是国际服客户端」需要**同时**满足两个前提:
   *   1. 一个国服候选都没有;
   *   2. 有一条 **lockfile 通道**读出来的 Riot 候选,探测下来不是游戏客户端接口。
   *
   * 前提 2 是国服优先的关键。进程命令行区分不了国服和国际服 ——
   * 国服 `LeagueClientUx.exe` 的命令行里本来就带 `--riotclient-*` 这一对参数,
   * 只看「有没有国服候选」会把国服用户判成国际服。能分开的只有 lockfile 的
   * **安装路径**:国服在 `wegameapps\英雄联盟\`,国际服在 `Riot Games\`。
   * 读到 Riot 目录下的 lockfile,才是「这台机器装的是国际服客户端」的硬证据。
   */
  if (
    !hasCnCandidate &&
    records.some((r) => r.origin === 'riot' && r.source === 'lockfile' && r.probe === 'not-lcu')
  ) {
    return 'not-cn-client';
  }
  if (hasCnCandidate && records.some((r) => r.origin === 'cn' && r.probe === 'not-lcu')) {
    return 'not-a-lcu';
  }
  if (liveProcess) {
    /**
     * 进程在,但没连上 —— 要分三种,给的下一步完全不同:
     *
     *   - **一条候选都没拿到**:我们压根不知道它的端口在哪。多半是客户端
     *     以管理员身份运行的(读不到它的命令行),也可能是国服这个版本
     *     不写标准 lockfile。→ 让用户「以管理员身份运行本程序」。
     *   - **候选都探测成 dead**:端口没在监听。→ 让用户等 / 重启客户端。
     *   - **其它**(连上了但请求超时、5xx):客户端还没就绪。→ 等 5 秒。
     *
     * 以前这三样都报「等 5 秒再点检测」—— 对第一种情况那句话完全没用,
     * 用户会一直等下去。
     */
    if (records.length === 0) return 'client-credentials-unavailable';
    if (records.every((r) => r.probe === 'dead')) return 'client-starting';
    return 'client-not-ready';
  }
  // 查询本身失败 —— 我们没查成,不能断言「客户端没启动」。
  if (queryFailed) return 'client-query-failed';
  if (scanTimedOut) return 'scan-timeout';
  return 'client-not-running';
}

/** LCU 在没登录召唤师时返回 `{}` —— 那也是有效凭据,只是没有召唤师信息。 */
function safeSummoner(body: unknown): CurrentSummoner {
  try {
    return toSummoner(body);
  } catch {
    return { displayName: '', puuid: '' };
  }
}

async function detectInner(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): Promise<LcuDetectionResult> {
  const records: ProbeRecord[] = [];
  const reports: LcuChannelReport[] = [];
  const probed = new Set<string>();
  let liveProcess = false;
  let scanTimedOut = false;
  let queryFailed = false;

  // 每条通道说了什么都打出来 —— 用户报障时截图就有用了,
  // 不用再让人去开发者面板里翻「复制诊断信息」。
  console.info('[LCU] 开始检测 · 深检测=' + (allowDiskScan ? '是' : '否'));

  for await (const stage of stageSequence(deps, allowDiskScan)) {
    console.info(
      '[LCU] 通道 ' +
        stage.source +
        ' · ' +
        stage.detail +
        ' · 候选 ' +
        stage.candidates.length +
        (stage.liveProcess ? ' · 客户端进程在跑' : '')
    );

    if (stage.liveProcess) liveProcess = true;
    if (stage.timedOut) scanTimedOut = true;
    if (stage.queryFailed) queryFailed = true;

    if (stage.source === 'disk-scan' && stage.paths && stage.paths.length > 0) {
      // 扫到的路径存下来,下次检测就不用再扫一遍。
      await deps.writeCachedPaths(stage.paths);
    }

    const probeRecords: LcuProbeRecord[] = [];

    for (const candidate of stage.candidates) {
      const key = candidate.host + ':' + candidate.port + ':' + candidate.token;
      if (probed.has(key)) continue;
      probed.add(key);

      const result = await deps.probe(candidate);
      console.info(
        '[LCU] 探测 端口' + candidate.port + '(' + candidate.origin + ') → ' + result.outcome
      );
      records.push({
        origin: candidate.origin,
        port: candidate.port,
        probe: result.outcome,
        source: candidate.source
      });
      probeRecords.push({
        port: candidate.port,
        origin: candidate.origin,
        probe: result.outcome
      });

      if (result.outcome !== 'alive') continue;

      const auth: LcuAuth = {
        port: candidate.port,
        token: candidate.token,
        protocol: candidate.protocol,
        host: candidate.host
      };
      deps.writeMemoryAuth(auth, candidate.origin);
      const summoner = safeSummoner(result.body);
      console.info(
        '[LCU] 检测成功 · 端口 ' +
          candidate.port +
          ' · 来源 ' +
          stage.source +
          ' · 召唤师 ' +
          summoner.displayName
      );
      reports.push({
        source: stage.source,
        ok: true,
        liveProcess: stage.liveProcess,
        detail: stage.detail,
        candidates: probeRecords,
        paths: stage.paths
      });
      return { ok: true, auth, summoner };
    }

    reports.push({
      source: stage.source,
      ok: false,
      liveProcess: stage.liveProcess,
      detail: stage.detail,
      candidates: probeRecords,
      paths: stage.paths
    });
  }

  const code = classify(records, liveProcess, scanTimedOut, queryFailed);
  const summary = FAILURE_SUMMARIES[code];
  console.warn('[LCU] 检测失败 · ' + code + ' · ' + summary);
  const diagnosis: LcuDiagnosis = {
    code,
    summary,
    channels: reports,
    environment: deps.readEnvironment()
  };
  return { ok: false, code, summary, diagnosis };
}

async function runDetection(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): Promise<LcuDetectionResult> {
  try {
    return await detectInner(deps, allowDiskScan);
  } catch (e: unknown) {
    // 异常路径也要留痕 —— 不然开发日志控制台里什么都看不到,
    // 只剩一句「检测失败」,等于什么线索都没留下。
    console.warn('[LCU] 检测过程抛出异常', e);
    const summary = FAILURE_SUMMARIES.unknown;
    const diagnosis: LcuDiagnosis = {
      code: 'unknown',
      summary,
      channels: [],
      environment: {
        proxyVars: [],
        localAppData: process.env.LOCALAPPDATA ?? null,
        electron: process.versions.electron ?? 'unknown',
        node: process.versions.node
      },
      error: e instanceof Error ? e.message : String(e)
    };
    return { ok: false, code: 'unknown', summary, diagnosis };
  }
}

/** 浅检测:不扫盘。用户点一下按钮的量级。 */
export async function detectLcu(
  deps: LcuDetectionDeps = DEFAULT_DEPS
): Promise<LcuDetectionResult> {
  return runDetection(deps, false);
}

/** 深度检测:允许扫盘。客户端装在非标准位置时的兜底。 */
export async function detectLcuDeep(
  deps: LcuDetectionDeps = DEFAULT_DEPS
): Promise<LcuDetectionResult> {
  return runDetection(deps, true);
}

/** 把失败结果翻译成旧接口要的异常。 */
function toError(result: Extract<LcuDetectionResult, { ok: false }>): Error {
  const details = result.diagnosis.channels.map((c) => c.source + ': ' + c.detail);
  switch (result.code) {
    case 'client-not-running':
    case 'not-cn-client':
    case 'scan-timeout':
      return new LcuNotRunningError(result.summary, details, result.code, result.summary);
    default:
      return new LcuUnreachableError(result.summary, result.code, result.summary);
  }
}

/** 解析出能连上的凭据。失败时抛错 —— 旧接口的语义。 */
export async function resolveLcuAuth(deps: LcuDetectionDeps = DEFAULT_DEPS): Promise<LcuAuth> {
  const result = await detectLcu(deps);
  if (result.ok) return result.auth;
  throw toError(result);
}

/**
 * {@link resolveLcuAuth} 的异步别名。
 *
 * 旧代码里这两个是「同步 / 异步」之分(同步那个用 execSync 会卡主进程),
 * 现在两个都是异步的,控制流不用改。
 */
export async function resolveLcuAuthAsync(deps: LcuDetectionDeps = DEFAULT_DEPS): Promise<LcuAuth> {
  return resolveLcuAuth(deps);
}

/**
 * 进程内共享的 LCU 凭据。
 *
 * 轮询器解析一次就会缓存住,别的模块(比如图标代理)直接取这份就行 ——
 * 不用各自去 spawn 一个 PowerShell 查进程命令行。
 */
let sharedAuth: LcuAuth | null = null;

export function setSharedLcuAuth(auth: LcuAuth | null): void {
  sharedAuth = auth;
}

export function getSharedLcuAuth(): LcuAuth | null {
  return sharedAuth;
}

export function invalidateSharedLcuAuth(): void {
  sharedAuth = null;
}
