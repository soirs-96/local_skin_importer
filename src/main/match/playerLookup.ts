import type { AxiosInstance } from 'axios';
import type { PlayerLookup, PlayerGamesSummary } from '../../shared/match';
import { formatRankDisplay } from '../../shared/rankLabels';
import { fetchPlayerGames } from './tencentLedge';
import { emptyStaticData, type StaticData } from './staticData';

/**
 * 查玩家(任意召唤师)。
 *
 * 国服客户端的搜人接口只有一条路:**`/lol-summoner/v1/summoners?name=名字#标签`**。
 * 实测过 30 个别的参数名,全部 `Unknown argument` —— 只认 `name`。
 * 而且名字**必须带 `#标签`**:只给「林俊杰」回 422 `INVALID_EMPTY_REQUEST`,
 * 给「林俊杰#CN1」回 404。国服的标签就是玩家自己的 QQ 号段(例如 `18557`)。
 *
 * 按 ID 查是另一条路:`/lol-summoner/v1/summoners/{summonerId}`。
 *
 * **战绩不走客户端那条路** —— 国服客户端把战绩路由裁到只剩
 * `current-summoner/matches`(只含我自己)。但腾讯的 ledge 网关是按 puuid 的,
 * 直连就能拿到**对方**的历史对局(见 tencentLedge.ts)。
 */

const SUMMONERS_PATH = '/lol-summoner/v1/summoners';
const LOOKUP_TIMEOUT_MS = 8000;
/** 一次查多少局 */
const LOOKUP_GAME_COUNT = 20;

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

/** 段位:对象里可能带,也可能不带 —— 不带就是没有,不用猜。 */
function extractRankedDisplay(raw: Record<string, unknown>): string {
  const regalia = raw.regalia;
  if (isRecord(regalia)) {
    const highest = regalia.highestRankedEntry;
    if (isRecord(highest)) {
      const tier = str(highest.tier);
      if (tier) return formatRankDisplay(tier, str(highest.division));
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
      return formatRankDisplay(tier, str(entry.division) || str(entry.rank));
    }
  }

  return '';
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
  myPuuid: string,
  games: PlayerGamesSummary | null = null,
  gamesError: string | null = null
): PlayerLookup {
  const displayName =
    str(summoner.gameName) || str(summoner.displayName) || str(summoner.summonerName);
  const tagLine = str(summoner.tagLine);
  const puuid = str(summoner.puuid);
  return {
    query,
    found: true,
    riotId: displayName && tagLine ? `${displayName}#${tagLine}` : '',
    displayName,
    tagLine,
    summonerId: num(summoner.summonerId),
    puuid,
    summonerLevel: num(summoner.summonerLevel),
    rankedDisplay: extractRankedDisplay(summoner),
    isSelf: Boolean(myPuuid) && puuid === myPuuid,
    games,
    gamesError,
    error: null
  };
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
    rankedDisplay: '',
    isSelf: false,
    games: null,
    gamesError: null,
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
 * 查一个召唤师。
 *
 * `myPuuid` 用来认出「查的是不是自己」—— 客户端给的资料里没有这个信息,
 * 但自己是谁我们知道。
 *
 * 资料查不到就到此为止;资料查到了,再顺手去腾讯网关拉对方的历史战绩。
 * **战绩拉不到不影响资料返回** —— 两者是两条独立的通路,腾讯网关挂了不该
 * 让「这个人是谁」也查不出来。
 */
export async function lookupPlayer(
  client: AxiosInstance,
  rawQuery: string,
  myPuuid = '',
  staticData?: StaticData
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

    if (!lookup.puuid) return lookup;

    try {
      const games = await fetchPlayerGames(
        client,
        staticData ?? emptyStaticData(),
        lookup.puuid,
        { count: LOOKUP_GAME_COUNT }
      );
      return toPlayerLookup(query, summoner, myPuuid, games, null);
    } catch (e: unknown) {
      return toPlayerLookup(query, summoner, myPuuid, null, describeGamesFailure(e));
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (typeof status === 'number') return failedLookup(query, describeLookupFailure(status));
    return failedLookup(query, '连不上游戏客户端 —— 先把游戏客户端开到主界面');
  }
}

/** 战绩拉取失败的原因 —— 说清楚是「腾讯那边挂了」还是「客户端没开」。 */
function describeGamesFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|超时/.test(message)) {
    return '连不上腾讯战绩服务(检查一下网络)';
  }
  return `战绩没取到:${message}`;
}
