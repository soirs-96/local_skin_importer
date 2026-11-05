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
  parseLockfileText,
  parseProcessOutput,
  type LcuProcessInfo
} from './parse';
import { listDriveRoots, scanForLockfiles } from './scan';
import type { LcuAuth, LcuAuthOrigin, LcuCandidate, LcuEnvironment } from './types';

/**
 * 查 LeagueClientUx.exe 的命令行。
 *
 * 输出走 base64 —— 安装路径可能是中文(`E:\wegameapps\英雄联盟\`),
 * 直接走管道会被控制台代码页毁掉。base64 是纯 ASCII,不受影响。
 */
export const PS_QUERY_SCRIPT =
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
  `Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" | ` +
  'ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(' +
  '($_.ExecutablePath + [char]31 + $_.CommandLine))) }';

/** PowerShell 查询超时。 */
export const PS_TIMEOUT_MS = 10_000;

/** lockfile 可能正在被写,读不到就重试几次。 */
export const LOCKFILE_RETRY_COUNT = 3;

/** 重试间隔。 */
export const LOCKFILE_RETRY_DELAY_MS = 200;

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
  processes: LcuProcessInfo[];
  /** 从进程推出来的 exe 目录,lockfile 就在那儿。 */
  exeDirs: string[];
  /** 有没有查到活的 LeagueClientUx.exe 进程。 */
  liveProcess: boolean;
  detail: string;
}

/** 查一次进程,拿回 exe 路径和命令行。 */
export async function queryLcuProcesses(): Promise<ProcessChannelResult> {
  let out: string;
  try {
    out = await runPowerShell(PS_QUERY_SCRIPT);
  } catch (e: unknown) {
    return {
      processes: [],
      exeDirs: [],
      liveProcess: false,
      detail: 'PowerShell 查询失败:' + describeError(e)
    };
  }

  const processes = parseProcessOutput(out);
  const exeDirs: string[] = [];
  for (const info of processes) {
    const dir = executableDirOf(info);
    if (dir && !exeDirs.includes(dir)) exeDirs.push(dir);
  }

  return {
    processes,
    exeDirs,
    liveProcess: processes.length > 0,
    detail:
      processes.length > 0
        ? '找到 ' + processes.length + ' 个 LeagueClientUx.exe 进程'
        : 'LeagueClientUx.exe 没在运行'
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
  const scan = await scanForLockfiles(roots);
  const { candidates, tried } = await readLockfileCandidates(scan.paths);

  return {
    candidates,
    paths: tried,
    timedOut: scan.timedOut,
    detail: scan.timedOut
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
