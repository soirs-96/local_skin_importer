/**
 * 发现通道:只负责**吐候选**,不做裁决。
 *
 * 裁决在 credentials.ts。这里每条通道失败都不抛错 —— 失败也是一种结论
 * (「查不到进程」和「查到了但连不上」要分开报),统一收进 detail。
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import {
  executableDirOf,
  GAME_CLIENT_PROCESS_NAMES,
  isGameClientProcess,
  LCU_PROCESS_NAMES,
  parseLockfileText,
  parseProcessOutput,
  type LcuProcessInfo
} from './parse';
import {
  FAST_SCAN_BUDGET_MS,
  listDriveRoots,
  PERMISSIVE_SCAN_BUDGET_MS,
  scanForLockfiles,
  scanForLockfilesPermissive
} from './scan';
import type { LcuAuth, LcuAuthOrigin, LcuCandidate, LcuEnvironment } from './types';

/**
 * 进程查询脚本(WMI 版)。
 *
 * 一次查询把四个客户端相关进程名全捞出来(用 OR 连起来)—— 一次 spawn 的成本,
 * 不能为了多查一个名字就多开一次 PowerShell。
 *
 * 输出走 base64 —— 安装路径可能是中文(`E:\wegameapps\英雄联盟\`),
 * 直接走管道会被控制台代码页毁掉。base64 是纯 ASCII,不受影响。
 *
 * 错误要分三种,脚本里必须自己分:
 *
 *   · 「一个都没匹配到」—— `Get-CimInstance -Filter` 找不到东西时**自己就会报**
 *     "No matching MSFT_CimInstance objects found"。这不是失败,客户端就是没开。
 *   · 「查询本身失败」—— WMI 被安全软件或系统策略拦了、服务没起来。
 *     这才是失败,必须以非零码退出,否则用户明明开着客户端却被告知
 *     「先打开客户端再点检测」。
 *   · 「看到了进程,但读不到它们的路径和命令行」—— 客户端的权限等级比本程序高
 *     (比如客户端是管理员启动的)时,WMI 的 `ExecutablePath` / `CommandLine`
 *     会返回空。**这一条最坑**:进程明明在跑,却因为读不出详情而被当成
 *     「压根没有这个进程」,用户会被告知「先打开客户端再点检测」。
 *
 * 脚本里只能写 ASCII —— 脚本是从 stdin 喂给 PowerShell 的,输入编码跟着
 * 控制台代码页走,中文常量会被读成乱码。中文结论由 TS 层翻译(见
 * {@link explainQueryError})。
 *
 * 「权限不足」的判断**只看游戏客户端那两个进程**:Riot 的系统级服务进程
 * (`RiotClientServices.exe`)对普通用户也是读不到路径的,但它跟游戏在不在
 * 没关系 —— 拿它来判定会把「客户端确实没开」误报成「权限不足」。
 */
export const PS_QUERY_SCRIPT =
  '$ErrorActionPreference = "SilentlyContinue"; $errs = @(); ' +
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
  `$procs = @(Get-CimInstance Win32_Process -Filter "${LCU_PROCESS_NAMES.map(
    (n) => `Name='${n}'`
  ).join(' OR ')}" -ErrorAction SilentlyContinue -ErrorVariable errs); ` +
  'if ($errs.Count -gt 0) { ' +
  '$id = [string]$errs[0].FullyQualifiedErrorId; ' +
  '$msg = [string]$errs[0].Exception.Message; ' +
  'if (($id -notlike "*NoMatch*") -and ($id -notlike "*NoMSFT*") -and ($msg -notlike "*No matching*")) { ' +
  '[Console]::Error.WriteLine("LCU_QUERY_ERROR: " + $msg); exit 1 } }; ' +
  '$readable = @(); $gameSeen = 0; $gameReadable = 0; ' +
  'foreach ($p in $procs) { ' +
  `$isGame = (${GAME_CLIENT_PROCESS_NAMES.map((n) => `$p.Name -eq '${n}'`).join(
    ' -or '
  )}); ` +
  '$ok = [bool]($p.ExecutablePath -or $p.CommandLine); ' +
  'if ($isGame) { $gameSeen = $gameSeen + 1; if ($ok) { $gameReadable = $gameReadable + 1 } }; ' +
  'if ($ok) { $readable = $readable + @($p) } }; ' +
  'if ($gameSeen -gt 0 -and $gameReadable -eq 0) { ' +
  '[Console]::Error.WriteLine("LCU_QUERY_ERROR: PERMISSION"); exit 1 }; ' +
  'foreach ($p in $readable) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(' +
  '($p.ExecutablePath + [char]31 + $p.CommandLine))) }';

