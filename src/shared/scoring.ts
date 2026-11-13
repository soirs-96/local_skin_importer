/**
 * 排位对局的玩家评分引擎。
 *
 * 回答的问题是「同段位里他到底是强是弱」—— 段位只说明你在哪个池子,
 * 评分说明你在池子里排哪儿。
 *
 * 口径:**绝对分为主 + 同场对比**。
 *
 * - 绝对分 = 四个指标各跟**该位置的基准值**比,换算成 0~1 的子分,等权平均,
 *   乘 10 得到 0~10 分。基准值吸收了角色差异 —— 辅助的经济份额本来就低,
 *   拿全队平均当基准会把辅助永远压在后面。
 * - 同场对比 = 这一局十个人都打了分,「我比同场平均高多少分」是真实存在的差。
 *
 * **不给「超过了 X% 的玩家」这种说法** —— 那要一个人群基线库,
 * 本地算不出来,写了就是假数据。
 */

import type { PlayerGame } from './match';
import { POSITION_LABELS, resolvePosition, SUMMONERS_RIFT_MAP_ID } from './gameLabels';
import type { PositionKey } from './gameLabels';

/**
 * 参与评分的队列。
 *
 * 400 = 灵活排位、420 / 440 = 单双排。大乱斗(450)、极限闪击(490)、
 * 普通匹配(2400)一律不参与 —— 前两个没有「同段位」这回事,后一个不是排位。
 */
export const RANKED_QUEUE_IDS = new Set([400, 420, 440]);

/** 这一局算不算排位。 */
export function isRankedGame(game: PlayerGame): boolean {
  return game.mapId === SUMMONERS_RIFT_MAP_ID && RANKED_QUEUE_IDS.has(game.queueId);
}

/**
 * 各位置的基准值 —— 这个位置上「正常发挥」该有的水平。
 *
 * **这些是估算值**,按常规排位(黄金~铂金)的常见水平取的。方向没问题,
 * 具体数字肯定有偏差 —— 后端把真实对局数据汇起来之后可以自动校准这张表。
 *
 * 这张表是**模型参数**,不是展示给用户的数据;界面上给的是拿它算出来的实分数。
 */
export interface MetricBaseline {
  /** 期望参团率:(击杀 + 助攻) / 队伍总击杀 */
  kp: number;
  /** 期望经济份额:本局经济 / 队伍总经济 */
  goldShare: number;
  /** 期望伤害份额:本局伤害 / 队伍总伤害 */
  damageShare: number;
  /** 期望 KDA:(击杀 + 助攻) / max(死亡, 1) */
  kda: number;
}

export const POSITION_BASELINES: Record<PositionKey, MetricBaseline> = {
  MID: { kp: 0.6, goldShare: 0.25, damageShare: 0.26, kda: 3.4 },
  JUNGLE: { kp: 0.68, goldShare: 0.18, damageShare: 0.15, kda: 3.8 },
  ADC: { kp: 0.55, goldShare: 0.25, damageShare: 0.3, kda: 3.5 },
  TOP: { kp: 0.55, goldShare: 0.18, damageShare: 0.18, kda: 3.2 },
  SUPPORT: { kp: 0.72, goldShare: 0.1, damageShare: 0.07, kda: 3.8 },
  UNKNOWN: { kp: 0.6, goldShare: 0.2, damageShare: 0.2, kda: 3.5 }
};

/** 比值夹在这个区间里再算 —— 防极端值把分数顶到天花板。 */
const RATIO_FLOOR = 0.25;
const RATIO_CEILING = 4;

/**
 * 比值 → 0~1 的子分。
 *
 * 对数曲线:正好是基准给 0.5 分,比基准高一倍给 0.75,四倍封顶 1;
 * 比基准低一半给 0.25,四分之一给 0。
 */
export function ratioToSubScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const clamped = Math.min(RATIO_CEILING, Math.max(RATIO_FLOOR, ratio));
  const value = 0.5 + 0.25 * Math.log2(clamped);
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 一个人这一局的原始指标。 */
export interface ScoreMetrics {
  /** 参团率 0~1 */
  kp: number;
  /** 经济份额 0~1 */
  goldShare: number;
  /** 伤害份额 0~1 */
  damageShare: number;
  /** 补刀份额 0~1 */
  csShare: number;
  kda: number;
}

