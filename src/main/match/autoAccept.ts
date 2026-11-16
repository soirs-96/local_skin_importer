import type { AxiosInstance } from 'axios';
import * as lcu from '../lcu';
import {
  countdownRemaining,
  decideAccept,
  findMyMember,
  DEFAULT_ACCEPT_DELAY_SECONDS,
  type AcceptAction,
  type AcceptProbe,
  type AcceptProbeMember,
  type AutoAcceptState,
  type AutoAcceptStatus
} from '../../shared/autoAccept';

/**
 * 自动接受对局。
 *
 * 自己跑一条轮询,而不是挂在对局助手的轮询器上 —— 用户可能一直待在
 * 「皮肤同步」页,自动接受照样得工作。
 *
 * 两种「接受」:
 *   - **匹配成功后的弹窗**(ready check):阶段是 `ReadyCheck`,点一下就进选人。
 *   - **选人阶段的确认**:阶段是 `ChampSelect`,得先锁定自己的英雄,
 *     否则客户端的确认按钮是灰的。
 *
 * 端点:不同客户端版本给的动作路径不完全一样,所以按候选顺序试,
 * **第一个 2xx 的记下来**,之后只用那一个 —— 不靠猜,靠实测。
 */

const POLL_INTERVAL_MS = 1000;
/** 凭据缓存时长 —— 客户端不动的时候不用反复去查进程命令行。 */
const AUTH_TTL_MS = 60_000;
/** 客户端没开时的重试间隔(查凭据要 spawn PowerShell,不能太勤)。 */
const AUTH_RETRY_MS = 10_000;
/** 两次「尝试接受」之间的最小间隔。 */
const ACCEPT_RETRY_MS = 2000;
/** 连续失败时的最长退避。 */
const MAX_BACKOFF_MS = 10_000;

const GAMEFLOW_PATH = '/lol-gameflow/v1/session';
const CHAMP_SELECT_PATH = '/lol-champ-select/v1/session';
const SUMMONER_PATH = '/lol-summoner/v1/current-summoner';

interface AcceptAttempt {
  method: 'post' | 'put';
  path: string;
  body?: unknown;
}

/**
 * ready check 的候选。
 *
 * 匹配成功后的「接受对局」弹窗走的是这个端点 ——
 * 实测(2026-11-16,国服客户端)路径确实存在(GET 回来 405「方法不对」)。
 */
const READY_CHECK_ATTEMPTS: AcceptAttempt[] = [
  { method: 'post', path: '/lol-matchmaking/v1/ready-check/accept' },
  { method: 'put', path: '/lol-matchmaking/v1/ready-check/accept' }
];

/**
 * 选人确认的候选。
 *
 * 实测(2026-11-16,国服客户端):`/lol-champ-select/v1/session/actions/accept`
 * 这个路径**确实存在** —— 用 GET 打过去返回 405「方法不对」,说明路由在,
 * 只是不收 GET。
 *
 * 方法是 POST 还是 PUT、body 长什么样,不同版本不一样。与其猜,不如挨个试:
 * 405 = 方法不对,400 = body 不对,404 = 路径不存在,2xx = 通了(记住它)。
 *
 * body 用客户端自己的动作 DTO 形状 —— 会话里带出来的那个动作最准,
 * 没有就按同样的字段拼一个。
 */
const CHAMP_SELECT_PATHS: string[] = [
  '/lol-champ-select/v1/session/actions/accept',
  '/lol-champ-select/v1/accept'
];

