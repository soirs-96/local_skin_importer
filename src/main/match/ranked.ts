import type { AxiosInstance } from 'axios';
import type { RankedEntry } from '../../shared/match';
import { formatRankDisplay, queueLabel } from '../../shared/rankLabels';

/**
 * 排位段位。
 *
 * 麻烦在于**同一个客户端版本里,ranked 数据可能藏在好几个端点下**,而
 * 新版客户端又会把其中几个直接删掉。所以这里按「已知端点依次探测,
 * 第一个给出可用数据的就赢」来找,全都不行再退到召唤师档案里的
 * `regalia.highestRankedEntry`(只剩段位,没有胜场/胜点)。
 */

// 中文标签表在 src/shared/rankLabels.ts —— 渲染进程显示队列名时也要用。
export { formatRankDisplay, queueLabel };

const PROFILE_PATH = '/lol-summoner/v1/current-summoner/summoner-profile';

export interface RankedResult {
  entries: RankedEntry[];
  /** 命中的端点;null = 全都没数据 */
  source: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseRankedEntries(raw: unknown): RankedEntry[] {
  let queues: unknown[];
  if (Array.isArray(raw)) {
    queues = raw;
  } else if (isRecord(raw)) {
    const inner = raw.queues;
    queues = Array.isArray(inner) ? inner : [];
  } else {
    queues = [];
  }

  const out: RankedEntry[] = [];
  for (const q of queues) {
    if (!isRecord(q)) continue;
    const tier = str(q.tier);
    if (!tier) continue;
    // 新客户端用 division,老客户端用 rank
    const division = str(q.division) || str(q.rank);
    const wins = num(q.wins);
    const losses = num(q.losses);
    const total = wins + losses;
    out.push({
      queueType: str(q.queueType),
      tier,
      division,
      leaguePoints: num(q.leaguePoints),
      wins,
      losses,
      display: formatRankDisplay(tier, division),
      winrate: total > 0 ? wins / total : 0
    });
  }
  return out;
}

/** 从召唤师档案里刨 ranked 形状的数据(不同客户端版本塞的 key 不一样)。 */
export function extractRankedFromProfile(profile: unknown): RankedEntry[] {
  if (!isRecord(profile)) return [];

  const directKeys = ['rankedQueues', 'rankedStats', 'ranked', 'queues', 'rankedQueueStats'];
  for (const key of directKeys) {
    const value = profile[key];
    if (Array.isArray(value) && value.length > 0) {
      return parseRankedEntries(value);
    }
    if (isRecord(value) && Array.isArray(value.queues) && value.queues.length > 0) {
      return parseRankedEntries(value.queues);
    }
  }

  // 嵌套一层:profile.xxx.queues
  for (const value of Object.values(profile)) {
    if (!isRecord(value)) continue;
    for (const key of ['queues', 'rankedQueues', 'ranked']) {
      const inner = value[key];
      if (!Array.isArray(inner) || inner.length === 0) continue;
      const hasRankField = inner.some(
        (e) => isRecord(e) && (e.tier || e.queueType || e.leaguePoints !== undefined)
      );
      if (!hasRankField) {
        continue;
      }
      return parseRankedEntries(inner);
    }
  }

  // 新客户端只剩横幅徽章:regalia.highestRankedEntry
  const regalia = profile.regalia;
  if (isRecord(regalia)) {
    const highest = regalia.highestRankedEntry;
    if (isRecord(highest) && str(highest.tier)) {
      return parseRankedEntries([
        {
          queueType: str(highest.queue) || 'RANKED_SOLO_5x5',
          tier: str(highest.tier),
          division: str(highest.division),
          leaguePoints: 0,
          wins: 0,
          losses: 0
        }
      ]);
    }
  }

  return [];
}

export async function getRankedEntries(
  client: AxiosInstance,
  puuid: string
): Promise<RankedResult> {
  const candidates: string[] = ['/lol-ranked/v1/current-ranked-stats'];
  if (puuid) {
    candidates.push(
      `/lol-ranked/v1/ranked-stats/by-puuid/${puuid}`,
      `/lol-ranked/v2/ranked-stats/by-puuid/${puuid}`,
      `/lol-ranked/v5/ranked-stats/by-puuid/${puuid}`,
      `/lol-ranked/v6/ranked-stats/by-puuid/${puuid}`
    );
  }
  candidates.push('/lol-ranked/v5/ranked-stats');

  for (const path of candidates) {
    try {
      const { data } = await client.get(path, { timeout: 5000 });
      const entries = parseRankedEntries(data);
      if (entries.length > 0) return { entries, source: path };
    } catch {
      // 这个端点不存在 / 被删了,试下一个
    }
  }

  // 兜底:召唤师档案
  try {
    const { data } = await client.get(PROFILE_PATH, { timeout: 5000 });
    const entries = extractRankedFromProfile(data);
    if (entries.length > 0) return { entries, source: 'summoner-profile' };
  } catch {
    // 档案也读不到就真的没有了
  }

  return { entries: [], source: null };
}
