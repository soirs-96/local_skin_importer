import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import { getAllGameData, getPlayerStats } from './liveClient';
import { getChampSelectSession } from './champSelect';
import { getRankedEntries } from './ranked';
import { findJustFinishedMatch, getRecentMatches, toMatchScore } from './recentMatches';
import { getChampionMastery } from './mastery';
import { getMatchSummoner } from './summoner';
import { getGameflowPhase, getOpponents } from './opponents';
import { resolveUsedSkin } from './usedSkin';
import { failedLookup, lookupPlayer as lookupPlayerByQuery } from './playerLookup';
import { fetchPlayerGames as fetchPlayerGamesFromLedge } from './tencentLedge';
import { championIndexEntries, emptyStaticData, loadStaticData, type StaticData } from './staticData';
import {
  LcuWsClient,
  extractRankedEntriesFromEvent,
  isAcceleratedEvent,
  isRankedEvent,
  type LcuWsEvent
} from './lcuWs';
import type {
  ChampionMastery,
  ChampSelectSession,
  LcuWsStatus,
  LiveGameInfo,
  MatchSnapshot,
  MatchState,
  OpponentsSnapshot,
  PlayerGamesSummary,
  PlayerLookup,
  RankedEntry,
  RecentMatchesSummary
} from '../../shared/match';
import type { ChampionIndexEntry } from '../../shared/recommendation';
import { lcuPhaseLabel } from '../../shared/gameLabels';
import type { LiveScore, LocalSettlement, UsedSkin } from '../../shared/settlement';

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
 * 熟练度的缓存时长。
 *
 * 熟练度只在打完一局之后才变,60 秒足够 —— 而且这个响应本身有 60 KB,
 * 每 2 秒拉一次纯属浪费。
 */
const MASTERY_TTL_MS = 60_000;
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
/**
 * 结算补齐段:局末之后过多久才开始查 match history(毫秒)。
 *
 * 客户端的 match history 有落库延迟 —— 局末那一刻往往还查不到刚打完的那局。
 */
const SETTLEMENT_ENRICH_DELAY_MS = 15_000;
/** 结算补齐段:两次查询之间的间隔(毫秒)。 */
const SETTLEMENT_ENRICH_RETRY_MS = 20_000;

