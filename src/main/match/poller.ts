import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import { getAllGameData, getPlayerStats } from './liveClient';
import { getChampSelectSession } from './champSelect';
import { getRankedEntries } from './ranked';
import { findJustFinishedMatch, getRecentMatches, toMatchScore } from './recentMatches';
import { getChampionMastery } from './mastery';
import { getMatchSummoner } from './summoner';
import { getGameflowPhase, getGameflowSession, getOpponents } from './opponents';
import {
  parseGameflowSelection,
  parseGameflowSelf,
  resolveSkinIndex,
  resolveUsedSkin
} from './usedSkin';
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
/**
 * 结算补齐段:两次「问 gameflow 补皮肤」之间的间隔(毫秒)。
 *
 * 客户端只在局末那几秒还留着上一局的队伍信息 —— 所以这个重试间隔不能太长,
 * 但也别每 2 秒打一次端点。
 */
const SETTLEMENT_SKIN_RETRY_MS = 20_000;

/**
 * 局中记皮肤的间隔(毫秒)。
 *
 * 局中的皮肤**不会中途变** —— 认出来一次就够;没认出来才隔一会儿再试。
 */
const IN_GAME_SKIN_RETRY_MS = 30_000;
/**
 * 「勤读」客户端会话的间隔(毫秒)。
 *
 * ⚠️ 选中记录(`playerChampionSelections`)**不是一直都在**:
 *    国服实测(2026-11-21 的会话快照)在 `PreEndOfGame` 阶段还读不到,
 *    到 `EndOfGame` 才冒出来 —— 而 `EndOfGame` 只持续几秒,
 *    客户端紧接着就把会话清空了。
 *    20 秒一轮的节奏必然错过那个窗口 —— 这就是「时好时坏」的根因。
 */
const SETTLEMENT_SKIN_FAST_RETRY_MS = 2_500;
/**
 * 结算刚出来的一段时间里都按「勤读」走(毫秒)。
 *
 * 结算刚生成时是皮肤最后出现的机会 —— 这段时间读勤一点,过了就随它去。
 */
const SETTLEMENT_SKIN_FAST_WINDOW_MS = 90_000;
/**
 * 局中补结算皮肤的窗口(毫秒)。
 *
 * 结算画面上 2999(Live Client)还开着 —— 轮询走的是 in_game 分支,
 * 常规的补齐段(`enrichSettlement`)根本跑不到,皮肤就永远停在
 * 「这个英雄的默认皮肤」。所以皮肤得在**局中**补一次。
 *
 * 这个窗口只管「刚打完这一局」:上一局留下的结算不该在下一局里
 * 反复去问客户端。
 */
const SETTLEMENT_IN_GAME_WINDOW_MS = 10 * 60_000;
/**
 * 拿不到这一局编号时(事件流断了)判「是不是同一局」的窗口(毫秒)。
 *
 * 客户端的阶段会来回跳(PreEndOfGame → None → EndOfGame),
 * 两次结算落在几十秒内 —— 同一个英雄 + 这么短的间隔 = 同一局跳回来的。
 */
const SETTLEMENT_FLAP_WINDOW_MS = 60_000;

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
 * 从 gameflow 事件载荷里取这一局的编号(`gameData.gameId`)。
 *
 * 结算的去重键靠它 —— 同一局只弹一次,不管客户端的阶段跳了几回。
 * 没有就返回空串(调用方退到时间戳当键)。
 */
export function gameIdFromEvent(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const gameData = (data as Record<string, unknown>).gameData;
  if (typeof gameData !== 'object' || gameData === null) return '';
  const gameId = (gameData as Record<string, unknown>).gameId;
  if (typeof gameId === 'number' && Number.isFinite(gameId) && gameId > 0) return String(gameId);
  if (typeof gameId === 'string' && gameId.trim() !== '') return gameId.trim();
  return '';
}

/**
 * 从 gameflow 事件载荷里取「我」这条的英雄编号和皮肤线索。
 *
 * gameflow 用 `teamOwner: true` 标本地玩家那条 —— 这是最准的认法;
 * 认不到就退到 puuid 对上。
 *
 * 认不到「我」是谁的时候,英雄编号可以宽松地拿队伍里第一个带英雄编号的
 * —— 那可能是队友,但**只是界面上写错个名字**,比空着强。
 *
 * ⚠️ 皮肤**不宽松**:认错人就会把队友的皮肤当成自己的(见 `usedSkin.ts`)。
 *
 * ⚠️ 国服客户端的队伍条目**没有** `skinId`,给的是 `lastSelectedSkinIndex`
 * (皮肤序号)和 `selectedSkinId`(是 id 还是序号没实测)—— 换算成数字 id 的规则
 * 见 `usedSkin.ts` 的 `resolveSkinIndex` / `resolveSkinValue`。
 */
export function selfPlayerFromEvent(
  data: unknown,
  myPuuid = ''
): {
  championId: number;
  championVerified: boolean;
  /**
   * 队伍条目里「我」那条的英雄编号。
   *
   * 队伍条目里的皮肤线索跟它**成对** —— 拿别的英雄编号去换算那个序号,
   * 会算出一个不存在的皮肤 id。
   */
  selfChampionId: number;
  skinId: number;
  skinIndex: number;
  skinValue: number;
  selectionSkinIndex: number;
  selectionChampionId: number;
} {
  const self = parseGameflowSelf(data, myPuuid);
  const selection = parseGameflowSelection(data, myPuuid);
  // 英雄编号跟皮肤**同源**:认皮肤靠 `playerChampionSelections` 里 puuid 对上那条,
  // 英雄编号必须也从那条来 —— 拿队伍里第一个人的编号会把英雄写成队友的
  // (实测:皮肤认的是自己,结算标题却写着队友的英雄)。
  const fromSelection = selection.isSelf && selection.championId > 0;
  const fromSelf = self.isSelf && self.championId > 0;
  return {
    championId: fromSelection ? selection.championId : self.championId,
    championVerified: fromSelection || fromSelf,
    selfChampionId: self.championId,
    skinId: self.skinId,
    skinIndex: self.skinIndex,
    skinValue: self.skinValue,
    selectionSkinIndex: selection.skinIndex,
    selectionChampionId: selection.championId
  };
}

