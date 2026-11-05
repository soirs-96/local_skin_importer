/**
 * 图标代理:把英雄/物品图标通过 `lcuicon://` 交给渲染进程。
 *
 * 图标有两个来源,各有各的脾气:
 *
 *   - **客户端自带资源**(`/lol-game-data/assets/v1/`)—— 本机回环,一定通。
 *     但只有**英雄头像**在那儿(`champion-icons/{id}.png`),**物品图标
 *     客户端根本不提供**(`item/`、`items/` 全回 400)。
 *   - **Data Dragon CDN** —— 物品图标只能走这儿。版本号必须用**客户端
 *     报的**那个(见 patchVersion.ts),不是 DDG API 里的那个。
 *
 * 所以顺序是:**英雄 = 客户端 → DDG**,**物品 = DDG → 客户端**。
 *
 * 鉴权和磁盘缓存都在主进程里做;客户端资源走**串行**队列 —— Python 版
 * 那边踩过坑:并发拉图会把 LCU 那个单监听器的回环口打爆,连带整个应用的
 * LCU 连接都被拒。
 */

import { app, protocol } from 'electron';
import axios from 'axios';
import { Buffer } from 'node:buffer';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ICON_SCHEME, parseLcuIconUrl, type IconKind } from '../../shared/icons';
import { getIconMeta } from './iconMeta';
import { FALLBACK_PATCH, resolvePatchVersion } from './patchVersion';
import {
  createLcuClient,
  getSharedLcuAuth,
  invalidateSharedLcuAuth,
  resolveLcuAuthAsync,
  type LcuAuth
} from '../lcu';

/**
 * 客户端资源路径的候选表。
 *
 * 路径各版本不太一样,先按经验值挨个试;全都没中再去客户端的元数据里
 * 找**权威路径**(见 loadIconPathMap)。
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

/**
 * 客户端元数据里带图标路径的字段。
 *
 * 猜路径靠不住 —— 腾讯客户端的 `/lol-game-data/assets/v1/item/{id}.png`
 * 直接回 400。客户端自己的元数据(items.json / champion-summary.json)
 * 里带着每个 id 的**真实图标路径**,从那儿读最靠谱。
 */
const LCU_ICON_METADATA: Record<IconKind, string> = {
  champion: '/lol-game-data/assets/v1/champion-summary.json',
  item: '/lol-game-data/assets/v1/items.json'
};

/** 每个类型优先读哪个字段当图标路径。 */
const ICON_PATH_FIELDS: Record<IconKind, string[]> = {
  champion: ['squarePortraitPath', 'portraitPath'],
  item: ['iconPath', 'iconLargePath', 'iconSmallPath']
};

const LCU_TIMEOUT_MS = 5_000;
const DDRAGON_TIMEOUT_MS = 10_000;
const DDRAGON_CDN_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/** 同一个图标同时被多个 <img> 请求时的去重表。 */
const inflight = new Map<string, Promise<Buffer>>();

/** 已经报过「客户端资源没命中」的图标类型,避免同一个错刷几十遍。 */
const loggedLcuMisses = new Set<IconKind>();

/** 从客户端元数据里读出来的 id → 图标路径。 */
const iconPathMaps = new Map<IconKind, Map<number, string>>();

/** 已经报过「这个补丁能用」的版本号,避免每张图标都喊一遍。 */
const loggedDdragonPatches = new Set<string>();

