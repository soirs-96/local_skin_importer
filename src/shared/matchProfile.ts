/**
 * 「我能跟谁一起打」这份资料的数据形状。
 *
 * 段位和主玩位置都是桌面端从游戏客户端读到的,同步时一起报给后端 ——
 * 后端拿它们做同区搭子的匹配(分数差不多 + 位置对得上)。
 *
 * 位置代码跟后端 `t_user_position.position` 是同一套:top / jungle / mid /
 * adc / support。
 */

import type { PositionKey } from './gameLabels';

/** 后端的位置代码。 */
export type PositionCode = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

/** 上报给后端的一条排位段位。 */
export interface RankedReport {
  /** 队列串:RANKED_SOLO_5x5 / RANKED_FLEX_5x5 */
  queueType: string;
  /** 大段位英文名(IRON / GOLD / …) */
  tier: string;
  /** 小段:I / II / III / IV;大师及以上没有小段 */
  division: string;
  /** 胜点 */
  leaguePoints: number;
  /** 胜场 */
  wins: number;
  /** 负场 */
  losses: number;
}

/** 上报给后端的一个主玩位置。 */
export interface PositionReport {
  position: PositionCode;
  /** 统计到的对局数 */
  matchCount: number;
}

/**
 * 上报给后端的一场排位 —— 大厅「近 10 场」的那份数据。
 *
 * <p>别人的对局历史在别人的电脑上,后端拿不到;只能桌面端同步时带上来。
 */
export interface RecentMatchReport {
  /** LCU 的 gameId */
  gameId: string;
  championId: number;
  championName: string;
  /** 位置;空串 = 认不出来(那一场不参与位置统计) */
  position: PositionCode | '';
  queueType: string;
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  durationS: number;
  win: boolean;
  /** 单场表现分 0~100 —— 见 {@link scoreRecentMatch} */
  score: number;
  /** 对局时间(epoch 毫秒) */
  playedAtMs: number;
}

/** 段位 + 位置 + 近 10 场,一起上报。 */
export interface MatchProfile {
  ranked: RankedReport[];
  positions: PositionReport[];
  /** 最近 10 场**排位**;读不到对局历史时是空数组 */
  recentMatches: RecentMatchReport[];
}

/** 位置(机器键)→ 后端的位置代码。 */
const POSITION_CODES: Record<Exclude<PositionKey, 'UNKNOWN'>, PositionCode> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'mid',
  ADC: 'adc',
  SUPPORT: 'support'
};

/** 后端的位置代码 → 中文。 */
export const POSITION_CODE_LABELS: Record<PositionCode, string> = {
  top: '上单',
  jungle: '打野',
  mid: '中单',
  adc: '射手',
  support: '辅助'
};

/** 位置(机器键)→ 后端的位置代码;认不出来返回 null。 */
export function toPositionCode(key: PositionKey): PositionCode | null {
  if (key === 'UNKNOWN') return null;
  return POSITION_CODES[key] ?? null;
}

/** 后端的位置代码 → 中文;认不出来返回空串。 */
export function positionCodeLabel(code: string): string {
  return POSITION_CODE_LABELS[code as PositionCode] ?? '';
}

// ---- 队列 -------------------------------------------------------------------

/** 后端认的排位队列 —— 大乱斗和匹配不算。 */
export const RANKED_QUEUE_TYPES = ['RANKED_SOLO_5x5', 'RANKED_FLEX_5x5'] as const;

/**
 * 队列串归一 —— 后端认 `RANKED_SOLO_5x5` / `RANKED_FLEX_5x5`。
 *
 * 客户端有时候给 `RANKED_SOLO_5X5`(X 大写),统一成后端那一套。
 */
export function normalizeQueueType(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === 'RANKED_SOLO_5X5') return 'RANKED_SOLO_5x5';
  if (upper === 'RANKED_FLEX_5X5') return 'RANKED_FLEX_5x5';
  // 同一个灵活排位,有的客户端版本叫 SR。
  if (upper === 'RANKED_FLEX_SR') return 'RANKED_FLEX_5x5';
  return upper;
}

/** 是不是排位队列。 */
export function isRankedQueueType(raw: string): boolean {
  return (RANKED_QUEUE_TYPES as readonly string[]).includes(normalizeQueueType(raw));
}

// ---- 近期排位表现分 ---------------------------------------------------------

/** 各位置每分钟补刀的基准(CPM)—— 达到这个数就算「打满了」。 */
const CS_BASELINES: Record<PositionCode, number> = {
  top: 7.5,
  jungle: 6.0,
  mid: 6.8,
  adc: 7.0,
  support: 1.8
};

/** 认不出位置时的基准 —— 取五路里最接近大众水平的一个。 */
const CS_BASELINE_UNKNOWN = 5.5;

/**
 * 一场排位的表现分 —— 0~100。
 *
 * <p>**只看排位表现,跟皮肤评分没关系**:KDA、补刀、胜负三个维度。
 *
 * <ul>
 *   <li>KDA 分(45%):(击杀 + 助攻) / 死亡,除以 4 封顶。4.0 的 KDA 拿满分。</li>
 *   <li>补刀分(30%):每分钟补刀 ÷ 该位置的基准。**按位置折算** ——
 *       辅助本来就不该跟射手比补刀,不折算的话辅助永远是 0 分。</li>
 *   <li>胜负分(25%):赢了 100,输了 40 —— 输了不代表这局打得差。</li>
 * </ul>
 *
 * <p>近 10 场的总分 = 每场这个分的平均。
 */
export function scoreRecentMatch(input: {
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  durationS: number;
  win: boolean;
  position?: PositionCode | '';
}): number {
  const kda = (input.kills + input.assists) / Math.max(input.deaths, 1);
  const kdaScore = clamp(kda / 4, 0, 1) * 100;

  // 时长读不出来就当 30 分钟 —— 宁可给个中位补刀率,也不要给 0
  const minutes = Math.max(input.durationS, 1) / 60;
  const cpm = input.minionKills / minutes;
  const position = input.position ?? '';
  const baseline =
    position === '' ? CS_BASELINE_UNKNOWN : (CS_BASELINES[position] ?? CS_BASELINE_UNKNOWN);
  // 达到基准给 80 分,超出 25% 才封顶 100 —— 别让「补刀王」一个人霸榜
  const csScore = clamp(cpm / baseline, 0, 1.25) * 80;

  const resultScore = input.win ? 100 : 40;

  return Math.round(kdaScore * 0.45 + csScore * 0.3 + resultScore * 0.25);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
