import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import { getAllGameData } from './liveClient';
import { getChampSelectSession } from './champSelect';
import { getRankedEntries } from './ranked';
import { getRecentMatches } from './recentMatches';
import { getMatchSummoner } from './summoner';
import { emptyStaticData, loadStaticData, type StaticData } from './staticData';
import {
  LcuWsClient,
  extractRankedEntriesFromEvent,
  isAcceleratedEvent,
  isRankedEvent,
  type LcuWsEvent
} from './lcuWs';
import type {
  LcuWsStatus,
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
 *
 * 上面这套是**兜底通路**:客户端把 `/lol-ranked/*` 那几个端点删掉之后,
 * 段位就只剩 WebSocket 事件流这一条路了。所以另外挂了一条 LCU WebSocket
 * 通道(`lcuWs.ts`):状态一变立刻唤醒一轮采集,段位也从事件流里捞一份备用。
 */

const POLL_INTERVAL_MS = 2000;
const RANKED_TTL_MS = 60_000;
const RECENT_TTL_MS = 30_000;
/**
 * WS 兜底段位的有效期。
 *
 * 段位只在打完排位后变,客户端推过来的就是最新的;但客户端换账号、或者
 * 事件流断了很久才重连,旧段位就没意义了 —— 5 分钟是折中。
 */
const WS_RANKED_TTL_MS = 5 * 60_000;
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
    rankedSource: null,
    wsStatus: 'disconnected',
    lastError: null,
    updatedAt: 0
  };
}

function describeError(e: unknown): string {
  // 裁决层的结论优先 —— 「装的是国际服客户端」比「未检测到游戏客户端」具体得多。
  const summary = (e as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.length > 0) return summary;
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

  private wsClient: LcuWsClient | null = null;
  private wsStatus: LcuWsStatus = 'disconnected';
  /** 从事件流里捞到的段位,HTTP 端点全废时用它兜底 */
  private wsRanked: { entries: RankedEntry[]; fetchedAt: number } | null = null;
  private rankedSource: string | null = null;
  /** 采集过程中来的唤醒:等这轮采完再补一轮,不丢事件 */
  private wakePending = false;

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
    this.startWs();
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
    this.wsClient?.stop();
    this.wsClient = null;
    this.wsStatus = 'disconnected';
  }

  /**
   * 挂上 LCU WebSocket 通道。
   *
   * 凭据复用轮询器自己的缓存 —— 客户端换端口时轮询那侧会先失败并作废缓存,
   * 下一轮重连就拿到新凭据了,不用两边各 spawn 一次 PowerShell。
   */
  private startWs(): void {
    if (this.wsClient) return;
    this.wsClient = new LcuWsClient({
      resolveAuth: () => this.ensureAuth(),
      onEvent: (event) => this.handleWsEvent(event),
      onStatus: (status) => {
        this.wsStatus = status;
        this.wake();
      },
      onAuthRejected: () => this.invalidateAuth()
    });
    this.wsClient.start();
  }

  private handleWsEvent(event: LcuWsEvent): void {
    if (isRankedEvent(event)) {
      const entries = extractRankedEntriesFromEvent(event);
      if (entries.length > 0) {
        this.wsRanked = { entries, fetchedAt: Date.now() };
      }
    }
    if (isAcceleratedEvent(event)) {
      this.wake();
    }
  }

  /** 事件驱动的立即采集。正在采的时候就记一笔,采完补一轮。 */
  private wake(): void {
    if (this.polling) {
      this.wakePending = true;
      return;
    }
    void this.poll();
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
      if (this.wakePending) {
        this.wakePending = false;
        void this.poll();
      }
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
      // 共享给别的模块(图标代理),省得各自去 spawn 一个 PowerShell
      lcu.setSharedLcuAuth(auth);
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
    lcu.setSharedLcuAuth(null);
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

  /**
   * 段位:HTTP 优先,拿不到才用事件流兜底。
   *
   * HTTP 优先是刻意的 —— `/lol-ranked/*` 的载荷形状稳定,还有 60 秒缓存,
   * 拿得到就没什么理由去猜事件流的形状。WS 兜底存在的唯一理由是
   * **新版客户端把那几个端点删了**,这时候 HTTP 全废,只剩事件流。
   */
  private async fetchRanked(client: AxiosInstance, puuid: string): Promise<RankedEntry[]> {
    const cached = this.rankedCache;
    if (cached && Date.now() - cached.fetchedAt < RANKED_TTL_MS) {
      if (cached.entries.length > 0) return cached.entries;
      return this.applyWsRankedFallback();
    }
    try {
      const { entries, source } = await getRankedEntries(client, puuid);
      // 空结果也缓存:否则每 2 秒要把七八个端点挨个试一遍
      this.rankedCache = { entries, fetchedAt: Date.now() };
      if (entries.length > 0) {
        this.rankedSource = source;
        return entries;
      }
    } catch {
      // HTTP 读不到 —— 落到 WS 兜底
    }
    return this.applyWsRankedFallback();
  }

  /** HTTP 没段位时用事件流兜底,并把来源标成 ws。 */
  private applyWsRankedFallback(): RankedEntry[] {
    const ws = this.wsRankedEntries();
    if (ws.length > 0) {
      this.rankedSource = 'ws';
      return ws;
    }
    return this.rankedCache?.entries ?? [];
  }

  /** 事件流里捞到的段位(过期的不给)。 */
  private wsRankedEntries(): RankedEntry[] {
    const ws = this.wsRanked;
    if (!ws) return [];
    if (Date.now() - ws.fetchedAt > WS_RANKED_TTL_MS) return [];
    return ws.entries;
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
        wsStatus: this.wsStatus,
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
        wsStatus: this.wsStatus,
        lastError: describeError(e),
        updatedAt: now
      };
    }

    const client = lcu.createLcuClient(auth);

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
        wsStatus: this.wsStatus,
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
        wsStatus: this.wsStatus,
        lastError: '游戏客户端没有登录中的召唤师',
        updatedAt: now
      };
    }

    // 静态数据放在召唤师之后取:Data Dragon 拉不动时要等好几秒,
    // 别把召唤师信息一起拖住。
    const staticData = await this.ensureStaticData(client);

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
      rankedSource: this.rankedSource,
      wsStatus: this.wsStatus,
      lastError: null,
      updatedAt: now
    };
  }
}

/** 进程内单例:整个应用共用一个轮询器,免得多个订阅者各拉各的。 */
export const matchPoller = new MatchPoller();
