import axios from 'axios';
import { getStoredToken } from '../auth';
import { matchPoller } from './poller';
import { gameTitle, laneLabel, roleLabel } from '../../shared/gameLabels';
import type { PlayerGame, PlayerLookup } from '../../shared/match';

/**
 * 后台「战绩查询」的桌面端执行器。
 *
 * <p>后台页面能查任意玩家的战绩,但**查的动作必须在这台电脑上做**:
 * 「昵称#标签」→ puuid 要问本机游戏客户端,腾讯的对局服务也要客户端的会话令牌。
 * 服务端两样都没有。
 *
 * <p>所以这里隔几秒去后端领一个任务,查完把结果回传。后台页面只是轮询任务状态。
 *
 * <p>没登录就领不了 —— 桌面 token 领任务,别的端领不走。
 */

const BACKEND_BASE_URL = 'http://101.34.210.254';
/** 多久领一次任务。桌面端本来就 2 秒轮询一次客户端,5 秒不算多。 */
const CLAIM_INTERVAL_MS = 5_000;
/** 领任务/回传的超时。查战绩本身慢,那是另一条请求。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** 一次拉多少局。 */
const GAME_COUNT = 20;

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

interface MatchTaskDTO {
  id: string;
  query: string;
}

interface MatchGamePayload {
  gameId: string;
  timestampMs: number;
  durationS: number;
  queueId: number;
  gameMode: string;
  mapId: number;
  championId: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  win: boolean;
  lane: string;
  role: string;
  roleBoundItemName: string;
  goldEarned: number;
  damageToChampions: number;
  minionKills: number;
  title: string;
  laneLabel: string;
  roleLabel: string;
}

interface MatchResultPayload {
  player: {
    riotId: string;
    displayName: string;
    tagLine: string;
    summonerId: number;
    puuid: string;
    summonerLevel: number;
    rankedDisplay: string;
    rankedTier: string;
    rankedDivision: string;
  };
  total: number;
  wins: number;
  winrate: number;
  games: MatchGamePayload[];
}

function toGamePayload(game: PlayerGame): MatchGamePayload {
  return {
    gameId: game.gameId,
    timestampMs: game.timestampMs,
    durationS: game.durationS,
    queueId: game.queueId,
    gameMode: game.gameMode,
    mapId: game.mapId,
    championId: game.championId,
    championName: game.championName,
    kills: game.kills,
    deaths: game.deaths,
    assists: game.assists,
    kda: game.kda,
    win: game.win,
    lane: game.lane,
    role: game.role,
    roleBoundItemName: game.roleBoundItemName ?? '',
    goldEarned: game.goldEarned,
    damageToChampions: game.damageToChampions,
    minionKills: game.minionKills,
    title: gameTitle(game.mapId, game.queueId, ''),
    laneLabel: laneLabel(game.lane),
    roleLabel: roleLabel(game.role)
  };
}

function toResultPayload(
  lookup: PlayerLookup,
  games: PlayerGame[]
): MatchResultPayload {
  const wins = games.filter((g) => g.win).length;
  return {
    player: {
      riotId: lookup.riotId,
      displayName: lookup.displayName,
      tagLine: lookup.tagLine,
      summonerId: lookup.summonerId,
      puuid: lookup.puuid,
      summonerLevel: lookup.summonerLevel,
      rankedDisplay: lookup.rankedDisplay,
      rankedTier: lookup.rankedTier,
      rankedDivision: lookup.rankedDivision
    },
    total: games.length,
    wins,
    winrate: games.length ? wins / games.length : 0,
    games: games.map(toGamePayload)
  };
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? '未知错误');
}

/**
 * 后台「战绩查询」的执行器。
 *
 * <p>单例挂在 main 进程里 —— 应用开着就一直能接活。
 */
export class MatchTaskRunner {
  private timer: NodeJS.Timeout | null = null;
  /** 上一次领取还没跑完时,这一轮就跳过 —— 同一时刻只能有一个任务在手。 */
  private busy = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, CLAIM_INTERVAL_MS);
    // 别让这个定时器拖着进程不退出。
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 领一个任务并执行。没有任务就什么都不做。 */
  async runOnce(): Promise<void> {
    if (this.busy) return;
    const token = getStoredToken();
    // 没登录就领不了 —— 桌面 token 领任务,别的端领不走。
    if (!token) return;

    this.busy = true;
    try {
      const task = await this.claim(token);
      if (!task) return;
      await this.execute(task, token);
    } catch (e: unknown) {
      // 领取/回传本身失败(断网、后端挂了)—— 下一轮继续,不用惊动用户。
      console.warn('[match-task] run failed:', errorText(e));
    } finally {
      this.busy = false;
    }
  }

  /** 领一个任务;没有待办返回 null。 */
  private async claim(token: string): Promise<MatchTaskDTO | null> {
    const { data } = await axios.post<BackendEnvelope<MatchTaskDTO | null>>(
      `${BACKEND_BASE_URL}/api/desktop/match-tasks/claim`,
      null,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (data.code !== 200) {
      throw new Error(data.message ?? '领取任务失败');
    }
    return data.data ?? null;
  }

  /** 查这个任务,查完把结果(或失败原因)回传。 */
  private async execute(task: MatchTaskDTO, token: string): Promise<void> {
    const query = task.query.trim();
    if (!query) {
      await this.report(task.id, token, null, '查询内容为空');
      return;
    }

    const lookup = await matchPoller.lookupPlayer(query);
    if (!lookup.found) {
      await this.report(task.id, token, null, lookup.error ?? '没查到这个玩家');
      return;
    }
    if (!lookup.puuid) {
      await this.report(task.id, token, null, '没拿到玩家标识,查不了战绩');
      return;
    }

    try {
      const summary = await matchPoller.fetchPlayerGames(lookup.puuid, 0, GAME_COUNT);
      await this.report(task.id, token, toResultPayload(lookup, summary.games), null);
    } catch (e: unknown) {
      await this.report(task.id, token, null, `拉战绩失败:${errorText(e)}`);
    }
  }

  private async report(
    taskId: string,
    token: string,
    result: MatchResultPayload | null,
    error: string | null
  ): Promise<void> {
    try {
      const { data } = await axios.post<BackendEnvelope<unknown>>(
        `${BACKEND_BASE_URL}/api/desktop/match-tasks/${taskId}/result`,
        { result, error },
        {
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        }
      );
      if (data.code !== 200) {
        console.warn('[match-task] report rejected:', data.message);
      }
    } catch (e: unknown) {
      console.warn('[match-task] report failed:', errorText(e));
    }
  }
}

export const matchTaskRunner = new MatchTaskRunner();
