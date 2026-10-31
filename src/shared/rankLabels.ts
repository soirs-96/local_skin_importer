/**
 * 排位段位 / 队列的中文标签。
 *
 * 放 shared 是因为主进程要算 `RankedEntry.display`,渲染进程要显示队列名 ——
 * 两边得用同一份映射,不然界面上会出现「单双排」和「RANKED_SOLO_5x5」混排。
 */

export const TIER_LABELS: Record<string, string> = {
  IRON: '坚韧黑铁',
  BRONZE: '英勇青铜',
  SILVER: '荣耀白银',
  GOLD: '华贵黄金',
  PLATINUM: '璀璨铂金',
  EMERALD: '翡翠大师',
  DIAMOND: '璀璨钻石',
  MASTER: '超凡大师',
  GRANDMASTER: '傲世宗师',
  CHALLENGER: '至尊王者',
  UNRANKED: '未定级'
};

export const QUEUE_LABELS: Record<string, string> = {
  RANKED_SOLO_5x5: '单双排',
  RANKED_FLEX_SR: '灵活排位',
  RANKED_TEAM_5x5: '组队单双排',
  RANKED_TFT: '斗魂竞技场',
  RANKED_TFT_DOUBLE_UP: '斗魂竞技场(双)',
  RANKED_URF: '极限闪击',
  RANKED_ARAM: '极地大乱斗',
  RANKED_LPL: '无限乱斗',
  RANKED_BLIND: '盲僧乱斗',
  RANKED_SWISS: '瑞士轮'
};

/** 段位展示名:中文段位 + 罗马数字。 */
export function formatRankDisplay(tier: string, division: string): string {
  const label = TIER_LABELS[tier.toUpperCase()] ?? tier;
  const div = division.toUpperCase().trim();
  if (!div) return label;
  return `${label} ${div}`;
}

export function queueLabel(queueType: string): string {
  return QUEUE_LABELS[queueType] ?? queueType;
}
