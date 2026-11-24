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

/** 段位 + 位置,一起上报。 */
export interface MatchProfile {
  ranked: RankedReport[];
  positions: PositionReport[];
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
