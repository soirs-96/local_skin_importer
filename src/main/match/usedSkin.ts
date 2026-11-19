/**
 * 「我这局用的皮肤」的认法 —— **纯解析,不发任何请求**。
 *
 * 四条来源,可靠度依次降级:
 *
 *   1. 选人会话(`/lol-champ-select/v1/session`)本地玩家那条的 `skinId`
 *      —— 数字 id,最准。但选人会话只在选人阶段存在,局末已经 404,
 *      所以**必须在选人阶段就记下来**(提取在 `champSelect.ts`,认本地玩家那条的
 *      逻辑也在那儿 —— 这里只管「几条来源里挑哪一条」)。
 *   2. gameflow(`/lol-gameflow/v1/session`)队伍条目里的皮肤
 *      —— **国际服客户端给 `skinId`(数字 id);国服客户端不给数字 id,给的是
 *      `lastSelectedSkinIndex`(皮肤序号)**,靠 {@link skinIdFromIndex} 换算。
 *      这一条**一直活到局末**,是国服上最靠得住的来源。
 *   3. match history 的 participant —— 局后可用(国服实测**没有** skin 字段)。
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

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
 * 皮肤序号 → Riot 皮肤 id。
 *
 * Riot 的皮肤编号规则:**皮肤 id = 英雄编号 × 1000 + 皮肤序号**,序号 0 是默认皮肤
 * (所以默认皮肤满足 `skinId % 1000 === 0`)。
 *
 * 这条规则有国服客户端自己的数据佐证:安妮的一款皮肤是 1001(1×1000+1)、
 * Aatrox 的一款皮肤是 266001(266×1000+1)—— 见 staticData 的测试用例。
 *
 * 客户端给的是「第几个皮肤」,不是皮肤 id —— 换算是纯算术,不用查表。
 */
export function skinIdFromIndex(championId: number, index: number): number {
  return championId * 1000 + index;
}

/** gameflow 队伍条目里「我」那条的皮肤线索。 */
export interface GameflowSelf {
  /** 英雄编号;0 = 没认出来 */
  championId: number;
  /** 皮肤数字 id(客户端直接给的时候);0 = 没有 */
  skinId: number;
  /** 皮肤序号(客户端给序号的时候);-1 = 没有 */
  skinIndex: number;
  /** 有没有**严认**出「我」这条 */
  isSelf: boolean;
}

/**
 * 队伍条目里的皮肤序号。
 *
 * 国服客户端给的是 `lastSelectedSkinIndex`(选人时选中的第几个皮肤);
 * 国际服直接给数字 `skinId`,压根不用序号。
 *
 * 空串**不算**序号 0 —— 字段缺就是缺,不能当成「默认皮肤」。
 */
export function parseSkinIndex(entry: Record<string, unknown>): number {
  for (const key of ['lastSelectedSkinIndex', 'selectedSkinIndex', 'skinIndex']) {
    const raw = entry[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
  }
  return -1;
}

/**
 * 从 gameflow 的队伍条目里认「我」那条。
 *
 * **认皮肤要严认**:只有 `teamOwner === true` 或者 puuid 对上才算「我」。
 * 认错了就会把队友的皮肤当成自己的 —— 那比「没认出来」糟糕得多:
 * 「没认出来」只是这一局没法打分,认错了是**给别人的皮肤打分**。
 *
 * 英雄编号可以宽松一点:实在认不出「我」是谁,拿队伍里第一个带英雄编号的,
 * 顶多多写错一个名字(比空着强)。这个宽松值**不参与**皮肤换算。
 */
export function parseGameflowSelf(raw: unknown, myPuuid = ''): GameflowSelf {
  const empty: GameflowSelf = { championId: 0, skinId: 0, skinIndex: -1, isSelf: false };
  if (!isRecord(raw)) return empty;
  const gameData = raw.gameData;
  if (!isRecord(gameData)) return empty;
  const gd = gameData as Record<string, unknown>;

  let looseChampionId = 0;
  for (const key of ['teamOne', 'teamTwo']) {
    const team = gd[key];
    if (!Array.isArray(team)) continue;
    for (const entry of team) {
      if (!isRecord(entry)) continue;
      const championId = num(entry.championId);
      const puuid = str(entry.puuid);
      const isSelf = entry.teamOwner === true || (Boolean(myPuuid) && puuid === myPuuid);
      if (isSelf) {
        return {
          championId: championId > 0 ? championId : looseChampionId,
          skinId: num(entry.skinId),
          skinIndex: parseSkinIndex(entry),
          isSelf: true
        };
      }
      if (looseChampionId <= 0 && championId > 0) looseChampionId = championId;
    }
  }
  return { ...empty, championId: looseChampionId };
}

/**
 * 四条来源合成一个结论。
 *
 * 优先级:选人会话 > gameflow(数字 id)> gameflow(序号换算)> match history > Live Client。
 * 认到数字 id 就用数字;只认到名字就只给名字(界面据此说明「没认到具体皮肤」)。
 */
export function resolveUsedSkin(candidates: {
  champSelectSkinId?: number | null;
  gameflowSkinId?: number | null;
  /** 国服 gameflow 给的皮肤序号(不是皮肤 id) */
  gameflowSkinIndex?: number | null;
  /** 序号所属的英雄编号 —— 换算皮肤 id 时必须跟序号成对,不能拿别的英雄来算 */
  gameflowChampionId?: number | null;
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
  const index = candidates.gameflowSkinIndex;
  const championId = candidates.gameflowChampionId;
  if (index !== undefined && index !== null && index >= 0 && championId && championId > 0) {
    return {
      riotSkinId: skinIdFromIndex(championId, index),
      displayName: null,
      source: 'gameflow-index'
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
