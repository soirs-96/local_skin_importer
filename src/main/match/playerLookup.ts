import type { AxiosInstance } from 'axios';
import type { PlayerLookup, RankedEntry } from '../../shared/match';
import { formatRankDisplay } from '../../shared/rankLabels';
import { getRankedEntriesByPuuid, parseRankedEntries } from './ranked';

/**
 * 查玩家(任意召唤师)的**资料**。
 *
 * 国服客户端的搜人接口只有一条路:**`/lol-summoner/v1/summoners?name=名字#标签`**。
 * 实测过 30 个别的参数名,全部 `Unknown argument` —— 只认 `name`。
 * 而且名字**必须带 `#标签`**:只给「林俊杰」回 422 `INVALID_EMPTY_REQUEST`,
 * 给「林俊杰#CN1」回 404。国服的标签就是玩家自己的 QQ 号段(例如 `18557`)。
 *
 * 按 ID 查是另一条路:`/lol-summoner/v1/summoners/{summonerId}`。
 *
 * 这里**只查资料** —— 战绩走腾讯的 ledge 网关,是另一个接口(见 tencentLedge.ts)。
 * 拆成两次是因为两边速度差一个量级:资料是本机回环,秒回;战绩要出网。
 */

const SUMMONERS_PATH = '/lol-summoner/v1/summoners';
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * 「是不是一个普通对象」。
 *
 * **数组不算** —— 数组也是 `typeof === 'object'`,不挡掉的话
 * 搜人接口回的单元素数组会被当成对象整个塞进来。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** 查询串解析出来的三种形态。 */
export type LookupQuery =
  | { kind: 'riotId'; riotId: string }
  | { kind: 'summonerId'; summonerId: number }
  | { kind: 'invalid'; reason: string };

/**
 * 把用户输入拆成「按 riotId 查」还是「按游戏 ID 查」。
 *
 * 全数字 → 游戏 ID(召唤师 ID)。
 * 带 `#` → riotId,两段都不能空。
 * 其他 → 判为格式错 —— 国服搜人不接受裸名字,与其让客户端回 422,
 * 不如自己先说清楚要什么格式。
 */
export function parseLookupQuery(raw: string): LookupQuery {
  const query = raw.trim();
  if (!query) return { kind: 'invalid', reason: '请输入召唤师名字或游戏 ID' };

  if (/^\d+$/.test(query)) {
    const summonerId = Number(query);
    if (!Number.isSafeInteger(summonerId) || summonerId <= 0) {
      return { kind: 'invalid', reason: '游戏 ID 得是正整数' };
    }
    return { kind: 'summonerId', summonerId };
  }

  const hash = query.indexOf('#');
  if (hash < 0) {
    return {
      kind: 'invalid',
      reason: '名字要带标签,格式是「名字#标签」(标签就是你 QQ 号后几位)'
    };
  }

  const name = query.slice(0, hash).trim();
  const tag = query.slice(hash + 1).trim();
  if (!name) return { kind: 'invalid', reason: '「#」前面没名字' };
  if (!tag) return { kind: 'invalid', reason: '「#」后面没标签' };
  return { kind: 'riotId', riotId: `${name}#${tag}` };
}

/**
 * 各队列的段位明细。
 *
 * **只收有真实场次的队列** —— 客户端有时只给一个「最高段位」徽章,没有场次。
 * 那一行显示成「总场次 0」是假数据,宁可整行不显示。
 */
function extractRankedRows(raw: Record<string, unknown>): RankedEntry[] {
  const keys = ['rankedQueues', 'rankedStats', 'rankedQueueStats', 'queues', 'ranked'];
  for (const key of keys) {
    const value = raw[key];
    const list = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.queues)
        ? value.queues
        : null;
    if (!list) continue;
    const rows = parseRankedEntries(list).filter((entry) => entry.wins + entry.losses > 0);
    if (rows.length > 0) return rows;
  }
  return [];
}

/** 段位:对象里可能带,也可能不带 —— 不带就是没有,不用猜。 */
interface RankedBadge {
  tier: string;
  division: string;
  display: string;
}

/** 从召唤师对象里刨出段位徽章信息。 */
function extractRankedBadge(raw: Record<string, unknown>): RankedBadge {
  const empty: RankedBadge = { tier: '', division: '', display: '' };

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

  return empty;
}

/**
 * 从搜人响应里挑出召唤师对象。
 *
 * 按名字查时客户端有时回对象、有时回单元素数组 —— 两种都认。
 */
export function extractSummoner(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) {
    // 有些形状是 { summoner: {...} }
    const inner = raw.summoner;
    if (isRecord(inner)) return inner;
    return raw;
  }
  if (Array.isArray(raw)) {
    const first = raw.find(isRecord);
    return first ?? null;
  }
  return null;
}

