import { getStoredUserId } from '../auth';
import { fetchCatalogSkinBySkinId } from '../catalog';
import { fetchMyRating, fetchSkinRatingStats } from '../rating';
import type { LocalSettlement, SettlementView } from '../../shared/settlement';

/**
 * 把「本地事实」补成「渲染进程要的那份」。
 *
 * 三步都**允许缺**:
 *   - 皮肤不在目录里 → skin = null
 *   - 后端没评分 / 挂了 → stats = null
 *   - 没登录 → myRating = null、loggedIn = false
 *
 * 缺的那块界面上整块不显示 —— **不编**。
 */

/** 跑一步,失败就退到 fallback —— 结算卡不能因为一个接口挂了就整个开不出来。 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function buildSettlementView(local: LocalSettlement): Promise<SettlementView> {
  const userId = getStoredUserId();
  const loggedIn = userId !== null;

  const catalogSkin = local.usedSkin.riotSkinId
    ? await safe(() => fetchCatalogSkinBySkinId(local.usedSkin.riotSkinId), null)
    : null;
  // 炫彩的底图那款皮肤 —— 站内目录里没有这条炫彩时要退到它,
  // 站内那条炫彩没有自己的立绘时图也要从它那儿取。
  const baseSkin = local.usedSkin.baseRiotSkinId
    ? await safe(() => fetchCatalogSkinBySkinId(local.usedSkin.baseRiotSkinId as number), null)
    : null;
  const skin = catalogSkin ?? baseSkin;
  // 展示用的图:炫彩自己没立绘(游戏里显示的是底图那张图调了色),
  // 站内那条炫彩的图字段多半是空的 → 图取底图那款的,打分对象不变。
  const art = skin && !skin.iconUrl && !skin.splashUrl ? (baseSkin ?? skin) : skin;
  const skinId = skin?.id ?? null;

  const stats = skinId !== null ? await safe(() => fetchSkinRatingStats(skinId), null) : null;
  const myRating =
    skinId !== null && userId !== null
      ? await safe(() => fetchMyRating(skinId, userId), null)
      : null;

  return {
    ...local,
    skin: skin
      ? {
          id: skin.id,
          skinId: skin.skinId,
          name: skin.name,
          nameEn: skin.nameEn,
          rarity: skin.rarity,
          iconUrl: art?.iconUrl ?? skin.iconUrl,
          splashUrl: art?.splashUrl ?? skin.splashUrl
        }
      : null,
    stats,
    myRating,
    loggedIn
  };
}
