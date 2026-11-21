/**
 * 「我这局用的皮肤」的认法 —— **纯解析,不发任何请求**。
 *
 * 五条来源,可靠度依次降级:
 *
 *   1. 选人会话(`/lol-champ-select/v1/session`)本地玩家那条的皮肤字段
 *      —— 国际服给 `skinId`;**国服实测没有 `skinId`,给的是 `selectedSkinId`**
 *      (是皮肤 id 还是皮肤序号没实测过,靠 {@link resolveSkinValue} 消歧)。
 *      选人会话只在选人阶段存在,局末已经 404,
 *      所以**必须在选人阶段就记下来**(提取在 `champSelect.ts`,认本地玩家那条的
 *      逻辑也在那儿 —— 这里只管「几条来源里挑哪一条」)。
 *   2. gameflow(`/lol-gameflow/v1/session`)的
 *      `gameData.playerChampionSelections` —— **国服最靠得住的一条**
 *      (国服实测,2026-11-21):每条选中都带 `championId` 和 `selectedSkinIndex`,
 *      10 个玩家全都有值,局末(`phase=EndOfGame`)还读得到。
 *      「我」靠 puuid 认(这个数组里没有 `teamOwner` 标记)。
 *   3. gameflow 的队伍条目(`gameData.teamOne/teamTwo`)里的皮肤
 *      —— **国际服客户端给 `skinId`(数字 id)**;
 *      **国服队伍条目里的 `lastSelectedSkinIndex` 恒为 0**(实测 10 人全是 0),
 *      跟实际用了哪款皮肤无关 —— 采信它会把「默认皮肤」当成「本局用的皮肤」,
 *      所以**不采信**(见 {@link parseSkinIndex})。
 *   4. match history 的 participant —— 局后可用(国服实测**没有** skin 字段)。
 *   5. Live Client `/liveclientdata/allgamedata` 的 `allPlayers[].skin`
 *      —— 只给英文资源名(如 `game_character_displayname_Ahri_Snow_Dawn`),
 *      拿不到数字 id,对不上站内的中文名。所以它只能当「认出了名字」用
 *      (提取在 `liveClient.ts`)。
 *
 * 一个都没认出来 = `riotSkinId: 0` —— **不猜**,不按「英雄默认皮肤」编一个 id 上去。
 *
 * **换算出来的 id 要拿客户端的皮肤清单校验**:客户端的 `skins.json` 是皮肤总目录,
 * 里面每个英雄有哪些皮肤一目了然(见 `staticData.ts` 的 `skinsByChampion`)。
 * 换算结果不在清单里 → 认不出来,而不是硬报一个可能存在的皮肤。
 * 认错皮肤 = 给别人的皮肤打分,比认不出来糟糕得多。
 *
 * ⚠️ **皮肤 id 空间里混着炫彩**:客户端把炫彩和普通皮肤排在同一个 id 空间里
 * (英雄编号 × 1000 + 序号,序号连续,普通皮肤和炫彩交替占位)。
 * 国服实测序号 9 → id 200009 = 「战场BOSS 卑尔维斯 拒绝之尾」,**是炫彩**。
 * 炫彩没有自己的立绘,用的是底图皮肤那张图调了色 —— 落回站内目录时
 * 要用炫彩→底图的映射(见 `staticData.ts` 的 `chromaBaseSkinIds`)。
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
 * 皮肤序号字段的值:**缺字段 = -1**。
 *
 * 0 是有意义的值(序号 0 = 默认皮肤),所以「没给」和「给了 0」必须分得开 ——
 * 混了就会把「没给」当成「用的默认皮肤」。
 */
