import https from 'node:https';
import type { AxiosInstance } from 'axios';
import { lcuIconUrl } from '../../shared/icons';
import type { PlayerGame, PlayerGamesSummary, PlayerPeer } from '../../shared/match';
import type { StaticData } from './staticData';

/**
 * 腾讯后端网关(ledge)直连。
 *
 * 国服客户端的 LCU 把战绩路由裁到了只剩「我自己」那一条
 * (`/lol-match-history/v1/products/lol/current-summoner/matches`),
 * 所以客户端里查不到别人的对局。但**服务端没裁** —— LCU 背后就是腾讯的
 * ledge 网关:
 *
 *   https://tj101-sgp.lol.qq.com:21019/match-history-query/v1/products/lol/player/{puuid}
 *
 * 路径里的 puuid 是**任意玩家**的。实测拿对手的 puuid 去打,返回的是那个人
 * 真实的对局列表(而且含有和我共同的那一局),服务端不做「只能查自己」的过滤。
 *
 * 认证只有一种能用:**league-session-token**
 * (`Authorization: Bearer <token>`,token 从 LCU 的
 * `/lol-league-session/v1/league-session-token` 拿)。试过的其它组合:
 * RSO access-token → 401、`X-Riot-Token` → 403、QQ cookie → 401。
 *
 * 列表接口直接带全量对局明细,不用再单独取单局:
 *   `.../player/{puuid}/SUMMARY` → `{"games":[{"metadata":{...},"json":{...}}]}`
 * `json.participants[]` 是**平铺**的(不在 `stats` 子对象里),每人带
 * puuid / riotIdGameName / riotIdTagline / kills / deaths / assists / win /
 * championId / item0..item6 / lane / role / teamId / goldEarned 等。
 */

/** 腾讯网关的地址 —— 这是客户端自己连的那个,别改成别的主机。 */
const LEDGE_HOST = 'tj101-sgp.lol.qq.com';
const LEDGE_PORT = 21019;
const LEDGE_PREFIX = '/match-history-query/v1/products/lol';

const SESSION_TOKEN_PATH = '/lol-league-session/v1/league-session-token';
const LEDGE_TIMEOUT_MS = 15_000;
const TOKEN_TIMEOUT_MS = 8000;

/**
 * session token 的缓存时长。
 *
 * 这个 token 是短效的,但我们只在用户主动查玩家时才用,一次查询一次请求,
 * 所以缓存 5 分钟足够覆盖连续点几次;真过期了服务端会回 401,那时会重取一次。
 */
const TOKEN_TTL_MS = 5 * 60_000;

let tokenCache: { token: string; fetchedAt: number } | null = null;

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

/**
 * 拿腾讯的会话令牌。
 *
 * 走 LCU 拿(LCU 本来就在本机),拿到的值是**带引号的 JSON 字符串**,要去引号。
 */
export async function getLedgeToken(client: AxiosInstance): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  const { data } = await client.get(SESSION_TOKEN_PATH, { timeout: TOKEN_TIMEOUT_MS });
  const token = typeof data === 'string' ? data.replace(/^"|"$/g, '') : String(data ?? '');
  if (!token) throw new Error('游戏客户端没有给出腾讯会话令牌');
  tokenCache = { token, fetchedAt: Date.now() };
  return token;
}

/** 只在本地清缓存 —— 401 时用,让下一次重新去 LCU 拿。 */
export function invalidateLedgeToken(): void {
  tokenCache = null;
}

interface LedgeResponse {
  status: number;
  body: string;
}

