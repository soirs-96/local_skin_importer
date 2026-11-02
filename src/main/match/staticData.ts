import axios, { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import { setIconMeta } from './iconMeta';

/**
 * 静态游戏数据:英雄 / 物品 / 天赋的中文名,以及图标 URL。
 *
 * 名字有两个来源:
 *
 *   - **Data Dragon**(带 zh_CN 语言包):名字最权威,一次给全;
 *   - **LCU 本地资源**:本机回环,一定拉得到,只是名字里混着皮肤条目。
 *
 * 两条路**同时跑**:Data Dragon 在国服经常拉不动,只给它 2.5 秒预算,超时就
 * 用 LCU 的结果 —— 名字可能带点皮肤名,但至少不为空。名字取两份的并集,
 * Data Dragon 优先。
 *
 * 图标不再走 Data Dragon 的 CDN URL —— 外网 CDN 一挂,界面上就是
 * 「英雄名有、头像和装备全是空的」。现在一律给 `lcuicon://` 自定义协议,
 * 由主进程从**客户端自带的资源**里取(见 iconAssets.ts)。
 */

const DDRAGON_API_BASE = 'https://ddragon.leagueoflegends.com/api';
const DDRAGON_CDN_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const DDRAGON_LOCALE = 'zh_CN';
const HTTP_TIMEOUT_MS = 15_000;
/** Data Dragon 的等待预算:超时就用 LCU 的名字。 */
const DDRAGON_BUDGET_MS = 2_500;
/** 试试 newest 之外的前一个版本 —— 新版本刚发时 CDN 常常还没同步。 */
const DDRAGON_VERSION_TRY_COUNT = 2;

/** 腾讯客户端的 champion-summary 里这些前缀代表「某个皮肤」而不是英雄本体。 */
const SKIN_ALIAS_PREFIXES = ['Jade_', 'PROJECT_', 'Spirit_', 'StarGuardian_'];

export interface ChampionInfo {
  name: string;
  iconUrl: string | null;
}

export interface ItemInfo {
  name: string;
  iconUrl: string | null;
}

export interface StaticData {
  /** Data Dragon 版本号;null = 没拿到(不影响图标,图标走客户端资源) */
  version: string | null;
  champions: Map<number, ChampionInfo>;
  items: Map<number, ItemInfo>;
  runes: Map<number, string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // 有些版本把 id 写成字符串("266"),照样当数字用
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/*                                  Data Dragon                                 */
/* -------------------------------------------------------------------------- */

/**
 * 取最近的几个版本号,新的在前。
 *
 * 新版本刚发布时 CDN 上的数据文件经常还没传完,这时退回上一个版本就好。
 */
export async function fetchDdragonVersions(): Promise<string[]> {
  try {
    const { data } = await axios.get<string[]>(`${DDRAGON_API_BASE}/versions.json`, {
      timeout: HTTP_TIMEOUT_MS
    });
    if (!Array.isArray(data)) return [];
    return data
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .slice(0, DDRAGON_VERSION_TRY_COUNT);
  } catch {
    return [];
  }
}

function ddragonDataUrl(version: string, file: string): string {
  return `${DDRAGON_CDN_BASE}/${version}/data/${DDRAGON_LOCALE}/${file}`;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const { data } = await axios.get(url, { timeout: HTTP_TIMEOUT_MS });
    return data;
  } catch {
    return null;
  }
}

export function parseDdragonChampions(raw: unknown): Map<number, ChampionInfo> {
  const out = new Map<number, ChampionInfo>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    out.set(id, {
      name: str(entry.name),
      iconUrl: lcuIconUrl('champion', id)
    });
  }
  return out;
}

/**
 * 英雄 id → Data Dragon 上的图片文件名(Aatrox.png)。
 *
 * 英雄图标在 Data Dragon 上按**英文名**命名,而客户端给的是数字 id,
 * 图标代理退到 Data Dragon 时需要这份对照表。
 */
export function parseDdragonChampionFiles(raw: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    const image = isRecord(entry.image) ? entry.image : {};
    const file = str(image.full);
    if (file) out.set(id, file);
  }
  return out;
}

