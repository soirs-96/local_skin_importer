/**
 * 连接层:跟 LCU 说上话。
 *
 * 关键点是 `proxy: false` —— axios 默认会继承 HTTPS_PROXY / ALL_PROXY 之类的
 * 环境变量,用户机器上装了代理软件时,连 127.0.0.1 的请求会被丢给代理,
 * 结果就是「客户端明明开着,工具却说连不上」。
 */
import axios, { AxiosInstance } from 'axios';
import * as https from 'node:https';
import * as net from 'node:net';
import type { CurrentSummoner, LcuAuth, LcuCandidate, LcuProbeOutcome } from './types';

/** 探测用的端点。挑它是因为它最轻、且在「没登录召唤师」时也返回 200。 */
export const SUMMONER_PATH = '/lol-summoner/v1/current-summoner';

/** 实测的超时。3 秒够本地回环,也不会卡住界面太久。 */
export const PROBE_TIMEOUT_MS = 3000;

/** 库存端点。类型名要写**枚举名**放在**路径段**里 —— 传 owned/skins/all 这类
 * 小写词会返回 200 但 body 是空数组,看起来像「这个接口没数据」。
 */
export const INVENTORY_PATH = '/lol-inventory/v2/inventory/CHAMPION_SKIN';

/** 库存响应约 1.1 MB,5 秒默认超时不够,单独放宽。 */
export const INVENTORY_TIMEOUT_MS = 30_000;

/**
 * Axios instance bound to the local LCU. Certificate verification is disabled because the
 * client serves a self-signed cert on 127.0.0.1 — this is scoped to this instance only.
 */
export function createLcuClient(auth: LcuAuth): AxiosInstance {
  const credentials = Buffer.from(`riot:${auth.token}`, 'latin1').toString('base64');
  return axios.create({
    baseURL: `${auth.protocol}://${auth.host}:${auth.port}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 5000,
    // 关键:不让 axios 继承 HTTPS_PROXY / ALL_PROXY。代理软件是本机 127.0.0.1
    // 的唯一通路,把请求交给代理等于必挂。
    proxy: false
  });
}

/**
 * 端口探活:host:port 上有没有人在听。
 *
 * 死端口会立刻回 ECONNREFUSED,所以这一步几乎不花时间。
 * 只判断「有没有人在听」,不判断对端是不是 LCU。
 */
export function isPortAlive(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
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
    socket.connect(port, host);
  });
}

/** 一次实测的结果。 */
export interface LcuProbeResult {
  outcome: LcuProbeOutcome;
  /** 200 时把响应体带回来(用来取召唤师信息)。 */
  body?: unknown;
}

/** 是「普通对象」而不是数组/null。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 实测一条候选:这个端口上真的是游戏客户端接口吗?
 *
 * 判定口径:
 *   - TCP 都连不上          → dead
 *   - 200 且 body 是 JSON 对象 → alive(注意:`{}` 也算 —— 那是「客户端在但没登录召唤师」)
 *   - 200 但 body 不是对象    → not-lcu
 *   - 401 / 403              → unauthorized(端口在、但凭据过期)
 *   - 404                    → not-lcu(国际服 Riot Client API 就是这样:游戏端点 404)
 *   - 超时 / 连接错 / 5xx    → not-ready(客户端起来了但还没就绪)
 */
export async function probeCandidate(candidate: LcuCandidate): Promise<LcuProbeResult> {
  const alive = await isPortAlive(candidate.host, candidate.port);
  if (!alive) return { outcome: 'dead' };

  const client = createLcuClient(candidate);
  try {
    const response = await client.get(SUMMONER_PATH, { timeout: PROBE_TIMEOUT_MS });
    if (isPlainObject(response.data)) {
      return { outcome: 'alive', body: response.data };
    }
    return { outcome: 'not-lcu' };
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) return { outcome: 'unauthorized' };
    if (status === 404) return { outcome: 'not-lcu' };
    return { outcome: 'not-ready' };
  }
}

/** 从 LCU 响应体里抽召唤师信息。 */
export function toSummoner(data: unknown): CurrentSummoner {
  if (!isPlainObject(data)) {
    throw new Error(`Unexpected ${SUMMONER_PATH} response.`);
  }
  const gameName = typeof data.gameName === 'string' ? data.gameName : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName : '';
  return {
    // 国服客户端的 displayName 是空的,真名在 gameName 里。
    displayName: gameName || displayName,
    puuid: typeof data.puuid === 'string' ? data.puuid : ''
  };
}

export async function getCurrentSummoner(client: AxiosInstance): Promise<CurrentSummoner> {
  const { data } = await client.get(SUMMONER_PATH);
  return toSummoner(data);
}

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
 */
export async function getInventoryOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get(INVENTORY_PATH, { timeout: INVENTORY_TIMEOUT_MS });
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected ${INVENTORY_PATH} response.`);
  }
  const ids = new Set<number>();
  for (const item of data) {
    if (!isPlainObject(item)) continue;
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
  if (!isPlainObject(node)) return;

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
  if (!isPlainObject(entry)) return false;
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
