import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import { getAllGameData } from './liveClient';
import { getChampSelectSession } from './champSelect';
import { getRankedEntries } from './ranked';
import { getRecentMatches } from './recentMatches';
import { getMatchSummoner } from './summoner';
import { loadStaticData, type StaticData } from './staticData';
import type {
  MatchSnapshot,
  MatchState,
  RankedEntry,
  RecentMatchesSummary
} from '../../shared/match';

/**
 * 对局助手的轮询器。
 *
 * 每 2 秒采一次:先问 Live Client Data(2999)「在不在对局里」,在的话就地取
 * 局内实时数据;不在才去 LCU 问召唤师 / 选人 / 段位 / 最近对局。
 *
 * 三个缓存各司其职:
 *   - **LCU 凭据**:进程命令行查一次就缓存住。客户端换端口时靠「请求失败 →
 *     作废凭据 → 下一轮重新解析」自愈,不用每 2 秒去 spawn PowerShell。
 *   - **段位 60 秒**:段位一场最多变一次,没必要每轮都打一串端点。
 *   - **最近对局 30 秒**:这个端点会被限流,打太勤会返回空列表。
 *     而且**空结果不当成「没打过游戏」** —— 保留上一次有货的结果。
 */

const POLL_INTERVAL_MS = 2000;
const RANKED_TTL_MS = 60_000;
const RECENT_TTL_MS = 30_000;
/**
 * 凭据解析失败后的退避时间。
 *
 * 查进程命令行要 spawn 一个 PowerShell,客户端没开的时候每 2 秒来一次太奢侈。
 * 失败一次就歇 10 秒,反正客户端开起来后 10 秒内一定会被探测到。
 */
const AUTH_RETRY_MS = 10_000;

export function emptySnapshot(): MatchSnapshot {
  return {
    state: 'idle',
    summoner: null,
    live: null,
    champSelect: null,
    ranked: [],
    recent: null,
    lastError: null,
    updatedAt: 0
  };
}

