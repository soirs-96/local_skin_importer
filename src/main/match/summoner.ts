import type { AxiosInstance } from 'axios';
import type { MatchSummoner } from '../../shared/match';

/** 当前登录的召唤师。比 lcu.ts 那个多带了 summonerId —— 选人时要靠它认出「我」。 */

const SUMMONER_PATH = '/lol-summoner/v1/current-summoner';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export async function getMatchSummoner(client: AxiosInstance): Promise<MatchSummoner | null> {
  const { data } = await client.get(SUMMONER_PATH, { timeout: 5000 });
  if (!isRecord(data)) return null;
  return {
    displayName: str(data.displayName),
    tagLine: str(data.tagLine),
    puuid: str(data.puuid),
    summonerId: num(data.summonerId)
  };
}
