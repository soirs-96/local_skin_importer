import type { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import type { ChampionMastery, TopChampion } from '../../shared/match';
import { parseLcuChampionSummaries, type StaticData } from './staticData';

/**
 * 官方英雄熟练度。
 *
 * 端点形状是 `/lol-champion-mastery/v1/{puuid}/champion-mastery`,路径上那一段
 * **必须是 puuid**。客户端其实也注册了 `current-summoner` 这个别名,但那条是
 * 坏的 —— 它把 `current-summoner` 拿去当数字解析,直接 500:
 *
 *   "message": "For input string: \"current-summoner\""
 *
 * 所以这里老老实实填 puuid,别图省事写别名。
 *
 * 返回的是**全量** —— 玩过的每个英雄一条,60 KB 上百条,按点数降序。
 * 点数是 Riot 自己算的,所以「本命英雄」= 点数最高的那个,不需要本机估算。
 */

/** 熟练度接口的路径。puuid 为空时返回 null —— 没有 puuid 就认不出「我」。 */
export function masteryPath(puuid: string): string | null {
  if (!puuid) return null;
  return `/lol-champion-mastery/v1/${encodeURIComponent(puuid)}/champion-mastery`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * 解析熟练度列表。
 *
 * 排序按点数降序 —— 点数就是熟练度的绝对口径,等级(1~7)只是它的分段。
 */
export function parseChampionMastery(raw: unknown, staticData: StaticData): ChampionMastery[] {
  if (!Array.isArray(raw)) return [];
  const out: ChampionMastery[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const championId = num(entry.championId);
    if (!championId) continue;
    const info = staticData.champions.get(championId);
    out.push({
      championId,
      championName: info?.name || `#${championId}`,
      championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
      championLevel: num(entry.championLevel),
      championPoints: num(entry.championPoints),
      highestGrade: str(entry.highestGrade),
      lastPlayTime: num(entry.lastPlayTime),
      tokensEarned: num(entry.tokensEarned)
    });
  }
  out.sort((a, b) => b.championPoints - a.championPoints);
  return out;
}

/** 取当前召唤师的官方熟练度。拿不到就返回空数组。 */
export async function getChampionMastery(
  client: AxiosInstance,
  staticData: StaticData,
  puuid: string
): Promise<ChampionMastery[]> {
  const url = masteryPath(puuid);
  if (!url) return [];
  const { data } = await client.get(url, { timeout: 10_000 });
  return parseChampionMastery(data, staticData);
}

/** 传给后端的本命英雄条数上限。 */
export const TOP_CHAMPION_LIMIT = 15;

/** 客户端本地资源:英雄本体条目的中文名 + 英文 key。 */
const CHAMPION_SUMMARY_PATH = '/lol-game-data/assets/v1/champion-summary.json';

/**
 * 取熟练度最高的前 N 个英雄 —— 也就是「本命英雄」。
 *
 * 跟界面上的「英雄熟练度」卡片是同一份数据(同一个端点),区别只在于:
 *
 *   - 这里只保留**认得出英文名**的英雄 —— 后端靠英文名对齐自己的英雄表,
 *     认不出来的报上去也是白报;
 *   - 这里带上英文 key,界面上用不着,但后端必须要。
 *
 * 排序按点数降序,跟「本命英雄」的口径一致。
 */
export async function getTopChampions(
  client: AxiosInstance,
  puuid: string,
  limit: number = TOP_CHAMPION_LIMIT
): Promise<TopChampion[]> {
  const url = masteryPath(puuid);
  if (!url) return [];

  const [masteryRes, summaryRes] = await Promise.all([
    client.get(url, { timeout: 10_000 }),
    client.get(CHAMPION_SUMMARY_PATH, { timeout: 10_000 }).catch(() => null)
  ]);

  const raw = masteryRes.data;
  if (!Array.isArray(raw)) return [];

  const summaries = parseLcuChampionSummaries(summaryRes?.data);
  const rows: TopChampion[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const championId = num(entry.championId);
    if (!championId) continue;
    const summary = summaries.get(championId);
    const nameEn = summary?.nameEn ?? '';
    // 英文 key 为空或者只是个数字,后端认不出来 —— 直接不要
    if (!nameEn || /^\d+$/.test(nameEn)) continue;
    rows.push({
      championId,
      championName: summary?.name ?? '',
      championNameEn: nameEn,
      championPoints: num(entry.championPoints)
    });
  }

  rows.sort((a, b) => b.championPoints - a.championPoints);
  return rows.slice(0, limit);
}
