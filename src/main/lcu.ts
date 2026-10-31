import axios, { AxiosInstance } from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync, spawn } from 'node:child_process';

/** Credentials scraped from the League client lockfile. Never leaves the main process. */
export interface LcuAuth {
  port: number;
  token: string;
}

export interface CurrentSummoner {
  displayName: string;
  puuid: string;
}

/** Thrown when the lockfile is absent, i.e. the League client is not running. */
export class LcuNotRunningError extends Error {
  constructor(message = 'League client is not running (lockfile not found).') {
    super(message);
    this.name = 'LcuNotRunningError';
  }
}

/**
 * 端口解析到了,但那个端口没人监听 —— 客户端重启过、换了端口,或者 lockfile /
 * 命令行里留着上一轮的旧端口。跟 {@link LcuNotRunningError} 分开:
 * 那个是「压根没找到客户端」,这个是「找到了,但已经失效」。
 */
export class LcuUnreachableError extends Error {
  constructor(message = 'League client is not reachable (port is not accepting connections).') {
    super(message);
    this.name = 'LcuUnreachableError';
  }
}

/**
 * Lockfile lives in %LocalAppData%\Riot Games\League of Legends\lockfile.
 * `LOL_LOCKFILE_PATH` overrides it (used by tests and non-default installs).
 */
export function findLockfilePath(): string {
  const override = process.env.LOL_LOCKFILE_PATH;
  if (override) return override;

  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Riot Games', 'League of Legends', 'lockfile');
}

/**
 * Lockfile format is five colon-separated fields:
 *   LeagueClientUx:<pid>:<port>:<password>:<protocol>
 * The port is field 2 and the password is field 3 (both zero-indexed).
 */
