import axios, { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import { isRoleQuestItem } from '../../shared/gameLabels';
import type { ChampionIndexEntry } from '../../shared/recommendation';
import { setChampionFiles, setIconVersion } from './iconMeta';
import { patchCandidates } from './patchVersion';

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
 * **版本号不从 Data Dragon 的 API 取**,而是从客户端那里问(见
 * patchVersion.ts):腾讯客户端报的是 `16.18.8165012+branch...`,
 * 原样丢给 CDN 每个请求都 403。
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
  /** 英文名;没有就空 —— AI 有时写英文,认英文名才能配上头像 */
  nameEn?: string;
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
  /**
   * 英雄编号 → 该英雄的皮肤 id 清单(升序)。
   *
   * 来源是客户端的 `skins.json`(皮肤总目录,2000 多条)—— 这份清单是
   * 「皮肤序号 ↔ 皮肤 id」的**权威对照表**:换算出来的 id 拿它一校验
   * 就知道对不对,不用靠猜。
   *
   * ⚠️ 清单里**含炫彩** —— 客户端把炫彩和普通皮肤排在同一个 id 空间里
   * (英雄编号 × 1000 + 序号,序号连续)。炫彩的条目嵌套在底图那款的
   * `chromas` 数组里,解析时要一并收进来(见 `parseLcuSkins`)。
   */
  skinsByChampion: Map<number, number[]>;
  /** 皮肤 id → 那款皮肤(目录条目:中文名 + 美术资源路径)。 */
  skins: Map<number, SkinInfo>;
  /**
   * 炫彩 id → 它所属的普通皮肤 id。
   *
   * 客户端把炫彩和普通皮肤放在同一个 id 空间里:英雄编号 × 1000 + 序号,
   * 序号从 0 连续排到 K,普通皮肤和炫彩交替占位。
   *
   * 炫彩的条目**嵌套在底图那款的 `chromas` 数组里**(国服客户端实测),
   * 底图就是挂着它的那一条。
   */
  chromaBaseSkinIds: Map<number, number>;
  /**
   * 炫彩 id → 它的中文名(如「战场BOSS 卑尔维斯 拒绝之尾」)。
   *
   * 炫彩的名字自带底图皮肤名(客户端就是这么给的),所以界面上直接显示它,
   * 底下再标一句「炫彩」—— 只显示底图名字的话,玩家看到的是自己没用过的那款。
   */
  chromaNames: Map<number, string>;
}

