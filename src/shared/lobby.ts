/**
 * 「开黑大厅」的数据形状和纯展示逻辑。
 *
 * <p>跟 `regionUsers.ts` 一个路子:类型和纯函数放 shared —— 主进程拿来发请求,
 * 渲染进程拿来渲染,两边对同一份数据的理解不能分叉。
 */

import { lcuPhaseLabel } from './gameLabels';

/** 主进程往渲染进程推大厅状态的通道名。 */
export const LOBBY_EVENT_CHANNEL = 'lobby:state';

/** 发言正文上限 —— 跟后端的 `MAX_TEXT_LEN` 一致。 */
export const LOBBY_TEXT_MAX_LEN = 64;

/** 进大厅拉多少条历史。 */
export const LOBBY_HISTORY_LIMIT = 50;

/** 离线候选给几个。 */
export const LOBBY_OFFLINE_LIMIT = 30;

/**
 * 这个人的状态灯。
 *
 * - `idle`    —— 空闲(没在打),可以拉
 * - `busy`    —— 在打(选人/对局中/结算)
 * - `unknown` —— **认不出来**
 *
 * `unknown` 单独一档是有意的:没采集到阶段、或者客户端报了个没见过的阶段串,
 * 这时候**不猜**他有没有在打 —— 猜错就是把人拉进一局里。
 */
export type LobbyStatus = 'idle' | 'busy' | 'unknown';

/** 空闲的阶段串 —— 空着的也算空闲?不算,空是 unknown。 */
const IDLE_PHASES = new Set(['None', 'Lobby']);

/** 大厅里的一行玩家。 */
export interface LobbyPlayer {
  userId: number;
  nickname: string;
  /** 召唤师ID(数字标签)—— 复制ID / 邀请都用它 */
  gameId: string;
  /** 大区原始名 */
  zone: string;
  /** 归一化之后的大区名;null = 认不出来。**「同大区」比的是它,不是 zone** */
  canonicalZone: string | null;
  avatarUrl: string;
  /** 游戏客户端原始阶段串;空 = 没采集到 */
  phase: string;
  online: boolean;
  /** 是否公开自己的信息 */
  publicVisible: boolean;
  /** 段位数值分;null = 没同步过段位 */
  rankScore: number | null;
  /** 「黄金 III」这种展示串 */
  rankLabel: string | null;
  /** 站内收藏分 */
  collectionScore: number | null;
  positions: string[];
  positionLabels: string[];
  vip: boolean;
  /** 上次出现在大厅的时间('yyyy-MM-dd HH:mm:ss');null = 从来过 */
  lastLobbyAt: string | null;
}

/** 悬浮卡片里的一场排位。 */
export interface LobbyProfileMatch {
  gameId: string;
  championId: number;
  championName: string;
  /** 位置(中文);空串 = 认不出来 */
  positionLabel: string;
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  /** 这一局的分 0~10 */
  score: number;
  win: boolean;
  /** 对局时间(epoch 毫秒) */
  playedAtMs: number;
}

/** 五个维度的平均值 —— 跟战绩查询页那套评分是一个口径。 */
export interface LobbyProfileMetrics {
  /** 参团率 0~1 */
  kp: number;
  /** 经济份额 0~1 */
  goldShare: number;
  /** 伤害份额 0~1 */
  damageShare: number;
  /** 补刀份额 0~1 */
  csShare: number;
  /** KDA */
  kda: number;
}

/** 四个计分维度各自的平均子分,0~1。 */
export interface LobbyProfileBreakdown {
  participation: number;
  economy: number;
  damage: number;
  kda: number;
}

/**
 * 某个玩家近 10 场排位的档案 —— 大厅列表里鼠标悬浮出来的那张卡片。
 *
 * <p>数据来自「最近战绩」(腾讯的对局服务),跟「战绩查询」页**同一套评分**
 * (`shared/scoring.ts`):表现分 0~10,按各位置的基准值折算 —— 只看排位表现,
 * 跟皮肤评分没关系。
 */
export interface LobbyPlayerProfile {
  /** 表现分 0~10 —— 近 N 场排位的均分;null = 没有排位数据 */
  score: number | null;
  /** 计入的排位场次 */
  games: number;
  /** 排位胜场 */
  wins: number;
  /** 比同场平均高/低多少分(负数 = 低于同场那几个人) */
  vsAverage: number;
  /** 五个维度的平均值 */
  metrics: LobbyProfileMetrics;
  /** 四个计分维度各自的平均子分,0~1 */
  breakdown: LobbyProfileBreakdown;
  /** 打得最多的位置(中文);空串 = 没有排位数据 */
  positionLabel: string;
  /** 位置分布(打得多的在前) */
  byPosition: { label: string; score: number; games: number }[];
  /** 近期常用英雄 */
  champions: { championId: number; championName: string; count: number }[];
  /** 近 N 场明细,新的在前 */
  matches: LobbyProfileMatch[];
}

/** 顶栏的三个数字。 */
export interface LobbyStats {
  /** 在线且公开的人数 */
  online: number;
  /** 跟我同大区的 */
  sameZone: number;
  /** 现在空闲、可以拉的 */
  invitable: number;
}

/** 我自己的档案。 */
export interface LobbyMe {
  userId: number;
  nickname: string;
  zone: string;
  /** 归一化之后的大区名;null = 认不出来 */
  canonicalZone: string | null;
  rankScore: number | null;
  rankLabel: string | null;
  collectionScore: number | null;
  vip: boolean;
}

