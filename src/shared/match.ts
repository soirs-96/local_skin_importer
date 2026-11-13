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
  /**
   * 头像编号(`profileIconId`)。
   * 头像图从本机客户端取:`/lol-game-data/assets/v1/profile-icons/{id}.jpg`。
   * 0 = 客户端没给,界面上不显示头像。
   */
  profileIconId: number;
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
  /** 客户端给的对局模式串:'CLASSIC' = 召唤师峡谷,'ARAM' = 大乱斗。 */
  gameMode: string;
  /** 地图编号:11 = 召唤师峡谷,12 = 大乱斗;0 = 客户端没给。 */
  mapId: number;
  /** 队列编号:420 = 单双排,450 = 大乱斗 …;0 = 客户端没给。 */
  queueId: number;
  /** 队列名(客户端只给名字的那种数据源)。 */
  queueType: string;
  /** 分路:TOP / MIDDLE / BOTTOM / JUNGLE;空串 = 没给。 */
  lane: string;
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
 * 一个「本命英雄」条目 —— 上传给后端的那份。
 *
 * `championNameEn` 是**英文 key**(Annie / MonkeyKing),后端靠它对齐自己的
 * 英雄表:后端的英雄编号是导入脚本的自增序号,跟 Riot 的编号对不上,
 * 只有英文名两边是一致的。
 */
export interface TopChampion {
  championId: number;
  championName: string;
  championNameEn: string;
  championPoints: number;
}

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

/**
 * 某个玩家的一局战绩。
 *
 * 数据来自腾讯的 ledge 网关(`match-history-query`),**任意玩家**都能查 ——
 * 不是只限自己。字段跟 `RecentMatch` 同构,多出的是经济/伤害/补刀这些。
 */
export interface PlayerGame {
  /** 腾讯的对局号,形如 `TJ101_401186650860` */
  gameId: string;
  /** 对局结束时间(epoch ms) */
  timestampMs: number;
  /** 对局时长(秒) */
  durationS: number;
  /** 队列编号:420=排位,2400=匹配 */
  queueId: number;
  /** 模式名(KIWI / CLASSIC …) */
  gameMode: string;
  mapId: number;
  championId: number;
  championName: string;
  championIconUrl: string | null;
  kills: number;
  deaths: number;
  assists: number;
  /** 「3/1/8」 */
  kda: string;
  win: boolean;
  /** 分路:TOP / MIDDLE / BOTTOM / JUNGLE */
  lane: string;
  /** 定位:SOLO / DUO / CARRY / SUPPORT / NONE */
  role: string;
  goldEarned: number;
  damageToChampions: number;
  minionKills: number;
  items: RecentMatchItem[];
  /**
   * 这一局的全部十个人。
   *
   * 腾讯的列表接口每局都带全量明细,所以这些人是**顺带**带回来的,不用再请求。
   */
  peers: PlayerPeer[];
}

/**
 * 一局里的一个玩家(展开某一局时用)。
 *
 * 十个人是从同一份 SUMMARY 里拆出来的,所以「这一局谁在打、谁输了」是现成的,
 * 不用再单独请求一次单局接口。
 */
export interface PlayerPeer {
  puuid: string;
  /** 玩家名(游戏名 + 标签) */
  displayName: string;
  championId: number;
  championName: string;
  championIconUrl: string | null;
  kills: number;
  deaths: number;
  assists: number;
  /** 「3/1/8」 */
  kda: string;
  win: boolean;
  /** 阵营:100 = 蓝方,200 = 红方 */
  teamId: number;
  /** 是不是被查的那个人 */
  isTarget: boolean;
  /** 本局赚的钱 —— 算经济份额要用 */
  goldEarned: number;
  /** 对英雄造成的伤害 —— 算伤害份额要用 */
  damageToChampions: number;
  /** 补掉的兵 —— 算补刀份额要用 */
  minionKills: number;
  /** 分路:TOP / MIDDLE / BOTTOM / JUNGLE */
  lane: string;
  /** 定位:SOLO / DUO / CARRY / SUPPORT / NONE */
  role: string;
}

export interface PlayerGamesSummary {
  /** 这次拉到的局数 */
  total: number;
  wins: number;
  /** 0~1 */
  winrate: number;
  games: PlayerGame[];
}

/**
 * 查玩家的**资料**结果。
 *
 * 资料来自国服客户端的搜人接口(任意玩家都能查),秒回。
 *
 * **战绩不在这里** —— 战绩来自腾讯的 ledge 网关,要单独发一次请求(慢得多),
 * 所以拆成两个接口,界面可以先把资料摆出来,战绩随后补上。
 */
export interface PlayerLookup {
  /** 原样回显用户输的查询串 */
  query: string;
  found: boolean;
  /** 「名字#标签」;客户端没给就是空串 */
  riotId: string;
  displayName: string;
  tagLine: string;
  summonerId: number;
  puuid: string;
  summonerLevel: number;
  /**
   * 头像编号(召唤师资料里的 `profileIconId`)。
   *
   * 头像图从本机客户端取:`/lol-game-data/assets/v1/profile-icons/{id}.jpg`。
   * 0 = 客户端没给,界面上不显示头像。
   */
  profileIconId: number;
  /** 段位显示串(如「荣耀黄金 III」);客户端没给就是空串 */
  rankedDisplay: string;
  /** 段位代号(GOLD / PLATINUM …),画段位徽章用;空串 = 没有段位 */
  rankedTier: string;
  /** 段位小段(IV / III …) */
  rankedDivision: string;
  /**
   * 各队列的段位明细(总场次/胜场/负场/胜点)。
   *
   * 只收**有真实场次**的队列 —— 客户端只给一个「最高段位」而没有场次时,
   * 那一行显示的总场次会是 0,那是假数据,宁可整行不显示。
   */
  ranked: RankedEntry[];
  /** 查的是不是自己 */
  isSelf: boolean;
  /** 查不到的原因;null = 查到了 */
  error: string | null;
}

/** 一局里的一个玩家。 */
export interface Opponent {
  summonerId: number;
  puuid: string;
  summonerName: string;
  championId: number;
  championName: string;
  championIconUrl: string | null;
  /** ally = 我这一队;enemy = 对面 */
  side: 'ally' | 'enemy';
  /** 是不是我 */
  isSelf: boolean;
}

/**
 * 最近一局的两队人。
 *
 * 数据来自 gameflow 的 `gameData.teamOne` / `teamTwo` —— 这是客户端里
 * **唯一**能拿到别的玩家的地方, 客户端只保留当前这一局的队伍信息。
 */
export interface OpponentsSnapshot {
  /** gameflow 阶段;空串 = 没在对局里 */
  phase: string;
  /** 队列名(如 CLASSIC);空串 = 没拿到 */
  queueType: string;
  /** 这一局有没有数据 */
  inGame: boolean;
  opponents: Opponent[];
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
