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
  const skinId = catalogSkin?.id ?? null;

  const stats = skinId !== null ? await safe(() => fetchSkinRatingStats(skinId), null) : null;
  const myRating =
    skinId !== null && userId !== null
      ? await safe(() => fetchMyRating(skinId, userId), null)
      : null;

  return {
    ...local,
    skin: catalogSkin
      ? {
          id: catalogSkin.id,
          skinId: catalogSkin.skinId,
          name: catalogSkin.name,
          nameEn: catalogSkin.nameEn,
          rarity: catalogSkin.rarity,
          iconUrl: catalogSkin.iconUrl,
          splashUrl: catalogSkin.splashUrl
        }
      : null,
    stats,
    myRating,
    loggedIn
  };
}