/** 大厅的一份完整快照。 */
export interface LobbySnapshot {
  online: LobbyPlayer[];
  offline: LobbyPlayer[];
  stats: LobbyStats;
  me: LobbyMe | null;
}

/** 一条聊天消息。 */
export interface LobbyMessage {
  id: number;
  userId: number;
  nickname: string;
  gameId: string;
  zone: string;
  text: string;
  /** 'yyyy-MM-dd HH:mm:ss' */
  createdAt: string;
}

/** 主进程里的连接状态。 */
export type LobbyClientStatus = 'disconnected' | 'connecting' | 'connected' | 'unauthorized';

/** 渲染进程拿到的大厅状态。 */
export interface LobbyState {
  status: LobbyClientStatus;
  /** true = WS 连不上,已经退化成 HTTP 轮询 */
  degraded: boolean;
  /** 「在大厅公开我的信息」 */
  publicVisible: boolean;
  snapshot: LobbySnapshot | null;
  messages: LobbyMessage[];
  /** 给用户看的一句话错误;null = 没有 */
  error: string | null;
}

/** 拉人结果。 */
export interface LobbyInviteResult {
  ok: boolean;
  /** invited = 真发出去了;copied = 降级成复制游戏ID */
  mode: 'invited' | 'copied';
  message: string;
}

// ---- 服务端 → 客户端 ------------------------------------------------------

export interface LobbyWelcomeFrame {
  type: 'welcome';
  history: LobbyMessage[];
  online: LobbyPlayer[];
  offline: LobbyPlayer[];
  stats: LobbyStats;
  me: LobbyMe | null;
}

export interface LobbyChatFrame {
  type: 'chat';
  id: number;
  userId: number;
  nickname: string;
  gameId: string;
  zone: string;
  text: string;
  createdAt: string;
}

export interface LobbyPresenceFrame {
  type: 'presence';
  online: LobbyPlayer[];
  stats: LobbyStats;
}

export interface LobbyPongFrame {
  type: 'pong';
}

export interface LobbyErrorFrame {
  type: 'error';
  code: string;
  reason: string;
}

export type LobbyServerFrame =
  | LobbyWelcomeFrame
  | LobbyChatFrame
  | LobbyPresenceFrame
  | LobbyPongFrame
  | LobbyErrorFrame;

// ---- 客户端 → 服务端 ------------------------------------------------------

export interface LobbyHelloFrame {
  type: 'hello';
  phase: string;
  public: boolean;
}

export interface LobbyProfileFrame {
  type: 'profile';
  phase: string;
  public: boolean;
}

export interface LobbySayFrame {
  type: 'say';
  text: string;
}

export interface LobbyPingFrame {
  type: 'ping';
}

export type LobbyClientFrame = LobbyHelloFrame | LobbyProfileFrame | LobbySayFrame | LobbyPingFrame;

// ---- 纯逻辑 ---------------------------------------------------------------

/** 这个人的状态灯属于哪一档。 */
export function lobbyStatusOf(phase: string): LobbyStatus {
  if (!phase) return 'unknown';
  if (IDLE_PHASES.has(phase)) return 'idle';
  // 认得出来的阶段 → 忙;认不出来的 → 未知
  return lcuPhaseLabel(phase) ? 'busy' : 'unknown';
}

/** 状态灯旁边显示的中文 —— 复用对局页那份映射。 */
export function lobbyStatusText(phase: string): string {
  return lcuPhaseLabel(phase) || '未知';
}

/** 能不能拉这个人进房间。 */
export function isLobbyInvitable(player: LobbyPlayer): boolean {
  if (!player.gameId) return false;
  return lobbyStatusOf(player.phase) === 'idle';
}

/** 一行显示的名字。 */
export function lobbyPlayerName(player: LobbyPlayer): string {
  return player.nickname || player.gameId || '无名召唤师';
}

/**
 * 列表里显示的上报主玩位置。
 *
 * <p>这是**历史累计**的位置(后端按 `t_user_position_stat` 统计的)——
 * 最近那 10 场的位置在悬浮卡片里,拉到之前先用这份顶着。
 */
export function lobbyPlayerPositions(player: LobbyPlayer): { codes: string[]; labels: string[] } {
  return { codes: player.positions, labels: player.positionLabels };
}

/**
 * 「上次在线 X 小时前」。
 *
 * <p>后端给的是 `yyyy-MM-dd HH:mm:ss`(全局 JacksonConfig 那套格式)。
 * 认不出来的串**原样显示** —— 显示成「0 小时前」是骗人。
 */
export function lobbyLastSeenText(lastLobbyAt: string | null, now: Date = new Date()): string {
  if (!lastLobbyAt) return '不知道';
  // '2026-11-24 22:16:03' → '2026-11-24T22:16:03'(不带时区 = 本地时间)
  const t = Date.parse(lastLobbyAt.replace(' ', 'T'));
  if (Number.isNaN(t)) return lastLobbyAt;
  const minutes = Math.floor((now.getTime() - t) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 两份消息合成一份 —— 按 id 去重,保留先来的那条。
 *
 * <p>去重是必须的:降级轮询和 WS 可能同时带同一条消息上来。
 */
export function mergeMessages(
  existing: LobbyMessage[],
  incoming: LobbyMessage[]
): LobbyMessage[] {
  const seen = new Set<number>();
  const out: LobbyMessage[] = [];
  for (const m of [...existing, ...incoming]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** 追加一条新消息 —— 老的在前,超上限砍最旧的。 */
export function appendMessages(existing: LobbyMessage[], message: LobbyMessage): LobbyMessage[] {
  return mergeMessages(existing, [message]).slice(-LOBBY_HISTORY_LIMIT);
}
