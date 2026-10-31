import axios, { AxiosInstance } from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

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
export function readLcuAuthFromProcess(): LcuAuth {
  const psScript =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
    'Select-Object -ExpandProperty CommandLine';

  let out: string;
  try {
    out = execSync(`powershell.exe -NoProfile -NonInteractive -Command -`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      input: psScript
    });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'unknown';
    throw new LcuNotRunningError(
      `LeagueClientUx.exe not found (PowerShell query failed: ${detail}).`
    );
  }

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
 * Resolves LCU auth. Prefers the process command line (works for both standard
 * Riot installs and WeGame). Falls back to the lockfile if wmic is unavailable
 * or the process is not running for the expected user.
 */
export function readLcuAuth(): LcuAuth {
  try {
    return readLcuAuthFromProcess();
  } catch {
    // fall through to lockfile
  }
  return readLockfile(findLockfilePath());
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