/** 客户端 `skins.json` 里的一条皮肤。 */
export interface SkinInfo {
  /** 皮肤 id(1001 = 安妮的第二款皮肤) */
  id: number;
  /** 皮肤序号(= id % 1000) */
  index: number;
  /** 英雄编号(= id ÷ 1000) */
  championId: number;
  /** 客户端给的中文名(「哥特萝莉 安妮」;默认皮肤给的是英雄称号) */
  name: string;
  /** splash 图在客户端资源里的路径 —— 本机回环就能取到 */
  splashPath: string | null;
  /** 未居中的 splash(结算页那种构图更接近它) */
  uncenteredSplashPath: string | null;
  /** 载入画面 */
  loadScreenPath: string | null;
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
 * 这是 **Data Dragon 自己的版本列表**,只当兜底:国服网络上这个接口经常
 * 拉不到,拉到了也不一定是客户端正在跑的那个版本。真正的版本号由
 * {@link patchCandidates} 从客户端那里问出来。
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

/**
 * 版本候选:客户端报的版本优先。
 *
 * 只问客户端(本机回环,毫秒级)。Data Dragon 的版本列表当最后兜底 ——
 * 那个接口在国服经常拉不动,不能挡在前面。
 */
async function collectVersions(client?: AxiosInstance): Promise<string[]> {
  return patchCandidates(client).catch(() => []);
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
 * 腾讯客户端的 champion-summary 里,`name` 是**称号**(`黑暗之女`),
 * `description` 才是**英雄名**(`安妮`)。名字取 `description`。
 *
 * 皮肤条目的 description 是一整句皮肤描述,所以只认短的 —— 英雄名都是
 * 两三个字,描述再短也不会短过 8 个字。
 */
function lcuDisplayName(entry: Record<string, unknown>, fallback: string): string {
  const description = str(entry.description).trim();
  if (description && description.length <= 8) return description;
  return fallback;
}

/**
 * 英雄本体条目的两个名字。
 *
 * `name` 是中文英雄名,`nameEn` 是英文 key(Annie / MonkeyKing)。
 * 英文 key 是**跟后端英雄表对齐的唯一依据** —— 后端的英雄编号是导入脚本的
 * 自增序号,跟 Riot 的编号对不上,只有英文名两边是一样的。
 */
export interface ChampionSummary {
  name: string;
  nameEn: string;
}

/**
 * 从 LCU 的 champion-summary.json 里挑出「英雄本体」条目。
 *
 * 挑不出来就退回第一条(名字至少不是空的)。
 */
export function parseLcuChampionSummaries(raw: unknown): Map<number, ChampionSummary> {
  const out = new Map<number, ChampionSummary>();
  if (!Array.isArray(raw)) return out;

  const best = new Map<
    number,
    { score: number; name: string; alias: string; summary: ChampionSummary }
  >();

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = num(entry.id);
    if (!id) continue;

    const alias = str(entry.alias) || str(entry.key) || str(entry.nameId);
    const rawName = str(entry.name) || alias;
    const score = lcuBaseScore(entry, alias, rawName);
    const summary: ChampionSummary = {
      name: lcuDisplayName(entry, rawName),
      nameEn: alias
    };

    const current = best.get(id);
    if (!current || score < current.score) {
      best.set(id, { score, name: rawName, alias, summary });
      continue;
    }
    if (score === current.score && isBetterTie(rawName, alias, current.name, current.alias)) {
      best.set(id, { score, name: rawName, alias, summary });
    }
  }

  for (const [id, entry] of best) out.set(id, entry.summary);
  return out;
}

/** 英雄本体条目 → 图鉴要用的名字和图标。 */
export function parseLcuChampions(raw: unknown): Map<number, ChampionInfo> {
  const out = new Map<number, ChampionInfo>();
  for (const [id, summary] of parseLcuChampionSummaries(raw)) {
    out.set(id, {
      name: summary.name,
      iconUrl: lcuIconUrl('champion', id),
      nameEn: summary.nameEn
    });
  }
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
    runes: new Map(),
    skinsByChampion: new Map(),
    skins: new Map(),
    chromaBaseSkinIds: new Map(),
    chromaNames: new Map()
  };
}

/**
 * 从 skins.json 里挑出「皮肤目录」。
 *
 * 客户端的 `skins.json` 是**皮肤的总目录**:一条一个皮肤,2000 多条。
 * 每条长这样(国服实测):
 *
 * ```json
 * { "id": 1000, "name": "黑暗之女", "isBase": true,
 *   "splashPath": ".../Characters/Annie/Skins/Base/Images/annie_splash_centered_0.jpg" }
 * { "id": 1001, "name": "哥特萝莉 安妮", "isBase": false,
 *   "splashPath": ".../Characters/Annie/Skins/Skin01/Images/annie_splash_centered_1.jpg" }
 * ```
 *
 * 三件事靠它:
 *
 *   - **英雄编号** = `id ÷ 1000`(1001 → 1,266001 → 266);
 *   - **皮肤序号** = `id % 1000`,而且 splash 文件名末尾的 `_N` 正好等于它
 *     —— 客户端自己的数据,不用推;
 *   - **美术资源路径** —— splash / 未居中 splash / 载入画面,本机回环就能取到。
 *
 * ⚠️ **炫彩不在顶层** —— 它挂在底图那一条的 `chromas` 数组里:
 *
 * ```json
 * { "id": 119058, "name": "最高清算 德莱文", "skinClassification": "kChampion",
 *   "chromas": [{ "id": 119067, "name": "最高清算 德莱文 至强",
 *                 "skinClassification": "kRecolor", "chromaPath": "..." }] }
 * ```
 *
 * 客户端给的皮肤序号把炫彩算在**同一个 id 空间**里(序号连续),所以炫彩的
 * id 必须一并收进清单 —— 漏了,用了炫彩的那一局就换算不出皮肤 id。
 *
 * ⚠️ `champion-summary.json` 里**没有**皮肤信息(国服实测 262 条,
 * 每条只有 id/name/alias/roles)—— 别拿它当皮肤对照表。
 */
