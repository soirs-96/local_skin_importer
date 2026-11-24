import type { AxiosInstance } from 'axios';
import { resolvePosition } from '../../shared/gameLabels';
import { normalizeQueueType, toPositionCode } from '../../shared/matchProfile';
import type { MatchProfile, PositionReport, RankedReport } from '../../shared/matchProfile';
import { getRankedEntries } from './ranked';
import { buildRecentReports } from './recentProfile';
import { extractGames, parseMatchEntry } from './recentMatches';
import { emptyStaticData, parseLcuChampions, parseLcuItems } from './staticData';
import type { StaticData } from './staticData';

// 队列归一搬到 shared 了(大厅那边也要用)—— 这里原样再导出,老的调用方不用改。
export { normalizeQueueType };

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

/** 客户端本地英雄表 —— 近 10 场要显示中文英雄名。 */
const CHAMPIONS_PATH = '/lol-game-data/assets/v1/champion-summary.json';

/** 只报这两个队列 —— 大乱斗和匹配没有段位,报了也没用。写法跟 normalizeQueueType 的输出一致。 */
const REPORTED_QUEUES = new Set(['RANKED_SOLO_5x5', 'RANKED_FLEX_5x5']);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
 * 读一份「段位 + 主玩位置 + 近 10 场排位」。
 *
 * 段位和位置互不依赖,各自失败就少一半 —— 读不到位置不该把段位也丢了。
 *
 * 对局历史**只打一次**:位置统计和近 10 场用的是同一份数据。
 * 那个端点限流,打两次就容易被限。
 */
export async function fetchMatchProfile(
  client: AxiosInstance,
  puuid: string
): Promise<MatchProfile> {
  const [ranked, matchData] = await Promise.all([
    fetchRanked(client, puuid),
    fetchMatches(client, puuid)
  ]);
  const games = matchData?.games ?? [];
  const staticData = matchData?.staticData ?? emptyStaticData();
  return {
    ranked,
    positions: summarizePositions(games, staticData, puuid),
    recentMatches: buildRecentReports(games, staticData, puuid)
  };
}

/** 对局历史 + 判位置要用的那点静态数据。 */
interface MatchData {
  games: unknown[];
  staticData: StaticData;
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

/**
 * 读对局历史(外加判位置要用的那点静态数据)。
 *
 * <p>读不到就返回 null —— 位置和近 10 场都没有,不能拿空数组冒充「他没打过」。
 */
async function fetchMatches(client: AxiosInstance, puuid: string): Promise<MatchData | null> {
  try {
    const [championsRes, itemsRes, matchesRes] = await Promise.all([
      client.get(CHAMPIONS_PATH, { timeout: 10_000 }).catch(() => null),
      client.get(ITEMS_PATH, { timeout: 10_000 }).catch(() => null),
      client
        .get(MATCHES_PATH, {
          params: { begIndex: MATCHES_BEG, endIndex: MATCHES_END },
          timeout: 10_000
        })
        .catch(() => null)
    ]);
    if (!matchesRes) return null;

    // 只借 items.json 判角色任务道具、champion-summary.json 拿中文英雄名 ——
    // 不为了判位置把整份静态数据(含 6MB 的皮肤目录)拉一遍。
    const staticData = {
      ...emptyStaticData(),
      champions: championsRes ? parseLcuChampions(championsRes.data) : emptyStaticData().champions,
      items: parseLcuItems(itemsRes?.data)
    };
    return { games: extractGames(matchesRes.data), staticData };
  } catch {
    // 对局历史端点限流,读不到就当没有位置
    return null;
  }
}
