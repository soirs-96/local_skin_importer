import type { AxiosInstance } from 'axios';
import type { ChampSelectMember, ChampSelectSession } from '../../shared/match';
import type { StaticData } from './staticData';

/**
 * 选人阶段(/lol-champ-select/v1/session)。
 *
 * 不在选人时这个端点返回 404,客户端不在时连不上 —— 两种情况都归一成
 * null,上层只关心「现在有没有在选人」。
 */

const CHAMP_SELECT_PATH = '/lol-champ-select/v1/session';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseChampSelectMembers(raw: unknown, staticData: StaticData): ChampSelectMember[] {
  if (!Array.isArray(raw)) return [];
  const out: ChampSelectMember[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const championId = num(entry.championId);
    const info = staticData.champions.get(championId);
    out.push({
      championId,
      championName: info?.name ?? `#${championId}`,
      championIconUrl: info?.iconUrl ?? null,
      assignedPosition: str(entry.assignedPosition),
      cellId: num(entry.cellId),
      summonerId: num(entry.summonerId)
    });
  }
  return out;
}

/**
 * 解析选人会话。
 *
 * 「我」是谁有两种认法,都留着:
 *   - localPlayerCellId:LCU 直接告诉你本地玩家在第几格,最准;
 *   - summonerId 匹配:老客户端不填 localPlayerCellId 时用。
 */
export function parseChampSelectSession(
  raw: unknown,
  staticData: StaticData,
  summonerId: number
): ChampSelectSession | null {
  if (!isRecord(raw)) return null;

  const myTeam = parseChampSelectMembers(raw.myTeam, staticData);
  const theirTeam = parseChampSelectMembers(raw.theirTeam, staticData);
  if (myTeam.length === 0 && theirTeam.length === 0) return null;

  const localCellId = num(raw.localPlayerCellId);
  const myMember =
    myTeam.find((m) => m.summonerId > 0 && m.summonerId === summonerId) ??
    myTeam.find((m) => m.cellId === localCellId && localCellId >= 0) ??
    null;

  const bans = isRecord(raw.bans) ? raw.bans : {};
  const bannedChampionIds = [
    ...(Array.isArray(bans.myTeamBans) ? bans.myTeamBans : []),
    ...(Array.isArray(bans.theirTeamBans) ? bans.theirTeamBans : [])
  ]
    .map((id) => num(id))
    .filter((id) => id > 0);

  return {
    myTeam,
    theirTeam,
    myRole: myMember?.assignedPosition ?? '',
    myChampionId: myMember?.championId ?? 0,
    myCellId: myMember?.cellId ?? -1,
    bannedChampions: bannedChampionIds.map((id) => {
      const info = staticData.champions.get(id);
      return {
        championId: id,
        championName: info?.name ?? `#${id}`,
        championIconUrl: info?.iconUrl ?? null
      };
    })
  };
}

export async function getChampSelectSession(
  client: AxiosInstance,
  staticData: StaticData,
  summonerId: number
): Promise<ChampSelectSession | null> {
  try {
    const { data } = await client.get(CHAMP_SELECT_PATH, { timeout: 5000 });
    return parseChampSelectSession(data, staticData, summonerId);
  } catch {
    return null;
  }
}
