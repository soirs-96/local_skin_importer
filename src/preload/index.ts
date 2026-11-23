import { contextBridge, ipcRenderer } from 'electron';
import { MATCH_STATE_CHANNEL } from '../shared/match';
import type {
  LlmStatus,
  MatchSnapshot,
  OpponentsSnapshot,
  PlayerGame,
  PlayerGamesSummary,
  PlayerLookup,
  PlayerPeer,
  RecommendationState,
  TopChampion
} from '../shared/match';
import { DEV_LOG_CHANNEL } from '../shared/dev';
import { SETTLEMENT_CHANNEL } from '../shared/settlement';
import type {
  LocalSettlement,
  MySkinRating,
  SettlementView,
  SkinRatingStats
} from '../shared/settlement';
import type { ChampionIndexEntry } from '../shared/recommendation';
import type { DevLogLine } from '../shared/dev';
import type { AutoAcceptState } from '../shared/autoAccept';
import type {
  RegionUser,
  RegionUsersQuery,
  RegionUsersResult
} from '../shared/regionUsers';
import type { MatchProfile, PositionReport, RankedReport } from '../shared/matchProfile';
import type { LcuDiagnosis, LcuFailureCode } from '../main/lcu/types';

export type { AutoAcceptState, AutoAcceptStatus } from '../shared/autoAccept';
export type { RegionUser, RegionUsersQuery, RegionUsersResult } from '../shared/regionUsers';
export type {
  MatchProfile,
  PositionCode,
  PositionReport,
  RankedReport
} from '../shared/matchProfile';

export type {
  ChampSelectMember,
  ChampSelectSession,
  ChampionRef,
  LlmStatus,
  LiveGameInfo,
  MatchSnapshot,
  MatchState,
  MatchSummoner,
  Opponent,
  OpponentsSnapshot,
  PlayerGame,
  PlayerGamesSummary,
  PlayerLookup,
  PlayerPeer,
  RankedEntry,
  RecentMatch,
  RecentMatchesSummary,
  RecommendationState,
  TopChampion
} from '../shared/match';

export type { LcuChannelReport, LcuDiagnosis, LcuFailureCode } from '../main/lcu/types';

export type { ChampionIndexEntry } from '../shared/recommendation';

export type {
  LocalSettlement,
  LiveScore,
  MatchScore,
  MyRating,
  MySkinRating,
  SettlementSkin,
  SettlementView,
  SkinRatingStats,
  UsedSkin
} from '../shared/settlement';

export interface LcuStatus {
  running: boolean;
  port?: number;
  summoner?: {
    displayName: string;
    puuid: string;
  };
  error?: string;
  /** 失败分类码 —— 界面据此决定文案与图标。 */
  code?: LcuFailureCode;
  /** 一句话结论,直接给用户看。 */
  summary?: string;
  /** 完整诊断明细,开发者面板用。 */
  diagnosis?: LcuDiagnosis;
}

/**
 * 「已拥有皮肤」的数据来源。
 *  - inventory: LCU 库存端点,权威口径,能读到已下架(绝版)的皮肤
 *  - store:     商城目录 owned 标记,降级口径,读不到已下架皮肤
 */
export type OwnedDataSource = 'inventory' | 'store';

export interface FetchSkinsResult {
  summoner: {
    displayName: string;
    puuid: string;
    /** Riot ID 的标签(# 后面那串)—— 小程序那边叫「游戏ID」 */
    tagLine: string;
  };
  ownedSkinIds: number[];
  source: OwnedDataSource;
  /** 是否已跟站内目录取交集(后端没升级 skinId 字段时为 false) */
  catalogFiltered: boolean;
  /** 大区编号(腾讯那套)—— 认不出来是空串 */
  gameZone: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  tokenPreview: string | null;
}

export interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
  /** 本命英雄(熟练度前 15)—— 后端收藏册按它把英雄排到前面 */
  topChampions?: TopChampion[];
  /** 排位段位 —— 后端拿来筛「分数差不多」的搭子 */
  ranked?: RankedReport[];
  /** 主玩位置 —— 后端拿来筛「一起打这个位」的搭子 */
  positions?: PositionReport[];
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
  /** Riot ID 的标签(# 后面那串)—— 后端回填小程序的「游戏ID」 */
  summonerTag?: string;
  /** 大区编号(腾讯那套)—— 后端转成大区名回填 */
  gameZone?: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
}