function ledgeGet(path: string, token: string): Promise<LedgeResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: LEDGE_HOST,
        port: LEDGE_PORT,
        path,
        method: 'GET',
        timeout: LEDGE_TIMEOUT_MS,
        // 腾讯网关的证书和这个域名对不上,客户端本身也是不校验的
        rejectUnauthorized: false,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('腾讯战绩服务超时'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 请求腾讯战绩接口。
 *
 * 401 会重取一次令牌再试 —— token 过期是唯一可自愈的失败。
 */
async function ledgeGetWithToken(
  path: string,
  client: AxiosInstance
): Promise<LedgeResponse> {
  const token = await getLedgeToken(client);
  const first = await ledgeGet(path, token);
  if (first.status !== 401) return first;
  invalidateLedgeToken();
  const second = await ledgeGet(path, await getLedgeToken(client));
  return second;
}

/** 把 `{games:[...]}` 或裸数组剥出来。 */
function extractGames(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const games = payload.games;
  if (Array.isArray(games)) return games.filter(isRecord);
  return [];
}

/** 装备:item0..item6,0 表示空槽。 */
function extractItemIds(participant: Record<string, unknown>): number[] {
  const ids: number[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const id = num(participant[`item${i}`]);
    if (id > 0) ids.push(id);
  }
  return ids;
}

/** 找出目标玩家在这一局里的那一条。 */
function findParticipant(
  participants: Record<string, unknown>[],
  puuid: string
): Record<string, unknown> | null {
  if (participants.length === 0) return null;
  if (!puuid) return participants[0];
  return participants.find((p) => str(p.puuid) === puuid) ?? null;
}

/**
 * 把这一局的十个人拆出来。
 *
 * 腾讯的列表接口每局都带全量明细,所以这十个人是**顺带**的,不用再请求单局接口。
 */
function buildPeers(
  participants: Record<string, unknown>[],
  targetPuuid: string,
  staticData: StaticData
): PlayerPeer[] {
  return participants.map((p) => {
    const championId = num(p.championId);
    const championInfo = staticData.champions.get(championId);
    const kills = num(p.kills);
    const deaths = num(p.deaths);
    const assists = num(p.assists);
    const gameName = str(p.riotIdGameName);
    const tagLine = str(p.riotIdTagline);
    return {
      puuid: str(p.puuid),
      displayName: gameName && tagLine ? `${gameName}#${tagLine}` : gameName,
      championId,
      championName:
        championInfo?.name || str(p.championName) || (championId > 0 ? `#${championId}` : ''),
      championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
      kills,
      deaths,
      assists,
      kda: `${kills}/${deaths}/${assists}`,
      win: p.win === true,
      teamId: num(p.teamId),
      isTarget: str(p.puuid) === targetPuuid
    };
  });
}

/**
 * 把腾讯返回的一局转成界面用的结构。
 *
 * `raw` 是 `{metadata, json}`;`json` 里是这一局的完整信息。
 * 目标玩家在 `json.participants[]` 里 —— **是平铺字段**,不在 `stats` 子对象里
 * (跟国服 LCU 那套形状不一样,别照抄 recentMatches.ts)。
 */
export function parseLedgeGame(
  raw: unknown,
  puuid: string,
  staticData: StaticData
): PlayerGame | null {
  if (!isRecord(raw)) return null;
  const json = isRecord(raw.json) ? raw.json : null;
  if (!json) return null;

  const participants = Array.isArray(json.participants)
    ? json.participants.filter(isRecord)
    : [];
  const me = findParticipant(participants, puuid);
  if (!me) return null;

  const championId = num(me.championId);
  const championInfo = staticData.champions.get(championId);
  const championName =
    championInfo?.name || str(me.championName) || (championId > 0 ? `#${championId}` : '');

  const kills = num(me.kills);
  const deaths = num(me.deaths);
  const assists = num(me.assists);

  const metadata = isRecord(raw.metadata) ? raw.metadata : {};

  return {
    gameId: str(metadata.match_id) || String(num(json.gameId)),
    timestampMs: num(json.gameEndTimestamp) || num(json.gameStartTimestamp) || num(metadata.timestamp),
    durationS: num(json.gameDuration),
    queueId: num(json.queueId),
    gameMode: str(json.gameMode),
    mapId: num(json.mapId),
    championId,
    championName,
    championIconUrl: championId > 0 ? lcuIconUrl('champion', championId) : null,
    kills,
    deaths,
    assists,
    kda: `${kills}/${deaths}/${assists}`,
    win: me.win === true,
    lane: str(me.lane),
    role: str(me.role),
    goldEarned: num(me.goldEarned),
    damageToChampions: num(me.totalDamageDealtToChampions),
    minionKills: num(me.totalMinionsKilled),
    items: extractItemIds(me).map((itemId) => {
      const item = staticData.items.get(itemId);
      return {
        itemId,
        name: item?.name ?? `物品#${itemId}`,
        iconUrl: itemId > 0 ? lcuIconUrl('item', itemId) : null
      };
    }),
    peers: buildPeers(participants, puuid, staticData)
  };
}

/** 把整份响应转成对局列表(丢掉解析不出来的那几局)。 */
export function parseLedgeGames(
  payload: unknown,
  puuid: string,
  staticData: StaticData
): PlayerGame[] {
  const out: PlayerGame[] = [];
  for (const raw of extractGames(payload)) {
    const parsed = parseLedgeGame(raw, puuid, staticData);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** 胜率统计。 */
export function summarizePlayerGames(games: PlayerGame[]): PlayerGamesSummary {
  const wins = games.filter((game) => game.win).length;
  return {
    total: games.length,
    wins,
    winrate: games.length > 0 ? wins / games.length : 0,
    games
  };
}

export interface LedgeQuery {
  /** 起始位置;0 = 最近的一局 */
  startIndex?: number;
  /** 要几局 */
  count?: number;
}

/**
 * 查某个玩家的对局。
 *
 * `puuid` 可以是**任何人**的 —— 这是查别人战绩的关键。
 */
export async function fetchPlayerGames(
  client: AxiosInstance,
  staticData: StaticData,
  puuid: string,
  query: LedgeQuery = {}
): Promise<PlayerGamesSummary> {
  if (!puuid) return summarizePlayerGames([]);

  const startIndex = query.startIndex ?? 0;
  const count = query.count ?? 20;
  const path =
    `${LEDGE_PREFIX}/player/${encodeURIComponent(puuid)}/SUMMARY` +
    `?startIndex=${startIndex}&count=${count}&tagsQueryType=AND`;

  const response = await ledgeGetWithToken(path, client);
  if (response.status === 401) {
    throw new Error('腾讯会话令牌失效了,重启游戏客户端再试');
  }
  if (response.status !== 200) {
    throw new Error(`腾讯战绩服务返回 ${response.status}`);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error('腾讯战绩服务返回了看不懂的数据');
  }
  return summarizePlayerGames(parseLedgeGames(payload, puuid, staticData));
}