export function parseDdragonItems(raw: unknown): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  if (!isRecord(raw)) return out;
  for (const entry of Object.values(raw)) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    out.set(id, {
      name: str(entry.name),
      iconUrl: lcuIconUrl('item', id)
    });
  }
  return out;
}

/** runesReforged.json:一棵树 = {id, name, slots:[{runes:[{id,name}]}]} */
export function parseRunes(raw: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(raw)) return out;
  for (const tree of raw) {
    if (!isRecord(tree)) continue;
    const treeId = num(tree.id);
    if (treeId) out.set(treeId, str(tree.name));
    const slots = Array.isArray(tree.slots) ? tree.slots : [];
    for (const slot of slots) {
      if (!isRecord(slot)) continue;
      const runes = Array.isArray(slot.runes) ? slot.runes : [];
      for (const rune of runes) {
        if (!isRecord(rune)) continue;
        const runeId = num(rune.id);
        if (runeId) out.set(runeId, str(rune.name));
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                 LCU 兜底                                    */
/* -------------------------------------------------------------------------- */

/**
 * 判断一个 champion-summary 条目有多像「英雄本体」。
 *
 * 腾讯客户端的这份数据混着皮肤条目,而且**皮肤条目也挂在英雄 id 上** ——
 * 同一个 id 会出现好几次。本体条目用这几个信号认:
 *
 *   1. `roles` —— 本体条目有角色列表(法师/射手/...),皮肤条目没有;
 *   2. `skinId` —— 本体没有这个字段(或为 0),皮肤条目有;
 *   3. alias —— 本体就是英雄名,皮肤条目带皮肤前缀(Jade_ / PROJECT_ ...);
 *   4. 名字 —— 本体的中文名没有空格,皮肤名是「皮肤名 英雄名」的格式。
 *
 * 分值越低越像本体。
 */
function lcuBaseScore(entry: Record<string, unknown>, alias: string, name: string): number {
  let score = 0;
  if (hasRoles(entry)) score -= 50;
  if (hasSkinId(entry)) score += 100;
  if (SKIN_ALIAS_PREFIXES.some((prefix) => alias.startsWith(prefix))) score += 50;
  if (alias.includes('_')) score += 20;
  if (name.includes(' ')) score += 10;
  return score;
}

function hasRoles(entry: Record<string, unknown>): boolean {
  const roles = entry.roles;
  return Array.isArray(roles) && roles.length > 0;
}

function hasSkinId(entry: Record<string, unknown>): boolean {
  const raw = entry.skinId;
  if (raw === undefined || raw === null) return false;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value !== 0;
}

/**
 * 从 LCU 的 champion-summary.json 里挑出「英雄本体」条目。
 *
 * 挑不出来就退回第一条(名字至少不是空的)。
 */
export function parseLcuChampions(raw: unknown): Map<number, ChampionInfo> {
  const out = new Map<number, ChampionInfo>();
  if (!Array.isArray(raw)) return out;

  const best = new Map<
    number,
    { score: number; name: string; alias: string; info: ChampionInfo }
  >();

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;

    const alias = str(entry.alias) || str(entry.key) || str(entry.nameId);
    const name = str(entry.name) || alias;
    const info: ChampionInfo = { name, iconUrl: lcuIconUrl('champion', id) };
    const score = lcuBaseScore(entry, alias, name);

    const current = best.get(id);
    if (!current || score < current.score) {
      best.set(id, { score, name, alias, info });
      continue;
    }
    if (score === current.score && isBetterTie(name, alias, current.name, current.alias)) {
      best.set(id, { score, name, alias, info });
    }
  }

  for (const [id, entry] of best) out.set(id, entry.info);
  return out;
}

/**
 * 同分时的取舍:alias 短的更像本体(本体的 alias 就是英雄名本身),
 * 再比名字长度。
 */
function isBetterTie(name: string, alias: string, otherName: string, otherAlias: string): boolean {
  if (alias.length !== otherAlias.length) return alias.length < otherAlias.length;
  return name.length < otherName.length;
}

export function parseLcuItems(raw: unknown): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  if (!isRecord(raw)) return out;
  for (const entry of Object.values(raw)) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    out.set(id, { name: str(entry.name), iconUrl: lcuIconUrl('item', id) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                   加载                                       */
/* -------------------------------------------------------------------------- */

export function emptyStaticData(): StaticData {
  return {
    version: null,
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  };
}

/**
 * Data Dragon 一路。
 *
 * 三个文件**各自独立**:item.json 或 runesReforged.json 拉不到,不影响
 * 英雄 —— 之前是一个 `Promise.all`,任意一个文件失败就把整份 Data Dragon
 * 丢掉,于是英雄名也一起退成了 LCU 的皮肤名。
 */
async function loadFromDdragon(): Promise<StaticData | null> {
  const versions = await fetchDdragonVersions();

  for (const version of versions) {
    const championsRaw = await fetchJson(ddragonDataUrl(version, 'champion.json'));
    if (!championsRaw) continue;

    const champions = parseDdragonChampions(championsRaw);
    if (champions.size === 0) continue;

    const [itemsRaw, runesRaw] = await Promise.all([
      fetchJson(ddragonDataUrl(version, 'item.json')),
      fetchJson(ddragonDataUrl(version, 'runesReforged.json'))
    ]);

    const items = itemsRaw ? parseDdragonItems(itemsRaw) : new Map<number, ItemInfo>();
    const runes = runesRaw ? parseRunes(runesRaw) : new Map<number, string>();

    // 图标代理退到 Data Dragon 时要用的对照表
    setIconMeta({ version, championFiles: parseDdragonChampionFiles(championsRaw) });

    return { version, champions, items, runes };
  }
  return null;
}

/** LCU 一路:本机回环,三个文件也是各自独立。 */
async function loadFromLcu(client: AxiosInstance): Promise<StaticData> {
  const out = emptyStaticData();

  const championsRaw = await fetchFromClient(
    client,
    '/lol-game-data/assets/v1/champion-summary.json'
  );
  if (championsRaw) out.champions = parseLcuChampions(championsRaw);

  const itemsRaw = await fetchFromClient(client, '/lol-game-data/assets/v1/items.json');
  if (itemsRaw) out.items = parseLcuItems(itemsRaw);

  const runesRaw = await fetchFromClient(client, '/lol-game-data/assets/v1/runesReforged.json');
  if (runesRaw) out.runes = parseRunes(runesRaw);

  return out;
}

async function fetchFromClient(client: AxiosInstance, url: string): Promise<unknown | null> {
  try {
    const { data } = await client.get(url, { timeout: HTTP_TIMEOUT_MS });
    return data;
  } catch {
    return null;
  }
}

/** 两份数据取并集,Data Dragon 优先。 */
function mergeStaticData(primary: StaticData, fallback: StaticData): StaticData {
  const champions = new Map(fallback.champions);
  for (const [id, info] of primary.champions) champions.set(id, info);

  const items = new Map(fallback.items);
  for (const [id, info] of primary.items) items.set(id, info);

  const runes = new Map(fallback.runes);
  for (const [id, name] of primary.runes) runes.set(id, name);

  return { version: primary.version, champions, items, runes };
}

/**
 * 拿静态数据。
 *
 * Data Dragon 和 LCU 同时开跑 —— Data Dragon 只给 2.5 秒预算,超时按 LCU 的算。
 * 两条路都拿到的部分取并集,Data Dragon 优先。
 *
 * `lcuClient` 可以不传 —— 那就只有 Data Dragon 一条路,失败就是空数据。
 */
export async function loadStaticData(lcuClient?: AxiosInstance): Promise<StaticData> {
  if (!lcuClient) {
    const ddragon = await loadFromDdragon().catch(() => null);
    return ddragon ?? emptyStaticData();
  }

  const lcuPromise = loadFromLcu(lcuClient);
  const ddragon = await Promise.race([
    loadFromDdragon().catch(() => null),
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), DDRAGON_BUDGET_MS);
      timer.unref?.();
    })
  ]);

  const lcu = await lcuPromise;
  return ddragon ? mergeStaticData(ddragon, lcu) : lcu;
}

/* -------------------------------------------------------------------------- */
/*                                  段位徽章                                     */
/* -------------------------------------------------------------------------- */

// 段位徽章的绘制在 src/shared/tierIcon.ts —— 渲染进程也要用同一份实现。
export { tierIconDataUrl } from '../../shared/tierIcon';
