import type { AxiosInstance } from 'axios';
import { resolvePosition } from '../../shared/gameLabels';
import { toPositionCode } from '../../shared/matchProfile';
import type { MatchProfile, PositionReport, RankedReport } from '../../shared/matchProfile';
import { getRankedEntries } from './ranked';
import { extractGames, parseMatchEntry } from './recentMatches';
import { emptyStaticData, parseLcuItems } from './staticData';
import type { StaticData } from './staticData';

/**
 * 同步时上报给后端的「排位 + 主玩位置」。
 *
 * 两份数据都从游戏客户端读:
 *
 *   - **段位** —— 队列 / 段位 / 小段 / 胜点 / 胜负场,后端拿它折成可比的分;
 *   - **主玩位置** —— 最近 20 局按位置统计,后端拿它筛「一起打这个位」的人。
 *
 * 位置判据跟结算卡完全一致(角色任务道具 → 定位 → 分路),认不出来就不算 ——
 * 报一个错位置比不报更糟。
 */

/** 最近对局(LCU 的历史端点)。 */
const MATCHES_PATH = '/lol-match-history/v1/products/lol/current-summoner/matches';
const MATCHES_BEG = 0;
const MATCHES_END = 19;

/** 客户端本地物品表 —— 判位置只要角色任务道具的名字。 */
const ITEMS_PATH = '/lol-game-data/assets/v1/items.json';

/** 只报这两个队列 —— 大乱斗和匹配没有段位,报了也没用。写法跟 normalizeQueueType 的输出一致。 */
const REPORTED_QUEUES = new Set(['RANKED_SOLO_5x5', 'RANKED_FLEX_5x5']);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

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

/**
 * 客户端给的段位 → 上报给后端的一条段位。
 *
 * 段位名认不出来就返回 null —— 后端宁可不收这条,也不要一个假段位。
 */
export function toRankedReport(entry: {
  queueType?: string;
  tier?: string;
  division?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
}): RankedReport | null {
  const tier = str(entry.tier).trim().toUpperCase();
  if (!tier) return null;
  const queueType = normalizeQueueType(str(entry.queueType));
  if (!REPORTED_QUEUES.has(queueType)) return null;
  const division = str(entry.division).trim().toUpperCase();
  return {
    queueType,
    tier,
    division: /^(I|II|III|IV)$/.test(division) ? division : '',
    leaguePoints: num(entry.leaguePoints),
    wins: num(entry.wins),
    losses: num(entry.losses)
  };
}

/**
 * 最近对局 → 主玩位置统计。
 *
 * 位置认不出来的那局不算数 —— 大乱斗没有上下路,硬算进去会把位置统计带歪。
 */
export function summarizePositions(
  games: unknown[],
  staticData: StaticData,
  puuid = ''
): PositionReport[] {
  const counts = new Map<string, number>();
  for (const raw of games) {
    const match = parseMatchEntry(raw, staticData, puuid);
    if (!match) continue;
    const key = resolvePosition(
      match.mapId,
      match.lane,
      match.role,
      match.roleBoundItemName ?? '',
      {
        kills: match.kills,
        assists: match.assists,
        deaths: match.deaths,
        minionKills: match.minionKills,
        gameMaxMinionKills: match.gameMaxMinionKills
      }
    );
    const code = toPositionCode(key);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([position, matchCount]) => ({
      position: position as PositionReport['position'],
      matchCount
    }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

/**
 * 读一份「段位 + 主玩位置」。
 *
 * 段位和位置互不依赖,各自失败就少一半 —— 读不到位置不该把段位也丢了。
 */
export async function fetchMatchProfile(
  client: AxiosInstance,
  puuid: string
): Promise<MatchProfile> {
  const [ranked, positions] = await Promise.all([
    fetchRanked(client, puuid),
    fetchPositions(client, puuid)
  ]);
  return { ranked, positions };
}

async function fetchRanked(client: AxiosInstance, puuid: string): Promise<RankedReport[]> {
  try {
    const { entries } = await getRankedEntries(client, puuid);
    const out: RankedReport[] = [];
    for (const entry of entries) {
      const report = toRankedReport(entry);
      if (report) out.push(report);
    }
    return out;
  } catch {
    // 读不到段位不影响位置
    return [];
  }
}

async function fetchPositions(client: AxiosInstance, puuid: string): Promise<PositionReport[]> {
  try {
    const [itemsRes, matchesRes] = await Promise.all([
      client.get(ITEMS_PATH, { timeout: 10_000 }).catch(() => null),
      client
        .get(MATCHES_PATH, {
          params: { begIndex: MATCHES_BEG, endIndex: MATCHES_END },
          timeout: 10_000
        })
        .catch(() => null)
    ]);
    if (!matchesRes) return [];

    // 只借 items.json 判角色任务道具 —— 不为了判位置把整份静态数据
    // (含 6MB 的皮肤目录)拉一遍。
    const staticData = { ...emptyStaticData(), items: parseLcuItems(itemsRes?.data) };
    return summarizePositions(extractGames(matchesRes.data), staticData, puuid);
  } catch {
    // 对局历史端点限流,读不到就当没有位置
    return [];
  }
}