function parseSelectedIndex(entry: Record<string, unknown>): number {
  const raw = entry.selectedSkinIndex;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return -1;
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
 * 皮肤序号 → 皮肤 id,**拿客户端自己的皮肤清单校验**。
 *
 * 换算规则是 Riot 的编号规则:**皮肤 id = 英雄编号 × 1000 + 皮肤序号**,
 * 序号 0 是默认皮肤(所以默认皮肤满足 `skinId % 1000 === 0`)。
 *
 * 这条规则有国服客户端自己的数据佐证:客户端的 skins.json 里,
 * 安妮的第二款皮肤是 1001(1×1000+1)、剑魔的是 266001(266×1000+1),
 * 而且 splash 文件名末尾的 `_N` 正好就是这个序号。
 *
 * 序号有两种可能的意思:
 *
 *   - **编号差**(`英雄编号 × 1000 + 序号`);
 *   - **清单里的位置**(皮肤 id 不连续时,位置 ≠ 编号差)。
 *
 * 两种都算,取**清单里真有的**那个。清单里一个都没有 → 返回 0(**认不出来**),
 * 绝不硬算一个 id 上去:认错皮肤比认不出来糟糕得多(那是给别人的皮肤打分)。
 *
 * ⚠️ 清单里**含炫彩**(国服实测)—— 序号落在炫彩上也是合法的,那是玩家
 * 真的用了那款炫彩。
 */
export function resolveSkinIndex(
  championId: number,
  index: number,
  knownSkinIds: number[] = []
): number {
  if (!championId || championId <= 0 || index < 0) return 0;
  const base = championId * 1000;
  const direct = base + index;
  if (knownSkinIds.length === 0) return direct;
  if (knownSkinIds.includes(direct)) return direct;
  // 编号差对不上 → 客户端给的可能是清单里的**位置**。
  const sorted = [...knownSkinIds].sort((a, b) => a - b);
  const byPosition = sorted[index];
  if (byPosition !== undefined && byPosition !== direct) return byPosition;
  return 0;
}

/**
 * 客户端给的一个「皮肤线索」到底是皮肤 id 还是皮肤序号 —— 消歧。
 *
 * 国服的选人会话给的是 `selectedSkinId`,这个字段**是 id 还是序号还没实测**。
 * 两种含义都用同一个办法消歧:**拿该英雄的皮肤清单校验**。
 *
 * - 值在清单里 → 它就是皮肤 id;
 * - `英雄编号 × 1000 + 值` 在清单里 → 它是序号;
 * - 都不在 → 0(认不出来)。
 *
 * 没有清单可校验时(客户端元数据没拉到)按量级猜:1000 以上只能是 id。
 */
export function resolveSkinValue(
  championId: number,
  value: number,
  knownSkinIds: number[] = []
): number {
  if (!championId || championId <= 0 || value < 0) return 0;
  if (knownSkinIds.length > 0) {
    if (knownSkinIds.includes(value)) return value;
    const viaIndex = championId * 1000 + value;
    if (knownSkinIds.includes(viaIndex)) return viaIndex;
    return 0;
  }
  if (value >= 1000) return value;
  return championId * 1000 + value;
}

/** gameflow 队伍条目里「我」那条的皮肤线索。 */
export interface GameflowSelf {
  /** 英雄编号;0 = 没认出来 */
  championId: number;
  /**
   * 这个英雄编号**认得准不准**。
   *
   * false = 「队伍里第一个带英雄编号的人」—— 那可能是队友。
   * 拿它当英雄名会把英雄写成队友的(实测:皮肤认的是自己,名字却写成队友的)。
   */
  championVerified: boolean;
  /** 皮肤数字 id(客户端直接给的时候);0 = 没有 */
  skinId: number;
  /** 皮肤序号(客户端给序号的时候);-1 = 没有 */
  skinIndex: number;
  /**
   * 说不清是 id 还是序号的线索(`selectedSkinId`);-1 = 没有。
   *
   * 跟选人会话那个字段同名 —— 客户端在两处用的是同一个字段名。
   */
  skinValue: number;
  /** 有没有**严认**出「我」这条 */
  isSelf: boolean;
}

/**
 * 队伍条目里的皮肤序号。
 *
 * ⚠️ **`lastSelectedSkinIndex` 不采信** —— 国服实测它对 10 个玩家**全是 0**,
 * 跟谁实际用了哪款皮肤无关(真正有值的是 `gameData.playerChampionSelections`
 * 里那条 `selectedSkinIndex`,见 {@link parseGameflowSelection})。
 * 采信它会把「默认皮肤」当成「本局用的皮肤」—— 认错皮肤比认不出来糟糕得多。
 *
 * 国际服客户端直接给数字 `skinId`,压根不用序号。
 *
 * 空串**不算**序号 0 —— 字段缺就是缺,不能当成「默认皮肤」。
 */
export function parseSkinIndex(entry: Record<string, unknown>): number {
  for (const key of ['selectedSkinIndex', 'skinIndex']) {
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
 * 队伍条目里的「皮肤线索」值:**缺字段 = -1**。
 *
 * 0 是有意义的值(皮肤序号 0 = 默认皮肤),所以「没给」和「给了 0」必须分得开 ——
 * 混了就会把「没给」当成「用的默认皮肤」。
 */
export function parseSkinValue(entry: Record<string, unknown>): number {
  const raw = entry.selectedSkinId;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
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
  const empty: GameflowSelf = {
    championId: 0,
    championVerified: false,
    skinId: 0,
    skinIndex: -1,
    skinValue: -1,
    isSelf: false
  };
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
          championVerified: championId > 0,
          skinId: num(entry.skinId),
          skinIndex: parseSkinIndex(entry),
          skinValue: parseSkinValue(entry),
          isSelf: true
        };
      }
      if (looseChampionId <= 0 && championId > 0) looseChampionId = championId;
    }
  }
  // 宽松值 —— 队伍里第一个带英雄编号的人,**不保证是「我」**。
  return { ...empty, championId: looseChampionId };
}