/** 已经报过「这类图标是从哪儿取到的」,每种组合只喊一遍。 */
const loggedSources = new Set<string>();

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
      console.warn('[iconAssets] icon request failed', ref, e);
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
  if (cached) {
    const tag = `${kind}:cache`;
    if (!loggedSources.has(tag)) {
      loggedSources.add(tag);
      console.log(`[iconAssets] ${kind} icons served from disk cache`);
    }
    return cached;
  }

  // 英雄头像客户端就有,先走本机;物品图标客户端不提供,只能走 DDG
  const order: ('lcu' | 'ddragon')[] = kind === 'item' ? ['ddragon', 'lcu'] : ['lcu', 'ddragon'];

  for (const source of order) {
    const buffer =
      source === 'lcu' ? await fetchFromLcu(kind, id) : await fetchFromDdragon(kind, id);
    if (buffer) {
      const tag = `${kind}:${source}`;
      if (!loggedSources.has(tag)) {
        loggedSources.add(tag);
        console.log(`[iconAssets] ${kind} icons served from ${source} (e.g. ${kind}/${id})`);
      }
      await writeCache(kind, id, buffer);
      return buffer;
    }
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
    console.warn('[iconAssets] cache write failed', target, e);
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
      let detail: string | undefined;
      const note = (result: LcuFetchResult, label: string): void => {
        statuses.push(`${label}=${result.status ?? 'ERR'}`);
        if (!detail && result.detail) detail = result.detail;
      };

      // 元数据已经读过的话,权威路径排最前面 —— 一次就中
      const known = iconPathMaps.get(kind)?.get(id);
      if (known) {
        const result = await tryFetchLcu(auth, known);
        if (result.buffer) return result.buffer;
        if (result.authFailed) authFailed = true;
        note(result, known);
      }

      // 经验候选路径
      for (const candidate of candidates) {
        const result = await tryFetchLcu(auth, candidate);
        if (result.buffer) return result.buffer;
        if (result.authFailed) authFailed = true;
        note(result, candidate);
      }

      // 元数据还没读过 —— 读一次,拿权威路径再试
      if (!iconPathMaps.has(kind)) {
        const authoritative = await lookupAuthoritativePath(kind, id, auth);
        if (authoritative) {
          const result = await tryFetchLcu(auth, authoritative);
          if (result.buffer) {
            console.log(`[iconAssets] HIT ${kind}/${id} via client metadata: ${authoritative}`);
            return result.buffer;
          }
          if (result.authFailed) authFailed = true;
          note(result, authoritative);
        }
      }

      // 路径全试过了还没中 —— 每种类型只报一次,不然刷屏
      if (!loggedLcuMisses.has(kind)) {
        loggedLcuMisses.add(kind);
        const suffix = detail ? ` | body: ${detail}` : '';
        console.warn(`[iconAssets] MISS ${kind} tried: ${statuses.join(' ')}${suffix}`);
      }
      // 401/403 说明 token 过期了(客户端重启过),换一份凭据再试一轮
      if (!authFailed) return null;
      invalidateSharedLcuAuth();
      localAuth = null;
      localAuthFailedAt = 0;
      iconPathMaps.clear();
    }
    return null;
  });
}

/**
 * 从客户端元数据里查 id 对应的图标路径。
 *
 * 猜路径靠不住:腾讯客户端的物品图标路径不是 `item/` 也不是 `items/`,
 * 挨个试都是 400。客户端自己的 items.json / champion-summary.json 里
 * 带着每个 id 的真实路径,从那儿读最稳。
 */
async function lookupAuthoritativePath(
  kind: IconKind,
  id: number,
  auth: LcuAuth
): Promise<string | null> {
  const map = await loadIconPathMap(kind, auth);
  return map.get(id) ?? null;
}

/** 拉一次客户端元数据,建 id → 图标路径的表;只拉一次,之后都用缓存。 */
async function loadIconPathMap(kind: IconKind, auth: LcuAuth): Promise<Map<number, string>> {
  const cached = iconPathMaps.get(kind);
  if (cached) return cached;

  const raw = await lcuGetJson(auth, LCU_ICON_METADATA[kind]);
  const entries = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : [];

  // 英雄:同一个 id 下还挂着皮肤条目,本体条目(带 roles)的路径才算数
  const base = new Map<number, string>();
  const fallback = new Map<number, string>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = Number(entry.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const path = pickIconPath(kind, entry);
    if (!path) continue;
    const isBase = Array.isArray(entry.roles) && entry.roles.length > 0;
    const target = isBase ? base : fallback;
    if (!target.has(id)) target.set(id, path);
  }

  const map = new Map<number, string>([...fallback, ...base]);

  if (map.size === 0) {
    // 元数据里没有可用的路径字段 —— 把字段名打出来,好知道该认哪个
    const first = entries.find((entry) => isRecord(entry));
    const keys = first && isRecord(first) ? Object.keys(first).join(',') : '(empty)';
    console.warn(`[iconAssets] no icon path field in ${LCU_ICON_METADATA[kind]}, keys: ${keys}`);
    return map;
  }

  iconPathMaps.set(kind, map);
  console.log(`[iconAssets] ${kind} icon paths from client metadata: ${map.size} entries`);
  return map;
}