/** 四个维度各自的 0~1 子分。 */
export interface ScoreBreakdown {
  participation: number;
  economy: number;
  damage: number;
  kda: number;
}

export interface PlayerScoreDetail {
  puuid: string;
  displayName: string;
  teamId: number;
  position: PositionKey;
  positionLabel: string;
  /** 本局分,0~10 */
  score: number;
  /** 本局排名,1 = 最好 */
  rank: number;
  isTarget: boolean;
  metrics: ScoreMetrics;
  breakdown: ScoreBreakdown;
}

export interface GameScore {
  gameId: string;
  /** 这一局十个人的平均分 */
  average: number;
  /** 按分从高到低排好的人 */
  players: PlayerScoreDetail[];
}

interface TeamTotals {
  kills: number;
  gold: number;
  damage: number;
  cs: number;
}

/**
 * 给一局里的十个人打分。
 *
 * 非召唤师峡谷的局返回 null —— 大乱斗没有分路、角色基准也不成立。
 * 人数不足 5 个的局同样不算 —— 那不是一场完整的对局。
 */
export function scoreGame(game: PlayerGame): GameScore | null {
  if (game.mapId !== SUMMONERS_RIFT_MAP_ID) return null;
  const participants = game.peers;
  if (participants.length < 5) return null;

  const totals = new Map<number, TeamTotals>();
  for (const p of participants) {
    const t = totals.get(p.teamId) ?? { kills: 0, gold: 0, damage: 0, cs: 0 };
    t.kills += p.kills;
    t.gold += p.goldEarned;
    t.damage += p.damageToChampions;
    t.cs += p.minionKills;
    totals.set(p.teamId, t);
  }

  const details: PlayerScoreDetail[] = participants.map((p) => {
    const team = totals.get(p.teamId) ?? { kills: 0, gold: 0, damage: 0, cs: 0 };
    const position = resolvePosition(game.mapId, p.lane, p.role);
    const base = POSITION_BASELINES[position];

    // 队伍 0 击杀时没人能参团 —— 这时候 KP 记成该位置的基准值(不奖不罚)。
    // 记 0 的话被团灭的一方整队归零,而那一局的问题不在「没参团」,在「被团灭了」。
    const kp = team.kills > 0 ? (p.kills + p.assists) / team.kills : base.kp;
    const goldShare = team.gold > 0 ? p.goldEarned / team.gold : 0;
    const damageShare = team.damage > 0 ? p.damageToChampions / team.damage : 0;
    const csShare = team.cs > 0 ? p.minionKills / team.cs : 0;
    const kda = (p.kills + p.assists) / Math.max(p.deaths, 1);

    const breakdown: ScoreBreakdown = {
      participation: ratioToSubScore(kp / base.kp),
      economy: ratioToSubScore(goldShare / base.goldShare),
      damage: ratioToSubScore(damageShare / base.damageShare),
      kda: ratioToSubScore(kda / base.kda)
    };
    const composite =
      (breakdown.participation + breakdown.economy + breakdown.damage + breakdown.kda) / 4;

    return {
      puuid: p.puuid,
      displayName: p.displayName,
      teamId: p.teamId,
      position,
      positionLabel: POSITION_LABELS[position],
      score: round1(composite * 10),
      rank: 0,
      isTarget: p.isTarget,
      metrics: { kp, goldShare, damageShare, csShare, kda },
      breakdown
    };
  });

  details.sort((a, b) => b.score - a.score);
  details.forEach((detail, index) => {
    detail.rank = index + 1;
  });

  const average = round1(details.reduce((sum, d) => sum + d.score, 0) / details.length);
  return { gameId: game.gameId, average, players: details };
}

export interface PositionScoreRow {
  position: PositionKey;
  label: string;
  score: number;
  games: number;
}

