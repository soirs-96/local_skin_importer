import axios, { AxiosInstance } from 'axios';

/**
 * 静态游戏数据:英雄 / 物品 / 天赋的中文名与图标 URL。
 *
 * 主源是 Data Dragon(带 zh_CN 语言包),它一次给全:
 *   - 版本号     api/versions.json
 *   - 英雄       cdn/{v}/data/zh_CN/champion.json
 *   - 物品       cdn/{v}/data/zh_CN/item.json
 *   - 天赋       cdn/{v}/data/zh_CN/runesReforged.json
 *
 * Data Dragon 挂了才退回 LCU 的本地静态资源 —— 但 LCU 那边**只能拿到名字**:
 * 腾讯客户端的 champion-summary.json 里混着一千多条皮肤变体条目
 * (Jade_Annie / PROJECT_Vayne 之类),同一个英雄 id 会出现好几次。
 * 靠「alias 不带皮肤前缀」筛出本体,名字才不会被换成「玉剑传说 安妮」。
 *
 * 图标一律走 Data Dragon 的 CDN URL,渲染进程直接 <img src> 加载 ——
 * 不需要像 pywebview 那套 data: URI 内联(那是 WebView2 拦 file:// 跨域的
 * 权宜之计,Electron 渲染进程没这个限制)。
 */

const DDRAGON_API_BASE = 'https://ddragon.leagueoflegends.com/api';
const DDRAGON_CDN_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const DDRAGON_LOCALE = 'zh_CN';
const HTTP_TIMEOUT_MS = 15_000;

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
  /** Data Dragon 版本号;null = 拿不到(图标就都没有) */
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
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/* -------------------------------------------------------------------------- */
/*                                  Data Dragon                                 */
/* -------------------------------------------------------------------------- */

export async function fetchDdragonVersion(): Promise<string | null> {
  try {
    const { data } = await axios.get<string[]>(`${DDRAGON_API_BASE}/versions.json`, {
      timeout: HTTP_TIMEOUT_MS
    });
    const first = Array.isArray(data) ? data[0] : null;
    return typeof first === 'string' && first ? first : null;
  } catch {
    return null;
  }
}

function ddragonDataUrl(version: string, file: string): string {
  return `${DDRAGON_CDN_BASE}/${version}/data/${DDRAGON_LOCALE}/${file}`;
}

export function parseDdragonChampions(raw: unknown, version: string): Map<number, ChampionInfo> {
  const out = new Map<number, ChampionInfo>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    const image = isRecord(entry.image) ? entry.image : {};
    const file = str(image.full);
    out.set(id, {
      name: str(entry.name),
      iconUrl: file ? `${DDRAGON_CDN_BASE}/${version}/img/champion/${file}` : null
    });
  }
  return out;
}

export function parseDdragonItems(raw: unknown, version: string): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  if (!isRecord(raw)) return out;
  for (const entry of Object.values(raw)) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    const image = isRecord(entry.image) ? entry.image : {};
    const file = str(image.full);
    out.set(id, {
      name: str(entry.name),
      iconUrl: file ? `${DDRAGON_CDN_BASE}/${version}/img/item/${file}` : null
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
 * 从 LCU 的 champion-summary.json 里挑出「英雄本体」条目。
 *
 * 腾讯客户端的这份数据混着皮肤变体,同一个英雄 id 会出现多次:
 * `Jade_Annie`、`PROJECT_Vayne` 这种 alias 属于皮肤,只有 alias 不带任何
 * 已知皮肤前缀的条目才是本体。挑不出来就退回第一条(名字至少不是空的)。
 */
export function parseLcuChampions(raw: unknown): Map<number, ChampionInfo> {
  // 本体条目优先;只有皮肤条目时才退而用皮肤条目兜底(名字至少不是空的)。
  const base = new Map<number, ChampionInfo>();
  const skinFallback = new Map<number, ChampionInfo>();
  if (!Array.isArray(raw)) return base;

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    const alias = str(entry.alias) || str(entry.key) || str(entry.nameId);
    const info: ChampionInfo = { name: str(entry.name) || alias, iconUrl: null };
    const isSkinAlias = SKIN_ALIAS_PREFIXES.some((p) => alias.startsWith(p));
    if (!isSkinAlias) {
      if (!base.has(id)) base.set(id, info);
    } else if (!skinFallback.has(id)) {
      skinFallback.set(id, info);
    }
  }

  for (const [id, info] of skinFallback) {
    if (!base.has(id)) base.set(id, info);
  }
  return base;
}

export function parseLcuItems(raw: unknown): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  if (!isRecord(raw)) return out;
  for (const entry of Object.values(raw)) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;
    out.set(id, { name: str(entry.name), iconUrl: null });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                   加载                                       */
/* -------------------------------------------------------------------------- */

async function loadFromDdragon(): Promise<StaticData | null> {
  const version = await fetchDdragonVersion();
  if (!version) return null;

  const [championsRaw, itemsRaw, runesRaw] = await Promise.all([
    axios.get(ddragonDataUrl(version, 'champion.json'), { timeout: HTTP_TIMEOUT_MS }),
    axios.get(ddragonDataUrl(version, 'item.json'), { timeout: HTTP_TIMEOUT_MS }),
    axios.get(ddragonDataUrl(version, 'runesReforged.json'), { timeout: HTTP_TIMEOUT_MS })
  ]);

  const champions = parseDdragonChampions(championsRaw.data, version);
  const items = parseDdragonItems(itemsRaw.data, version);
  const runes = parseRunes(runesRaw.data);
  if (champions.size === 0) return null;

  return { version, champions, items, runes };
}

/**
 * 拿静态数据。Data Dragon 拿不到时退回 LCU 的本地资源(只有名字,没有图标)。
 *
 * `lcuClient` 可以不传 —— 那就只有 Data Dragon 一条路,失败就是空数据。
 */
export async function loadStaticData(lcuClient?: AxiosInstance): Promise<StaticData> {
  const ddragon = await loadFromDdragon().catch(() => null);
  if (ddragon) return ddragon;

  const empty: StaticData = {
    version: null,
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  };
  if (!lcuClient) return empty;

  try {
    const { data } = await lcuClient.get('/lol-game-data/assets/v1/champion-summary.json', {
      timeout: HTTP_TIMEOUT_MS
    });
    empty.champions = parseLcuChampions(data);
  } catch {
    // 拿不到就算了,界面上只显示英雄 id
  }
  try {
    const { data } = await lcuClient.get('/lol-game-data/assets/v1/items.json', {
      timeout: HTTP_TIMEOUT_MS
    });
    empty.items = parseLcuItems(data);
  } catch {
    // 同上
  }
  try {
    const { data } = await lcuClient.get('/lol-game-data/assets/v1/runesReforged.json', {
      timeout: HTTP_TIMEOUT_MS
    });
    empty.runes = parseRunes(data);
  } catch {
    // 同上
  }
  return empty;
}

/* -------------------------------------------------------------------------- */
/*                                  段位徽章                                     */
/* -------------------------------------------------------------------------- */

// 段位徽章的绘制在 src/shared/tierIcon.ts —— 渲染进程也要用同一份实现。
export { tierIconDataUrl } from '../../shared/tierIcon';
