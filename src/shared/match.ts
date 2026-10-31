/**
 * 对局助手(原 lol-match-data)与主进程 / 渲染进程共用的类型。
 *
 * 这个文件不许 import 任何东西 —— 它同时被 electron-vite 的 main / preload /
 * renderer 三个构建目标引用,带依赖就会把 electron 之类的 Node 侧模块拖进
 * 渲染进程的编译范围。
 */

export type MatchState = 'idle' | 'lobby' | 'champ_select' | 'in_game';

/** 主进程往渲染进程推对局快照用的 IPC 频道。 */
export const MATCH_STATE_CHANNEL = 'match:state';

export interface MatchSummoner {
  displayName: string;
  tagLine: string;
  puuid: string;
  summonerId: number;
}

/** 英雄的最小引用:够画头像和写名字就行。 */
export interface ChampionRef {
  championId: number;
  championName: string;
  championIconUrl: string | null;
}

export interface ChampSelectMember extends ChampionRef {
  /** LCU 给的位置:TOP / MIDDLE / BOTTOM / JUNGLE / SUPPORT,可能是空串 */
  assignedPosition: string;
  cellId: number;
  summonerId: number;
}

export interface ChampSelectSession {
  myTeam: ChampSelectMember[];
  theirTeam: ChampSelectMember[];
  /** 我方这一行被分配到的位置;空串 = 还没选位置 */
  myRole: string;
  myChampionId: number;
  /** 我在 myTeam 里的格位;渲染进程靠它把「我」标出来 */
  myCellId: number;
  bannedChampions: ChampionRef[];
}

export interface RankedEntry {
  queueType: string;
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  /** 「黄金 III」这种展示串 */
  display: string;
  /** 0~1 */
  winrate: number;
}

export interface RecentMatchItem {
  itemId: number;
  name: string;
  iconUrl: string | null;
}

export interface RecentMatch {
  gameId: number;
  championId: number;
  championName: string;
  championIconUrl: string | null;
  queueType: string;
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  /** 「3/1/8」 */
  kda: string;
  win: boolean;
  timestampMs: number;
  durationS: number;
  items: RecentMatchItem[];
}

export interface RecentMatchesSummary {
  total: number;
  wins: number;
  /** 0~1 */
  winrate: number;
  matches: RecentMatch[];
}

export interface LiveGameInfo {
  summonerName: string;
  currentGold: number;
  gameTime: number;
  gameMode: string;
}

/** 一次轮询采到的全量快照。渲染进程拿到它就能画完整个页面。 */
export interface MatchSnapshot {
  state: MatchState;
  summoner: MatchSummoner | null;
  live: LiveGameInfo | null;
  champSelect: ChampSelectSession | null;
  ranked: RankedEntry[];
  recent: RecentMatchesSummary | null;
  /** 最近一次采集失败的原因;null = 上次采集成功 */
  lastError: string | null;
  /** epoch ms */
  updatedAt: number;
}

export interface RecommendationState {
  markdown: string | null;
  usedFallback: boolean;
  error: string | null;
  inflight: boolean;
  /** epoch ms */
  generatedAt: number | null;
}

export interface LlmStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
  /** false = 系统没有可用的加密,Key 只存在内存里,重启后要重新填 */
  persisted: boolean;
}