/**
 * 不走 WMI 的进程查询(兜底)。
 *
 * `Get-CimInstance` 走 WMI —— 有些机器上 WMI 被安全软件或系统策略拦了。
 * `Get-Process` 走系统进程 API,不经过 WMI,拿它兜底。
 *
 * 只吐 exe 路径(拿不到命令行)—— 但路径就够了:lockfile 就在 exe 旁边,
 * 推得出安装目录,读 lockfile 就能拿到完整凭据。
 *
 * 同样要分「一个都没看到」和「看到了但读不到路径」:后者是权限问题
 * (`Get-Process.Path` 读管理员进程一样抛错),必须报成查询失败,
 * 不能当成「客户端没开」。判定同样只看游戏客户端那两个进程。
 *
 * 输出格式跟主查询一样(路径 + 分隔符),所以能复用同一个解析器。
 */
export const PS_FALLBACK_SCRIPT =
  '$ErrorActionPreference = "SilentlyContinue"; ' +
  `$procs = @(Get-Process -Name ${LCU_PROCESS_NAMES.map((n) =>
    n.replace(/\.exe$/i, '')
  ).join(',')} -ErrorAction SilentlyContinue); ` +
  '$readable = @(); $gameSeen = 0; $gameReadable = 0; ' +
  'foreach ($p in $procs) { ' +
  `$isGame = (${GAME_CLIENT_PROCESS_NAMES.map(
    (n) => `$p.ProcessName -eq '${n.replace(/\.exe$/i, '')}'`
  ).join(' -or ')}); ` +
  '$path = ""; try { $path = $p.Path } catch { $path = "" }; ' +
  'if ($isGame) { $gameSeen = $gameSeen + 1; if ($path) { $gameReadable = $gameReadable + 1 } }; ' +
  'if ($path) { $readable = $readable + @($path) } }; ' +
  'if ($gameSeen -gt 0 -and $gameReadable -eq 0) { ' +
  '[Console]::Error.WriteLine("LCU_QUERY_ERROR: PERMISSION"); exit 1 }; ' +
  'foreach ($path in $readable) { ' +
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($path + [char]31)) }';

/** PowerShell 查询超时。 */
export const PS_TIMEOUT_MS = 10_000;

/** lockfile 可能正在被写,读不到就重试几次。 */
export const LOCKFILE_RETRY_COUNT = 3;

/** 重试间隔。 */
export const LOCKFILE_RETRY_DELAY_MS = 200;

/**
 * PowerShell 脚本里的权限不足标记。
 *
 * 脚本只能写 ASCII(见 {@link PS_QUERY_SCRIPT}),中文结论在这儿翻译。
 */
export const PERMISSION_MARKER = 'LCU_QUERY_ERROR: PERMISSION';

/**
 * 把 PowerShell 的原始报错翻成人能懂的话。
 *
 * 权限不足单独翻译 —— 它不是「查询失败了」这种泛泛的话,而是有一个明确的
 * 用户侧解法(用管理员身份跑本程序,或者把客户端降权启动)。
 */
export function explainQueryError(raw: string): string {
  if (raw.includes(PERMISSION_MARKER)) {
    return '看到了客户端进程,但读不到它的路径和命令行 —— 权限不足(客户端是不是以管理员身份运行的?)';
  }
  return raw;
}

/** 把异常变成一句能给人看的话。 */
function describeError(e: unknown): string {
  return explainQueryError(e instanceof Error ? e.message : String(e));
}

/**
 * 跑一段 PowerShell 脚本并拿回 stdout。
 *
 * 用 spawn 而不是 execSync:execSync 会把 Electron 主进程卡住最多 10 秒,
 * 界面会跟着一起卡。
 */
export function runPowerShell(script: string, timeoutMs = PS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let out = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('PowerShell query timed out.')));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (e: Error) => {
      clearTimeout(timer);
      finish(() => reject(new Error('PowerShell query failed: ' + e.message)));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        finish(() =>
          reject(new Error('PowerShell exited with ' + (code ?? 'null') + ': ' + stderr.trim()))
        );
        return;
      }
      /**
       * **没有 stdout 但 stderr 有内容 = 查询没查成**,不是「查到了 0 条」。
       *
       * 这一条是双保险:脚本里已经用 try/catch 把错误变成非零退出码了,
       * 但万一错误是以别的方式冒出来的(比如 PowerShell 把错误记录写进了
       * stdout),只看退出码就会把「没查成」误判成「客户端没启动」——
       * 给用户一句「先打开客户端再点检测」,而他客户端明明开着。
       */
      if (!out.trim() && stderr.trim()) {
        finish(() => reject(new Error('PowerShell query failed: ' + stderr.trim())));
        return;
      }
      finish(() => resolve(out));
    });

    child.stdin.on('error', () => {
      // PowerShell 已经退出了,stdin 写不进去 —— close 事件会给出真正的结论
    });
    child.stdin.end(script);
  });
}

