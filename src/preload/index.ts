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
import type { DevLogLine } from '../shared/dev';
import type { LcuDiagnosis, LcuFailureCode } from '../main/lcu/types';

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
  };
  ownedSkinIds: number[];
  source: OwnedDataSource;
  /** 是否已跟站内目录取交集(后端没升级 skinId 字段时为 false) */
  catalogFiltered: boolean;
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
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
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
  /** 把一段文本写进系统剪贴板(开发者面板的「复制诊断信息」用) */
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
  /** 拿当前选人会话去生成推荐 */
  requestRecommendation: (): Promise<RecommendationState> => invoke('match:recommend'),
  getLlmStatus: (): Promise<LlmStatus> => invoke('llm:get-status'),
  setLlmApiKey: (apiKey: string): Promise<LlmStatus> => invoke('llm:set-key', { apiKey }),
  clearLlmApiKey: (): Promise<LlmStatus> => invoke('llm:clear-key'),
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
