import type { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import type { ChampSelectMember, ChampSelectSession } from '../../shared/match';
import { fetchSummonerProfile } from './summonerProfile';
import type { StaticData } from './staticData';
import { parseSkinValue } from './usedSkin';

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

/**
 * 召唤师 ID。
 *
 * 选人会话里的 `summonerId` 是正的;老客户端给的是 `playerId`,同一个值。
 *
 * `playerId` 有可能是格位号(0~9)而不是召唤师 ID —— 拿它查资料会查出
 * 另一个人。所以**只在这里记着**,拿去查资料的时候另有判断
 * (见 summonerProfile.ts 的 MIN_SUMMONER_ID)。
 */
function pickSummonerId(entry: Record<string, unknown>): number {
  return num(entry.summonerId) || num(entry.playerId);
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
      championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
      assignedPosition: str(entry.assignedPosition),
      cellId: num(entry.cellId),
      // 游戏内皮肤 id;客户端没给就是 0
      skinId: num(entry.skinId),
      // 国服真正给的是这个字段(是 id 还是序号没实测过,结算时消歧)
      selectedSkinId: parseSkinValue(entry),
      // 选人会话里通常给的是 summonerId;老客户端给 playerId(同一个值)。
      summonerId: pickSummonerId(entry),
      puuid: str(entry.puuid),
      displayName: '',
      tagLine: '',
      summonerLevel: 0,
      profileIconId: 0,
      rankedDisplay: ''
    });
  }
  return out;
}

/**
 * 解析选人会话。
 *
 * 「我」是谁有三种认法,都留着:
 *   - localPlayerCellId:LCU 直接告诉你本地玩家在第几格,最准;
 *   - puuid 匹配:puuid 唯一,认不错;
 *   - summonerId 匹配:老客户端不填 localPlayerCellId 时用。
 */
export function parseChampSelectSession(
  raw: unknown,
  staticData: StaticData,
  summonerId: number,
  myPuuid = ''
): ChampSelectSession | null {
  if (!isRecord(raw)) return null;

  const myTeam = parseChampSelectMembers(raw.myTeam, staticData);
  const theirTeam = parseChampSelectMembers(raw.theirTeam, staticData);
  if (myTeam.length === 0 && theirTeam.length === 0) return null;

  const localCellId = num(raw.localPlayerCellId);
  const myMember =
    myTeam.find((m) => Boolean(myPuuid) && m.puuid === myPuuid) ??
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
    mySkinId: myMember?.skinId ?? 0,
    mySelectedSkinId: myMember?.selectedSkinId ?? -1,
    myCellId: myMember?.cellId ?? -1,
    bannedChampions: bannedChampionIds.map((id) => {
      const info = staticData.champions.get(id);
      return {
        championId: id,
        championName: info?.name ?? `#${id}`,
        championIconUrl: id > 0 ? lcuIconUrl('champion', id) : null
      };
    })
  };
}

/**
 * 给**我方**的人补上资料:昵称、等级、头像、段位。
 *
 * 选人会话只给 id —— 想知道「这人什么水平」得再问客户端要一次资料。
 * **一次只查一个人**:客户端的回环口只听一个连接,并发打过去会把它挤爆
 * (英雄图标那条路就是这么炸过一次)。
 *
 * **只查我方**:选人阶段对面的身份本来就看不见(客户端也不给),
 * 去硬凑是白费功夫 —— 而且界面上也不该出现对面的名字。
 */
async function fillMemberProfiles(client: AxiosInstance, members: ChampSelectMember[]): Promise<void> {
  for (const member of members) {
    if (member.displayName && member.summonerLevel > 0) continue;
    if (!member.puuid && member.summonerId <= 0) continue;
    const profile = await fetchSummonerProfile(client, member.puuid, member.summonerId);
    if (!profile) continue;
    // 选人会话里有时只给游戏 ID —— 查别人的战绩只认 puuid,
    // 资料接口里能拿到就补上,补不上这人的战绩就拉不了。
    if (!member.puuid && profile.puuid) member.puuid = profile.puuid;
    member.displayName = profile.displayName;
    member.tagLine = profile.tagLine;
    member.summonerLevel = profile.summonerLevel;
    member.profileIconId = profile.profileIconId;
    member.rankedDisplay = profile.rankedDisplay;
  }
}

export async function getChampSelectSession(
  client: AxiosInstance,
  staticData: StaticData,
  summonerId: number,
  myPuuid = ''
): Promise<ChampSelectSession | null> {
  try {
    const { data } = await client.get(CHAMP_SELECT_PATH, { timeout: 5000 });
    const session = parseChampSelectSession(data, staticData, summonerId, myPuuid);
    if (!session) return null;
    await fillMemberProfiles(client, session.myTeam);
    return session;
  } catch {
    return null;
  }
}