/** C1 通道的结果。 */
export interface ProcessChannelResult {
  /** 查到的全部客户端相关进程。 */
  processes: LcuProcessInfo[];
  /**
   * 其中属于**游戏客户端**的进程(LeagueClientUx.exe / LeagueClient.exe)。
   *
   * `liveProcess` 以它为准 —— Riot 客户端那层进程在游戏没开的时候也在跑,
   * 把它算进「客户端在跑」会让用户没开游戏也被告知「客户端还没准备好」。
   */
  gameProcesses?: LcuProcessInfo[];
  /** 从游戏客户端进程推出来的 exe 目录,lockfile 就在那儿。 */
  exeDirs: string[];
  /** 有没有查到活的游戏客户端进程。 */
  liveProcess: boolean;
  /**
   * PowerShell 查询本身失败(被安全软件拦、超时、PowerShell 不可用)。
   *
   * 这跟「查到了但没有进程」是两回事 —— 前者我们根本没查成,
   * 不能拿它去断言「客户端没启动」。
   */
  queryFailed?: boolean;
  detail: string;
}

/**
 * 从进程列表里挑出**游戏客户端**进程,并推出 lockfile 所在目录。
 *
 * 纯函数 —— 不碰 IO,所以能直接单测。
 *
 * lockfile 只跟着游戏客户端走 —— Riot 客户端那层目录里没有。
 */
export function pickGameClient(processes: LcuProcessInfo[]): {
  gameProcesses: LcuProcessInfo[];
  exeDirs: string[];
  liveProcess: boolean;
  detail: string;
} {
  const gameProcesses = processes.filter(isGameClientProcess);

  const exeDirs: string[] = [];
  for (const info of gameProcesses) {
    const dir = executableDirOf(info);
    if (dir && !exeDirs.includes(dir)) exeDirs.push(dir);
  }

  let detail: string;
  if (gameProcesses.length > 0) {
    detail = '找到 ' + gameProcesses.length + ' 个游戏客户端进程';
  } else if (processes.length > 0) {
    detail = '只找到 ' + processes.length + ' 个 Riot 客户端进程,没找到游戏客户端进程';
  } else {
    detail = '没查到客户端进程';
  }

  return { gameProcesses, exeDirs, liveProcess: gameProcesses.length > 0, detail };
}

/**
 * 查一次进程,拿回 exe 路径和命令行。
 *
 * 主查询走 WMI。WMI 被拦/被禁用时**换一条路再查一次** —— 不走 WMI 的
 * `Get-Process` 也能拿到进程名和 exe 路径,足够推出安装目录、读到 lockfile。
 * 两条路都断才叫「查询失败」。
 */
export async function queryLcuProcesses(): Promise<ProcessChannelResult> {
  let out: string;
  try {
    out = await runPowerShell(PS_QUERY_SCRIPT);
  } catch (e: unknown) {
    return queryLcuProcessesWithoutWmi(e);
  }

  const processes = parseProcessOutput(out);
  const { gameProcesses, exeDirs, liveProcess, detail } = pickGameClient(processes);

  return { processes, gameProcesses, exeDirs, liveProcess, detail };
}

/**
 * WMI 那条路走不通时的兜底查询。
 *
 * `cause` 是主查询的失败原因 —— 报告里要留着,不然用户只看到「没查到进程」,
 * 不知道其实是 WMI 被拦了。
 */
async function queryLcuProcessesWithoutWmi(cause: unknown): Promise<ProcessChannelResult> {
  let out: string;
  try {
    out = await runPowerShell(PS_FALLBACK_SCRIPT);
  } catch (e: unknown) {
    return {
      processes: [],
      gameProcesses: [],
      exeDirs: [],
      liveProcess: false,
      queryFailed: true,
      detail:
        '进程查询失败(WMI:' +
        describeError(cause) +
        ' / 兜底:' +
        describeError(e) +
        ')'
    };
  }

  const processes = parseProcessOutput(out);
  const { gameProcesses, exeDirs, liveProcess, detail } = pickGameClient(processes);

  return {
    processes,
    gameProcesses,
    exeDirs,
    liveProcess,
    /**
     * 兜底查到了游戏客户端就算数。
     *
     * 兜底也没查到 → WMI 那条路是真的断了,不能拿「兜底也没找到」
     * 当成「客户端没开」—— 那正是用户被误导的那句话。
     */
    queryFailed: gameProcesses.length === 0,
    detail:
      '兜底查询(不经 WMI):' +
      detail +
      (gameProcesses.length === 0 ? ' | WMI 查询失败:' + describeError(cause) : '')
  };
}