/**
 * 这个阶段里 gameData 是不是**当前这一局**的队伍信息。
 *
 * 大厅 / 空闲 / 选人这几个阶段,gameData 里留着的是**上一局**的残留 ——
 * 收了就会把上一局的皮肤算到这一局头上。只有「对局中」「等待结算」「对局结束」
 * 这几个阶段算数。
 */
function hasCurrentGameTeams(phase: string): boolean {
  const label = lcuPhaseLabel(phase);
  return label === '对局中' || label === '等待结算' || label === '对局结束';
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
  /**
   * 国服选人会话给的 `selectedSkinId` —— **是皮肤 id 还是皮肤序号没实测过**。
   *
   * 跟 {@link champSelectSkinChampionId} 成对记着:消歧要靠英雄编号,
   * 拿上一局的英雄编号去配这一局的值会算出一个根本不存在的皮肤。
   */
  private champSelectSkinValue = -1;
  /** 上面那个值所属的英雄编号 */
  private champSelectSkinChampionId = 0;
  private gameflowSkinId = 0;
  /**
   * 国服 gameflow 给的皮肤**序号**(不是皮肤 id);-1 = 没读到。
   *
   * 序号必须跟 {@link gameflowSkinChampionId} 成对记着 —— 换算皮肤 id 要用
   * 「英雄编号 × 1000 + 序号」,拿上一局的序号配上这一局的英雄编号会算出一个
   * 根本不存在的皮肤。
   */
  private gameflowSkinIndex = -1;
  /** 上面那个序号所属的英雄编号 */
  private gameflowSkinChampionId = 0;
  /**
   * 国服 gameflow 给的 `selectedSkinId` —— 是皮肤 id 还是皮肤序号没实测过;
   * -1 = 没读到。结算时拿皮肤清单消歧(见 usedSkin.ts 的 resolveSkinValue)。
   */
  private gameflowSkinValue = -1;
  /**
   * 国服 gameflow 的 `playerChampionSelections` 里「我」那条的皮肤序号。
   *
   * **国服最准的一条**(实测 10 个玩家全都有值,局末还读得到);
   * 队伍条目里的 `lastSelectedSkinIndex` 恒为 0,不能采信 ——
   * 采信它会把「默认皮肤」当成本局用的皮肤。
   */
  private gameflowSelectionSkinIndex = -1;
  /** 上面那个序号所属的英雄编号 —— 换算皮肤 id 要用,必须成对 */
  private gameflowSelectionChampionId = 0;
  private liveClientSkinName: string | null = null;
  /** 本局英雄编号(选人阶段 / gameflow 事件里记下) */
  private currentChampionId = 0;
  /**
   * 这个英雄编号**认得准不准**。
   *
   * gameflow 的队伍条目里没有 `teamOwner`,认「我」只能靠 puuid;
   * 认不出「我」时只能拿队伍里第一个带英雄编号的人 —— 那可能是队友,
   * 这种编号不能拿去写英雄名(会写成队友的英雄)。
   */
  private currentChampionVerified = false;
  /**
   * 认出来英雄编号时,那一局的编号(gameflow 的 `gameData.gameId`);空串 = 不知道。
   *
   * 用来判断「这个英雄编号是不是**当前这一局**的」——
   * 上一局认出来的编号会一直留着,这一局认不出「我」是谁时,
   * 拿它去写英雄名、去取默认皮肤,写上的就是上一局的英雄。
   */
  private championGameId = '';
  /**
   * 这个英雄编号是不是从**选人会话**里来的。
   *
   * 选人会话是本地玩家自己的会话 —— 认得准,而且就是**当前这一局**的
   * (选人完就进这一局)。所以它不受「上一局的编号还没清」的影响。
   */
  private championFromChampSelect = false;
  /**
   * 本局的编号(gameflow 的 `gameData.gameId`)。
   *
   * 结算的去重键靠它 —— 客户端的阶段是会来回跳的
   * (PreEndOfGame → None → EndOfGame),每跳一次就当「结束了一次」,
   * 同一局会弹两遍结算。用**这一局自己的编号**当键,跳多少次都是同一把键。
   *
   * 故意**不清**:局末之后 gameData 里还留着上一局的编号,
   * 留着才能认出「还是刚才那一局」。
   */
  private currentGameId = '';
  /**
   * 上一次结算之后,有没有进过「选人 / 对局中」。
   *
   * 用来分辨「同一局的阶段跳回来了」和「玩家又打完了一局」——
   * 前者不该再弹一次结算。
   */
  private sawGamePhaseSinceSettlement = false;
  /** 局末结算 */
  private settlement: LocalSettlement | null = null;
  /** 上次尝试补 match history 的时刻 */
  private settlementEnrichedAt = 0;
  /** 上次尝试从 gameflow 补皮肤的时刻(事件流漏了的时候兜底) */
  private settlementSkinTriedAt = 0;
  /**
   * 局中那次补皮肤的时间戳。
   *
   * 和 `settlementSkinTriedAt` **分开记** —— 两条路都可能先跑到,
   * 共用一个的话先跑的那条会把另一条挡掉 20 秒,皮肤就又停在默认皮肤上。
   */
  private settlementInGameSkinTriedAt = 0;
  /**
   * **局中**认出来的皮肤 —— 「我这局用的哪款皮肤」。
   *
   * ⚠ 为什么非得在局中记:结算画面上客户端往往已经把 gameflow 会话清掉了
   *    (选中记录没了)。这就是「时好时坏」的根因 —— 读结算那一刻的会话,
   *    早一秒晚一秒结果完全不同。局中读,那份数据一定在,皮肤也不会中途变。
   */
  private liveGameSkin: { gameId: string; championId: number; skinIndex: number } | null = null;
  /** 上次尝试在局中记皮肤的时刻 */
  private liveGameSkinTriedAt = 0;
  /**
   * 局中问客户端要来的 puuid。
   *
   * 快照里的召唤师是**大厅阶段**问到的 —— 应用是局中才打开的话就没有。
   * 认「我」全靠 puuid(国服队伍条目里没有 `teamOwner`),所以局中也得有一份。
   */
  private puuidCache = '';
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

  /**
   * 游戏客户端的原始阶段串(`None` / `Lobby` / `InProgress` / …)。
   *
   * <p>大厅的状态灯要用它 —— **复用这一份,不再另开一路读**。
   * `MatchState` 那四档表达不了「结算中」,所以这里给的是原始串。
   */
  getPhase(): string {
    return this.phase;
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
      const self = selfPlayerFromEvent(event.data, this.myPuuid());
      // 队伍信息是不是当前这一局的 —— 大厅/选人阶段 gameData 里还是上一局的人。
      const inGame = hasCurrentGameTeams(phase);
      // 这一局自己的编号 —— 结算的去重键靠它(阶段会来回跳,别按跳的次数算「结束了几次」)
      // ⚠️ 只在「确实在对局里」的阶段收 —— 大厅/选人阶段 gameData 还是上一局的残留,
      //    收错了会把下一局算成上一局(键一样 → 结算被当成重复的吃掉)。
      const gameId = gameIdFromEvent(event.data);
      if (inGame && gameId) this.currentGameId = gameId;
      // ⚠️ 英雄编号只在**确实在对局里**的阶段收 ——
      // 大厅 / 空闲 / 选人这几个阶段 gameData 里还是上一局的人,
      // 收了就等于拿上一局的英雄编号当这一局的(实测会写成队友的英雄)。
      // 选人阶段的英雄由选人会话给(见 recordChampSelect),那才是准的。
      if (
        inGame &&
        self.championId > 0 &&
        // 认不准的编号不许覆盖已经认准的(可能是队友的)
        (self.championVerified || !this.currentChampionVerified)
      ) {
        this.currentChampionId = self.championId;
        this.currentChampionVerified = self.championVerified;
        // 记下这是**哪一局**认出来的 —— 下一局认不出「我」时别拿它当这一局的
        this.championGameId = gameId;
        this.championFromChampSelect = false;
      }
      // gameflow 里的皮肤编号 —— 选人会话之外的第二条来源
      if (inGame && self.skinId > 0) this.gameflowSkinId = self.skinId;
      // 国服客户端给的是「皮肤序号」,不是皮肤 id —— 序号跟英雄编号**成对**记着,
      // 免得下一局换了英雄却拿上一局的序号去换算出一个不存在的皮肤。
      if (inGame && self.skinIndex >= 0 && self.selfChampionId > 0) {
        this.gameflowSkinIndex = self.skinIndex;
        this.gameflowSkinChampionId = self.selfChampionId;
      }
      // 国服客户端的 `selectedSkinId` —— 是 id 还是序号没实测,两个都记,
      // 结算时拿皮肤清单消歧。
      if (inGame && self.skinValue >= 0 && self.selfChampionId > 0) {
        this.gameflowSkinValue = self.skinValue;
        this.gameflowSkinChampionId = self.selfChampionId;
      }
      // 国服最准的一条:`playerChampionSelections` 里「我」那条的皮肤序号
      const hasSelection =
        inGame && self.selectionSkinIndex >= 0 && self.selectionChampionId > 0;
      if (hasSelection) {
        this.gameflowSelectionSkinIndex = self.selectionSkinIndex;
        this.gameflowSelectionChampionId = self.selectionChampionId;
      }
      // ⚠️ 顺序要紧:**阶段先处理,皮肤后记**。
      //    阶段跳回「对局中 / 选人」= 又开了一局,那一段会把上一局记的皮肤作废。
      //    皮肤先记的话,刚记下的**这一局**会被当成上一局的抹掉 ——
      //    抹掉的那一瞬间没有别的来源能补,皮肤就再也认不出来了(实测丢在这)。
      if (phase) this.onPhaseChange(phase);
      // 事件流里带了选中记录 —— 存进「这一局用的皮肤」的缓存。
      // 结束段那几秒里选中记录才冒出来,这一条比再去问一次客户端还快。
      if (hasSelection) {
        this.rememberLiveGameSkin(self.selectionChampionId, self.selectionSkinIndex, gameId);
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

  /**
   * 我的 puuid。
   *
   * 快照里有就直接用;没有(轮询器还没跑)就问一次客户端 ——
   * 「查的是不是自己」要靠它判断。
   */
  private async resolveMyPuuid(client: AxiosInstance): Promise<string> {
    const cached = this.snapshot.summoner?.puuid || this.puuidCache;
    if (cached) return cached;
    try {
      const summoner = await getMatchSummoner(client);
      this.puuidCache = summoner?.puuid ?? '';
      return this.puuidCache;
    } catch {
      return '';
    }
  }

  /**
   * 我的 puuid(同步版)。
   *
   * 队伍条目里认「我」那条用 —— `teamOwner` 认不到时靠 puuid 对上。
   *
   * 快照里的召唤师是**大厅阶段**问到的;应用是局中才打开的话快照里没有 ——
   * 这时候靠 {@link puuidCache}(局中问客户端要来的那一份)。
   */
  private myPuuid(): string {
    return this.snapshot.summoner?.puuid || this.puuidCache;
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
    // 「进了一局新的」—— 阶段跳回结束段时靠它区分「同一局跳回来了」和「又打完一局」。
    // 客户端的阶段会来回跳(PreEndOfGame → None → EndOfGame),
    // 真打一局必然经过选人/对局中 —— 没经过就不是新的一局。
    if (!isEnd && (phase === 'InProgress' || phase === 'ChampSelect')) {
      this.sawGamePhaseSinceSettlement = true;
      // 又开了一局 —— 上一局记下来的皮肤作废,别带进这一局。
      // ⚠️ 这一局的皮肤是**在这之后**才记的(顺序见 `handleWsEvent`),
      //    所以这里抹掉的确定是上一局的那份。
      this.liveGameSkin = null;
      this.liveGameSkinTriedAt = 0;
    }
    if (!isEnd) return;
    if (wasEnd) {
      // 阶段在结束段里又跳了一格(PreEndOfGame → EndOfGame)——
      // **选中记录恰恰是到 EndOfGame 才冒出来的**(实测),这一格最值钱,
      // 立刻再问一次,别等下一轮轮询。
      void this.resolveSettlementSkinFromGameflow(Date.now(), true);
      return;
    }
    this.createSettlement();
    // 结算刚出来,皮肤多半还没认出来 —— 立刻问一次客户端的 gameflow。
    // 不等下一轮轮询:局末那几秒客户端就把上一局的队伍信息清掉了,
    // 而且结算画面上 Live Client 还活着,常规的补齐段压根跑不到。
    void this.resolveSettlementSkinFromGameflow(Date.now(), true);
  }

  /** 四条候选合成一个结论 —— 优先级在 `usedSkin.ts` 里定死。 */
  private resolveSettlementSkin(): UsedSkin {
    // 局中记下来的皮肤 —— **最靠得住的一条**。
    // 结算那一刻客户端往往已经把 gameflow 会话清掉了,这时才去读就晚了
    // (读到的时好时坏)。局中记下来的这份一直在。
    const cached = this.liveGameSkinId();
    if (cached > 0) {
      return this.withChampionDefault(
        this.withChromaBase({
          riotSkinId: cached,
          displayName: this.liveClientSkinName,
          source: 'gameflow-selection'
        })
      );
    }
    const resolved = resolveUsedSkin({
      champSelectSkinId: this.champSelectSkinId,
      champSelectSkinValue: this.champSelectSkinValue >= 0 ? this.champSelectSkinValue : null,
      champSelectChampionId: this.champSelectSkinChampionId,
      gameflowSkinId: this.gameflowSkinId,
      gameflowSkinIndex: this.gameflowSkinIndex,
      gameflowSkinValue: this.gameflowSkinValue >= 0 ? this.gameflowSkinValue : null,
      gameflowChampionId: this.gameflowSkinChampionId,
      gameflowSelectionSkinIndex:
        this.gameflowSelectionSkinIndex >= 0 ? this.gameflowSelectionSkinIndex : null,
      gameflowSelectionChampionId: this.gameflowSelectionChampionId,
      liveClientSkinName: this.liveClientSkinName,
      knownSkinIds: (championId) => this.knownSkinIds(championId)
    });
    return this.withChampionDefault(this.withChromaBase(resolved));
  }

  /**
   * 这个英雄编号是不是**当前这一局**的。
   *
   * 上一局认出来的编号会一直留着 —— 这一局认不出「我」是谁时,
   * 拿它去写英雄名、去取默认皮肤,写上的就是**上一局的英雄**。
   * 认不准就别用。
   */
  private championBelongsToCurrentGame(): boolean {
    if (!this.currentChampionVerified) return false;
    // 选人阶段认的 —— 就是当前这一局
    if (this.championFromChampSelect) return true;
    // 两边都没有编号 —— 没得比,只能信它
    if (this.championGameId === '' || this.currentGameId === '') return true;
    return this.championGameId === this.currentGameId;
  }

  /**
   * 没认出具体哪款皮肤时,落到**这个英雄自己的默认皮肤**。
   *
   * 认不出来就什么都不给 → 玩家这一局完全没法打分。
   * 但落到同一个英雄的默认皮肤**不会打错人**(还是这个英雄的),
   * 玩家能接着评价 —— 分数记在默认皮肤上,界面上说明白。
   *
   * ⚠️ 只有英雄编号**认准了、而且是当前这一局的**才能这么退 ——
   * 认不准的编号可能是队友的,上一局的编号可能是上一局的,
   * 拿它去取默认皮肤就是给别人的皮肤打分。
   */
  private withChampionDefault(used: UsedSkin): UsedSkin {
    if (used.riotSkinId > 0) return used;
    if (!this.championBelongsToCurrentGame()) return used;
    const championId = this.currentChampionId;
    if (championId <= 0) return used;
    // 客户端的 id 空间:英雄编号 × 1000 + 序号,序号 0 就是默认皮肤。
    const defaultSkinId = championId * 1000;
    const known = this.knownSkinIds(championId);
    if (known.length > 0 && !known.includes(defaultSkinId)) return used;
    return { ...used, riotSkinId: defaultSkinId, source: 'champion-default' };
  }

  /**
   * 认出来的是**炫彩**时,补上它底图皮肤 id。
   *
   * 客户端把炫彩和普通皮肤排在同一个 id 空间里 —— 认到的 id 可能是炫彩
   * (国服实测序号 9 → 200009 =「战场BOSS 卑尔维斯 拒绝之尾」)。
   * 炫彩没有自己的立绘,游戏里显示的是底图那张图调了色,
   * 站内查不到这条炫彩时要退到底图那款皮肤。
   */
  private withChromaBase(used: UsedSkin): UsedSkin {
    if (!used.riotSkinId) return used;
    const base = this.staticData?.chromaBaseSkinIds.get(used.riotSkinId);
    if (!base) return used;
    const chromaName = this.staticData?.chromaNames.get(used.riotSkinId) ?? null;
    return { ...used, baseRiotSkinId: base, chromaName };
  }

  /**
   * 某个英雄的皮肤 id 清单(客户端的 skins.json 皮肤总目录)。
   *
   * 换算出来的皮肤 id 拿它一校验就知道对不对 —— 清单里没有就是认不出来。
   */
  private knownSkinIds(championId: number): number[] {
    if (!championId || championId <= 0) return [];
    return this.staticData?.skinsByChampion.get(championId) ?? [];
  }

  /**
   * 英雄名。
   *
   * **按英雄编号从静态数据里取**,不信 Live Client —— 国服客户端在局末会把
   * `activePlayer` 换成占位数据,那儿的英雄名是「解锁者」这种鬼话。
   */
  private championName(championId: number): string {
    if (championId <= 0) return '';
    return this.staticData?.champions.get(championId)?.name ?? '';
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
    if (usedSkin.source === 'champion-default') {
      // 只在「退到默认皮肤」时留一句 —— 排查「时好时坏」用
      console.log('[皮肤] 结算没认出具体皮肤 —— 局中没记到,退到英雄默认皮肤');
    }
    // 认不准 / 不是当前这一局的英雄编号 —— 一律当没有。
    const championBelongs = this.championBelongsToCurrentGame();
    const championId = championBelongs ? this.currentChampionId : 0;

    // 去重键:**这一局自己的编号**。
    // 客户端的阶段会来回跳(PreEndOfGame → None → EndOfGame),
    // 每跳一次都会走到这儿 —— 用时间戳当键的话同一局会弹两遍。
    const key = this.currentGameId
      ? `g${this.currentGameId}`
      : `${championId}-${usedSkin.riotSkinId}-${endedAt}`;

    // 同一局又跳回来了 —— **别重新生成一份**。
    // 皮肤候选在第一次结算后已经清空,再生成一次只会把「这局用的哪款皮肤」弄丢,
    // 界面上就变成「未识别到皮肤」。这次读到的皮肤并回原来那份就行。
    const prev = this.settlement;
    if (prev && prev.key === key) {
      // 已经那份还停在「没认出来」或「英雄默认皮肤」上,而这次认出来了 →
      // 换成真皮肤。默认皮肤是**兜底**,不是答案(见 `usedSkin.ts` 的口径)。
      const prevUsed = prev.usedSkin;
      const stillUnknown = prevUsed.riotSkinId === 0 || prevUsed.source === 'champion-default';
      if (usedSkin.riotSkinId > 0 && stillUnknown) {
        this.updateSettlement({ usedSkin });
      }
      this.resetSkinCandidates();
      return;
    }

    // 拿不到这一局编号时(事件流断了)退到「同英雄 + 没进过新的一局 + 短窗口」——
    // 阶段跳回结束段、但中间没经过选人/对局中 = 还是刚才那一局。
    if (
      prev &&
      !this.currentGameId &&
      !this.sawGamePhaseSinceSettlement &&
      prev.championId === championId &&
      endedAt - prev.endedAt < SETTLEMENT_FLAP_WINDOW_MS
    ) {
      this.resetSkinCandidates();
      return;
    }

    const settlement: LocalSettlement = {
      key,
      // 认不准 / 不是当前这一局的英雄编号 —— 一律清掉。
      // 留着会在结算标题上显示别人的英雄,还会拿它去取默认皮肤。
      championId,
      championVerified: championBelongs,
      // 英雄名只在**英雄编号认准了**的时候写 —— 认不准的编号可能是队友的,
      // 写上去就是在结算标题上显示别人的英雄。
      // 静态数据里的英雄名最准;它还没加载出来时才退到 Live Client 的名字
      // (局末那会儿 Live Client 给的可能是占位符,补齐段里会换成真名)。
      championName: championBelongs
        ? this.championName(this.currentChampionId) || live?.championName || ''
        : '',
      usedSkin,
      live: this.lastPlayerStats,
      match: null,
      endedAt
    };
    this.settlement = settlement;
    this.settlementEnrichedAt = 0;
    this.settlementSkinTriedAt = 0;
    this.settlementInGameSkinTriedAt = 0;
    this.sawGamePhaseSinceSettlement = false;
    this.emitSettlement(settlement);
    // 结算快照已经带走了这一局的皮肤 —— 候选作废,免得带进下一局。
    this.resetSkinCandidates();
  }

  /** 清掉本局的皮肤候选 —— 下一局重新攒。 */
  private resetSkinCandidates(): void {
    this.champSelectSkinId = 0;
    this.champSelectSkinValue = -1;
    this.champSelectSkinChampionId = 0;
    this.gameflowSkinId = 0;
    this.gameflowSkinIndex = -1;
    this.gameflowSkinChampionId = 0;
    this.gameflowSkinValue = -1;
    this.gameflowSelectionSkinIndex = -1;
    this.gameflowSelectionChampionId = 0;
    this.liveClientSkinName = null;
  }

  /** 改结算的某几项并发出去 —— 弹窗开着的时候让它刷新。 */
  private updateSettlement(patch: Partial<LocalSettlement>): void {
    const current = this.settlement;
    if (!current) return;
    const next: LocalSettlement = { ...current, ...patch };
    this.settlement = next;
    this.emitSettlement(next);
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
    if (champSelect.myChampionId > 0) {
      this.currentChampionId = champSelect.myChampionId;
      // 选人会话是**本地玩家自己**的会话 —— 英雄编号认得准。
      this.currentChampionVerified = true;
      // 选人阶段还不知道这一局的编号 —— 空串表示「就是当前这一局」
      this.championGameId = '';
      this.championFromChampSelect = true;
    }
    if (champSelect.mySkinId > 0) this.champSelectSkinId = champSelect.mySkinId;
    // 国服真正给的是 `selectedSkinId` —— 跟英雄编号成对记着,结算时消歧
    if (champSelect.mySelectedSkinId >= 0 && champSelect.myChampionId > 0) {
      this.champSelectSkinValue = champSelect.mySelectedSkinId;
      this.champSelectSkinChampionId = champSelect.myChampionId;
    }
  }

  /**
   * 结算的补齐段。
   *
   * 三件事,各自独立、缺了都不影响别的:
   *   1. **英雄名** —— 国服 Live Client 在局末给的英雄名是占位符(「解锁者」),
   *      按英雄编号从静态数据里取真名。
   *   2. **皮肤** —— 事件流漏掉 gameflow 那一次更新时,再问一次客户端补上。
   *   3. **胜负 / 时长 / 位置** —— match history 有落库延迟,过一会儿再查。
   */
  private async enrichSettlement(
    client: AxiosInstance,
    staticData: StaticData,
    puuid: string,
    now: number
  ): Promise<void> {
    const settlement = this.settlement;
    if (!settlement) return;

    // 1. 英雄名 —— 静态数据里的真名
    //    英雄编号没认准就不写 —— 认不准的编号可能是队友的。
    if (!settlement.championName && settlement.championId > 0 && settlement.championVerified) {
      const name = staticData.champions.get(settlement.championId)?.name ?? '';
      if (name) this.updateSettlement({ championName: name });
    }

    // 2. 炫彩的底图 —— 静态数据可能这会儿才加载好(游戏中途才打开应用),
    //    结算那一刻认皮肤的时候还拿不到「炫彩 → 底图」的映射,这里补一次。
    const withBase = this.withChromaBase(settlement.usedSkin);
    if (
      withBase.baseRiotSkinId !== settlement.usedSkin.baseRiotSkinId ||
      withBase.chromaName !== settlement.usedSkin.chromaName
    ) {
      this.updateSettlement({ usedSkin: withBase });
    }

    // 3. 皮肤 —— 事件流没读到的话,直接问一次客户端的 gameflow。
    //    「只认到英雄默认皮肤」也算没读到:默认皮肤是**兜底**,不是答案。
    const beforeSkin = this.settlement;
    if (
      beforeSkin &&
      (beforeSkin.usedSkin.riotSkinId === 0 || beforeSkin.usedSkin.source === 'champion-default')
    ) {
      // 别每 2 秒打一次端点(结算刚出来那会儿读勤一点 —— 选中记录就露那么几秒)
      if (now - this.settlementSkinTriedAt >= this.skinRetryInterval(now, SETTLEMENT_SKIN_RETRY_MS)) {
        this.settlementSkinTriedAt = now;
        await this.resolveSkinFromGameflow(client, puuid);
      }
    }

    // 3.5 还是没认出来 —— 退到这个英雄的默认皮肤(这一局总得能打分)
    const afterSkin = this.settlement;
    if (afterSkin && afterSkin.usedSkin.riotSkinId === 0) {
      const fallback = this.withChampionDefault(afterSkin.usedSkin);
      if (fallback.riotSkinId > 0) this.updateSettlement({ usedSkin: fallback });
    }

    // 3. match history 的战绩
    const current = this.settlement;
    if (!current || current.match) return;
    // 不知道英雄 —— 不猜是哪一局
    if (!current.championId) return;
    if (now - current.endedAt < SETTLEMENT_ENRICH_DELAY_MS) return;
    if (now - this.settlementEnrichedAt < SETTLEMENT_ENRICH_RETRY_MS) return;

    this.settlementEnrichedAt = now;
    try {
      // 用**结算自己的**英雄编号,不用当前的 —— 玩家可能已经排上下一局了。
      const found = await findJustFinishedMatch(client, staticData, puuid, current.championId, {
        now
      });
      if (!found) return;
      // 查的过程中结算可能被更新过(皮肤补上了)—— 以最新的那份为底
      const base = this.settlement;
      if (!base) return;
      const enriched: LocalSettlement = { ...base, match: toMatchScore(found.match) };
      // 结算时没认出皮肤的话,match history 里的 participant 可能给
      if (enriched.usedSkin.riotSkinId === 0 && found.skinId && found.skinId > 0) {
        // 皮肤 id 得是这个英雄的 —— 清单里没有就别认(认错了是给别人打分)
        const known = this.knownSkinIds(base.championId);
        if (known.length === 0 || known.includes(found.skinId)) {
          enriched.usedSkin = resolveUsedSkin({
            matchHistorySkinId: found.skinId,
            liveClientSkinName: enriched.usedSkin.displayName
          });
        }
      }
      this.settlement = enriched;
      this.emitSettlement(enriched);
    } catch {
      // 查不到就还是缺 —— 不编
    }
  }

  /**
   * 皮肤还没认出来时,直接问一次客户端的 gameflow。
   *
   * 事件流(WS)漏掉那一次更新的场合走这里 —— 客户端的会话里带着
   * `gameData.playerChampionSelections`,每条选中都带皮肤序号(国服实测)。
   *
   * ⚠️ **只认「选中记录」里的那一条**(`puuid` 对上的 `selectedSkinIndex`)。
   * 队伍条目里的皮肤线索**不可信**:国服实测 `lastSelectedSkinIndex`
   * 对 10 个玩家**全是 0**,采信它就是把「默认皮肤」当成本局用的皮肤。
   *
   * 严认「我」那条 —— 认错了就是给队友的皮肤打分。
   */
  /**
   * 现在该隔多久读一次客户端的会话。
   *
   * 选中记录只在**很短的一个窗口**里冒出来(结束段那几秒),
   * 平时 30 秒一轮够用,那个窗口里必须读勤一点 —— 否则必然错过。
   */
  private skinRetryInterval(now: number, normal: number): number {
    const settlement = this.settlement;
    // 结算刚出来 —— 皮肤最后出现的机会就在这会儿。
    if (settlement && now - settlement.endedAt < SETTLEMENT_SKIN_FAST_WINDOW_MS) {
      return SETTLEMENT_SKIN_FAST_RETRY_MS;
    }
    // 阶段已经进到结束段 —— 选中记录就是在这时候才出现的。
    if (isGameEndPhase(this.phase)) return SETTLEMENT_SKIN_FAST_RETRY_MS;
    return normal;
  }

  /**
   * **局中**读一次客户端的会话,把这局用的皮肤记下来。
   *
   * ⚠ 为什么非得在局中读:结算画面上客户端往往已经把 gameflow 会话清掉了
   *    (选中记录没了)—— 读结算那一刻的会话,早一秒晚一秒结果完全不同,
   *    这就是「时好时坏」的根因。局中读,那份数据一定在,皮肤也不会中途变。
   */
  private async captureInGameSkin(now: number): Promise<void> {
    // 认出来过就不用再读 —— 局中皮肤不会中途变
    if (this.liveGameSkin) return;
    // 别每 2 秒打一次端点(但结束段那会儿要读勤一点)
    if (now - this.liveGameSkinTriedAt < this.skinRetryInterval(now, IN_GAME_SKIN_RETRY_MS)) return;
    this.liveGameSkinTriedAt = now;
    let client: AxiosInstance;
    try {
      const auth = await this.ensureAuth();
      client = lcu.createLcuClient(auth);
    } catch {
      // 客户端连不上 —— 下次再试
      return;
    }
    const raw = await getGameflowSession(client);
    if (!raw) return;
    // 只在「确实跟这一局有关」的阶段记 —— 大厅/空闲时读到的是上一局的残留。
    //
    // ⚠️ **结束段(PreEndOfGame/EndOfGame)也要读**:选中记录恰恰是到
    //    `EndOfGame` 才冒出来的(实测 2026-11-21 的会话快照就是 EndOfGame
    //    才读到的),而且那个阶段只持续几秒 —— 错过了就只能退到默认皮肤。
    if (!hasCurrentGameTeams(phaseFromEvent(raw))) return;
    // 「我」是谁要靠 puuid(国服队伍条目里没有 teamOwner 标记)
    const puuid = this.myPuuid() || (await this.resolveMyPuuid(client));
    if (!puuid) return;
    const selection = parseGameflowSelection(raw, puuid);
    if (!selection.isSelf || selection.championId <= 0 || selection.skinIndex < 0) return;
    const gameId = gameIdFromEvent(raw);
    this.rememberLiveGameSkin(selection.championId, selection.skinIndex, gameId);
    // 英雄也一并记下 —— 选中记录里那条是**按 puuid 严认**出来的,
    // 跟队伍条目里「第一个带英雄编号的人」一样可靠。
    if (selection.championId > 0 && !this.currentChampionVerified) {
      this.currentChampionId = selection.championId;
      this.currentChampionVerified = true;
      this.championGameId = gameId;
      this.championFromChampSelect = false;
    }
  }

  /**
   * 记住「这一局用的皮肤」。
   *
   * 两条来源都走这里 —— 事件流里的选中记录、HTTP 读会话拿到的选中记录。
   * 先记到的算数;结算已经出来的话,顺手把它换上,不用等下一轮轮询。
   */
  private rememberLiveGameSkin(championId: number, skinIndex: number, gameId: string): void {
    if (championId <= 0 || skinIndex < 0) return;
    // 已经有了就别改 —— 局中的皮肤不会中途变。
    if (this.liveGameSkin) return;
    this.liveGameSkin = { gameId, championId, skinIndex };
    console.log(
      `[皮肤] 记到这一局用的皮肤: 英雄 ${championId} 皮肤序号 ${skinIndex} gameId ${gameId || '无'}`
    );
    // 结算已经退到默认皮肤了 —— 立刻换回来(这一刻正是皮肤最后出现的机会)。
    const settlement = this.settlement;
    if (settlement && settlement.usedSkin.source === 'champion-default') {
      this.applyLiveGameSkin(settlement);
    }
  }

  /**
   * 局中记下来的皮肤 → 皮肤 id(0 = 没记着 / 认不出来)。
   *
   * 不是**当前这一局**的 → 宁可不认 —— 认错了就是给别人的皮肤打分。
   */
  private liveGameSkinId(): number {
    const cached = this.liveGameSkin;
    if (!cached || cached.championId <= 0 || cached.skinIndex < 0) return 0;
    if (cached.gameId && this.currentGameId && cached.gameId !== this.currentGameId) return 0;
    return resolveSkinIndex(
      cached.championId,
      cached.skinIndex,
      this.knownSkinIds(cached.championId)
    );
  }

  /**
   * 把局中记下来的皮肤套到结算上 —— 认得出来就用它。
   *
   * 返回有没有套上。
   */
  private applyLiveGameSkin(settlement: LocalSettlement): boolean {
    const skinId = this.liveGameSkinId();
    if (skinId <= 0) return false;
    // 已经是这一款了 —— 别再发一遍(同一局的结算会被推好几次,
    // 每次都推一遍的话弹窗会被无谓地刷新)。
    if (
      settlement.usedSkin.riotSkinId === skinId &&
      settlement.usedSkin.source === 'gameflow-selection'
    ) {
      return true;
    }
    this.updateSettlement({
      usedSkin: this.withChromaBase({
        riotSkinId: skinId,
        displayName: settlement.usedSkin.displayName,
        source: 'gameflow-selection'
      })
    });
    return true;
  }

  private async resolveSkinFromGameflow(
    client: AxiosInstance,
    puuid: string
  ): Promise<void> {
    const settlement = this.settlement;
    if (!settlement) return;
    // 局中记下来的皮肤 —— 结算那一刻客户端往往已经把会话清掉了,
    // 这是最靠得住的一条,先看它。
    if (this.applyLiveGameSkin(settlement)) return;
    const raw = await getGameflowSession(client);
    if (!raw) return;
    const self = parseGameflowSelf(raw, puuid);
    const selection = parseGameflowSelection(raw, puuid);
    if (!self.isSelf && !selection.isSelf) return;
    const resolved = resolveUsedSkin({
      gameflowSkinId: self.skinId,
      // 队伍条目里的两条线索不采信(国服实测不可信)—— 见上面的说明
      gameflowSkinIndex: null,
      gameflowSkinValue: null,
      gameflowSelectionSkinIndex: selection.skinIndex,
      gameflowSelectionChampionId: selection.championId,
      liveClientSkinName: settlement.usedSkin.displayName,
      knownSkinIds: (championId) => this.knownSkinIds(championId)
    });
    const patch: Partial<LocalSettlement> = {};
    if (resolved.riotSkinId > 0) {
      patch.usedSkin = {
        ...this.withChromaBase(resolved),
        displayName: resolved.displayName ?? settlement.usedSkin.displayName
      };
    }
    // 英雄也一起补 —— 结算那一刻可能没认出来(应用是局中才打开的,
    // 或者事件流里只有队伍条目)。选中记录里的英雄编号是**按 puuid 严认**
    // 出来的,可以用。
    if (!settlement.championId && selection.championId > 0) {
      patch.championId = selection.championId;
      patch.championVerified = true;
      patch.championName = this.championName(selection.championId) || settlement.championName;
    }
    if (Object.keys(patch).length === 0) return;
    this.updateSettlement(patch);
  }

  /**
   * 结算的皮肤还没认出来时,问一次客户端的 gameflow 会话。
   *
   * 会话里带着 `playerChampionSelections`,每条选中都带皮肤序号(国服实测)。
   *
   * 三个调用点:
   *   - **结算刚生成时**(WS 事件)—— 立刻问一次,不等下一轮轮询;
   *   - **局中**(Live Client 还活着)—— 结算画面上补齐段跑不到,在这儿补;
   *   - **局末的常规补齐段** —— 老兜底。
   *
   * ⚠️ 为什么要单独做前两条:玩家还站在结算画面上的时候,2999(Live Client)
   * 还在,`collect()` 走的是 in_game 分支**直接 return** —— 挂在 LCU 分支上的
   * 补齐段(`enrichSettlement`)根本跑不到。皮肤就永远停在「英雄默认皮肤」。
   * 实测就丢在这:游戏里明明看得到皮肤,弹窗却写着「没认出具体哪款皮肤」。
   */
  private async resolveSettlementSkinFromGameflow(now: number, force: boolean): Promise<void> {
    const settlement = this.settlement;
    if (!settlement) return;
    const used = settlement.usedSkin;
    // 已经认出具体哪款皮肤了 —— 不用再问
    if (used.riotSkinId > 0 && used.source !== 'champion-default') return;
    if (!force) {
      // 只管刚打完这一局 —— 上一局留下的结算不该在下一局里反复问客户端
      if (now - settlement.endedAt > SETTLEMENT_IN_GAME_WINDOW_MS) return;
      // 别每 2 秒打一次端点。
      // ⚠️ 这条路和局末补齐段**各用各的时间戳** —— 共用一个的话,
      //    先跑的那条会把另一条挡掉 20 秒(实测就是这么丢的)。
      //
      // ⚠️ 结算刚出来那会儿要读**勤**一点:选中记录在结束段只露几秒,
      //    20 秒一轮必然错过那个窗口(实测「时好时坏」就是这么来的)。
      if (
        now - this.settlementInGameSkinTriedAt <
        this.skinRetryInterval(now, SETTLEMENT_SKIN_RETRY_MS)
      ) {
        return;
      }
      this.settlementInGameSkinTriedAt = now;
    }

    let client: AxiosInstance;
    try {
      const auth = await this.ensureAuth();
      client = lcu.createLcuClient(auth);
    } catch {
      // 客户端连不上 —— 常规补齐段会再试
      return;
    }
    // 皮肤清单(客户端自己的 skins.json)—— 换算皮肤 id、认炫彩底图都要它
    await this.ensureStaticData(client);
    // 「我」是谁要靠 puuid(国服队伍条目里没有 teamOwner 标记)
    const puuid = this.myPuuid() || (await this.resolveMyPuuid(client));
    await this.resolveSkinFromGameflow(client, puuid);
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
      // ⚠ 结算画面上 2999 还开着 —— 下面的 LCU 分支跑不到,补齐段也跟着跑不到。
      //    皮肤还没认出来时,在**局中**就直接问一次客户端的 gameflow。
      await this.resolveSettlementSkinFromGameflow(now, false);
      // 趁**局中**把这局用的皮肤记下来 —— 结算那一刻客户端往往已经把
      // 会话清掉了(选中记录没了),那时再读就晚了(读到的时好时坏)。
      await this.captureInGameSkin(now);
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
