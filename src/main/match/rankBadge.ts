import { formatRankDisplay } from '../../shared/rankLabels';

/**
 * 从召唤师资料对象里刨出段位徽章。
 *
 * 段位在资料里有两种放法:
 *   - `regalia.highestRankedEntry` —— 「最高段位」徽章,只有段位没有场次;
 *   - `rankedQueues` / `rankedStats` / `queues` —— 各队列的明细。
 *
 * 两边形状不统一,谁先命中用谁 —— 都拿不到就是没有段位,不猜。
 */

export interface RankedBadge {
  tier: string;
  division: string;
  display: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const EMPTY_BADGE: RankedBadge = { tier: '', division: '', display: '' };

export function extractRankedBadge(raw: Record<string, unknown>): RankedBadge {
  const regalia = raw.regalia;
  if (isRecord(regalia)) {
    const highest = regalia.highestRankedEntry;
    if (isRecord(highest)) {
      const tier = str(highest.tier);
      if (tier) {
        const division = str(highest.division);
        return { tier, division, display: formatRankDisplay(tier, division) };
      }
    }
  }

  for (const key of ['rankedQueues', 'rankedStats', 'queues', 'ranked']) {
    const value = raw[key];
    const list = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.queues)
        ? value.queues
        : null;
    if (!list) continue;
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const tier = str(entry.tier);
      if (!tier) continue;
      const division = str(entry.division) || str(entry.rank);
      return { tier, division, display: formatRankDisplay(tier, division) };
    }
  }

  return EMPTY_BADGE;
}