export function emptySnapshot(): MatchSnapshot {
  return {
    state: 'idle',
    summoner: null,
    live: null,
    champSelect: null,
    ranked: [],
    recent: null,
    mastery: [],
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

/**
 * gameflow 是不是已经进了「对局结束」段。
 *
 * 直接用共享的阶段标签表判断 —— `PreEndOfGame` / `EndOfGame` / `PostGame`
 * 三个阶段在 `gameLabels.ts` 里都映射成「对局结束」。不新造枚举。
 */
export function isGameEndPhase(phase: string): boolean {
  return lcuPhaseLabel(phase) === '对局结束';
}

/** 从 gameflow 事件载荷里取 phase。 */
export function phaseFromEvent(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const phase = (data as Record<string, unknown>).phase;
  return typeof phase === 'string' ? phase : '';
}

/**
 * 从 gameflow 事件载荷里取「我」这条的英雄编号和皮肤编号。
 *
 * gameflow 用 `teamOwner: true` 标本地玩家那条 —— 这是最准的认法。
 * 认不到就退到「第一个带 championId 的条目」—— 那是本地玩家还是队友分不清,
 * 但**英雄编号对结算卡有用**,拿错了也只是界面上写错个名字,比空着强。
 *
 * ⚠️ 顺带读 `skinId`:gameflow 的队伍条目里是有皮肤编号的,
 * 这是选人会话之外的**第二条皮肤来源**,而且它一直活到局末。
 *
 * ⚠️ `teamOne` / `teamTwo` 的具体载荷形状没实测过(见探测 1),
 * 所以这里对字段名保持宽容。
 */
export function selfPlayerFromEvent(data: unknown): { championId: number; skinId: number } {
  const empty = { championId: 0, skinId: 0 };
  if (typeof data !== 'object' || data === null) return empty;
  const gameData = (data as Record<string, unknown>).gameData;
  if (typeof gameData !== 'object' || gameData === null) return empty;
  const gd = gameData as Record<string, unknown>;

  let fallback: { championId: number; skinId: number } = empty;
  for (const key of ['teamOne', 'teamTwo']) {
    const team = gd[key];
    if (!Array.isArray(team)) continue;
    for (const entry of team) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const championId = typeof e.championId === 'number' ? e.championId : 0;
      const skinId = typeof e.skinId === 'number' ? e.skinId : 0;
      if (championId <= 0 && skinId <= 0) continue;
      if (e.teamOwner === true) return { championId, skinId };
      if (fallback.championId <= 0 && championId > 0) {
        fallback = { championId, skinId };
      }
    }
  }
  return fallback;
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
export type SettlementListener = (settlement: LocalSettlement) => void;

export class MatchPoller {
  private timer: NodeJS.Timeout | null = null;
  private auth: lcu.LcuAuth | null = null;
  private authError: unknown = null;
  private authRetryAt = 0;
  private staticData: StaticData | null = null;
  private staticDataPromise: Promise<StaticData> | null = null;
  private rankedCache: { entries: RankedEntry[]; fetchedAt: number } | null = null;
  private recentCache: { payload: RecentMatchesSummary | null; fetchedAt: number } | null = null;
  private masteryCache: { entries: ChampionMastery[]; fetchedAt: number } | null = null;
  private polling = false;
  private listeners = new Set<MatchSnapshotListener>();

  /** 最近的 gameflow 阶段(事件流或轮询兜底) */
  private phase = '';
  /** 局内最后一帧的实时数据(2999) */
  private lastLive: LiveGameInfo | null = null;
  /** 局内最后一帧的即时战绩(2999) */
  private lastPlayerStats: LiveScore | null = null;
  /**
   * 本局皮肤的**三条候选来源**,各自独立记着。
   *
   * 谁先到不重要 —— 结算时由 `resolveUsedSkin` 按可靠度合成一个结论。
   * 拆成三条是因为它们的采集时机横跨整局:选人阶段、局中、局后各有各的坑。
   *
   * ⚠️ match history 那条**不是字段** —— 它要等局末才查得到,而且只属于
   * 那一局。存成字段就会把上一局的皮肤 id 带进下一局。
   */
  private champSelectSkinId = 0;
  private gameflowSkinId = 0;
  private liveClientSkinName: string | null = null;
  /** 本局英雄编号(选人阶段 / gameflow 事件里记下) */
  private currentChampionId = 0;
  /** 局末结算 */
  private settlement: LocalSettlement | null = null;
  /** 上次尝试补 match history 的时刻 */
  private settlementEnrichedAt = 0;
  private settlementListeners = new Set<SettlementListener>();

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

  /**
   * 订阅「局末结算」。
   *
   * 跟快照订阅分开 —— 结算不是快照的一部分,是局末那一刻单独产生的一条消息。
   */
  subscribeSettlement(listener: SettlementListener): () => void {
    this.settlementListeners.add(listener);
    return () => {
      this.settlementListeners.delete(listener);
    };
  }

  /** 主进程手上这一份结算;null = 还没打过一局 */
  getSettlement(): LocalSettlement | null {
    return this.settlement;
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
    // gameflow:局末判定的主通路 —— 事件流比 2 秒轮询快得多,
    // 而且不用去问 LCU(对局中轮询器是直接 return 的)。
    if (event.uri.startsWith('/lol-gameflow/v1/session')) {
      const phase = phaseFromEvent(event.data);
      const self = selfPlayerFromEvent(event.data);
      // 「空闲 / 大厅」阶段的 gameData 还是上一局的残留 —— 不收,
      // 不然下一局没读到皮肤时会拿上一局的编号顶上。
      const stale = phase === 'None' || phase === 'Lobby';
      if (!stale && self.championId > 0) this.currentChampionId = self.championId;
      // gameflow 里的皮肤编号 —— 选人会话之外的第二条来源
      if (!stale && self.skinId > 0) this.gameflowSkinId = self.skinId;
      if (phase) this.onPhaseChange(phase);
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

  /**
   * 我的 puuid。
   *
   * 快照里有就直接用;没有(轮询器还没跑)就问一次客户端 ——
   * 「查的是不是自己」要靠它判断。
   */
  private async resolveMyPuuid(client: AxiosInstance): Promise<string> {
    const cached = this.snapshot.summoner?.puuid;
    if (cached) return cached;
    try {
      const summoner = await getMatchSummoner(client);
      return summoner?.puuid ?? '';
    } catch {
      return '';
    }
  }

  /**
   * 查一个召唤师的资料。
   *
   * 跟轮询器共用凭据缓存 —— 凭据拿一次要好几秒,没必要另起一份。
   */
  async lookupPlayer(query: string): Promise<PlayerLookup> {
    try {
      const auth = await this.ensureAuth();
      const client = lcu.createLcuClient(auth);
      const myPuuid = await this.resolveMyPuuid(client);
      return await lookupPlayerByQuery(client, query, myPuuid);
    } catch (e: unknown) {
      return failedLookup(query, describeError(e));
    }
  }

  /**
   * 查某个玩家的历史战绩(腾讯的对局服务)。
   *
   * `puuid` 可以是**任何人**的 —— 客户端那层把战绩路由裁到只剩「我自己」,
   * 直连腾讯网关才能拿到对方的历史(见 tencentLedge.ts)。
   *
   * 跟资料查询是**两个接口**:资料是本机回环,秒回;战绩要出网,慢一个量级。
   * 拆开界面才能先把资料摆出来,战绩随后补上。
   */
  async fetchPlayerGames(
    puuid: string,
    startIndex = 0,
    count = 20
  ): Promise<PlayerGamesSummary> {
    const auth = await this.ensureAuth();
    const client = lcu.createLcuClient(auth);
    // 静态数据(英雄名/物品名)是锦上添花 —— 拉不到就用编号兜底,
    // 别因为它把整个查询搞失败。
    let staticData: StaticData;
    try {
      staticData = await this.ensureStaticData(client);
    } catch {
      staticData = emptyStaticData();
    }
    return await fetchPlayerGamesFromLedge(client, staticData, puuid, { startIndex, count });
  }

  /**
   * 对局中的两队人。
   *
   * 不启动轮询器 —— 这是一次性查询,没必要把 2 秒轮询也带起来。
   */
  async fetchOpponents(): Promise<OpponentsSnapshot> {
    try {
      const auth = await this.ensureAuth();
      const client = lcu.createLcuClient(auth);
      const staticData = await this.ensureStaticData(client);
      const myPuuid = await this.resolveMyPuuid(client);
      return await getOpponents(client, staticData, myPuuid);
    } catch {
      return { phase: '', queueType: '', inGame: false, opponents: [] };
    }
  }

  /**
   * 英雄名 → 编号 的对照表。
   *
   * AI 推荐只吐名字不吐编号,界面靠这张表把名字配上头像。
   * 拉不到就空表 —— 界面退回纯文字,不出错。
   */
  async getChampionIndex(): Promise<ChampionIndexEntry[]> {
    try {
      const auth = await this.ensureAuth();
      const client = lcu.createLcuClient(auth);
      const staticData = await this.ensureStaticData(client);
      return championIndexEntries(staticData);
    } catch {
      return [];
    }
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

  /**
   * gameflow 阶段变了。
   *
   * 边沿检测:从「不是结束」进入「结束」的那一次才触发 —— 同一局只触发一次。
   */
  private onPhaseChange(phase: string): void {
    if (!phase || phase === this.phase) return;
    const wasEnd = isGameEndPhase(this.phase);
    const isEnd = isGameEndPhase(phase);
    this.phase = phase;
    if (!isEnd || wasEnd) return;
    this.createSettlement();
  }

  /** 三条候选合成一个结论 —— 优先级在 `usedSkin.ts` 里定死。 */
  private resolveSettlementSkin(): UsedSkin {
    return resolveUsedSkin({
      champSelectSkinId: this.champSelectSkinId,
      gameflowSkinId: this.gameflowSkinId,
      liveClientSkinName: this.liveClientSkinName
    });
  }

  /**
   * 局末:生成结算快照。
   *
   * 只有真的打过这一局才生成 —— 应用刚启动时客户端可能正停在结算画面上,
   * 那时候读到的 phase 也是「对局结束」,但我们根本没打过这一局。
   */
  private createSettlement(): void {
    if (!this.currentChampionId && !this.lastLive) {
      this.resetSkinCandidates();
      return;
    }

    const endedAt = Date.now();
    const live = this.lastLive;
    const usedSkin = this.resolveSettlementSkin();

    const settlement: LocalSettlement = {
      key: `${this.currentChampionId}-${usedSkin.riotSkinId}-${endedAt}`,
      championId: this.currentChampionId,
      championName: live?.championName ?? '',
      usedSkin,
      live: this.lastPlayerStats,
      match: null,
      endedAt
    };
    this.settlement = settlement;
    this.settlementEnrichedAt = 0;
    this.emitSettlement(settlement);
    // 结算快照已经带走了这一局的皮肤 —— 候选作废,免得带进下一局。
    this.resetSkinCandidates();
  }

  /** 清掉本局的皮肤候选 —— 下一局重新攒。 */
  private resetSkinCandidates(): void {
    this.champSelectSkinId = 0;
    this.gameflowSkinId = 0;
    this.liveClientSkinName = null;
  }

  private emitSettlement(settlement: LocalSettlement): void {
    for (const listener of this.settlementListeners) {
      try {
        listener(settlement);
      } catch {
        // 订阅者自己的问题不能带崩轮询
      }
    }
  }

  /**
   * 记下本局的英雄和皮肤(选人阶段每轮都调)。
   *
   * 选人会话只在选人阶段存在 —— 局末再问已经 404,所以必须提前记。
   */
  private recordChampSelect(champSelect: ChampSelectSession | null): void {
    if (!champSelect) return;
    if (champSelect.myChampionId > 0) this.currentChampionId = champSelect.myChampionId;
    if (champSelect.mySkinId > 0) this.champSelectSkinId = champSelect.mySkinId;
  }

  /**
   * 补齐结算里的胜负 / 时长 / 位置。
   *
   * 客户端的 match history 有落库延迟 —— 局末那一刻往往还查不到刚打完的那局。
   * 所以弹窗先开起来(靠 2999 的即时战绩),过一会儿再补。
   */
  private async enrichSettlement(
    client: AxiosInstance,
    staticData: StaticData,
    puuid: string,
    now: number
  ): Promise<void> {
    const settlement = this.settlement;
    if (!settlement || settlement.match) return;
    // 不知道英雄 —— 不猜是哪一局
    if (!settlement.championId) return;
    if (now - settlement.endedAt < SETTLEMENT_ENRICH_DELAY_MS) return;
    if (now - this.settlementEnrichedAt < SETTLEMENT_ENRICH_RETRY_MS) return;

    this.settlementEnrichedAt = now;
    try {
      // 用**结算自己的**英雄编号,不用当前的 —— 玩家可能已经排上下一局了。
      const found = await findJustFinishedMatch(client, staticData, puuid, settlement.championId, {
        now
      });
      if (!found) return;
      const enriched: LocalSettlement = { ...settlement, match: toMatchScore(found.match) };
      // 结算时没认出皮肤的话,match history 里的 participant 可能给
      if (enriched.usedSkin.riotSkinId === 0 && found.skinId && found.skinId > 0) {
        enriched.usedSkin = resolveUsedSkin({
          matchHistorySkinId: found.skinId,
          liveClientSkinName: enriched.usedSkin.displayName
        });
      }
      this.settlement = enriched;
      this.emitSettlement(enriched);
    } catch {
      // 查不到就还是缺 —— 不编
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

  /**
   * 官方熟练度。
   *
   * 拉不到就保留上一次的结果:这个端点在客户端刚启动、还没登录完的时候会
   * 短暂地 4xx/5xx,那不代表用户没有熟练度。
   */
  private async fetchMastery(
    client: AxiosInstance,
    staticData: StaticData,
    puuid: string
  ): Promise<ChampionMastery[]> {
    const cached = this.masteryCache;
    if (cached && Date.now() - cached.fetchedAt < MASTERY_TTL_MS) return cached.entries;
    try {
      const entries = await getChampionMastery(client, staticData, puuid);
      if (entries.length > 0) {
        this.masteryCache = { entries, fetchedAt: Date.now() };
        return entries;
      }
    } catch {
      // 端点暂时不可用 —— 沿用上一次的数据
    }
    return cached?.entries ?? [];
  }

  private async collect(): Promise<MatchSnapshot> {
    const now = Date.now();
    const previous = this.snapshot;

    // 1. 在对局里?Live Client Data 是最直接的判据
    const live = await getAllGameData();
    if (live) {
      // 2999 在局末会关 —— 最后一帧得留住
      this.lastLive = live;
      // Live Client 只给英文资源名 —— 拿不到数字 id,只能当「认出了名字」用
      if (live.skinName) this.liveClientSkinName = live.skinName;
      // 即时战绩也缓存一份(等下结算要用)
      const stats = await getPlayerStats();
      if (stats) this.lastPlayerStats = stats;
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

    // gameflow 阶段 —— **只在事件流没连上的时候**才走这一路兜底。
    // 事件流连着的时候每 2 秒再问一次 HTTP 是白花钱(LCU 那边也算请求)。
    if (this.wsStatus !== 'connected') {
      const phase = await getGameflowPhase(client);
      if (phase) this.onPhaseChange(phase);
    }

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

    const champSelect = await getChampSelectSession(
      client,
      staticData,
      summoner.summonerId,
      summoner.puuid
    );
    this.recordChampSelect(champSelect);
    const state: MatchState = champSelect ? 'champ_select' : 'lobby';

    // 熟练度跟当前在不在选人无关 —— 大厅和选人阶段都要显示。
    const mastery = await this.fetchMastery(client, staticData, summoner.puuid);

    let ranked = previous.ranked;
    let recent = previous.recent;
    if (state === 'lobby') {
      ranked = await this.fetchRanked(client, summoner.puuid);
      recent = await this.fetchRecent(client, staticData, summoner.puuid);
    }

    // 结算的补齐段:局末之后 match history 才落库,过一会儿再查一次。
    //
    // ⚠️ **放在大厅分支外面** —— 打完之后玩家可能直接排下一把,那时
    // state 是 'champ_select',放在分支里就永远补不上了。
    await this.enrichSettlement(client, staticData, summoner.puuid, now);

    return {
      state,
      summoner,
      live: null,
      champSelect,
      ranked,
      recent,
      mastery,
      rankedSource: this.rankedSource,
      wsStatus: this.wsStatus,
      lastError: null,
      updatedAt: now
    };
  }
}

/** 进程内单例:整个应用共用一个轮询器,免得多个订阅者各拉各的。 */
export const matchPoller = new MatchPoller();
