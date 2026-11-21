/**
 * 局末结算的跨进程类型。
 *
 * ⚠️ **这个文件不许 import 任何东西** —— main / preload / renderer 三个构建目标都引用它,
 * 带依赖就会把 Node 侧模块拖进渲染进程的编译范围。
 */

/** 主进程 → 渲染进程的推送频道。 */
export const SETTLEMENT_CHANNEL = 'match:settlement';

/**
 * 「我这局用的皮肤」。
 *
 * 五条来源,可靠度依次降级(见 src/main/match/usedSkin.ts):
 *   1. 选人会话 —— 数字 skinId,最准(但选人会话只在选人阶段存在)
 *   2. gameflow 的 `playerChampionSelections` —— **国服最准的一条**
 *      (每条选中都带 `selectedSkinIndex`,局末还读得到)
 *   3. gameflow 的队伍条目 —— 一直活到局末。
 *      国际服客户端直接给数字 skinId;国服队伍条目里的
 *      `lastSelectedSkinIndex` 恒为 0,**不能采信**(会把默认皮肤当成本局用的皮肤)
 *   4. match history 的 participant —— 局后可用(国服实测**没有**皮肤字段)
 *   5. Live Client 的 allPlayers[].skin —— 只有英文资源名,拿不到数字 id
 */
export interface UsedSkin {
  /** 游戏内皮肤 id(= LCU itemId);0 = 没认出来 */
  riotSkinId: number;
  /** 只认到名字时的兜底(英文资源名);null = 没有 */
  displayName: string | null;
  /**
   * 认出来的是**炫彩**时,它的底图皮肤 id(= 英雄编号 × 1000 + 底图序号);
   * null / 没有 = 不是炫彩。
   *
   * 炫彩没有自己的立绘,游戏里显示的是底图那张图调了色 ——
   * 站内目录里查不到这条炫彩时,要退到底图那款皮肤(打分的对象是它)。
   */
  baseRiotSkinId?: number | null;
  /**
   * 认出来的是**炫彩**时,客户端给的那个中文名
   * (如「战场BOSS 卑尔维斯 拒绝之尾」);null / 没有 = 不是炫彩。
   *
   * 炫彩名自带底图皮肤名 —— 界面上显示它,底下再标「炫彩」。
   */
  chromaName?: string | null;
  /** 认皮肤认到哪儿了;null = 一条都没认到 */
  source:
    | 'champ-select'
    | 'champ-select-value'
    | 'gameflow'
    | 'gameflow-index'
    | 'gameflow-value'
    | 'gameflow-selection'
    | 'match-history'
    | 'live-client'
    /** 没认出具体哪款皮肤,落到了这个英雄的默认皮肤 */
    | 'champion-default'
    | null;
}

/**
 * 局内最后一帧的即时战绩(2999 端口)。
 *
 * 全部字段都是 0 表示「这项没取到」—— 调用方按整块不显示处理。
 */
export interface LiveScore {
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  goldEarned: number;
  damageToChampions: number;
  level: number;
}

/**
 * match history 补齐段的本局战绩。
 *
 * 拿不到就整块是 null —— **不编**。
 */
export interface MatchScore {
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  durationS: number;
  /** 分路;空串 = 没给 */
  lane: string;
  /** 定位(Riot 的 role);空串 = 没给 */
  role: string;
  /** 角色任务道具的名字(名字里写着位置,最准);空串 = 没给 */
  roleBoundItemName: string;
  /** 地图编号;0 = 没给 —— 只有召唤师峡谷(11)才有位置可言 */
  mapId: number;
  gameMode: string;
  queueType: string;
  championId: number;
}

/**
 * 主进程检测到「这一局结束了」时的本地事实。
 *
 * 这一份**不碰网络** —— 皮肤名字、站内 id、现有评分都是渲染进程那边另外拉的。
 */
export interface LocalSettlement {
  /**
   * 去重键 —— 同一局只弹一次。
   *
   * 优先用这一局自己的编号(`gameData.gameId`):客户端的阶段会来回跳
   * (PreEndOfGame → None → EndOfGame),用时间戳当键的话同一局会弹两遍。
   * 拿不到编号时退到 `${championId}-${riotSkinId}-${endedAt}`。
   */
  key: string;
  championId: number;
  /**
   * 这个英雄编号**认得准不准**。
   *
   * false = 只能拿到「队伍里第一个带英雄编号的人」,可能是队友 ——
   * 这时候英雄名留空,别在标题上写别人的英雄。
   */
  championVerified: boolean;
  championName: string;
  usedSkin: UsedSkin;
  /** 2999 的即时战绩;null = 没取到 */
  live: LiveScore | null;
  /** match history 补齐段的战绩;null = 还没补上 / 补不上 */
  match: MatchScore | null;
  /** 局末那一刻的时间戳(epoch ms) */
  endedAt: number;
}

/** 站内目录里的这条皮肤。 */
export interface SettlementSkin {
  /** 站内 id(t_skin.id)—— 打分接口要的就是它 */
  id: number;
  /** 游戏内皮肤 id(t_skin.skin_id) */
  skinId: number | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  iconUrl: string | null;
  splashUrl: string | null;
}

/** 某款皮肤的聚合评分(后端 /api/ratings/skin-stats 的一条)。 */
export interface SkinRatingStats {
  skinId: number;
  skinName: string | null;
  iconUrl: string | null;
  splashUrl: string | null;
  rarity: string | null;
  /** 有多少人打过;0 = 还没人打 */
  totalCount: number;
  avgScore: number | null;
  avgHandFeel: number | null;
  avgArtwork: number | null;
  avgModel: number | null;
  avgMockery: number | null;
}

/** 我打过的这一条评分(四维都是 1~5 的整数星)。 */
export interface MyRating {
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
  /** 我写的评价文字;null = 没写 */
  content: string | null;
}

/**
 * 我给某款皮肤打过的分(含评价文字)。
 *
 * `skinId` 是**站内**皮肤 id(t_skin.id)—— 跟游戏内皮肤 id(Riot itemId)不是一个东西,
 * 打分接口要的就是前者。
 */
export interface MySkinRating {
  /** 站内皮肤 id(t_skin.id) */
  skinId: number;
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
  /** 评价文字;null = 没写 */
  content: string | null;
}

/**
 * 渲染进程要的那份:本地事实 + 站内皮肤 + 现有评分 + 我打过的分。
 *
 * 缺的字段就是 null —— 界面上那块整块不显示,不写占位数字。
 */
export interface SettlementView extends LocalSettlement {
  /** 站内目录里的这条皮肤;null = 不在目录里 / 没认到皮肤 */
  skin: SettlementSkin | null;
  /** 现有聚合评分;null = 后端没给 / 还没拉到 */
  stats: SkinRatingStats | null;
  /** 我打过的分;null = 没打过 */
  myRating: MyRating | null;
  /** 桌面端有没有登录(没登录不能打分) */
  loggedIn: boolean;
}