export interface SyncOutcome {
  /** true = 被本地节流挡掉了,没打后端 */
  skipped: boolean;
  /** 最近一次成功同步的时刻(epoch ms) */
  lastSyncAt: number | null;
  /** 后端返回的计数;skipped 时为 null */
  result: SyncResult | null;
}

export interface CatalogSkin {
  id: number;
  skinId: number | null;
  heroId: number | null;
  heroName: string | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  priceRp: number | null;
  splashUrl: string | null;
  iconUrl: string | null;
}

export interface CatalogResult {
  total: number;
  records: CatalogSkin[];
  /**
   * 响应里是否存在 `skinId` 这个 key。
   * false = 后端未升级,无法比对已拥有状态。
   */
  skinIdFieldPresent: boolean;
}

export interface OwnedSnapshot {
  /** 已同步到后端的已拥有总数(含目录未收录的) */
  totalOwnedCount: number;
  /** 已拥有的游戏内皮肤 ID 列表(t_skin.skin_id 口径,可能含目录没收录的) */
  ownedSkinIds: number[];
  /** 最近一次同步时刻(ISO 字符串);null = 从未同步过 */
  lastSyncAt: string | null;
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api = {
  /**
   * 检测游戏客户端。
   * deep = true 时允许扫盘找客户端(用户手点按钮时用);
   * 不传时是浅检测(界面挂载时的自动检查用)。
   */
  checkLcu: (deep?: boolean): Promise<LcuStatus> =>
    deep === true ? invoke('lcu:check-status', true) : invoke('lcu:check-status'),
  fetchSkins: (): Promise<FetchSkinsResult> => invoke('lcu:fetch-skins'),
  redeemCode: (code: string): Promise<AuthStatus> =>
    invoke('auth:login', { code }),
  logout: (): Promise<{ ok: true }> => invoke('auth:logout'),
  getAuthStatus: (): Promise<AuthStatus> => invoke('auth:get-status'),
  sync: (payload: SyncPayload): Promise<SyncOutcome> => invoke('backend:sync', payload),
  fetchCatalog: (): Promise<CatalogResult> => invoke('catalog:fetch-all'),
  fetchMyOwned: (): Promise<OwnedSnapshot> => invoke('catalog:fetch-owned'),
  /** 打开 Chromium 开发者工具(开发者面板用) */
  openDevTools: (): Promise<{ ok: true }> => invoke('dev:open-devtools'),
  /** 把一段文本写进系统剪贴板(复制诊断信息 / 游戏ID 用) */
  copyText: (text: string): Promise<{ ok: true }> => invoke('dev:copy-text', text),

  // ---- 开发日志控制台 --------------------------------------------------------
  /**
   * 开始收主进程的日志,并把之前的历史捞回来。
   * afterSeq = 已经知道的最后一条序号,主进程只给更新的那些。
   */
  attachConsole: (afterSeq?: number): Promise<DevLogLine[]> =>
    invoke('dev:console-attach', afterSeq ?? 0),
  /** 停止收主进程的日志(控制台关掉时调) */
  detachConsole: (): Promise<{ ok: true }> => invoke('dev:console-detach'),
  /** 订阅主进程推来的日志,返回取消订阅的函数 */
  onDevLog: (cb: (line: DevLogLine) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, line: DevLogLine): void => {
      cb(line);
    };
    ipcRenderer.on(DEV_LOG_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(DEV_LOG_CHANNEL, listener);
    };
  },

