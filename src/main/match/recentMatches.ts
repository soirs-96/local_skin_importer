import type { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import type { RecentMatch, RecentMatchesSummary } from '../../shared/match';
import type { MatchScore } from '../../shared/settlement';
import type { StaticData } from './staticData';
import { parseMatchHistorySkinId } from './usedSkin';

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

/**
 * 客户端在「这一项没有值」时给的是字符串 `"NONE"` —— 当成没有。
 *
 * 原样透出去,界面上就是一个刺眼的「NONE」。
 */
function noneToEmpty(value: string): string {
  return value.trim().toUpperCase() === 'NONE' ? '' : value;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // 有的数据源把编号给成字符串 —— 认得出来就用,认不出来当没有。
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * 按路径取字段,取不到返回 undefined。
 *
 * 同一个含义的字段在不同版本里位置不一样(`gameMode` 有时挂在 `gameMetadata`
 * 下面),所以每个含义都给一串候选路径,按顺序取第一个有的。
 */
function pick(raw: Record<string, unknown>, path: string): unknown {
  let current: unknown = raw;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function pickStr(raw: Record<string, unknown>, paths: string[]): string {
  for (const path of paths) {
    const value = pick(raw, path);
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
}

function pickNum(raw: Record<string, unknown>, paths: string[]): number {
  for (const path of paths) {
    const value = pick(raw, path);
    const parsed = num(value);
    if (parsed !== 0) return parsed;
  }
  return 0;
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
export function findMyParticipant(raw: Record<string, unknown>, puuid: string): Record<string, unknown> {
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

/**
 * 角色任务道具的名字。
 *
 * 客户端在 `stats.roleBoundItem` 里给出一个道具编号,那件道具是玩家这一局的
 * 「角色任务」(打野任务 / 辅助任务 / 上路任务 …)—— **名字里就写着位置**。
 *
 * 名字从静态数据里查(客户端的 items.json 有这些道具,Data Dragon 没有)。
 * 查不到就空串 —— 位置退回 lane / role 判,不会更差。
 */
function roleBoundItemName(
  stats: Record<string, unknown>,
  staticData: StaticData
): string {
  const id = num(stats.roleBoundItem);
  if (id <= 0) return '';
  return staticData.items.get(id)?.name ?? '';
}

/**
 * 这一局十个人里最高的补刀。
 *
 * 拿来跟「我」的补刀比 —— 辅助不farm、射手要吃线,这是下路那两个人
 * 唯一分得开的信号(任务道具给的是「下路任务」,分不开)。
 */
function gameMaxMinionKills(participants: Record<string, unknown>[]): number {
  let max = 0;
  for (const participant of participants) {
    const stats = isRecord(participant.stats) ? participant.stats : {};
    const cs = num(stats.totalMinionsKilled);
    if (cs > max) max = cs;
  }
  return max;
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
  const participants = Array.isArray(raw.participants) ? raw.participants.filter(isRecord) : [];

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
    // 图标地址只认 id —— 静态数据没查到这个名字,不代表头像就画不出来
    championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
    // 客户端给的是 Riot 的 gameMode:'CLASSIC' / 'ARAM' / ...
    // 但腾讯这批数据里 gameMode 恒是 KIWI,大乱斗和召唤师峡谷都给它 ——
    // 所以判断大乱斗要靠 mapId / queueId,gameMode 只当补充。
    gameMode: pickStr(raw, ['gameMode', 'gameMetadata.gameMode', 'metadata.gameMode']),
    mapId: pickNum(raw, ['mapId', 'gameMetadata.mapId']),
    queueId: pickNum(raw, ['queueId', 'gameMetadata.queueId']),
    queueType: pickStr(raw, ['queueType', 'gameMetadata.queueType']),
    lane: noneToEmpty(str(timeline.lane) || str(stats.lane)),
    role: noneToEmpty(str(timeline.role) || str(stats.role)),
    // 角色任务道具:名字里写着位置,是唯一不会写错的位置来源。
    roleBoundItemName: roleBoundItemName(stats, staticData),
    kills,
    deaths,
    assists,
    kda: `${kills}/${deaths}/${assists}`,
    win: bool(stats.win),
    timestampMs: num(raw.gameCreation) || num(raw.gameCreationDate),
    durationS: num(raw.gameDuration),
    minionKills: num(stats.totalMinionsKilled),
    gameMaxMinionKills: gameMaxMinionKills(participants),
    items: extractItemIds(stats).map((itemId) => {
      const item = staticData.items.get(itemId);
      return {
        itemId,
        name: item?.name ?? `物品#${itemId}`,
        iconUrl: itemId > 0 ? lcuIconUrl('item', itemId) : null
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

/** 「刚打完的那一局」的查找窗口:30 分钟。 */
export const JUST_FINISHED_WINDOW_MS = 30 * 60_000;

/**
 * 定位「刚打完的那一局」。
 *
 * 客户端的 match history 有**落库延迟** —— 局末那一刻往往还查不到刚打完的这局,
 * 稍后再查就有了。定位规则:**gameCreation 距今 windowMs 内 + 英雄跟本局一致**,
 * 取最新的那个。
 *
 * 认不出来就返回 null —— **不拿最近的那一局冒充**。
 */
export async function findJustFinishedMatch(
  client: AxiosInstance,
  staticData: StaticData,
  puuid: string,
  championId: number,
  opts: { now?: number; windowMs?: number } = {}
): Promise<{ match: RecentMatch; skinId: number | null } | null> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? JUST_FINISHED_WINDOW_MS;
  const { data } = await client.get(MATCHES_PATH, {
    params: { begIndex: MATCHES_BEG, endIndex: MATCHES_END },
    timeout: 10_000
  });
  const games = extractGames(data);
  let best: { match: RecentMatch; skinId: number | null } | null = null;
  for (const game of games) {
    if (!isRecord(game)) continue;
    const match = parseMatchEntry(game, staticData, puuid);
    if (!match) continue;
    if (match.timestampMs <= 0) continue;
    const age = now - match.timestampMs;
    if (age < 0 || age > windowMs) continue;
    if (championId > 0 && match.championId !== championId) continue;
    if (!best || match.timestampMs > best.match.timestampMs) {
      best = { match, skinId: parseMatchHistorySkinId(findMyParticipant(game, puuid)) };
    }
  }
  return best;
}

/** 把 RecentMatch 缩成结算卡要的那几个字段。 */
export function toMatchScore(match: RecentMatch): MatchScore {
  return {
    win: match.win,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    minionKills: match.minionKills,
    durationS: match.durationS,
    lane: match.lane,
    role: match.role,
    roleBoundItemName: match.roleBoundItemName ?? '',
    mapId: match.mapId,
    gameMode: match.gameMode,
    queueType: match.queueType,
    championId: match.championId
  };
}
