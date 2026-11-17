import type { AxiosInstance } from 'axios';
import { extractRankedBadge } from './rankBadge';

/**
 * 查一个召唤师的资料(昵称、等级、头像、段位)。
 *
 * 选人阶段想知道「对面/队友是什么水平」,靠的就是这个 —— 客户端在选人
 * 界面只给 id(puuid / 游戏 ID),得再问一次客户端要资料。
 *
 * 三条路,挨个试:
 *   1. `/lol-summoner/v2/summoners/puuid/{puuid}` —— 按 puuid 查(实测最全);
 *   2. `/lol-summoner/v1/summoners/by-puuid/{puuid}` —— 老版本客户端的形状;
 *   3. `/lol-summoner/v1/summoners/{summonerId}` —— 按游戏 ID 查。
 *
 * **一次只发一条请求** —— 客户端的回环口只听一个连接,并发打过去会把它挤爆
 * (英雄图标那条路就是这么炸过一次)。
 */

const PROFILE_TIMEOUT_MS = 5000;

/** 召唤师 ID 的下限 —— 比这小的是格位号,不是召唤师 ID。 */
const MIN_SUMMONER_ID = 100_000;

/** 资料缓存有效期。资料基本不变,但段位会掉 —— 5 分钟够了。 */
const PROFILE_TTL_MS = 5 * 60_000;

export interface SummonerProfile {
  displayName: string;
  tagLine: string;
  summonerLevel: number;
  profileIconId: number;
  rankedDisplay: string;
  /**
   * 这个召唤师的 puuid。
   *
   * 选人会话里有时只给游戏 ID 不给 puuid —— 查别人的战绩只认 puuid,
   * 所以这里把它带出来,好让上层补上。
   */
  puuid: string;
}

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

/** 从响应里挑出召唤师对象(有的接口回单元素数组)。 */
function extractSummoner(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) {
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

/** 把召唤师对象变成界面要的那几项。 */
export function toSummonerProfile(raw: Record<string, unknown>): SummonerProfile {
  const badge = extractRankedBadge(raw);
  return {
    // 国服客户端的 displayName 是空的,真名在 gameName 里。
    displayName: str(raw.gameName) || str(raw.displayName) || str(raw.summonerName),
    tagLine: str(raw.tagLine),
    summonerLevel: num(raw.summonerLevel),
    profileIconId: num(raw.profileIconId),
    rankedDisplay: badge.display,
    puuid: str(raw.puuid)
  };
}

/** 缓存:同一个召唤师短时间内只查一次。 */
const cache = new Map<string, { profile: SummonerProfile; fetchedAt: number }>();

function cacheKey(puuid: string, summonerId: number): string {
  return puuid ? `puuid:${puuid}` : `sid:${summonerId}`;
}

/** 缓存的存取 —— 供测试清理。 */
export function clearProfileCache(): void {
  cache.clear();
}

async function requestProfile(
  client: AxiosInstance,
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await client.get(path, { timeout: PROFILE_TIMEOUT_MS });
    return extractSummoner(data);
  } catch {
    return null;
  }
}

/**
 * 查一个召唤师的资料。查不到就是 null —— 不拿别的玩家的资料来凑。
 */
export async function fetchSummonerProfile(
  client: AxiosInstance,
  puuid: string,
  summonerId: number
): Promise<SummonerProfile | null> {
  const key = cacheKey(puuid, summonerId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return cached.profile;

  const paths: string[] = [];
  if (puuid) {
    paths.push(`/lol-summoner/v2/summoners/puuid/${puuid}`);
    paths.push(`/lol-summoner/v1/summoners/by-puuid/${puuid}`);
  }
  // 召唤师 ID 都是十位往上的大数。小的(0~9)是格位号,拿它查资料会查出
  // 另一个人来 —— 不查。
  if (summonerId >= MIN_SUMMONER_ID) paths.push(`/lol-summoner/v1/summoners/${summonerId}`);

  for (const path of paths) {
    const raw = await requestProfile(client, path);
    if (!raw) continue;
    // 回包里的 puuid 得对得上 —— 对不上就是查错了人(拿别处的 ID 查的),丢掉。
    if (puuid) {
      const answered = str(raw.puuid);
      if (answered && answered !== puuid) continue;
    }
    const profile = toSummonerProfile(raw);
    // 一个名字都没有 = 这个接口没认出他,换下一条路。
    if (!profile.displayName && profile.summonerLevel === 0 && profile.profileIconId === 0) {
      continue;
    }
    cache.set(key, { profile, fetchedAt: Date.now() });
    return profile;
  }

  // 查不到也记一笔,免得每 2 秒重试一次。
  if (paths.length > 0) {
    cache.set(key, {
      profile: {
        displayName: '',
        tagLine: '',
        summonerLevel: 0,
        profileIconId: 0,
        rankedDisplay: '',
        puuid: ''
      },
      fetchedAt: Date.now()
    });
  }
  return null;
}