export function parseLcuSkins(raw: unknown): {
  byChampion: Map<number, number[]>;
  infos: Map<number, SkinInfo>;
  chromaBaseSkinIds: Map<number, number>;
  chromaNames: Map<number, string>;
} {
  const byChampion = new Map<number, number[]>();
  const infos = new Map<number, SkinInfo>();
  const chromaBaseSkinIds = new Map<number, number>();
  const chromaNames = new Map<number, string>();

  const entries: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      if (isRecord(entry)) entries.push(entry);
    });
  } else if (isRecord(raw)) {
    for (const entry of Object.values(raw)) {
      if (isRecord(entry)) entries.push(entry);
    }
  }

  // 先按英雄归堆 —— 炫彩要知道自己属于哪款底图,得看它前面的普通皮肤
  const perChampion = new Map<number, { id: number; entry: Record<string, unknown> }[]>();
  for (const entry of entries) {
    const id = num(entry.id);
    if (id <= 0) continue;
    const championId = Math.floor(id / 1000);
    if (championId <= 0) continue;
    const list = perChampion.get(championId) ?? [];
    list.push({ id, entry });
    perChampion.set(championId, list);
  }

  for (const [championId, list] of perChampion) {
    list.sort((a, b) => a.id - b.id);
    const ids: number[] = [];
    let lastChampionSkinId = 0;
    for (const { id, entry } of list) {
      // 英雄皮肤和炫彩都收 —— 客户端数据里还混着地图皮肤等别的分类
      const classification = str(entry.skinClassification);
      if (classification && classification !== 'kChampion' && classification !== 'kRecolor') {
        continue;
      }
      const index = id % 1000;
      // 同一个 id 只进一次 —— 清单里的**位置**就是「序号」的换算依据,
      // 重复一条会让位置整体错位,认到别的皮肤上。
      if (!ids.includes(id)) ids.push(id);

      if (classification === 'kRecolor') {
        // 炫彩没有自己的立绘,游戏里显示的是底图皮肤那张图调了色
        // ⚠️ 已经有归属就别改:嵌套在底图那条里的炫彩拿到的底图是**准的**
        // (就是挂着它的那一条),别拿「上一条普通皮肤」这个猜测覆盖掉。
        if (lastChampionSkinId > 0 && !chromaBaseSkinIds.has(id)) {
          chromaBaseSkinIds.set(id, lastChampionSkinId);
        }
        const chromaName = str(entry.name);
        if (chromaName) chromaNames.set(id, chromaName);
        continue;
      }

      lastChampionSkinId = id;
      // ⚠️ **炫彩是嵌套在底图那一条里的**(`chromas` 数组),不是顶层条目。
      // 国服客户端实测(2026-11-24,德莱文):
      //   顶层只有普通皮肤(119000~119006、119012、119013、119020、119029、
      //   119039、119048、119058、119068),炫彩全在底图那款的 `chromas` 里
      //   (119007~119011 挂在 119003 下、119067 挂在 119058 下……)。
      //
      // 而客户端给的皮肤序号**把炫彩算在同一个 id 空间里**(英雄编号 × 1000 + 序号)，
      // 序号连续 —— 所以炫彩的 id 必须进 id 空间。不进的话,用了炫彩的那一局
      // 换算出来的 id 校验不过 → 「认不出来」→ 只能退到英雄默认皮肤。
      const chromas = entry.chromas;
      if (Array.isArray(chromas)) {
        for (const chroma of chromas) {
          if (!isRecord(chroma)) continue;
          const chromaId = num(chroma.id);
          // 炫彩跟底图同一个英雄 —— 不是就别收(别的分类混进来会撑坏 id 空间)
          if (chromaId <= 0 || Math.floor(chromaId / 1000) !== championId) continue;
          if (!ids.includes(chromaId)) ids.push(chromaId);
          // 底图就是挂着它的那一条 —— 比「按 id 猜上一条普通皮肤」准
          chromaBaseSkinIds.set(chromaId, id);
          const chromaName = str(chroma.name);
          if (chromaName) chromaNames.set(chromaId, chromaName);
        }
      }
      const splashPath = str(entry.splashPath) || null;
      // splash 文件名末尾的 `_N` 应当就是序号 —— 对不上说明这份数据不守
      // 「皮肤 id = 英雄编号 × 1000 + 序号」,这条皮肤的图不能用,别收进目录。
      // ⚠️ 但**仍要留在 id 空间里**:少一条就会让「序号 → 位置」的换算整体错位,
      // 认到别的皮肤上 —— 那比认不出来糟糕得多。
      const suffix = splashPath ? /_(\d+)\.jpg$/i.exec(splashPath) : null;
      if (suffix && Number(suffix[1]) !== index) continue;

      infos.set(id, {
        id,
        index,
        championId,
        name: str(entry.name),
        splashPath,
        uncenteredSplashPath: str(entry.uncenteredSplashPath) || null,
        loadScreenPath: str(entry.loadScreenPath) || null
      });
    }
    // 这个英雄一条皮肤都没收到(整组都是别的分类)→ 不占位
    // 排序:id 空间是「英雄编号 × 1000 + 序号」,序号从小到大 = id 从小到大
    if (ids.length > 0) byChampion.set(championId, ids.sort((a, b) => a - b));
  }

  return { byChampion, infos, chromaBaseSkinIds, chromaNames };
}