/** 把召唤师对象拼成给界面的结果。 */
export function toPlayerLookup(
  query: string,
  summoner: Record<string, unknown>,
  myPuuid: string
): PlayerLookup {
  const displayName =
    str(summoner.gameName) || str(summoner.displayName) || str(summoner.summonerName);
  const tagLine = str(summoner.tagLine);
  const puuid = str(summoner.puuid);
  const badge = extractRankedBadge(summoner);
  return {
    query,
    found: true,
    riotId: displayName && tagLine ? `${displayName}#${tagLine}` : '',
    displayName,
    tagLine,
    summonerId: num(summoner.summonerId),
    puuid,
    summonerLevel: num(summoner.summonerLevel),
    profileIconId: num(summoner.profileIconId),
    rankedDisplay: badge.display,
    rankedTier: badge.tier,
    rankedDivision: badge.division,
    ranked: extractRankedRows(summoner),
    isSelf: Boolean(myPuuid) && puuid === myPuuid,
    error: null
  };
}

/**
 * 头像编号。
 *
 * 搜人接口不一定带 `profileIconId` —— 带上就没有,没带就**按游戏 ID 再查一次**
 * (`/lol-summoner/v1/summoners/{summonerId}` 一定带)。查不到就是 0,
 * 界面上不显示头像,不留一个碎图。
 */
async function fetchProfileIconId(client: AxiosInstance, summonerId: number): Promise<number> {
  try {
    const { data } = await client.get(`${SUMMONERS_PATH}/${summonerId}`, {
      timeout: LOOKUP_TIMEOUT_MS
    });
    const summoner = extractSummoner(data);
    return summoner ? num(summoner.profileIconId) : 0;
  } catch {
    return 0;
  }
}

/** 查不到时也要给界面一个能显示的结果对象,而不是抛异常。 */
export function failedLookup(query: string, error: string): PlayerLookup {
  return {
    query,
    found: false,
    riotId: '',
    displayName: '',
    tagLine: '',
    summonerId: 0,
    puuid: '',
    summonerLevel: 0,
    profileIconId: 0,
    rankedDisplay: '',
    rankedTier: '',
    rankedDivision: '',
    ranked: [],
    isSelf: false,
    error
  };
}

/** 把 HTTP 状态码翻成人能懂的话。 */
export function describeLookupFailure(status: number): string {
  if (status === 404) return '没找到这个召唤师 —— 名字或标签写错了?';
  if (status === 422) return '客户端不接受这个查询 —— 名字要写成「名字#标签」';
  if (status === 400) return '客户端拒绝了这次查询';
  if (status === 401 || status === 403) return '客户端凭据失效了,重启游戏客户端再试';
  if (status === 429) return '查询太频繁了,稍等一下再试';
  return `查询失败(客户端返回 ${status})`;
}

/**
 * 查一个召唤师的资料。
 *
 * `myPuuid` 用来认出「查的是不是自己」—— 客户端给的资料里没有这个信息,
 * 但自己是谁我们知道。
 *
 * **只查资料**。战绩是另一个接口(`fetchPlayerGames`),界面分开调 ——
 * 资料本机回环秒回,战绩要出网,合成一次返回会让界面干等。
 */
export async function lookupPlayer(
  client: AxiosInstance,
  rawQuery: string,
  myPuuid = ''
): Promise<PlayerLookup> {
  const query = rawQuery.trim();
  const parsed = parseLookupQuery(query);
  if (parsed.kind === 'invalid') return failedLookup(query, parsed.reason);

  try {
    let response: { status: number; data: unknown };
    if (parsed.kind === 'riotId') {
      response = await client.get(SUMMONERS_PATH, {
        params: { name: parsed.riotId },
        timeout: LOOKUP_TIMEOUT_MS
      });
    } else {
      response = await client.get(`${SUMMONERS_PATH}/${parsed.summonerId}`, {
        timeout: LOOKUP_TIMEOUT_MS
      });
    }

    const summoner = extractSummoner(response.data);
    if (!summoner) return failedLookup(query, '客户端没返回这个召唤师的资料');

    const lookup = toPlayerLookup(query, summoner, myPuuid);
    if (!lookup.puuid && !lookup.summonerId) {
      return failedLookup(query, '客户端没返回这个召唤师的资料');
    }

    // 段位明细:搜人响应里没带的话,再去 by-puuid 端点找一次。
    // 找不到就空着 —— 界面上整行不显示,不拿别的玩家的段位来凑。
    if (lookup.ranked.length === 0 && lookup.puuid) {
      const entries = await getRankedEntriesByPuuid(client, lookup.puuid);
      lookup.ranked = entries.filter((entry) => entry.wins + entry.losses > 0);
    }

    // 头像:搜人响应没带编号就按游戏 ID 再查一次。
    if (lookup.profileIconId === 0 && lookup.summonerId > 0) {
      lookup.profileIconId = await fetchProfileIconId(client, lookup.summonerId);
    }

    return lookup;
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (typeof status === 'number') return failedLookup(query, describeLookupFailure(status));
    return failedLookup(query, '连不上游戏客户端 —— 先把游戏客户端开到主界面');
  }
}
