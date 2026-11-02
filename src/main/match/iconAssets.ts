/**
 * 图标代理:把客户端自带的图标通过 `lcuicon://` 交给渲染进程。
 *
 * 为什么要自己代理,而不是让渲染进程直接 `<img src="https://ddragon...">`:
 *
 *   - **外网 CDN 靠不住**。Data Dragon 在国服经常拉不动,表现就是
 *     「英雄名有、头像和装备全是空的」——图标这块不能再依赖外网。
 *   - **客户端自己带全套图标**。`/lol-game-data/assets/v1/` 下有英雄头像和
 *     物品图标,走本机回环一定通。
 *   - **鉴权和缓存得在主进程里做**。LCU 的资源端点要带 Basic 认证头;
 *     一次拉下来落盘缓存,之后连客户端都不用开。
 *
 * 取图顺序:**磁盘缓存 → 客户端本地资源 → Data Dragon**。
 * 客户端资源走**串行**队列 —— Python 版那边踩过坑:并发拉图会把 LCU
 * 那个单监听器的回环口打爆,连带整个应用的 LCU 连接都被拒。
 */

import { app, protocol } from 'electron';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import * as https from 'node:https';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ICON_SCHEME, parseLcuIconUrl, type IconKind } from '../../shared/icons';
import { getIconMeta } from './iconMeta';
import {
  getSharedLcuAuth,
  invalidateSharedLcuAuth,
  resolveLcuAuthAsync,
  type LcuAuth
} from '../lcu';

/**
 * 客户端资源路径的候选表。
 *
 * 路径各版本不太一样:英雄头像历来是 `champion-icons/`,物品则见过
 * `item/` 和 `items/` 两种写法 —— 所以每个都多试几个,谁先返回 200 用谁。
 */
const LCU_ICON_PATHS: Record<IconKind, string[]> = {
  champion: [
    '/lol-game-data/assets/v1/champion-icons/{id}.png',
    '/lol-game-data/assets/v1/champions/{id}.png',
    '/lol-game-data/assets/v1/champion/{id}.png'
  ],
  item: [
    '/lol-game-data/assets/v1/item/{id}.png',
    '/lol-game-data/assets/v1/items/{id}.png',
    '/lol-game-data/assets/v1/item-icons/{id}.png'
  ]
};

const LCU_TIMEOUT_MS = 5_000;
const DDRAGON_TIMEOUT_MS = 10_000;
const DDRAGON_CDN_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/** 同一个图标同时被多个 <img> 请求时的去重表。 */
const inflight = new Map<string, Promise<Buffer>>();

/** 已经报过「客户端资源没命中」的图标类型,避免同一个错刷几十遍。 */
const loggedLcuMisses = new Set<IconKind>();

/**
 * 拉客户端资源的串行队列。
 *
 * LCU 的回环口只听一个连接,并发拉图会把它挤爆,所以排队一个个来。
 */
let lcuQueue: Promise<unknown> = Promise.resolve();

/** 图标代理自己解析出来的凭据(轮询器还没跑起来时的兜底)。 */
let localAuth: LcuAuth | null = null;
/**
 * 上次解析凭据失败的时间。
 *
 * 解析凭据要 spawn 一个 PowerShell,最多 10 秒。客户端没开的时候每张图标
 * 都去重试一次,串行队列就被拖死了 —— 失败之后先冷却一段时间。
 */
let localAuthFailedAt = 0;
const AUTH_COOLDOWN_MS = 10_000;

/**
 * 必须在 app ready **之前**调用:自定义协议要先登记成特权协议,
 * 否则渲染进程拿不到 `standard` 语义,`lcuicon://champion/1.png`
 * 会被当成普通路径而不是带 host 的标准 URL。
 */
export function registerIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ICON_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ]);
}

/** 在 app ready **之后**调用:接管 `lcuicon://` 的请求。 */
export function registerIconProtocol(): void {
  protocol.handle(ICON_SCHEME, async (request) => {
    const ref = parseLcuIconUrl(request.url);
    if (!ref) return new Response('not found', { status: 404 });
    try {
      const buffer = await loadIcon(ref.kind, ref.id);
      return new Response(buffer, {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' }
      });
    } catch (e: unknown) {
      console.warn('[iconAssets] 取图标失败', ref, e);
      return new Response('not found', { status: 404 });
    }
  });
}