/** lockfile 读出来的结果。 */
export interface LockfileReadResult {
  candidates: LcuCandidate[];
  /** 试过哪些路径 —— 诊断面板里要给用户看。 */
  tried: string[];
}

/** 国服路径的关键词。lockfile 路径能看出它是哪一服装的。 */
const CN_PATH_HINTS = ['英雄联盟', 'wegameapps', 'rail_apps'];

/** 从 lockfile 路径判断是哪一服。认不出来就按国服算(国服优先)。 */
function originOfLockfilePath(lockfilePath: string): LcuAuthOrigin {
  const lower = lockfilePath.toLowerCase();
  if (lower.includes('riot games')) return 'riot';
  for (const hint of CN_PATH_HINTS) {
    if (lower.includes(hint)) return 'cn';
  }
  return 'cn';
}

/**
 * 读一次 lockfile,读不到就重试 —— 客户端可能正在写它。
 *
 * 两种情况都算「暂时读不出来」:文件还没落盘(ENOENT),或者落盘了但只写了一半
 * (内容解析不出五段格式)。两种都是瞬时的,重试有意义。
 */
async function readLockfileWithRetry(lockfilePath: string): Promise<LcuAuth | null> {
  for (let attempt = 0; attempt < LOCKFILE_RETRY_COUNT; attempt++) {
    try {
      const raw = await fs.promises.readFile(lockfilePath, 'utf8');
      const auth = parseLockfileText(raw);
      if (auth) return auth;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      // 别的错误(权限不足、路径是目录)重试也没用。
      if (code !== 'ENOENT') return null;
    }
    if (attempt < LOCKFILE_RETRY_COUNT - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCKFILE_RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * 试候选路径,把所有读出来的都吐出来。
 *
 * **并发读** —— 读不到的路径要重试(客户端可能刚起、lockfile 还没落盘),
 * 每次重试间隔 200ms。串行的话十来个不存在的路径就是四五秒,
 * 「客户端没开」这种最常见的场景反而最慢。并发之后总耗时就是一次重试。
 */
export async function readLockfileCandidates(paths: string[]): Promise<LockfileReadResult> {
  const unique = [...new Set(paths)];
  const results = await Promise.all(
    unique.map(async (lockfilePath) => ({
      path: lockfilePath,
      auth: await readLockfileWithRetry(lockfilePath)
    }))
  );

  const candidates: LcuCandidate[] = [];
  const tried: string[] = [];

  for (const result of results) {
    tried.push(result.path);
    if (!result.auth) continue;
    candidates.push({
      ...result.auth,
      origin: originOfLockfilePath(result.path),
      source: 'lockfile'
    });
  }

  return { candidates, tried };
}

/**
 * 从 exe 所在目录推 lockfile 的候选路径。
 *
 * 跟着 exe 走就不用猜安装目录 —— 国服 WeGame 装在 `E:\wegameapps\英雄联盟\`、
 * 国际服装在 `%LOCALAPPDATA%\Riot Games\`,两条都能覆盖。
 */
export function exeDerivedLockfilePaths(exeDirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of exeDirs) {
    out.push(path.join(dir, 'lockfile'));
    out.push(path.join(dir, '..', 'lockfile'));
    out.push(path.join(dir, '..', '..', 'lockfile'));
  }
  return [...new Set(out)];
}

/**
 * 常见安装位置。国服 WeGame 的路径排在最前面。
 */
export function staticLockfilePaths(
  driveRoots: string[],
  localAppData: string | null,
  programFiles: string | null
): string[] {
  const out: string[] = [];

  for (const root of driveRoots) {
    out.push(path.join(root, 'WeGameApps', 'rail_apps', '英雄联盟', 'lockfile'));
    out.push(path.join(root, 'wegameapps', '英雄联盟', 'lockfile'));
    out.push(path.join(root, 'wegameapps', '英雄联盟', 'LeagueClient', 'lockfile'));
  }

  if (localAppData) {
    out.push(path.join(localAppData, 'Riot Games', 'League of Legends', 'lockfile'));
  }
  if (programFiles) {
    out.push(path.join(programFiles, 'Riot Games', 'League of Legends', 'lockfile'));
  }

  return [...new Set(out)];
}

/** C3 通道的结果。 */
export interface ScanChannelResult {
  candidates: LcuCandidate[];
  paths: string[];
  timedOut: boolean;
  detail: string;
}

/**
 * 扫盘找 lockfile,再把读出来的凭据吐出来。
 *
 * `roots` 只在测试里传 —— 生产环境扫的是所有存在的盘符。
 * 留这个口子是因为「扫盘 → 读 lockfile」这一段必须能单测:
 * `scanForLockfiles` 吐的是 **lockfile 文件路径**,不是目录 —— 两者混用的话,
 * `readFile` 会撞上 EISDIR,扫盘通道会静悄悄地一个候选都吐不出来。
 */
export async function scanLockfileCandidates(roots = listDriveRoots()): Promise<ScanChannelResult> {
  // 第一趟:按目录名白名单扫。快,但认不出 `D:\game\LOL\英雄联盟` 这种路径。
  const fast = await scanForLockfiles(roots, FAST_SCAN_BUDGET_MS);
  const fastResult = await readLockfileCandidates(fast.paths);

  let candidates = fastResult.candidates;
  let tried = fastResult.tried;
  let timedOut = fast.timedOut;

  /**
   * 白名单那趟空手而归 → 再来一趟不看目录名的。
   *
   * 用户把客户端装在 `D:\game\LOL\英雄联盟` 这种地方时,白名单那趟连
   * `英雄联盟` 都走不到(中间的 `game`、`LOL` 两个目录名它不认),
   * 结果就是「明明开着客户端,却说没检测到」。
   */
  if (candidates.length === 0) {
    const loose = await scanForLockfilesPermissive(roots, PERMISSIVE_SCAN_BUDGET_MS);
    const looseResult = await readLockfileCandidates(loose.paths);
    candidates = looseResult.candidates;
    tried = [...tried, ...looseResult.tried];
    if (loose.timedOut) timedOut = true;
  }

  return {
    candidates,
    paths: tried,
    timedOut,
    detail: timedOut
      ? '磁盘扫描超时(找到 ' + tried.length + ' 个候选)'
      : '磁盘扫描完成(找到 ' + tried.length + ' 个候选)'
  };
}

/** C4 通道:上一次找到的 lockfile 路径。 */
export interface LcuPathCache {
  lockfilePaths: string[];
  updatedAt: number;
}

/** 缓存文件名。 */
export const PATH_CACHE_FILENAME = 'lcu-paths.json';

/**
 * 读路径缓存。
 *
 * **只存路径,不存 token** —— token 是凭据,落盘等于泄露。
 */
export async function readPathCache(): Promise<string[]> {
  try {
    const file = path.join(app.getPath('userData'), PATH_CACHE_FILENAME);
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LcuPathCache>;
    if (!parsed || !Array.isArray(parsed.lockfilePaths)) return [];
    return parsed.lockfilePaths.filter((p): p is string => typeof p === 'string');
  } catch {
    // 缓存不存在或坏了 —— 当没有缓存,不报错
    return [];
  }
}

/** 写路径缓存。同样只存路径。 */
export async function writePathCache(lockfilePaths: string[]): Promise<void> {
  try {
    const file = path.join(app.getPath('userData'), PATH_CACHE_FILENAME);
    const payload: LcuPathCache = { lockfilePaths, updatedAt: Date.now() };
    await fs.promises.writeFile(file, JSON.stringify(payload), 'utf8');
  } catch {
    // 缓存写不进去不影响主流程
  }
}

/** C5 通道:进程内缓存的凭据。 */
export interface MemoryAuth {
  auth: LcuAuth;
  origin: LcuAuthOrigin;
  at: number;
}

let memoryAuth: MemoryAuth | null = null;

/** 读内存凭据缓存。 */
export function readMemoryAuth(): MemoryAuth | null {
  return memoryAuth;
}

/** 写内存凭据缓存。只在内存里,不落盘。 */
export function writeMemoryAuth(auth: LcuAuth, origin: LcuAuthOrigin): void {
  memoryAuth = { auth, origin, at: Date.now() };
}

/** 清内存凭据缓存。 */
export function clearMemoryAuth(): void {
  memoryAuth = null;
}

/**
 * 环境快照,诊断面板里展示。
 *
 * **只报代理变量的名字,不报值** —— 值里通常带账号密码。
 */
export function readEnvironment(): LcuEnvironment {
  const proxyVars = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy'
  ].filter((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.length > 0;
  });

  return {
    proxyVars,
    localAppData: process.env.LOCALAPPDATA ?? null,
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  };
}