function describeError(e: unknown): string {
  if (e instanceof lcu.LcuNotRunningError) return '未检测到游戏客户端,请先启动它。';
  if (e instanceof lcu.LcuUnreachableError) {
    return '游戏客户端端口已失效(客户端重启过),请重新启动客户端。';
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 请求失败说明凭据过期了(客户端换过端口/token),丢掉缓存让下一轮重新解析。 */
function isAuthStale(e: unknown): boolean {
  if (e instanceof lcu.LcuUnreachableError || e instanceof lcu.LcuNotRunningError) return true;
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: string; response?: { status?: number } };
  if (err.response?.status === 401) return true;
  return err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
}

export type MatchSnapshotListener = (snapshot: MatchSnapshot) => void;

export class MatchPoller {
  private timer: NodeJS.Timeout | null = null;
  private auth: lcu.LcuAuth | null = null;
  private authError: unknown = null;
  private authRetryAt = 0;
  private staticData: StaticData | null = null;
  private staticDataPromise: Promise<StaticData> | null = null;
  private rankedCache: { entries: RankedEntry[]; fetchedAt: number } | null = null;
  private recentCache: { payload: RecentMatchesSummary | null; fetchedAt: number } | null = null;
  private polling = false;
  private listeners = new Set<MatchSnapshotListener>();

  private snapshot: MatchSnapshot = emptySnapshot();

  getSnapshot(): MatchSnapshot {
    return this.snapshot;
  }

  subscribe(listener: MatchSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    // 定时器不该拖着进程不让退出
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 立刻采一次(用户点了「立即刷新」)。 */
  async refreshNow(): Promise<MatchSnapshot> {
    await this.poll();
    return this.snapshot;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // 订阅者自己的问题不能带崩轮询
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.snapshot = await this.collect();
      this.emit();
    } finally {
      this.polling = false;
    }
  }

  private async ensureAuth(): Promise<lcu.LcuAuth> {
    if (this.auth) return this.auth;
    if (this.authError && Date.now() < this.authRetryAt) {
      throw this.authError;
    }
    try {
      const auth = await lcu.resolveLcuAuthAsync();
      this.auth = auth;
      this.authError = null;
      return auth;
    } catch (e: unknown) {
      this.authError = e;
      this.authRetryAt = Date.now() + AUTH_RETRY_MS;
      throw e;
    }
  }

  private invalidateAuth(): void {
    this.auth = null;
    this.authError = null;
    this.authRetryAt = 0;
  }

  private async ensureStaticData(client: AxiosInstance): Promise<StaticData> {
    if (this.staticData) return this.staticData;
    if (!this.staticDataPromise) {
      this.staticDataPromise = loadStaticData(client)
        .then((data) => {
          this.staticData = data;
          return data;
        })
        .catch(() => {
          this.staticDataPromise = null;
          return emptyStaticData();
        });
    }
    return this.staticDataPromise;
  }

  private async fetchRanked(client: AxiosInstance, puuid: string): Promise<RankedEntry[]> {
    const cached = this.rankedCache;
    if (cached && Date.now() - cached.fetchedAt < RANKED_TTL_MS) return cached.entries;
    try {
      const { entries } = await getRankedEntries(client, puuid);
      this.rankedCache = { entries, fetchedAt: Date.now() };
      return entries;
    } catch {
      return cached?.entries ?? [];
    }
  }

  private async fetchRecent(
    client: AxiosInstance,
    staticData: StaticData,
    puuid: string
  ): Promise<RecentMatchesSummary | null> {
    const cached = this.recentCache;
    if (cached && Date.now() - cached.fetchedAt < RECENT_TTL_MS) return cached.payload;
    try {
      const payload = await getRecentMatches(client, staticData, puuid);
      // 空列表 = 端点限流了,不是「没打过游戏」—— 保留上一次有货的结果。
      if (payload.total > 0) {
        this.recentCache = { payload, fetchedAt: Date.now() };
        return payload;
      }
      return cached?.payload ?? payload;
    } catch {
      return cached?.payload ?? null;
    }
  }

  private async collect(): Promise<MatchSnapshot> {
    const now = Date.now();
    const previous = this.snapshot;

    // 1. 在对局里?Live Client Data 是最直接的判据
    const live = await getAllGameData();
    if (live) {
      return {
        ...previous,
        state: 'in_game',
        live,
        champSelect: null,
        lastError: null,
        updatedAt: now
      };
    }

    // 2. 不在局里 —— 去 LCU
    let auth: lcu.LcuAuth;
    try {
      auth = await this.ensureAuth();
    } catch (e: unknown) {
      return {
        ...previous,
        state: 'idle',
        live: null,
        champSelect: null,
        lastError: describeError(e),
        updatedAt: now
      };
    }

    const client = lcu.createLcuClient(auth.port, auth.token);
    const staticData = await this.ensureStaticData(client);

    let summoner;
    try {
      summoner = await getMatchSummoner(client);
    } catch (e: unknown) {
      if (isAuthStale(e)) this.invalidateAuth();
      return {
        ...previous,
        state: 'idle',
        live: null,
        champSelect: null,
        lastError: describeError(e),
        updatedAt: now
      };
    }

    if (!summoner) {
      return {
        ...previous,
        state: 'idle',
        live: null,
        champSelect: null,
        lastError: '游戏客户端没有登录中的召唤师',
        updatedAt: now
      };
    }

    const champSelect = await getChampSelectSession(client, staticData, summoner.summonerId);
    const state: MatchState = champSelect ? 'champ_select' : 'lobby';

    let ranked = previous.ranked;
    let recent = previous.recent;
    if (state === 'lobby') {
      ranked = await this.fetchRanked(client, summoner.puuid);
      recent = await this.fetchRecent(client, staticData, summoner.puuid);
    }

    return {
      state,
      summoner,
      live: null,
      champSelect,
      ranked,
      recent,
      lastError: null,
      updatedAt: now
    };
  }
}

function emptyStaticData(): StaticData {
  return {
    version: null,
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  };
}

/** 进程内单例:整个应用共用一个轮询器,免得多个订阅者各拉各的。 */
export const matchPoller = new MatchPoller();