/** 拿一张图标。同一张图的并发请求会合并成一次。 */
export function loadIcon(kind: IconKind, id: number): Promise<Buffer> {
  const key = `${kind}/${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = fetchIcon(kind, id).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

async function fetchIcon(kind: IconKind, id: number): Promise<Buffer> {
  const cached = await readCache(kind, id);
  if (cached) return cached;

  const fromLcu = await fetchFromLcu(kind, id);
  if (fromLcu) {
    await writeCache(kind, id, fromLcu);
    return fromLcu;
  }

  const fromDdragon = await fetchFromDdragon(kind, id);
  if (fromDdragon) {
    await writeCache(kind, id, fromDdragon);
    return fromDdragon;
  }

  throw new Error(`icon ${kind}/${id} not found`);
}

/* -------------------------------------------------------------------------- */
/*                                 磁盘缓存                                     */
/* -------------------------------------------------------------------------- */

function cachePath(kind: IconKind, id: number): string {
  return path.join(app.getPath('userData'), 'icon-cache', kind, `${id}.png`);
}

async function readCache(kind: IconKind, id: number): Promise<Buffer | null> {
  try {
    const data = await fs.readFile(cachePath(kind, id));
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function writeCache(kind: IconKind, id: number, data: Buffer): Promise<void> {
  const target = cachePath(kind, id);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  } catch (e: unknown) {
    // 缓存写不进去不影响使用,只是下次还要重新拉一遍
    console.warn('[iconAssets] 写缓存失败', target, e);
  }
}

/* -------------------------------------------------------------------------- */
/*                               客户端本地资源                                  */
/* -------------------------------------------------------------------------- */

async function fetchFromLcu(kind: IconKind, id: number): Promise<Buffer | null> {
  const candidates = LCU_ICON_PATHS[kind].map((tpl) => tpl.replace('{id}', String(id)));
  return runExclusive(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = await resolveAuth();
      if (!auth) return null;

      let authFailed = false;
      const statuses: string[] = [];
      for (const candidate of candidates) {
        const result = await tryFetchLcu(auth, candidate);
        if (result.buffer) return result.buffer;
        if (result.authFailed) authFailed = true;
        statuses.push(`${candidate}=${result.status ?? 'ERR'}`);
      }
      // 路径全试过了还没中 —— 每种类型只报一次,不然刷屏
      if (!loggedLcuMisses.has(kind)) {
        loggedLcuMisses.add(kind);
        console.warn(`[iconAssets] 客户端资源没命中 ${kind},试过:${statuses.join(' ')}`);
      }
      // 401/403 说明 token 过期了(客户端重启过),换一份凭据再试一轮
      if (!authFailed) return null;
      invalidateSharedLcuAuth();
      localAuth = null;
      localAuthFailedAt = 0;
    }
    return null;
  });
}

interface LcuFetchResult {
  buffer: Buffer | null;
  authFailed: boolean;
  /** HTTP 状态码;连接层出错时是 undefined */
  status?: number;
}

async function tryFetchLcu(auth: LcuAuth, assetPath: string): Promise<LcuFetchResult> {
  try {
    const { data } = await axios.get<ArrayBuffer>(
      `https://127.0.0.1:${auth.port}${assetPath}`,
      {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        headers: { Authorization: basicAuthHeader(auth.token) },
        responseType: 'arraybuffer',
        timeout: LCU_TIMEOUT_MS,
        validateStatus: (status) => status === 200
      }
    );
    const buffer = Buffer.from(data);
    return { buffer: buffer.length > 0 ? buffer : null, authFailed: false, status: 200 };
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    return { buffer: null, authFailed: status === 401 || status === 403, status };
  }
}

function basicAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`riot:${token}`, 'latin1').toString('base64')}`;
}

/** 凭据:优先用轮询器共享的那份,没有就自己解析一次并缓存。 */
async function resolveAuth(): Promise<LcuAuth | null> {
  const shared = getSharedLcuAuth();
  if (shared) return shared;
  if (localAuth) return localAuth;

  // 刚试过还没开客户端,就别再 spawn PowerShell 了
  if (Date.now() - localAuthFailedAt < AUTH_COOLDOWN_MS) return null;

  try {
    localAuth = await resolveLcuAuthAsync();
    localAuthFailedAt = 0;
    return localAuth;
  } catch {
    localAuth = null;
    localAuthFailedAt = Date.now();
    return null;
  }
}

/** 串行执行,避免并发把 LCU 的回环口打爆。 */
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = lcuQueue.then(task, task);
  lcuQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/* -------------------------------------------------------------------------- */
/*                                Data Dragon                                   */
/* -------------------------------------------------------------------------- */

async function fetchFromDdragon(kind: IconKind, id: number): Promise<Buffer | null> {
  const meta = getIconMeta();
  if (!meta.version) return null;

  // 物品图标按 id 命名(1001.png),英雄图标按英文名命名(Aatrox.png)
  const file = kind === 'champion' ? meta.championFiles.get(id) : `${id}.png`;
  if (!file) return null;

  const url = `${DDRAGON_CDN_BASE}/${meta.version}/img/${kind}/${file}`;
  try {
    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: DDRAGON_TIMEOUT_MS,
      validateStatus: (status) => status === 200
    });
    const buffer = Buffer.from(data);
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}