/**
 * Data Dragon 一路。
 *
 * 三个文件**各自独立**:item.json 或 runesReforged.json 拉不到,不影响
 * 英雄 —— 之前是一个 `Promise.all`,任意一个文件失败就把整份 Data Dragon
 * 丢掉,于是英雄名也一起退成了 LCU 的皮肤名。
 */
async function loadFromDdragon(clientVersions: string[]): Promise<StaticData | null> {
  // 客户端报的版本先试;全都不中再问 Data Dragon 自己的版本列表(慢,兜底)
  for (const version of clientVersions) {
    const data = await loadDdragonVersion(version);
    if (data) return data;
  }
  for (const version of await fetchDdragonVersions()) {
    const data = await loadDdragonVersion(version);
    if (data) return data;
  }
  return null;
}

/** 拉某一个版本的 Data Dragon 数据。 */
async function loadDdragonVersion(version: string): Promise<StaticData | null> {
  // 版本号先记上 —— 物品图标只需要版本号,不用等 champion.json
  setIconVersion(version);

  const championsRaw = await fetchJson(ddragonDataUrl(version, 'champion.json'));
  if (!championsRaw) return null;

  const champions = parseDdragonChampions(championsRaw);
  if (champions.size === 0) return null;

  const [itemsRaw, runesRaw] = await Promise.all([
    fetchJson(ddragonDataUrl(version, 'item.json')),
    fetchJson(ddragonDataUrl(version, 'runesReforged.json'))
  ]);

  const items = itemsRaw ? parseDdragonItems(itemsRaw) : new Map<number, ItemInfo>();
  const runes = runesRaw ? parseRunes(runesRaw) : new Map<number, string>();

  // 图标代理退到 Data Dragon 时要用的对照表
  const championFiles = parseDdragonChampionFiles(championsRaw);
  setChampionFiles(championFiles);

  // 英文名从图片文件名反推(Aatrox.png → Aatrox)—— AI 偶尔写英文名。
  for (const [id, info] of champions) {
    const file = championFiles.get(id);
    if (file && !info.nameEn) info.nameEn = file.replace(/\.png$/i, '');
  }

  // Data Dragon 不给皮肤目录 —— 皮肤对照表只有 LCU 那份有。
  return {
    version,
    champions,
    items,
    runes,
    skinsByChampion: new Map(),
    skins: new Map(),
    chromaBaseSkinIds: new Map(),
    chromaNames: new Map()
  };
}

/** LCU 一路:本机回环,每个文件各自独立。 */
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

  // 皮肤目录:客户端的皮肤总目录(6MB 上下,本机回环,拉得到)。
  // 这是「皮肤序号 ↔ 皮肤 id」唯一的权威对照表 —— 没有它,换算出来的 id
  // 只能靠猜,认错皮肤等于给别人的皮肤打分。
  const skinsRaw = await fetchFromClient(client, '/lol-game-data/assets/v1/skins.json', {
    timeout: 30_000,
    maxContentLength: 32_000_000
  });
  if (skinsRaw) {
    const parsed = parseLcuSkins(skinsRaw);
    out.skinsByChampion = parsed.byChampion;
    out.skins = parsed.infos;
    out.chromaBaseSkinIds = parsed.chromaBaseSkinIds;
    out.chromaNames = parsed.chromaNames;
  }

  return out;
}