export function parseLockfile(contents: string): LcuAuth {
  const fields = contents.trim().split(':');
  if (fields.length !== 5) {
    throw new Error(`Malformed lockfile: expected 5 colon-separated fields, got ${fields.length}.`);
  }

  const [, , portField, token] = fields;
  const port = Number(portField);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Malformed lockfile: invalid port "${portField}".`);
  }
  if (!token) {
    throw new Error('Malformed lockfile: empty token.');
  }

  return { port, token };
}

/** Reads and parses the lockfile. Throws {@link LcuNotRunningError} when it does not exist. */
export function readLockfile(lockfilePath: string = findLockfilePath()): LcuAuth {
  let raw: string;
  try {
    raw = fs.readFileSync(lockfilePath, 'utf8');
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new LcuNotRunningError(
        `League client is not running (lockfile not found at ${lockfilePath}).`
      );
    }
    throw err;
  }
  return parseLockfile(raw);
}

/**
 * Reads the auth directly from the LeagueClientUx.exe process command line.
 * Used as a fallback because WeGame-installed LOL writes a lockfile that does not
 * track the current LOL PID (the lockfile is captured by the Riot Client launcher
 * at start, then never refreshed across LOL restarts).
 *
 * Two command-line shapes exist in the wild:
 *   1. Standard Riot install:
 *        --riotclient-app-port=<port>
 *        --riotclient-auth-token=<token>
 *   2. WeGame install (or any Tencent launcher that proxies LOL):
 *        --app-port=<port>
 *        --remoting-auth-token=<token>
 *
 * WeGame's LeagueClientUx.exe carries BOTH pairs. The LCU game API
 * (e.g. /lol-summoner/v1/current-summoner) is served on --app-port with
 * --remoting-auth-token; --riotclient-app-port serves the Riot Client API
 * (e.g. /rso-auth/v1/...) and returns 404 for game endpoints.
 *
 * Detection: if --remoting-auth-token is present, prefer the WeGame pair.
 * Otherwise fall back to the standard Riot pair.
 *
 * Uses Get-CimInstance via PowerShell because wmic was removed in Windows 11 24H2.
 * The script is piped via stdin (`-Command -`) to avoid cmd.exe quote-escaping pitfalls.
 */
const PS_QUERY_SCRIPT =
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
  "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
  'Select-Object -ExpandProperty CommandLine';

export function readLcuAuthFromProcess(): LcuAuth {
  let out: string;
  try {
    const raw: unknown = execSync(`powershell.exe -NoProfile -NonInteractive -Command -`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      input: PS_QUERY_SCRIPT
    });
    out = typeof raw === 'string' ? raw : '';
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'unknown';
    throw new LcuNotRunningError(
      `LeagueClientUx.exe not found (PowerShell query failed: ${detail}).`
    );
  }
  return parseLcuAuthFromCommandLine(out);
}

/** 从 LeagueClientUx.exe 的命令行里抠出端口和 token。 */
export function parseLcuAuthFromCommandLine(out: string): LcuAuth {
  const remotingTokenMatch = out.match(/--remoting-auth-token=([\w-]+)/);
  const appPortMatch = out.match(/--app-port=(\d+)/);

  if (remotingTokenMatch && appPortMatch) {
    return { port: Number(appPortMatch[1]), token: remotingTokenMatch[1] };
  }

  const rcPortMatch = out.match(/--riotclient-app-port=(\d+)/);
  const rcTokenMatch = out.match(/--riotclient-auth-token=([\w-]+)/);

  if (rcPortMatch && rcTokenMatch) {
    return { port: Number(rcPortMatch[1]), token: rcTokenMatch[1] };
  }

  throw new LcuNotRunningError(
    'LeagueClientUx.exe is running but did not expose recognizable LCU port/token ' +
      '(expected --app-port + --remoting-auth-token, or --riotclient-app-port + --riotclient-auth-token).'
  );
}

/**
 * 异步版的 {@link readLcuAuthFromProcess}。
 *
 * `execSync` 会把主进程的事件循环卡住最多 10 秒 —— 定时轮询里用不起,
 * 界面会跟着一起卡。用 spawn 把脚本喂给 PowerShell 的 stdin,全程不阻塞。
 */
export function readLcuAuthFromProcessAsync(): Promise<LcuAuth> {
  return new Promise<LcuAuth>((resolve, reject) => {
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
      finish(() =>
        reject(new LcuNotRunningError('PowerShell query for LeagueClientUx.exe timed out.'))
      );
    }, 10_000);

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
      finish(() =>
        reject(
          new LcuNotRunningError(
            `LeagueClientUx.exe not found (PowerShell query failed: ${e.message}).`
          )
        )
      );
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        finish(() =>
          reject(
            new LcuNotRunningError(
              `LeagueClientUx.exe not found (PowerShell exited with ${code ?? 'null'}: ${stderr.trim()}).`
            )
          )
        );
        return;
      }
      finish(() => {
        try {
          resolve(parseLcuAuthFromCommandLine(out));
        } catch (e: unknown) {
          reject(e);
        }
      });
    });

    child.stdin.on('error', () => {
      // PowerShell 已经退出了,stdin 写不进去 —— close 事件会给出真正的结论
    });
    child.stdin.end(PS_QUERY_SCRIPT);
  });
}

/** 端口/token 的来源,排查时用得上。 */
export type LcuAuthSource = 'process' | 'lockfile';

export interface LcuAuthCandidate extends LcuAuth {
  source: LcuAuthSource;
}

/**
 * 端口探活:127.0.0.1:port 上有没有人在听。
 *
 * 死端口会立刻回 ECONNREFUSED,所以这一步几乎不花时间。
 * 只判断「有没有人在听」,不判断对端是不是 LCU。
 */
export function isPortAlive(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * 把两个来源都收集起来,谁成功算谁的。
 *
 * 进程命令行优先(标准 Riot 和 WeGame 都能覆盖),lockfile 兜底。
 * 两个都留着是有原因的:进程查到了但端口是旧的(客户端重启过)这种场景更常见,
 * 光靠「进程查询失败才退 lockfile」会直接拿到死端口。
 */
export function collectLcuAuthCandidates(): LcuAuthCandidate[] {
  const candidates: LcuAuthCandidate[] = [];
  let firstError: unknown;

  try {
    const auth = readLcuAuthFromProcess();
    candidates.push({ ...auth, source: 'process' });
  } catch (e: unknown) {
    firstError = e;
  }

  try {
    const auth = readLockfile(findLockfilePath());
    candidates.push({ ...auth, source: 'lockfile' });
  } catch (e: unknown) {
    if (firstError === undefined) firstError = e;
  }

  if (candidates.length === 0) {
    throw firstError instanceof Error ? firstError : new LcuNotRunningError();
  }
  return candidates;
}

/**
 * 解析出**连得上**的 LCU 端口。
 *
 * 两个来源都探一遍,谁先活着用谁;都死了就抛 {@link LcuUnreachableError},
 * 并把试过的端口报出来 —— 端口号变了正是客户端重启过的信号。
 */
export async function resolveLcuAuth(): Promise<LcuAuth> {
  return pickAliveCandidate(collectLcuAuthCandidates());
}

/**
 * {@link resolveLcuAuth} 的非阻塞版本。
 *
 * 轮询器里必须用这个:`execSync` 查进程命令行会把主进程卡住最多 10 秒,
 * 定时任务里用不起。
 */
export async function resolveLcuAuthAsync(): Promise<LcuAuth> {
  const candidates: LcuAuthCandidate[] = [];
  let firstError: unknown;

  try {
    candidates.push({ ...(await readLcuAuthFromProcessAsync()), source: 'process' });
  } catch (e: unknown) {
    firstError = e;
  }

  try {
    candidates.push({ ...readLockfile(findLockfilePath()), source: 'lockfile' });
  } catch (e: unknown) {
    if (firstError === undefined) firstError = e;
  }

  if (candidates.length === 0) {
    throw firstError instanceof Error ? firstError : new LcuNotRunningError();
  }
  return pickAliveCandidate(candidates);
}

async function pickAliveCandidate(candidates: LcuAuthCandidate[]): Promise<LcuAuth> {
  const dead: number[] = [];

  for (const candidate of candidates) {
    if (await isPortAlive(candidate.port)) {
      return { port: candidate.port, token: candidate.token };
    }
    dead.push(candidate.port);
  }

  throw new LcuUnreachableError(
    `League client is not reachable (tried port(s) ${dead.join(', ')}). ` +
      'The client may have restarted with a new port — open the game client and retry.'
  );
}

/**
 * Axios instance bound to the local LCU. Certificate verification is disabled because the
 * client serves a self-signed cert on 127.0.0.1 — this is scoped to this instance only.
 */
export function createLcuClient(port: number, token: string): AxiosInstance {
  const credentials = Buffer.from(`riot:${token}`, 'latin1').toString('base64');
  return axios.create({
    baseURL: `https://127.0.0.1:${port}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 5000
  });
}

