/**
 * 对局助手(原 lol-match-data)与主进程 / 渲染进程共用的类型。
 *
 * 这个文件不许 import 任何东西 —— 它同时被 electron-vite 的 main / preload /
 * renderer 三个构建目标引用,带依赖就会把 electron 之类的 Node 侧模块拖进
 * 渲染进程的编译范围。
 */

export type MatchState = 'idle' | 'lobby' | 'champ_select' | 'in_game';

/**
 * LCU WebSocket 通道(事件加速)的状态。
 *
 * connected = 事件流已连上,状态变化能立刻反映到界面;
 * disconnected = 没连上,只能靠 2 秒轮询 —— 不是故障,客户端没开时就是这样。
 */
export type LcuWsStatus = 'disconnected' | 'connecting' | 'connected';

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

/**
 * 一个英雄的官方熟练度。
 *
 * 数据来自客户端的 champion-mastery 接口,是 Riot 自己算的点数 —— 不是本机
 * 估算出来的,所以「本命英雄」直接看 points 最高的那个就行。
 */
export interface ChampionMastery {
  championId: number;
  championName: string;
  championIconUrl: string | null;
  /** 熟练度等级 */
  championLevel: number;
  /** 熟练度点数 —— 本命英雄口径 */
  championPoints: number;
  /** 本赛季最高评级(S+ / S / A+ ...);空串 = 没有评级 */
  highestGrade: string;
  /** 最近一局使用时间(epoch ms);0 = 没记录 */
  lastPlayTime: number;
  tokensEarned: number;
}

/** 熟练度 + 最近对局窗口里这个英雄的成绩。 */
export interface MasteryRow extends ChampionMastery {
  /** 最近对局窗口内的场次 */
  recentGames: number;
  /** 最近对局窗口内的胜场 */
  recentWins: number;
}

export type MasterySortMode = 'mastery' | 'winrate';

/**
 * 把熟练度和最近对局窗口对起来。
 *
 * 窗口只有 20 局(客户端本地就只留 20 局),所以 `recentGames` 大多是小数字,
 * 拿它算胜率噪声很大 —— 界面把它标成「近 20 局」,不当成总体胜率。
 */
export function buildMasteryRows(
  entries: ChampionMastery[],
  recent: RecentMatchesSummary | null
): MasteryRow[] {
  const counts = new Map<number, { games: number; wins: number }>();
  for (const match of recent?.matches ?? []) {
    const stat = counts.get(match.championId) ?? { games: 0, wins: 0 };
    stat.games += 1;
    if (match.win) stat.wins += 1;
    counts.set(match.championId, stat);
  }
  return entries.map((entry) => {
    const stat = counts.get(entry.championId);
    return { ...entry, recentGames: stat?.games ?? 0, recentWins: stat?.wins ?? 0 };
  });
}

/**
 * 排序。
 *
 * - `mastery`:按官方点数降序 —— 本命英雄口径。
 * - `winrate`:按最近窗口里的胜率降序,**只保留窗口里出现过的英雄** ——
 *   没出现过的英雄没有胜率可言,排进来只会占位。
 */
export function sortMasteryRows(rows: MasteryRow[], mode: MasterySortMode): MasteryRow[] {
  if (mode === 'mastery') {
    return [...rows].sort((a, b) => b.championPoints - a.championPoints);
  }
  return rows
    .filter((row) => row.recentGames > 0)
    .sort((a, b) => {
      const diff = b.recentWins / b.recentGames - a.recentWins / a.recentGames;
      if (diff !== 0) return diff;
      return b.championPoints - a.championPoints;
    });
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
  /** 官方英雄熟练度,按点数降序 */
  mastery: ChampionMastery[];
  /**
   * 段位是从哪儿来的:
   *   - `'ws'` —— 客户端删掉了 /lol-ranked/* 端点,段位是从事件流里捞的;
   *   - `'summoner-profile'` —— 退到召唤师档案;
   *   - 其余是命中的 HTTP 端点路径;null = 压根没数据。
   */
  rankedSource: string | null;
  /** 事件加速通道的状态 */
  wsStatus: LcuWsStatus;
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
