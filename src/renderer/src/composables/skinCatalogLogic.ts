// composables 目录在 src/renderer/src/ 下,往上三层才是 src/
import type { CatalogSkin } from '../../../preload/index';

/**
 * 解析后端给的时间字符串。
 *
 * 后端全局 Jackson 把 LocalDateTime 序列化成 "yyyy-MM-dd HH:mm:ss"(空格分隔),
 * 不是 ISO 8601 的 'T' 分隔。不同 JS 引擎对空格形式的 Date.parse 结果不统一,
 * 所以自己换成 'T' 再按本地时间解析。已经是 ISO 的原样返回。
 * 解析不了返回 null,别显示 NaN。
 */
export function parseServerTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(' ', 'T');
  if (!normalized) return null;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
}

export function isOwned(skin: CatalogSkin, ownedIds: Set<number>): boolean {
  return skin.skinId != null && ownedIds.has(skin.skinId);
}

/**
 * 英雄默认皮肤(原皮)。
 *
 * skinId = champId * 1000,人人都有,不是「可收集的皮肤」—— 游戏收藏册本来就不算它们。
 * 目录里混着这批行,界面上看着像一堆未拥有的皮肤(原皮的名字和英雄名一模一样),
 * 浏览图鉴时也要剔掉。
 *
 * 没有 skinId 的老数据只能靠名字兜底:原皮的名字 = 英雄名。
 */
export function isDefaultSkin(skin: CatalogSkin): boolean {
  if (skin.skinId != null) return skin.skinId % 1000 === 0;
  return !!skin.name && !!skin.heroName && skin.name === skin.heroName;
}

export function dropDefaultSkins(records: CatalogSkin[]): CatalogSkin[] {
  return records.filter((r) => !isDefaultSkin(r));
}

/**
 * t_skin 里同一个 skin_id 可能有多行(不同系列),网格里会出现重复卡片,
 * 「已拥有」也会被重复计数。这里按 skinId 去重,保留第一条。
 * 没有 skinId 的行无法去重,原样保留。
 */
export function dedupeBySkinId(records: CatalogSkin[]): CatalogSkin[] {
  const seen = new Set<number>();
  const out: CatalogSkin[] = [];
  for (const r of records) {
    if (r.skinId == null) {
      out.push(r);
      continue;
    }
    if (seen.has(r.skinId)) continue;
    seen.add(r.skinId);
    out.push(r);
  }
  return out;
}

export interface CatalogFilters {
  keyword: string;
  heroId: number | null;
  rarity: string | null;
  onlyUnowned: boolean;
}

export function filterSkins(
  skins: CatalogSkin[],
  ownedIds: Set<number>,
  filters: CatalogFilters
): CatalogSkin[] {
  const kw = filters.keyword.trim().toLowerCase();
  return skins.filter((s) => {
    if (filters.heroId != null && s.heroId !== filters.heroId) return false;
    if (filters.rarity && s.rarity !== filters.rarity) return false;
    if (filters.onlyUnowned && isOwned(s, ownedIds)) return false;
    if (kw) {
      const hay = `${s.name ?? ''} ${s.nameEn ?? ''} ${s.heroName ?? ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export interface VisibleRange {
  startIndex: number;
  endIndex: number;
}

export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  cols: number,
  totalItems: number,
  overscanRows = 2
): VisibleRange {
  if (totalItems <= 0 || cols <= 0) return { startIndex: 0, endIndex: 0 };
  const rows = Math.ceil(totalItems / cols);
  // firstRow 必须夹到 rows-1:否则滚过头时 startIndex 会大于 totalItems,
  // slice(startIndex, endIndex) 变成空数组,网格底部整片空白。
  const firstRow = Math.max(
    0,
    Math.min(rows - 1, Math.floor(scrollTop / rowHeight) - overscanRows)
  );
  const lastRow = Math.min(
    rows - 1,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows
  );
  return {
    startIndex: firstRow * cols,
    endIndex: Math.min(totalItems, (lastRow + 1) * cols)
  };
}

export interface OwnedStats {
  /** 目录中实际被标为「已拥有」的皮肤件数(去重后) */
  ownedMatched: number;
  /** LCU / 后端报告的已拥有总数 */
  ownedReported: number;
  /** 报告了但目录里没有的件数 */
  ownedMissingFromCatalog: number;
  /** 目录中 skinId 非空的比例,0~1 */
  skinIdCoverage: number;
  /**
   * 可收集皮肤数(按 skinId 去重、去掉英雄默认皮肤)。
   * 口径与后端 my-collection 的 totalSkinsInGame 一致 —— 默认皮肤人人都有,
   * 客户端的收藏册也不把它们算进去,留着会让完成率永远差一截。
   */
  collectableTotal: number;
}

export function computeStats(
  skins: CatalogSkin[],
  ownedIds: Set<number>,
  ownedReported: number
): OwnedStats {
  const matched = new Set<number>();
  const collectable = new Set<number>();
  let withId = 0;
  for (const s of skins) {
    if (s.skinId == null) continue;
    withId += 1;
    // 英雄默认皮肤:skinId = champId * 1000,人人都有,不计入可收集
    if (s.skinId % 1000 === 0) continue;
    collectable.add(s.skinId);
    if (ownedIds.has(s.skinId)) matched.add(s.skinId);
  }
  return {
    ownedMatched: matched.size,
    ownedReported,
    ownedMissingFromCatalog: Math.max(0, ownedReported - matched.size),
    skinIdCoverage: skins.length ? withId / skins.length : 0,
    collectableTotal: collectable.size
  };
}