/**
 * gameflow 的 `gameData.playerChampionSelections` 里「我」那条。
 *
 * **这是国服最靠得住的皮肤来源**(国服实测,2026-11-21):
 * 每条选中都带 `championId` 和 `selectedSkinIndex`,10 个玩家全都有值,
 * 局末(`phase=EndOfGame`)还读得到。
 * 皮肤 id = 英雄编号 × 1000 + 序号(客户端的 id 空间里普通皮肤和炫彩
 * 交替占位、序号连续,所以这个换算是无歧义的)。
 *
 * 「我」靠 **puuid** 认 —— 这个数组里没有 `teamOwner` 标记。
 * 没有 puuid 就认不出「我」,宁可不认:认错人就是给队友的皮肤打分。
 */
export interface GameflowSelection {
  /** 英雄编号;0 = 没认出来 */
  championId: number;
  /** 皮肤序号(换算成 id 要乘 1000);-1 = 没给 */
  skinIndex: number;
  /** 有没有**严认**出「我」这条 */
  isSelf: boolean;
}

export function parseGameflowSelection(raw: unknown, myPuuid = ''): GameflowSelection {
  const empty: GameflowSelection = { championId: 0, skinIndex: -1, isSelf: false };
  if (!isRecord(raw)) return empty;
  if (!myPuuid) return empty;
  const gameData = raw.gameData;
  if (!isRecord(gameData)) return empty;
  const selections = (gameData as Record<string, unknown>).playerChampionSelections;
  if (!Array.isArray(selections)) return empty;

  for (const entry of selections) {
    if (!isRecord(entry)) continue;
    if (str(entry.puuid) !== myPuuid) continue;
    return {
      championId: num(entry.championId),
      skinIndex: parseSelectedIndex(entry),
      isSelf: true
    };
  }
  return empty;
}

/**
 * 五条来源合成一个结论。
 *
 * 优先级:选人会话 > gameflow(数字 id)> gameflow(`selectedSkinId`)
 * > gameflow(选中记录里的序号)> gameflow(队伍条目里的序号)
 * > match history > Live Client。
 * 认到数字 id 就用数字;只认到名字就只给名字(界面据此说明「没认到具体皮肤」)。
 */