export async function getCurrentSummoner(client: AxiosInstance): Promise<CurrentSummoner> {
  const { data } = await client.get('/lol-summoner/v1/current-summoner');
  if (!isRecord(data)) {
    throw new Error('Unexpected /lol-summoner/v1/current-summoner response.');
  }
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    puuid: typeof data.puuid === 'string' ? data.puuid : ''
  };
}

/**
 * 库存端点。类型名要写**枚举名**放在**路径段**里 —— 传 owned/skins/all 这类
 * 小写词会返回 200 但 body 是空数组，看起来像「这个接口没数据」。
 * 响应约 1.1 MB,5 秒默认超时不够,单独放宽。
 */
const INVENTORY_PATH = '/lol-inventory/v2/inventory/CHAMPION_SKIN';
const INVENTORY_TIMEOUT_MS = 30_000;

/**
 * 库存里的「已拥有」判定。库存条目的拥有状态是**扁平**的:
 *   owned / ownershipType / rental / quantity 都在条目顶层,没有嵌套的 ownership.owned。
 */
function isOwnedInventoryItem(item: Record<string, unknown>): boolean {
  if (item.owned === false) return false;
  if (item.rental === true) return false;
  const ownershipType =
    typeof item.ownershipType === 'string' ? item.ownershipType.toUpperCase() : '';
  if (ownershipType && ownershipType !== 'OWNED') return false;
  return true;
}