/** 从一条元数据里挑出图标路径。 */
function pickIconPath(kind: IconKind, entry: Record<string, unknown>): string | null {
  for (const field of ICON_PATH_FIELDS[kind]) {
    const value = entry[field];
    if (typeof value === 'string' && value.endsWith('.png')) return value;
  }
  // 兜底:任何叫 xxxPath 的 png 字段(原画 splash 这类不要)
  for (const [key, value] of Object.entries(entry)) {
    if (!key.endsWith('Path') || key.toLowerCase().includes('splash')) continue;
    if (typeof value === 'string' && value.endsWith('.png')) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface LcuFetchResult {
  buffer: Buffer | null;
  authFailed: boolean;
  /** HTTP 状态码;连接层出错时是 undefined */
  status?: number;
  /** 错误响应体的一小截,用来认出「路径不对」还是别的原因 */
  detail?: string;
}

async function tryFetchLcu(auth: LcuAuth, assetPath: string): Promise<LcuFetchResult> {
  try {
    // 走 createLcuClient 而不是裸 axios:
    //   1) proxy: false —— 装了代理软件的机器上,裸 axios 会把回环请求丢给代理,必挂;
    //   2) baseURL 用 auth.protocol / auth.host —— 不再硬编码 https://127.0.0.1;
    //   3) 自签证书照样放行。
    const client = createLcuClient(auth);
    const { data } = await client.get<ArrayBuffer>(assetPath, {
      responseType: 'arraybuffer',
      timeout: LCU_TIMEOUT_MS,
      validateStatus: (status) => status === 200
    });
    const buffer = Buffer.from(data);
    return { buffer: buffer.length > 0 ? buffer : null, authFailed: false, status: 200 };
  } catch (e: unknown) {
    const response = (e as { response?: { status?: number; data?: unknown } })?.response;
    const status = response?.status;
    return {
      buffer: null,
      authFailed: status === 401 || status === 403,
      status,
      detail: readDetail(response?.data)
    };
  }
}

/** 错误响应体取个短摘要 —— LCU 有时会在里面说明为什么 400。 */
function readDetail(data: unknown): string | undefined {
  if (!data) return undefined;
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 120);
}

/** GET 一次客户端的 JSON 接口。 */
async function lcuGetJson(auth: LcuAuth, url: string): Promise<unknown | null> {
  try {
    // url 是相对路径('/lol-game-data/...') —— 必须有 baseURL 才能拼成绝对地址。
    // 之前这里用裸 axios.get(相对路径),axios 在 Node 端会直接抛 Invalid URL,
    // 元数据一次都没加载成功过。
    const client = createLcuClient(auth);
    const { data } = await client.get(url, {
      timeout: LCU_TIMEOUT_MS,
      validateStatus: (status) => status === 200
    });
    return data;
  } catch {
    return null;
  }
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

/** 客户端报的版本号,只探一次。 */
let patchPromise: Promise<string> | null = null;

/**
 * 问客户端当前是哪个补丁。
 *
 * 腾讯客户端报的是 `16.18.8165012+branch.releases-...`,原样拼到 CDN 路径
 * 里每个请求都 403 —— patchVersion.ts 负责归一化成 `X.Y.1`。
 */
function resolvePatch(): Promise<string> {
  if (!patchPromise) {
    patchPromise = (async () => {
      const auth = await resolveAuth();
      if (!auth) return FALLBACK_PATCH;
      try {
        return await resolvePatchVersion(createLcuClient(auth));
      } catch {
        return FALLBACK_PATCH;
      }
    })();
  }
  return patchPromise;
}

/** 值得试的补丁号:客户端报的优先,再退到静态数据用过的版本、兜底版本。 */
async function ddragonPatches(): Promise<string[]> {
  const out: string[] = [];
  const fromClient = await resolvePatch();
  out.push(fromClient);
  const meta = getIconMeta();
  if (meta.version && !out.includes(meta.version)) out.push(meta.version);
  if (!out.includes(FALLBACK_PATCH)) out.push(FALLBACK_PATCH);
  return out;
}

async function fetchFromDdragon(kind: IconKind, id: number): Promise<Buffer | null> {
  // 物品图标按 id 命名(1001.png),英雄图标按英文名命名(Aatrox.png)
  const file = kind === 'champion' ? getIconMeta().championFiles.get(id) : `${id}.png`;
  if (!file) return null;

  for (const patch of await ddragonPatches()) {
    const url = `${DDRAGON_CDN_BASE}/${patch}/img/${kind}/${file}`;
    const buffer = await fetchDdragonImage(url);
    if (buffer) {
      if (!loggedDdragonPatches.has(patch)) {
        loggedDdragonPatches.add(patch);
        console.log(`[iconAssets] ddragon patch ${patch} works for ${kind}/${id}`);
      }
      return buffer;
    }
  }
  return null;
}

async function fetchDdragonImage(url: string): Promise<Buffer | null> {
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