async function fetchFromClient(
  client: AxiosInstance,
  url: string,
  options?: { timeout?: number; maxContentLength?: number }
): Promise<unknown | null> {
  try {
    const { data } = await client.get(url, {
      timeout: options?.timeout ?? HTTP_TIMEOUT_MS,
      maxContentLength: options?.maxContentLength
    });
    return data;
  } catch {
    return null;
  }
}

/** 两份数据取并集,Data Dragon 优先。 */
function mergeStaticData(primary: StaticData, fallback: StaticData): StaticData {
  const champions = new Map(fallback.champions);
  for (const [id, info] of primary.champions) {
    // 中文名听 Data Dragon 的,英文名谁有算谁的 ——
    // Data Dragon 的 champion.json 里没有英文名,只有图片文件名。
    const local = fallback.champions.get(id);
    champions.set(id, { ...info, nameEn: info.nameEn ?? local?.nameEn });
  }

  const items = new Map(fallback.items);
  for (const [id, info] of primary.items) {
    // 角色任务道具(打野任务 / 辅助任务 …)只认客户端本地资源给的名字 ——
    // 它是判位置的关键,别被同编号的别的道具名盖掉。
    const local = fallback.items.get(id);
    items.set(id, local && isRoleQuestItem(local.name) ? local : info);
  }

  const runes = new Map(fallback.runes);
  for (const [id, name] of primary.runes) runes.set(id, name);

  // 皮肤目录只有 LCU 那份有(Data Dragon 不给)—— 直接用兜底那份。
  const skinsByChampion = new Map(fallback.skinsByChampion);
  const skins = new Map(fallback.skins);
  const chromaBaseSkinIds = new Map(fallback.chromaBaseSkinIds);
  const chromaNames = new Map(fallback.chromaNames);

  return {
    version: primary.version,
    champions,
    items,
    runes,
    skinsByChampion,
    skins,
    chromaBaseSkinIds,
    chromaNames
  };
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
  const result = await loadStaticDataInner(lcuClient);
  console.log(
    `[staticData] champions=${result.champions.size} items=${result.items.size} ` +
      `version=${result.version ?? 'none'}`
  );
  return result;
}

async function loadStaticDataInner(lcuClient?: AxiosInstance): Promise<StaticData> {
  if (!lcuClient) {
    const versions = await collectVersions(undefined);
    const ddragon = await loadFromDdragon(versions).catch(() => null);
    return ddragon ?? emptyStaticData();
  }

  // LCU 的名字和「探版本号」并行 —— 探版本号是本机回环,很快,但没必要让它挡着
  const lcuPromise = loadFromLcu(lcuClient);
  const ddragon = await Promise.race([
    collectVersions(lcuClient)
      .then((versions) => loadFromDdragon(versions))
      .catch(() => null),
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), DDRAGON_BUDGET_MS);
      timer.unref?.();
    })
  ]);

  const lcu = await lcuPromise;
  return ddragon ? mergeStaticData(ddragon, lcu) : lcu;
}

/* -------------------------------------------------------------------------- */
/*                                英雄名对照                                    */
/* -------------------------------------------------------------------------- */

/**
 * 英雄名 → 编号 的对照表。
 *
 * 界面靠它把 AI 给的英雄名配上头像 —— AI 只吐名字,不吐编号。
 * 只给名字和编号,图标地址由渲染进程自己拼(`lcuicon://`)。
 */
export function championIndexEntries(data: StaticData): ChampionIndexEntry[] {
  const out: ChampionIndexEntry[] = [];
  for (const [id, info] of data.champions) {
    if (!info.name) continue;
    out.push({ id, name: info.name, nameEn: info.nameEn });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                  段位徽章                                     */
/* -------------------------------------------------------------------------- */

// 段位徽章的绘制在 src/shared/tierIcon.ts —— 渲染进程也要用同一份实现。
export { tierIconDataUrl } from '../../shared/tierIcon';
