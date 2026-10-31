import axios from 'axios';
import * as https from 'node:https';
import type { LiveGameInfo } from '../../shared/match';

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
      validateStatus: () => true
    });
    if (response.status !== 200) return null;
    const data = response.data;
    if (!isRecord(data)) return null;

    const activePlayer = isRecord(data.activePlayer) ? data.activePlayer : {};
    const gameData = isRecord(data.gameData) ? data.gameData : {};

    return {
      summonerName: str(activePlayer.summonerName),
      currentGold: num(activePlayer.currentGold),
      gameTime: num(gameData.gameTime),
      gameMode: str(gameData.gameMode)
    };
  } catch {
    return null;
  }
}