export interface PlayerScoreSummary {
  /** 近期排位均分,0~10 */
  score: number;
  /** 计入的排位场次 */
  games: number;
  /** 比同场平均高/低多少分(负数 = 低于同场那几个人) */
  vsAverage: number;
  /** 各指标的平均值 */
  metrics: ScoreMetrics;
  /** 各维度子分的平均值,0~1 */
  breakdown: ScoreBreakdown;
  /** 分位置的均分 */
  byPosition: PositionScoreRow[];
}

const EMPTY_METRICS: ScoreMetrics = {
  kp: 0,
  goldShare: 0,
  damageShare: 0,
  csShare: 0,
  kda: 0
};

const EMPTY_BREAKDOWN: ScoreBreakdown = {
  participation: 0,
  economy: 0,
  damage: 0,
  kda: 0
};

/**
 * 把一个玩家的几局战绩汇总成一张成绩单。
 *
 * 只统计**排位** —— 大乱斗和普通匹配不进分。
 */
export function summarizePlayerScores(games: PlayerGame[]): PlayerScoreSummary {
  const scored: { detail: PlayerScoreDetail; average: number }[] = [];
  for (const game of games) {
    if (!isRankedGame(game)) continue;
    const result = scoreGame(game);
    if (!result) continue;
    const me = result.players.find((p) => p.isTarget);
    if (!me) continue;
    scored.push({ detail: me, average: result.average });
  }

  const count = scored.length;
  if (count === 0) {
    return {
      score: 0,
      games: 0,
      vsAverage: 0,
      metrics: { ...EMPTY_METRICS },
      breakdown: { ...EMPTY_BREAKDOWN },
      byPosition: []
    };
  }

  const metrics = { ...EMPTY_METRICS };
  const breakdown = { ...EMPTY_BREAKDOWN };
  const positions = new Map<PositionKey, { score: number; games: number }>();
  let scoreSum = 0;
  let vsSum = 0;

  for (const { detail, average } of scored) {
    scoreSum += detail.score;
    vsSum += detail.score - average;
    metrics.kp += detail.metrics.kp;
    metrics.goldShare += detail.metrics.goldShare;
    metrics.damageShare += detail.metrics.damageShare;
    metrics.csShare += detail.metrics.csShare;
    metrics.kda += detail.metrics.kda;
    breakdown.participation += detail.breakdown.participation;
    breakdown.economy += detail.breakdown.economy;
    breakdown.damage += detail.breakdown.damage;
    breakdown.kda += detail.breakdown.kda;

    const entry = positions.get(detail.position) ?? { score: 0, games: 0 };
    entry.score += detail.score;
    entry.games += 1;
    positions.set(detail.position, entry);
  }

  return {
    score: round1(scoreSum / count),
    games: count,
    vsAverage: round1(vsSum / count),
    metrics: {
      kp: metrics.kp / count,
      goldShare: metrics.goldShare / count,
      damageShare: metrics.damageShare / count,
      csShare: metrics.csShare / count,
      kda: metrics.kda / count
    },
    breakdown: {
      participation: breakdown.participation / count,
      economy: breakdown.economy / count,
      damage: breakdown.damage / count,
      kda: breakdown.kda / count
    },
    byPosition: [...positions.entries()]
      .map(([position, entry]) => ({
        position,
        label: POSITION_LABELS[position],
        score: round1(entry.score / entry.games),
        games: entry.games
      }))
      .sort((a, b) => b.games - a.games)
  };
}

/**
 * 给一批对局建 gameId → 评分的索引。
 *
 * 界面用它在每行对局旁边显示「本局分」,也在十人面板里显示每个人的分。
 */
export function buildScoreIndex(games: PlayerGame[]): Record<string, GameScore> {
  const index: Record<string, GameScore> = {};
  for (const game of games) {
    const result = scoreGame(game);
    if (result) index[result.gameId] = result;
  }
  return index;
}

/** 一个人这一局的分(他在十个人里排第几也会带上)。 */
export function targetOf(score: GameScore): PlayerScoreDetail | undefined {
  return score.players.find((p) => p.isTarget);
}
