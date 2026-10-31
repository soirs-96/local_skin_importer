import type { AxiosInstance } from 'axios';
import * as lcu from './lcu';
import { fetchCatalogSkinIds } from './catalog';

/**
 * 「已拥有皮肤」的数据来源。
 *  - inventory: LCU 库存端点,权威口径,能读到已下架(绝版)的皮肤
 *  - store:     商城目录 owned 标记,降级口径,读不到已下架皮肤
 */
export type OwnedDataSource = 'inventory' | 'store';

export interface OwnedSkinSet {
  ownedSkinIds: number[];
  source: OwnedDataSource;
  /** 是否已跟站内目录取交集(后端没升级 skinId 字段时为 false) */
  catalogFiltered: boolean;
}

/**
 * 英雄默认皮肤(skinId % 1000 === 0)不算「可收集的皮肤」——人人都有,
 * 游戏客户端的收藏册也不把它们计入。后端 my-collection 的 totalSkinsInGame /
 * ownedMatchedCount 用的是同一个规则,桌面端上传的集合必须跟它一致,
 * 两边的「已拥有 X / Y」才对得上。
 */
function isCollectableSkin(skinId: number): boolean {
  return skinId % 1000 !== 0;
}

/** 只留下「站内目录收录的」并且是「可收集皮肤」的 id。 */
function pickCollectableInCatalog(ids: number[], catalogIds: Set<number>): number[] {
  return ids.filter((id) => catalogIds.has(id) && isCollectableSkin(id));
}

/**
 * 算出「我拥有的皮肤」集合,只保留站内目录收录的。
 *
 * 口径 = **库存端点的 owned 条目 ∩ 站内目录的 skinId**。
 *
 * 为什么取交集:库存里混着炫彩(RECOLOR)、皮肤变体(skin_variant)、经典版英雄的长 id
 * (60000000 + champId*1000 + 序号),以及商城没收录的皮肤。站内目录一条炫彩/变体都没有,
 * 所以取交集就等于把这些噪声全滤掉,剩下的正好是「站内收录且我拥有」的真皮肤。
 * 后端 my-collection 的 totalOwnedCount 直接取上传条数,不上传目录外的 id,
 * 那个数字才有意义。
 *
 * 为什么不用商城目录定「什么是皮肤」:商城目录是**商品**目录,里面混着云顶棋盘、
 * 英雄礼包、货币、蛋 —— 全都标着 inventoryType: CHAMPION_SKIN。它只能当炫彩黑名单用。
 */
export async function resolveOwnedSkinIds(client: AxiosInstance): Promise<OwnedSkinSet> {
  let catalogIds: Set<number> | null = null;
  try {
    catalogIds = await fetchCatalogSkinIds();
  } catch {
    catalogIds = null;
  }

  if (!catalogIds) {
    // 站内目录拿不到(后端没升级 skinId 字段,或网络不通):没法取交集,
    // 退回商城口径 —— 那是老行为,至少炫彩/变体已经滤掉了。
    return {
      ownedSkinIds: (await lcu.getStoreOwnedSkinIds(client)).filter(isCollectableSkin),
      source: 'store',
      catalogFiltered: false
    };
  }

  let inventoryIds: number[] | null = null;
  try {
    inventoryIds = await lcu.getInventoryOwnedSkinIds(client);
  } catch {
    inventoryIds = null;
  }

  if (inventoryIds) {
    return {
      ownedSkinIds: pickCollectableInCatalog(inventoryIds, catalogIds),
      source: 'inventory',
      catalogFiltered: true
    };
  }

  // 库存端点不可用(老客户端没这个路由):退回商城口径,同样跟站内目录取交集。
  const storeIds = await lcu.getStoreOwnedSkinIds(client);
  return {
    ownedSkinIds: pickCollectableInCatalog(storeIds, catalogIds),
    source: 'store',
    catalogFiltered: true
  };
}