  // ---- 对局助手 ------------------------------------------------------------
  /** 取一次当前快照(同时会把主进程轮询器唤醒) */
  getMatchState: (): Promise<MatchSnapshot> => invoke('match:get-state'),
  /** 立刻重采一次 */
  refreshMatchState: (): Promise<MatchSnapshot> => invoke('match:refresh'),
  /** 取熟练度最高的 15 个英雄(本命英雄),同步时一起传给后端 */
  getTopChampions: (): Promise<TopChampion[]> => invoke('match:get-top-champions'),
  /** 读一份「段位 + 主玩位置」—— 同步时一起报给后端,后端靠它筛搭子 */
  getMatchProfile: (): Promise<MatchProfile> => invoke('match:get-profile'),
  /**
   * 查一个召唤师的资料(名字#标签 或 游戏 ID)。
   * 只有资料 —— 战绩在下面那个接口。
   */
  lookupPlayer: (query: string): Promise<PlayerLookup> =>
    invoke('match:lookup-player', { query }),
  /**
   * 查某个玩家的历史战绩(腾讯的对局服务)。
   * `puuid` 可以是**任何人**的 —— 客户端那层给不了别人的战绩。
   */
  fetchPlayerGames: (
    puuid: string,
    startIndex = 0,
    count = 20
  ): Promise<PlayerGamesSummary> =>
    invoke('match:fetch-player-games', { puuid, startIndex, count }),
  /** 最近一局的两队人(gameflow) */
  getOpponents: (): Promise<OpponentsSnapshot> => invoke('match:get-opponents'),
  /** 主进程里存着的上一份推荐(切页回来还能看到) */
  getRecommendation: (): Promise<RecommendationState> => invoke('match:get-recommendation'),
  /** 英雄名 → 编号 的对照表 —— 界面靠它把 AI 给的英雄名配上头像 */
  getChampionIndex: (): Promise<ChampionIndexEntry[]> => invoke('match:get-champion-index'),
  /** 拿当前选人会话去生成推荐 */
  requestRecommendation: (): Promise<RecommendationState> => invoke('match:recommend'),
  getLlmStatus: (): Promise<LlmStatus> => invoke('llm:get-status'),
  setLlmApiKey: (apiKey: string): Promise<LlmStatus> => invoke('llm:set-key', { apiKey }),
  clearLlmApiKey: (): Promise<LlmStatus> => invoke('llm:clear-key'),

  // ---- 实用功能 ------------------------------------------------------------
  /** 自动接受对局的当前状态 */
  getAutoAccept: (): Promise<AutoAcceptState> => invoke('tools:get-auto-accept'),
  /** 开关自动接受对局 */
  setAutoAccept: (enabled: boolean): Promise<AutoAcceptState> =>
    invoke('tools:set-auto-accept', { enabled }),
  /** 设置接受前要等多久(秒) */
  setAutoAcceptDelay: (delaySeconds: number): Promise<AutoAcceptState> =>
    invoke('tools:set-auto-accept-delay', { delaySeconds }),
  /** 拉同大区的用户(找人双排) */
  fetchRegionUsers: (query?: RegionUsersQuery): Promise<RegionUsersResult> =>
    invoke('tools:fetch-region-users', query ?? {}),

  // ---- 局末结算 ------------------------------------------------------------
  /** 取完整的那份结算;null = 还没打过一局 */
  getSettlement: (): Promise<SettlementView | null> => invoke('match:get-settlement'),
  /** 提交皮肤评分 */
  submitRating: (payload: {
    skinId: number;
    handFeel: number;
    artwork: number;
    model: number;
    mockery: number;
    /** 评价文字;空 = 只打星 */
    content?: string;
  }): Promise<{
    ok: true;
    stats: SkinRatingStats | null;
    /** 后端实际存下来的评价文字;null = 没写上 */
    savedContent: string | null;
  }> => invoke('rating:submit', payload),
  /** 我打过的全部评分(一次拉完,按站内皮肤 id 建索引) */
  fetchMyRatings: (): Promise<MySkinRating[]> => invoke('rating:my-list'),
  /** 某款皮肤的聚合评分;null = 还没人打过分 */
  fetchSkinRatingStats: (skinId: number): Promise<SkinRatingStats | null> =>
    invoke('rating:skin-stats', skinId),
  /** 订阅主进程推来的局末结算,返回取消订阅的函数 */
  onSettlement: (cb: (settlement: LocalSettlement) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, settlement: LocalSettlement): void => {
      cb(settlement);
    };
    ipcRenderer.on(SETTLEMENT_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(SETTLEMENT_CHANNEL, listener);
    };
  },

  /** 订阅主进程推来的对局快照,返回取消订阅的函数 */
  onMatchState: (cb: (snapshot: MatchSnapshot) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: MatchSnapshot): void => {
      cb(snapshot);
    };
    ipcRenderer.on(MATCH_STATE_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(MATCH_STATE_CHANNEL, listener);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
