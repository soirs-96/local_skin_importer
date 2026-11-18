/**
 * 皮肤评分的「分制 / 段位」口径。
 *
 * ⚠️ **口径是从微信小程序搬过来的,不是重新发明的。** 来源:
 *   - `wechat_rating_program/utils/rating-tier.js`      —— RATING_TIERS / toTen
 *   - `wechat_rating_program/pages/skin-detail/index.js`  —— scoreToTier
 *   - `wechat_rating_program/components/skin-drawer/index.js` —— rankMap
 *
 * ⚠️ **`scoreToTier` 和 `rankMap` 不是同一个函数,也不能合并**:
 *   - `scoreToTier` 吃的是 **10 分制的聚合总分**
 *   - `rankMap`     吃的是 **1~5 的单维星级**
 *   两者的阈值也不一样(总分 5.0 是「NPC」,5 星却是「夯」)。
 *   有一单测专门把这个差异钉死,别去「优化」它。
 *
 * ⚠️ 这个文件跟 `src/shared/scoring.ts` 是**两套东西** —— 那份是玩家**表现分**。
 */

/** 段位 key */
export type TierKey = 'hang' | 'top' | 'above' | 'npc' | 'trash';

/** 段位元数据 —— 抄小程序 `utils/rating-tier.js` 的 RATING_TIERS */
export const RATING_TIERS: Record<TierKey, { label: string; color: string }> = {
  hang: { label: '夯', color: '#C8AA6E' },
  top: { label: '顶级', color: '#9D6EE3' },
  above: { label: '人上人', color: '#4A9EE3' },
  npc: { label: 'NPC', color: '#b8b8b8' },
  trash: { label: '拉完了', color: '#b85c5c' }
};

/**
 * 1~5 分制 → 10 分制展示,保留一位小数。
 *
 * 后端存的是 1~5 分制,界面统一按 10 分制显示 —— 量纲换算只此一处。
 */
export function toTen(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(v) * 2 * 10) / 10;
}

/**
 * 10 分制总分 → 段位 key。
 *
 * 抄小程序 `pages/skin-detail/index.js` 的 scoreToTier。
 */
export function scoreToTier(score: number | null | undefined): TierKey {
  if (score === null || score === undefined) return 'npc';
  if (score >= 9.0) return 'hang';
  if (score >= 8.0) return 'top';
  if (score >= 6.5) return 'above';
  if (score >= 5.0) return 'npc';
  return 'trash';
}

/**
 * 单维星级(1~5) → 段位文案。
 *
 * 抄小程序 `components/skin-drawer/index.js` 的 rankMap。**跟 scoreToTier 不是一回事。**
 */
export function rankMap(stars: number): string {
  const map: Record<number, string> = {
    5: '夯',
    4: '顶级',
    3: '人上人',
    2: 'NPC',
    1: '拉完了'
  };
  return map[stars] ?? '';
}

/** 四个评分维度 —— 标签照抄小程序,别改成近义词。 */
export const RATING_DIMENSIONS = [
  { key: 'handFeel', label: '手感巅峰' },
  { key: 'artwork', label: '原画天花板' },
  { key: 'model', label: '局部模型' },
  { key: 'mockery', label: '嘲讽拉满' }
] as const;

export type RatingDimensionKey = (typeof RATING_DIMENSIONS)[number]['key'];