export function resolveUsedSkin(candidates: {
  champSelectSkinId?: number | null;
  /**
   * 国服选人会话里的 `selectedSkinId` —— 是皮肤 id 还是皮肤序号没实测过,
   * 靠 {@link resolveSkinValue} 拿皮肤清单消歧。
   */
  champSelectSkinValue?: number | null;
  /** 上面那个值所属的英雄编号 —— 必须跟值成对 */
  champSelectChampionId?: number | null;
  gameflowSkinId?: number | null;
  /** 国服 gameflow 给的皮肤序号(不是皮肤 id) */
  gameflowSkinIndex?: number | null;
  /**
   * 国服 gameflow 给的 `selectedSkinId` —— 是皮肤 id 还是皮肤序号没实测过,
   * 跟选人会话那个字段同名。
   */
  gameflowSkinValue?: number | null;
  /** 序号所属的英雄编号 —— 换算皮肤 id 时必须跟序号成对,不能拿别的英雄来算 */
  gameflowChampionId?: number | null;
  /**
   * 国服 gameflow 的 `playerChampionSelections` 里「我」那条的皮肤序号。
   *
   * **这是国服最准的一条**(实测每条选中都带这个值);队伍条目里的
   * `lastSelectedSkinIndex` 恒为 0,不能采信。
   */
  gameflowSelectionSkinIndex?: number | null;
  /** 上面那个序号所属的英雄编号 —— 必须成对 */
  gameflowSelectionChampionId?: number | null;
  matchHistorySkinId?: number | null;
  liveClientSkinName?: string | null;
  /**
   * 查某个英雄的皮肤 id 清单(客户端的 skins.json)—— 用来校验换算结果。
   *
   * 给了清单,换算出来的 id 就必须**清单里真有**;给不出就认不出来。
   *
   * 传函数而不是数组:每条候选的皮肤都跟着**它自己的英雄编号**,
   * 不能拿别的英雄的清单来校验。
   */
  knownSkinIds?: ((championId: number) => number[]) | null;
}): UsedSkin {
  const skinIdsFor: (championId: number) => number[] = candidates.knownSkinIds ?? (() => []);

  if (candidates.champSelectSkinId && candidates.champSelectSkinId > 0) {
    return {
      riotSkinId: candidates.champSelectSkinId,
      displayName: null,
      source: 'champ-select'
    };
  }
  const champSelectValue = candidates.champSelectSkinValue;
  const champSelectChampionId = candidates.champSelectChampionId;
  if (
    champSelectValue !== undefined &&
    champSelectValue !== null &&
    champSelectValue >= 0 &&
    champSelectChampionId &&
    champSelectChampionId > 0
  ) {
    const skinId = resolveSkinValue(
      champSelectChampionId,
      champSelectValue,
      skinIdsFor(champSelectChampionId)
    );
    if (skinId > 0) {
      return { riotSkinId: skinId, displayName: null, source: 'champ-select-value' };
    }
  }
  if (candidates.gameflowSkinId && candidates.gameflowSkinId > 0) {
    return {
      riotSkinId: candidates.gameflowSkinId,
      displayName: null,
      source: 'gameflow'
    };
  }
  // gameflow 的 `selectedSkinId` 排前面:它字面上就是「皮肤 id」,
  // 比「序号」可信 —— 序号换算要靠算术,id 直接拿清单一比就知道。
  const gameflowValue = candidates.gameflowSkinValue;
  const championId = candidates.gameflowChampionId;
  if (
    gameflowValue !== undefined &&
    gameflowValue !== null &&
    gameflowValue >= 0 &&
    championId &&
    championId > 0
  ) {
    const skinId = resolveSkinValue(championId, gameflowValue, skinIdsFor(championId));
    if (skinId > 0) {
      return { riotSkinId: skinId, displayName: null, source: 'gameflow-value' };
    }
  }
  // 国服最准的一条:`playerChampionSelections` 里「我」那条的序号。
  const selectionIndex = candidates.gameflowSelectionSkinIndex;
  const selectionChampionId = candidates.gameflowSelectionChampionId;
  if (
    selectionIndex !== undefined &&
    selectionIndex !== null &&
    selectionIndex >= 0 &&
    selectionChampionId &&
    selectionChampionId > 0
  ) {
    const skinId = resolveSkinIndex(
      selectionChampionId,
      selectionIndex,
      skinIdsFor(selectionChampionId)
    );
    if (skinId > 0) {
      return { riotSkinId: skinId, displayName: null, source: 'gameflow-selection' };
    }
  }
  const index = candidates.gameflowSkinIndex;
  if (index !== undefined && index !== null && index >= 0 && championId && championId > 0) {
    const skinId = resolveSkinIndex(championId, index, skinIdsFor(championId));
    if (skinId > 0) {
      return { riotSkinId: skinId, displayName: null, source: 'gameflow-index' };
    }
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
