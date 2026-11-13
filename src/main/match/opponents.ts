import type { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import type { Opponent, OpponentsSnapshot } from '../../shared/match';
import { extractSummoner } from './playerLookup';
import type { StaticData } from './staticData';

/**
 * 最近一局的两队人(/lol-gameflow/v1/session)。
 *
 * **这是客户端里唯一能拿到别的玩家的地方。**
 *
 * 试过的其它路都走不通:
 *   - `/lol-match-history/v1/products/lol/current-summoner/matches` ——
 *     每局 `participants` 长度就是 1,只有我自己(普通排位也一样);
 *   - 各种 `by-puuid` / `by-summoner` / `matches/{gameId}` —— 全部 404。
 *
 * 所以 gameflow 的 `gameData.teamOne` / `teamTwo` 是**客户端里**唯一的口。
 * 它给的东西:**游戏 ID、puuid、召唤师名、英雄、头像编号、位置**。
 * 它**不给**的:KDA、装备、段位。
 *
 * 要 KDA/装备/历史战绩,走腾讯的对局服务(见 tencentLedge.ts)——
 * 那边按 puuid 查,对手的历史战绩照样拿得到。
 *
 * 客户端只保留当前这一局的队伍信息(局末会不会清掉没验证)。
 */

const GAMEFLOW_PATH = '/lol-gameflow/v1/session';
const GAMEFLOW_TIMEOUT_MS = 5000;
/** 召唤师资料端点 —— gameflow 不给名字时按游戏 ID 补名字用。 */
const SUMMONERS_PATH = '/lol-summoner/v1/summoners';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

/**
 * 名字在 gameflow 里的几种可能位置。
 *
 * 客户端不同版本给的字段名不一样(`summonerName` / `riotIdGameName` …),
 * 而且**局末的 gameflow 常常一个人名都不给** —— 那种情况下名字得另外查。
 */
function pickName(entry: Record<string, unknown>): string {
  const direct =
    str(entry.summonerName) || str(entry.summonerInternalName) || str(entry.gameName);
  if (direct) return direct;
  const game = str(entry.riotIdGameName);
  const tag = str(entry.riotIdTagLine);
  if (game && tag) return `${game}#${tag}`;
  return game;
}

/** 一队里的人。 */
function parseTeam(
  raw: unknown,
  staticData: StaticData,
  myPuuid: string,
  isMyTeam: boolean
): Opponent[] {
  if (!Array.isArray(raw)) return [];
  const out: Opponent[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const puuid = str(entry.puuid);
    const teamOwner = entry.teamOwner === true;
    const championId = num(entry.championId);
    const info = staticData.champions.get(championId);
    out.push({
      summonerId: num(entry.summonerId),
      puuid,
      summonerName: pickName(entry),
      championId,
      championName: info?.name ?? (championId > 0 ? `#${championId}` : ''),
      championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
      side: isMyTeam ? 'ally' : 'enemy',
      isSelf: teamOwner || (Boolean(myPuuid) && puuid === myPuuid)
    });
  }
  return out;
}

/**
 * 解析 gameflow。
 *
 * 哪一队是我这一队:靠 `teamOwner` 标记(客户端在本地玩家那条上置 true)。
 * 万一没这个标记,退到用 puuid 认 —— 认不出来就当 teamOne 是我方,
 * 但这种情况在界面上会由「isSelf 谁都没标」看出来。
 */
export function parseOpponents(
  raw: unknown,
  staticData: StaticData,
  myPuuid = ''
): OpponentsSnapshot {
  const empty: OpponentsSnapshot = {
    phase: '',
    queueType: '',
    inGame: false,
    opponents: []
  };
  if (!isRecord(raw)) return empty;

  const gameData: Record<string, unknown> = isRecord(raw.gameData) ? raw.gameData : {};
  const teamOneRaw = gameData.teamOne;
  const teamTwoRaw = gameData.teamTwo;
  if (!Array.isArray(teamOneRaw) && !Array.isArray(teamTwoRaw)) return empty;

  const hasOwner = (team: unknown): boolean =>
    Array.isArray(team) && team.some((entry) => isRecord(entry) && entry.teamOwner === true);

  let oneIsMine: boolean;
  if (hasOwner(teamOneRaw)) oneIsMine = true;
  else if (hasOwner(teamTwoRaw)) oneIsMine = false;
  else {
    oneIsMine = Array.isArray(teamOneRaw)
      ? teamOneRaw.some(
          (entry) => isRecord(entry) && Boolean(myPuuid) && str(entry.puuid) === myPuuid
        )
      : true;
  }

  const opponents = [
    ...parseTeam(teamOneRaw, staticData, myPuuid, oneIsMine),
    ...parseTeam(teamTwoRaw, staticData, myPuuid, !oneIsMine)
  ];

  const queue: Record<string, unknown> = isRecord(gameData.queue) ? gameData.queue : {};

  return {
    phase: str(raw.phase),
    queueType: str(queue.name) || str(queue.gameMode) || str(queue.shortName),
    inGame: opponents.length > 0,
    opponents
  };
}

/**
 * gameflow 里没给名字的人,按游戏 ID 去客户端补一次。
 *
 * **局末的 gameflow 经常一个人名都不给**(只剩 puuid、游戏 ID、英雄),
 * 界面上就变成一片「未知召唤师」。客户端的召唤师端点一直有名字,
 * 按 ID 查一次就能补上。
 *
 * 名字几乎不变,所以查过一次就缓存 5 分钟 —— 反复点「刷新」不会一直打端点。
 */
const NAME_CACHE_TTL_MS = 5 * 60_000;
const nameCache = new Map<number, { name: string; fetchedAt: number }>();

async function fetchSummonerName(client: AxiosInstance, summonerId: number): Promise<string> {
  const cached = nameCache.get(summonerId);
  if (cached && Date.now() - cached.fetchedAt < NAME_CACHE_TTL_MS) return cached.name;
  try {
    const { data } = await client.get(`${SUMMONERS_PATH}/${summonerId}`, {
      timeout: GAMEFLOW_TIMEOUT_MS
    });
    const summoner = extractSummoner(data);
    const name = summoner
      ? str(summoner.gameName) || str(summoner.displayName) || str(summoner.summonerName)
      : '';
    nameCache.set(summonerId, { name, fetchedAt: Date.now() });
    return name;
  } catch {
    // 查不到就还是没名字 —— 不编一个出来。
    return '';
  }
}

async function fillMissingNames(client: AxiosInstance, opponents: Opponent[]): Promise<void> {
  const missing = opponents.filter((opponent) => !opponent.summonerName && opponent.summonerId > 0);
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async (opponent) => {
      const name = await fetchSummonerName(client, opponent.summonerId);
      if (name) opponent.summonerName = name;
    })
  );
}

export async function getOpponents(
  client: AxiosInstance,
  staticData: StaticData,
  myPuuid = ''
): Promise<OpponentsSnapshot> {
  try {
    const { data } = await client.get(GAMEFLOW_PATH, { timeout: GAMEFLOW_TIMEOUT_MS });
    const snapshot = parseOpponents(data, staticData, myPuuid);
    await fillMissingNames(client, snapshot.opponents);
    return snapshot;
  } catch {
    return { phase: '', queueType: '', inGame: false, opponents: [] };
  }
}
