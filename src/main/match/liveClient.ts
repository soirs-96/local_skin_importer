import axios from 'axios';
import * as https from 'node:https';
import type { LiveGameInfo } from '../../shared/match';
import type { LiveScore } from '../../shared/settlement';

/**
 * Live Client Data API(2999 端口)。
 *
 * 这个端口**只在游戏内**开着,不需要鉴权,证书是自签的。
 * 客户端不在对局中时,连过去会直接被拒 —— 这就是「有没有在对局」最可靠的判据。
 */

const LIVE_CLIENT_BASE = 'https://127.0.0.1:2999';
const LIVE_CLIENT_TIMEOUT_MS = 1000;

/** 自签证书,得显式放行。复用一个实例,免得每 2 秒新建一个 agent。 */
const LIVE_CLIENT_AGENT = new https.Agent({ rejectUnauthorized: false });

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
 * 读当前对局的实时数据。不在对局中(或者客户端没开)返回 null。
 *
 * 这里**不抛异常**:这个接口「连不上」是常态,不是错误 —— 调用方靠 null 判断
 * 状态,让它抛错只会让整轮采集失败。
 */
export async function getAllGameData(
  timeoutMs = LIVE_CLIENT_TIMEOUT_MS
): Promise<LiveGameInfo | null> {
  try {
    const response = await axios.get(`${LIVE_CLIENT_BASE}/liveclientdata/allgamedata`, {
      httpsAgent: LIVE_CLIENT_AGENT,
      timeout: timeoutMs,
      validateStatus: () => true,
      // 本机回环请求不能走代理 —— 装了代理软件的机器上,代理会直接接管这个请求。
      proxy: false
    });
    if (response.status !== 200) return null;
    const data = response.data;
    if (!isRecord(data)) return null;

    const activePlayer = isRecord(data.activePlayer) ? data.activePlayer : {};
    const gameData = isRecord(data.gameData) ? data.gameData : {};
    const allPlayers = Array.isArray(data.allPlayers) ? data.allPlayers.filter(isRecord) : [];
    const myName = str(activePlayer.summonerName);
    const me = myName ? allPlayers.find((p) => str(p.summonerName) === myName) : undefined;

    return {
      summonerName: str(activePlayer.summonerName),
      currentGold: num(activePlayer.currentGold),
      gameTime: num(gameData.gameTime),
      gameMode: str(gameData.gameMode),
      championName: str(activePlayer.championName) || (me ? str(me.championName) : ''),
      skinName: me ? str(me.skin) : ''
    };
  } catch {
    return null;
  }
}

/** 从一条记录里按候选字段名取第一个能用的数。 */
function pickNum(raw: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = num(raw[key]);
    if (value !== 0) return value;
  }
  return 0;
}

/**
 * 从一条玩家记录里读出即时战绩。
 *
 * 认不出来(一个数都没有)返回 null —— 那说明这份载荷不是我们认得的形状,
 * 别把一堆 0 当成「这一局啥也没干」。
 */
function toLiveScore(raw: Record<string, unknown>): LiveScore | null {
  const score: LiveScore = {
    kills: pickNum(raw, ['championsKilled', 'kills']),
    deaths: pickNum(raw, ['deaths']),
    assists: pickNum(raw, ['assists']),
    minionKills: pickNum(raw, ['minionsKilled', 'totalMinionsKilled', 'minionKills']),
    goldEarned: pickNum(raw, ['goldEarned', 'totalGoldEarned', 'currentGold']),
    damageToChampions: pickNum(raw, [
      'damageDealtToChampions',
      'damageToChampions',
      'totalDamageDealtToChampions'
    ]),
    level: pickNum(raw, ['level', 'championLevel'])
  };
  const allZero =
    score.kills === 0 &&
    score.deaths === 0 &&
    score.assists === 0 &&
    score.minionKills === 0 &&
    score.goldEarned === 0;
  return allZero ? null : score;
}

/**
 * 局内即时战绩(/liveclientdata/playerstats)。
 *
 * 载荷形状各版本不一样:统计可能在 `activePlayer` 里,也可能只在
 * `allPlayers[]` 里(按召唤师名找「我」那条)。两种都试。
 *
 * **不抛异常** —— 2999 连不上是常态(局末它就关了)。
 */
export async function getPlayerStats(
  timeoutMs = LIVE_CLIENT_TIMEOUT_MS
): Promise<LiveScore | null> {
  try {
    const response = await axios.get(`${LIVE_CLIENT_BASE}/liveclientdata/playerstats`, {
      httpsAgent: LIVE_CLIENT_AGENT,
      timeout: timeoutMs,
      validateStatus: () => true,
      proxy: false
    });
    if (response.status !== 200) return null;
    const data = response.data;
    if (!isRecord(data)) return null;

    const active = isRecord(data.activePlayer) ? data.activePlayer : {};
    const players = Array.isArray(data.allPlayers) ? data.allPlayers.filter(isRecord) : [];
    const myName = str(active.summonerName);
    const inAllPlayers = myName ? players.find((p) => str(p.summonerName) === myName) : undefined;

    for (const source of [active, inAllPlayers]) {
      if (!isRecord(source)) continue;
      const score = toLiveScore(source);
      if (score) return score;
    }
    return null;
  } catch {
    return null;
  }
}
