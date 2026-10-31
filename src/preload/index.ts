import { contextBridge, ipcRenderer } from 'electron';
import { MATCH_STATE_CHANNEL } from '../shared/match';
import type {
  LlmStatus,
  MatchSnapshot,
  RecommendationState
} from '../shared/match';

export type {
  ChampSelectMember,
  ChampSelectSession,
  ChampionRef,
  LlmStatus,
  LiveGameInfo,
  MatchSnapshot,
  MatchState,
  MatchSummoner,
  RankedEntry,
  RecentMatch,
  RecentMatchesSummary,
  RecommendationState
} from '../shared/match';

export interface LcuStatus {
  running: boolean;
  port?: number;
  summoner?: {
    displayName: string;
    puuid: string;
  };
  error?: string;
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
  checkLcu: (): Promise<LcuStatus> => invoke('lcu:check-status'),
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

  // ---- 对局助手 ------------------------------------------------------------
  /** 取一次当前快照(同时会把主进程轮询器唤醒) */
  getMatchState: (): Promise<MatchSnapshot> => invoke('match:get-state'),
  /** 立刻重采一次 */
  refreshMatchState: (): Promise<MatchSnapshot> => invoke('match:refresh'),
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
