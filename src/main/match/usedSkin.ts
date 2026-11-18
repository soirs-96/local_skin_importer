/**
 * 「我这局用的皮肤」的认法 —— **纯解析,不发任何请求**。
 *
 * 四条来源,可靠度依次降级:
 *
 *   1. 选人会话(`/lol-champ-select/v1/session`)本地玩家那条的 `skinId`
 *      —— 数字 id,最准。但选人会话只在选人阶段存在,局末已经 404,
 *      所以**必须在选人阶段就记下来**(提取在 `champSelect.ts`,认本地玩家那条的
 *      逻辑也在那儿 —— 这里只管「几条来源里挑哪一条」)。
 *   2. gameflow(`/lol-gameflow/v1/session`)队伍条目里的 `skinId`
 *      —— 也是数字 id,而且**一直活到局末**。本地玩家那条靠 `teamOwner` 认。
 *   3. match history 的 participant —— 局后可用(取决于客户端给不给这个字段,
 *      见探测 2)。它同时能给出胜负。
 *   4. Live Client `/liveclientdata/allgamedata` 的 `allPlayers[].skin`
 *      —— 只给英文资源名(如 `game_character_displayname_Ahri_Snow_Dawn`),
 *      拿不到数字 id,对不上站内的中文名。所以它只能当「认出了名字」用
 *      (提取在 `liveClient.ts`)。
 *
 * 一个都没认出来 = `riotSkinId: 0` —— **不猜**,不按「英雄默认皮肤」编一个 id 上去。
 */

import type { UsedSkin } from '../../shared/settlement';

export type { UsedSkin };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * match history 里「我」那条 participant 的皮肤 id。
 *
 * ⚠️ 客户端给不给这个字段**还没实测**(探测 2)—— 所以这里把可能的字段名都试一遍。
 * 认不出来就 null,**绝不用英雄 id 顶替**。
 */
export function parseMatchHistorySkinId(participant: unknown): number | null {
  if (!isRecord(participant)) return null;
  for (const key of ['skinId', 'skin_id']) {
    const value = num(participant[key]);
    if (value > 0) return value;
  }
  return null;
}

/**
 * 四条来源合成一个结论。
 *
 * 优先级:选人会话 > gameflow > match history > Live Client。
 * 认到数字 id 就用数字;只认到名字就只给名字(界面据此说明「没认到具体皮肤」)。
 */
export function resolveUsedSkin(candidates: {
  champSelectSkinId?: number | null;
  gameflowSkinId?: number | null;
  matchHistorySkinId?: number | null;
  liveClientSkinName?: string | null;
}): UsedSkin {
  if (candidates.champSelectSkinId && candidates.champSelectSkinId > 0) {
    return {
      riotSkinId: candidates.champSelectSkinId,
      displayName: null,
      source: 'champ-select'
    };
  }
  if (candidates.gameflowSkinId && candidates.gameflowSkinId > 0) {
    return {
      riotSkinId: candidates.gameflowSkinId,
      displayName: null,
      source: 'gameflow'
    };
  }
  if (candidates.matchHistorySkinId && candidates.matchHistorySkinId > 0) {
    return {
      riotSkinId: candidates.matchHistorySkinId,
      displayName: null,
      source: 'match-history'
    };
  }
  if (candidates.liveClientSkinName) {
    return { riotSkinId: 0, displayName: candidates.liveClientSkinName, source: 'live-client' };
  }
  return { riotSkinId: 0, displayName: null, source: null };
}
