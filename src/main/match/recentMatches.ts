import type { AxiosInstance } from 'axios';
import type { RecentMatch, RecentMatchesSummary } from '../../shared/match';
import type { StaticData } from './staticData';

/**
 * 最近对局(/lol-match-history/v1/products/lol/current-summoner/matches)。
 *
 * 这个端点有两个坑:
 *   1. **返回形状会变** —— 外层可能是 `{"games": [...]}`、`{"games": {"gameId": {...}}}`
 *      或者 `{"games": {"games": [...], "gameCount": N}}`,得逐个剥。
 *   2. **限流** —— 每 2 秒打一次,几分钟后就会开始返回空列表,界面上看起来像
 *      「数据没了」。所以调用方必须带缓存(见 poller)。
 */

const MATCHES_PATH = '/lol-match-history/v1/products/lol/current-summoner/matches';
const MATCHES_BEG = 0;
const MATCHES_END = 19;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** 从各种外层包装里把「对局数组」剥出来。剥不出来就当没有。 */
export function extractGames(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const games = payload.games;
  if (Array.isArray(games)) return games;
  if (isRecord(games)) {
    if (Array.isArray(games.games)) return games.games;
    if (isRecord(games.games)) return Object.values(games.games);
    return Object.values(games);
  }
  return [];
}

function extractItemIds(stats: Record<string, unknown>): number[] {
  const ids: number[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const id = num(stats[`item${i}`]);
    if (id > 0) ids.push(id);
  }
  return ids;
}

/**
 * 找出「我」在这一局里的那条 participant。
 *
 * 标准形状里 `participants` 只有 participantId / championId / stats,
 * **不含 summonerId** —— 玩家身份全在 `participantIdentities[].player` 里。
 * 所以认「我」的正确做法是:用当前召唤师的 puuid 在 identities 里定位,
 * 再拿 participantId 回 participants 里取对应那条。
 *
 * 没有 puuid 就真的认不出来(这个端点每局都有十个玩家,没有任何字段标记
 * 「哪个是我」),只能退到第一条 —— 总比整局丢掉强。
 */
function findMyParticipant(raw: Record<string, unknown>, puuid: string): Record<string, unknown> {
  const participants = Array.isArray(raw.participants) ? raw.participants.filter(isRecord) : [];
  if (participants.length === 0) return {};
  if (!puuid) return participants[0];

  const identities = Array.isArray(raw.participantIdentities)
    ? raw.participantIdentities.filter(isRecord)
    : [];

  for (const identity of identities) {
    const player = isRecord(identity.player) ? identity.player : {};
    if (str(player.puuid) !== puuid) continue;
    const found = participants.find((p) => p.participantId === identity.participantId);
    if (found) return found;
  }

  return participants[0];
}

export function parseMatchEntry(
  raw: unknown,
  staticData: StaticData,
  puuid = ''
): RecentMatch | null {
  if (!isRecord(raw)) return null;

  // 两种形状:
  //   - 简化版:stats 直接挂在顶层(没有 participants)
  //   - Riot 标准版:stats 在 participants[i].stats 里
  const simplified = isRecord(raw.stats) && !raw.participants;
  const participant = simplified ? raw : findMyParticipant(raw, puuid);
  const stats = isRecord(participant.stats) ? participant.stats : {};
  const timeline = isRecord(participant.timeline) ? participant.timeline : {};

  const championId = num(participant.championId);
  const info = staticData.champions.get(championId);
  const championName = info?.name || str(participant.championName) || str(raw.championName);

  const kills = num(stats.kills);
  const deaths = num(stats.deaths);
  const assists = num(stats.assists);

  return {
    gameId: num(raw.gameId),
    championId,
    championName: championName || `#${championId}`,
    championIconUrl: info?.iconUrl ?? null,
    queueType: str(raw.gameMode) || str(raw.queueType),
    role: str(timeline.role) || str(stats.role),
    kills,
    deaths,
    assists,
    kda: `${kills}/${deaths}/${assists}`,
    win: bool(stats.win),
    timestampMs: num(raw.gameCreation) || num(raw.gameCreationDate),
    durationS: num(raw.gameDuration),
    items: extractItemIds(stats).map((itemId) => {
      const item = staticData.items.get(itemId);
      return {
        itemId,
        name: item?.name ?? `物品#${itemId}`,
        iconUrl: item?.iconUrl ?? null
      };
    })
  };
}

export function parseRecentMatches(
  raw: unknown,
  staticData: StaticData,
  puuid = ''
): RecentMatchesSummary {
  const games = extractGames(raw);
  const matches: RecentMatch[] = [];
  for (const game of games) {
    const parsed = parseMatchEntry(game, staticData, puuid);
    if (parsed) matches.push(parsed);
  }
  const wins = matches.filter((m) => m.win).length;
  return {
    total: matches.length,
    wins,
    winrate: matches.length > 0 ? wins / matches.length : 0,
    matches
  };
}

export async function getRecentMatches(
  client: AxiosInstance,
  staticData: StaticData,
  puuid = ''
): Promise<RecentMatchesSummary> {
  const { data } = await client.get(MATCHES_PATH, {
    params: { begIndex: MATCHES_BEG, endIndex: MATCHES_END },
    timeout: 10_000
  });
  return parseRecentMatches(data, staticData, puuid);
}