/**
 * 从 LCU 库存端点读「已拥有的英雄皮肤卡」itemId。
 *
 * 这是权威的拥有数据源:商城目录的 `owned` 标记只覆盖当前在售的商品,
 * 已下架(绝版)的皮肤在商城里看不到,只能从库存拿到。
 *
 * 返回的是**未经筛选的原始 itemId 集合** —— 里面混着炫彩(RECOLOR)、皮肤变体
 * (skin_variant)、经典版英雄的长 id(60000000 + champId*1000 + 序号)以及商城
 * 没有收录的皮肤。要判断「哪些是皮肤、哪些是站内收录的皮肤」,得由调用方拿
 * 站内目录去比对(见 owned.ts)。
 */
export async function getInventoryOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get(INVENTORY_PATH, { timeout: INVENTORY_TIMEOUT_MS });
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected ${INVENTORY_PATH} response.`);
  }
  const ids = new Set<number>();
  for (const item of data) {
    if (!isRecord(item)) continue;
    if (!isOwnedInventoryItem(item)) continue;
    const id = Number(item.itemId);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * 商城目录口径的「已拥有皮肤」(降级兜底)。
 *
 * 只认当前在售 + bundles/featured 补充的条目,所以读不到已下架皮肤,
 * 也分不出炫彩/变体以外的东西。库存端点不可用时才走这条路。
 */
export async function getStoreOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const owned = new Set<number>();

  const { data } = await client.get('/lol-store/v1/skins');
  collectOwnedSkins(data, owned);

  // Supplement: retired skins the store catalog no longer lists. A failure here
  // must not lose the catalog data, so each source is best-effort.
  for (const url of ['/lol-store/v1/bundles', '/lol-store/v1/featured']) {
    try {
      const { data: supplement } = await client.get(url, { timeout: 20000 });
      collectOwnedSkins(supplement, owned);
    } catch {
      // ignore — the catalog data collected above still stands
    }
  }

  return [...owned];
}

/** Walks an arbitrary store payload and keeps every owned CHAMPION_SKIN itemId. */
function collectOwnedSkins(node: unknown, out: Set<number>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectOwnedSkins(item, out);
    return;
  }
  if (!isRecord(node)) return;

  if (isOwnedSkin(node)) {
    const id = Number(node.itemId);
    if (Number.isFinite(id)) out.add(id);
  }

  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') {
      collectOwnedSkins(value, out);
    }
  }
}

function isOwnedSkin(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry.inventoryType !== 'CHAMPION_SKIN' || entry.owned !== true) return false;
  return !isChroma(entry);
}

/** 炫彩与皮肤变体:商城条目里 inventoryType 也是 CHAMPION_SKIN,靠 subInventoryType 或 tags 区分。
 *  - subInventoryType === 'RECOLOR' 是标准炫彩
 *  - tags 里带 skin_variant 的是皮肤变体(如 神龙尊者 昼日真龙 亚索),同样没有原画 */
function isChroma(entry: Record<string, unknown>): boolean {
  if (String(entry.subInventoryType ?? '').toUpperCase() === 'RECOLOR') return true;
  const tags = entry.tags;
  if (Array.isArray(tags)) {
    return tags.some((tag) => {
      const t = String(tag).toLowerCase();
      return t === 'recolor' || t.startsWith('skin_variant');
    });
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