const CHAMP_SELECT_METHODS: Array<'post' | 'put'> = ['post', 'put'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 把异常变成一句能给人看的话。 */
function describeError(e: unknown): string {
  const summary = (e as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.length > 0) return summary;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 客户端重启过(端口/token 变了)?是的话把缓存的凭据丢掉。 */
function isStaleAuth(e: unknown): boolean {
  const err = e as { code?: string; response?: { status?: number } };
  if (err.response?.status === 401) return true;
  return err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
}

export class AutoAcceptService {
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;
  private ticking = false;

  private client: AxiosInstance | null = null;
  private authAt = 0;
  private authRetryAt = 0;
  private myPuuid = '';

  private phase = '';
  /** 上一轮的阶段 —— 变了就说明换了一局。 */
  private lastPhase = '';
  /** 已经接受过的阶段 —— 同一个阶段里不重复点。 */
  private acceptedPhase = '';
  /**
   * 实测用通的候选,之后只用它。
   *
   * **只记路径和方法,不记 body** —— body 里带着当局的英雄编号,
   * 记下来下一局就过期了。
   */
  private working: { kind: AcceptAction; path: string; method: 'post' | 'put' } | null = null;
  /** 会话里带出来的「接受」动作(有动作号就用动作号那条路)。 */
  private sessionAcceptAction: AcceptAttempt | null = null;
  /** 我在选人名单里的格位和英雄 —— 拼动作 DTO 要用。 */
  private myCellId = -1;
  private myChampionId = 0;
  private lastAttemptAt = 0;
  /** 连续失败的次数 —— 退避用,免得端点全不对时每秒打一串请求。 */
  private failedAttempts = 0;

  private status: AutoAcceptStatus = 'off';
  private acceptedCount = 0;
  private lastAcceptedAt: number | null = null;
  private lastError: string | null = null;
  private endpoint: string | null = null;
  private clientConnected = false;

  /** 接受前要等多久(秒)。 */
  private delaySeconds = DEFAULT_ACCEPT_DELAY_SECONDS;
  /** 倒计时起算时刻;null = 现在没在倒计时。 */
  private pendingAt: number | null = null;
  /** 倒计时是在等哪件事 —— 换了件事就得重新计时。 */
  private pendingAction: AcceptAction = 'none';
  /** 上一轮看到的自己的英雄编号 —— 变了说明改主意了,倒计时重开。 */
  private lastChampionId = 0;

  getState(): AutoAcceptState {
    return {
      enabled: this.enabled,
      status: this.status,
      acceptedCount: this.acceptedCount,
      lastAcceptedAt: this.lastAcceptedAt,
      lastError: this.lastError,
      phase: this.phase,
      endpoint: this.endpoint,
      clientConnected: this.clientConnected,
      delaySeconds: this.delaySeconds,
      pendingAt: this.pendingAt
    };
  }

  /** 改延时。倒计时中的话,剩余时间按新延时重算。 */
  setDelay(seconds: number): AutoAcceptState {
    this.delaySeconds = seconds;
    console.info('[自动接受] 延时改成 ' + seconds + ' 秒');
    return this.getState();
  }

  setEnabled(enabled: boolean): AutoAcceptState {
    this.enabled = enabled;
    if (enabled) {
      this.status = 'waiting';
      this.start();
      void this.tick();
    } else {
      this.status = 'off';
      this.pendingAt = null;
      this.pendingAction = 'none';
      this.stop();
    }
    console.info('[自动接受] ' + (enabled ? '已开启' : '已关闭'));
    return this.getState();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      const client = await this.ensureClient();
      if (!client) {
        this.clientConnected = false;
        if (this.status !== 'off') this.status = 'waiting';
        return;
      }
      this.clientConnected = true;

      const probe = await this.buildProbe(client);
      this.phase = probe.phase;

      // 阶段变了 —— 上一局接受过的事实就不作数了。
      if (probe.phase !== this.lastPhase) {
        this.acceptedPhase = '';
        this.lastPhase = probe.phase;
        this.pendingAt = null;
        this.pendingAction = 'none';
      }

      if (this.acceptedPhase && this.acceptedPhase === probe.phase) {
        this.status = 'accepted';
        return;
      }

      const action = decideAccept(probe);
      if (action === 'none') {
        this.pendingAt = null;
        this.pendingAction = 'none';
        this.status = 'waiting';
        return;
      }

      /**
       * 延时 —— 不给用户反应时间就太霸道了。
       * 换了件事(从弹窗变成选人)或者换了英雄,都重新计时。
       */
      if (this.pendingAction !== action) {
        this.pendingAction = action;
        this.pendingAt = Date.now();
      } else if (!this.pendingAt) {
        this.pendingAt = Date.now();
      }
      if (countdownRemaining(this.pendingAt, this.delaySeconds, Date.now()) > 0) {
        this.status = 'countdown';
        return;
      }

      await this.attemptAccept(client, action);
    } catch (e: unknown) {
      this.lastError = describeError(e);
      if (isStaleAuth(e)) {
        // 客户端重启过 —— 共享的那份凭据也作废,下一轮重新解析。
        this.client = null;
        this.authAt = 0;
        lcu.invalidateSharedLcuAuth();
      }
      if (this.status !== 'off') this.status = 'error';
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 拿一份「现在是什么情况」。
   *
   * gameflow 是主判据(阶段在那儿);选人会话是补充(谁是我、锁没锁英雄)。
   * gameflow 读不到但选人会话在,按选人阶段算 —— 宁可按实际看到的走。
   */
  private async buildProbe(client: AxiosInstance): Promise<AcceptProbe> {
    const phase = await this.readPhase(client);
    // 只在选人阶段(或者阶段读不到时)才去问选人会话 —— 大厅里每秒问一次
    // 一个必定 404 的端点,没必要。
    const session =
      phase === 'ChampSelect' || phase === '' ? await this.readChampSelect(client) : null;
    this.sessionAcceptAction = session ? pickSessionAcceptAction(session) : null;

    const myTeam: AcceptProbeMember[] = [];
    let localPlayerCellId = -1;
    if (session) {
      localPlayerCellId = num(session.localPlayerCellId, -1);
      const rawTeam = Array.isArray(session.myTeam) ? session.myTeam : [];
      for (const entry of rawTeam) {
        if (!isRecord(entry)) continue;
        myTeam.push({
          cellId: num(entry.cellId, -1),
          puuid: str(entry.puuid),
          championId: num(entry.championId)
        });
      }
    }

    if (!this.myPuuid) {
      this.myPuuid = await this.readMyPuuid(client);
    } else if (myTeam.length > 0 && !myTeam.some((m) => Boolean(m.puuid) && m.puuid === this.myPuuid)) {
      // 换账号了 —— 缓存的 puuid 不在名单里,重新取一次。
      this.myPuuid = await this.readMyPuuid(client);
    }

    // 我是几号格、选的谁 —— 拼动作 DTO 要用。
    const me = findMyMember({
      phase: '',
      localPlayerCellId,
      myPuuid: this.myPuuid,
      myTeam
    });
    this.myCellId = me?.cellId ?? -1;
    this.myChampionId = me?.championId ?? 0;

    // 换了英雄 = 改主意了 —— 倒计时重新开始,别拿着上一次的犹豫去接受。
    if (this.myChampionId !== this.lastChampionId) {
      this.lastChampionId = this.myChampionId;
      this.pendingAt = null;
    }

    return {
      phase: phase || (session ? 'ChampSelect' : ''),
      localPlayerCellId,
      myPuuid: this.myPuuid,
      myTeam
    };
  }

  private async readPhase(client: AxiosInstance): Promise<string> {
    try {
      const { data } = await client.get(GAMEFLOW_PATH, { timeout: 5000 });
      return isRecord(data) ? str(data.phase) : '';
    } catch {
      return '';
    }
  }

  private async readChampSelect(client: AxiosInstance): Promise<Record<string, unknown> | null> {
    try {
      const { data } = await client.get(CHAMP_SELECT_PATH, { timeout: 5000 });
      return isRecord(data) ? data : null;
    } catch {
      // 不在选人阶段时这个端点返回 404 —— 不是错误。
      return null;
    }
  }

  private async readMyPuuid(client: AxiosInstance): Promise<string> {
    try {
      const { data } = await client.get(SUMMONER_PATH, { timeout: 5000 });
      return isRecord(data) ? str(data.puuid) : '';
    } catch {
      return '';
    }
  }

  /**
   * 选人确认的候选。
   *
   * 会话里带出来的动作号最准(那是客户端自己给的动作),没有就按
   * 固定路径 × 方法挨个试。body 用客户端的动作 DTO 形状 ——
   * `actorCellId` / `championId` 填我自己的。
   */
  private champSelectAttempts(): AcceptAttempt[] {
    const body = {
      actorCellId: this.myCellId,
      championId: this.myChampionId,
      completed: true,
      isAllyAction: false,
      isInProgress: false,
      pickTurn: false,
      type: 'accept'
    };
    const out: AcceptAttempt[] = [];
    // 会话里带出来的动作号最准(那是客户端自己给的动作)—— 而且会话
    // 每轮都重读,不会拿到上一局的数据。
    if (this.sessionAcceptAction) {
      out.push({ ...this.sessionAcceptAction, method: 'put' });
      out.push({ ...this.sessionAcceptAction, method: 'post' });
    }
    // 上次用通的那个路径优先 —— 但 body 用当场的重拼。
    // 会话动作那条路不用在这儿重复试,上面刚试过(而且是新鲜的)。
    if (this.working && this.working.kind === 'champ-select' && !this.sessionAcceptAction) {
      out.push({ method: this.working.method, path: this.working.path, body });
    }
    for (const path of CHAMP_SELECT_PATHS) {
      for (const method of CHAMP_SELECT_METHODS) {
        out.push({ method, path, body });
      }
    }
    /**
     * 兜底:有的客户端把「接受对局」弹窗做在选人阶段里 —— 阶段是 ChampSelect,
     * 弹的却是 ready check 的窗。放最后试,通了就记住。
     */
    for (const attempt of READY_CHECK_ATTEMPTS) out.push(attempt);
    return out;
  }

  /**
   * 去点「接受」。
   *
   * 候选顺序:会话里带出来的动作号 → 上次用通的那个路径 → 写死的那几个。
   * 挨个试,谁先 2xx 算谁。
   */
  private async attemptAccept(client: AxiosInstance, action: AcceptAction): Promise<boolean> {
    // 连续失败就退避 —— 端点全不对的时候,别每秒往客户端打一串请求。
    const backoff = Math.min(ACCEPT_RETRY_MS * Math.max(1, this.failedAttempts), MAX_BACKOFF_MS);
    if (Date.now() - this.lastAttemptAt < backoff) return false;
    this.lastAttemptAt = Date.now();
    this.status = 'acting';

    const attempts: AcceptAttempt[] = [];
    if (action === 'champ-select') {
      attempts.push(...this.champSelectAttempts());
    } else {
      // ready check 没有 body,上次用通的那个直接复用。
      if (this.working && this.working.kind === action) {
        attempts.push({ method: this.working.method, path: this.working.path });
      }
      attempts.push(...READY_CHECK_ATTEMPTS);
    }

    for (const attempt of attempts) {
      if (await this.sendAccept(client, attempt)) {
        this.working = { kind: action, path: attempt.path, method: attempt.method };
        this.endpoint = attempt.path;
        this.acceptedCount += 1;
        this.lastAcceptedAt = Date.now();
        this.acceptedPhase = this.phase;
        this.pendingAt = null;
        this.pendingAction = 'none';
        this.lastError = null;
        this.failedAttempts = 0;
        this.status = 'accepted';
        console.info('[自动接受] 已接受 · ' + attempt.path);
        return true;
      }
    }

    this.failedAttempts += 1;
    this.lastError = '客户端拒绝了接受请求 —— 可能还没到能确认的时候,会自动重试';
    this.status = 'error';
    console.info('[自动接受] 没找到能用的接受端点');
    return false;
  }

  private async sendAccept(client: AxiosInstance, attempt: AcceptAttempt): Promise<boolean> {
    try {
      const res = await client.request({
        method: attempt.method,
        url: attempt.path,
        data: attempt.body,
        timeout: 5000
      });
      console.info(
        '[自动接受] ' + attempt.method.toUpperCase() + ' ' + attempt.path + ' → ' + res.status
      );
      return res.status >= 200 && res.status < 300;
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } }).response?.status;
      console.info(
        '[自动接受] ' +
          attempt.method.toUpperCase() +
          ' ' +
          attempt.path +
          ' → ' +
          (status ?? '失败(无响应码)')
      );
      return false;
    }
  }

  private async ensureClient(): Promise<AxiosInstance | null> {
    if (this.client && Date.now() - this.authAt < AUTH_TTL_MS) return this.client;
    if (Date.now() < this.authRetryAt) return null;
    try {
      // 别的模块(轮询器)已经解析过就借它的,省一次 spawn PowerShell。
      const shared = lcu.getSharedLcuAuth();
      const auth = shared ?? (await lcu.resolveLcuAuthAsync());
      this.client = lcu.createLcuClient(auth);
      this.authAt = Date.now();
      this.authRetryAt = 0;
      return this.client;
    } catch (e: unknown) {
      this.client = null;
      this.authRetryAt = Date.now() + AUTH_RETRY_MS;
      this.lastError = describeError(e);
      return null;
    }
  }
}

/**
 * 会话里带出来的「接受」动作。
 *
 * 有些客户端会在 `actions` 里给这个动作一个动作号,按动作号那条路更准。
 */
function pickSessionAcceptAction(session: Record<string, unknown>): AcceptAttempt | null {
  const actions = Array.isArray(session.actions) ? session.actions : [];
  for (const entry of actions) {
    if (!isRecord(entry)) continue;
    const type = str(entry.type).toLowerCase();
    if (!type.includes('accept')) continue;
    const id = num(entry.id, -1);
    if (id < 0) continue;
    return {
      method: 'post',
      path: `/lol-champ-select/v1/session/actions/${id}`,
      body: { ...entry, completed: true }
    };
  }
  return null;
}

/** 进程内单例 —— 自动接受全局只该有一份。 */
export const autoAcceptService = new AutoAcceptService();
