/**
 * 开黑大厅的主进程编排。
 *
 * <p>职责:
 * <ul>
 *   <li>持有 WS 客户端,应用一启动就连(退到托盘也保持连接)</li>
 *   <li>把游戏阶段的变化推给服务端(`profile` 帧)</li>
 *   <li>WS 连不上时退化成 HTTP 轮询,大厅仍然能用</li>
 *   <li>把状态变化推给渲染进程</li>
 * </ul>
 */

import { BrowserWindow } from 'electron';
import { getStoredToken } from '../auth';
import { matchPoller } from '../match/poller';
import { fetchLobbyHistory, fetchLobbyPlayers, normalizeSnapshot } from './api';
import { LobbyClient } from './client';
import { invitePlayer } from './invite';
import { readLobbyPrefs, writeLobbyPrefs } from './prefs';
import {
  LOBBY_EVENT_CHANNEL,
  LOBBY_HISTORY_LIMIT,
  appendMessages,
  mergeMessages,
  type LobbyInviteResult,
  type LobbyMessage,
  type LobbyServerFrame,
  type LobbyState
} from '../../shared/lobby';

const BACKEND_BASE_URL = 'http://101.34.210.254';

/**
 * WS 的备用入口 —— 跟 REST 分开。
 *
 * <p>同一个后端在 nginx 上有两个入口:IP(101.34.210.254)和域名(www.sxdtaz.cn),
 * 是两套 server 块。IP 那套没开 WebSocket 的 Upgrade 转发时,后端收到的是普通 GET,
 * Spring 的握手检查直接回 400("Unexpected server response: 400")。
 * 域名那套是 chat 小程序一直在用的(`wss://www.sxdtaz.cn/api/ws/chat`),通着。
 *
 * <p>所以两个都写上,客户端握手失败会自己换 —— 不用等运维改 nginx 配置。
 */
const LOBBY_WS_FALLBACK_URLS = ['https://www.sxdtaz.cn'];

/** 降级轮询:列表 3 秒一次,聊天 2 秒一次。 */
const POLL_PLAYERS_MS = 3_000;
const POLL_HISTORY_MS = 2_000;

/** 多久问一次「游戏客户端的阶段变没变」。 */
const PHASE_POLL_MS = 2_000;

/** 多久看一眼「token 换了没」。 */
const TOKEN_CHECK_MS = 15_000;

export class LobbyService {
  private client: LobbyClient | null = null;
  private state: LobbyState;
  private playersTimer: NodeJS.Timeout | null = null;
  private historyTimer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private tokenTimer: NodeJS.Timeout | null = null;
  private lastPhase = '';
  /** 握手被拒时用的那个 token —— 换了就说明用户重新登录了,该重连。 */
  private failedToken: string | null = null;
  /**
   * 上次连不上是不是因为「还没登录」。
   *
   * <p>首次启动时用户还没兑换同步码,大厅连不上是正常的。等用户登录完,
   * 退避计时器最长要 30 秒才轮到下一次重试 —— 那一段大厅是空的。
   * 记住这个状态,登录完立刻重连。
   */
  private waitingForLogin = false;

  constructor() {
    const prefs = readLobbyPrefs();
    this.state = {
      status: 'disconnected',
      degraded: false,
      publicVisible: prefs.publicVisible,
      snapshot: null,
      messages: [],
      error: null
    };
  }

  getState(): LobbyState {
    return this.state;
  }

  /** 应用启动就调。 */
  start(): void {
    if (this.client) return;
    this.client = new LobbyClient({
      resolveToken: async () => {
        const token = getStoredToken();
        if (!token) {
          this.waitingForLogin = true;
          throw new Error('未登录');
        }
        this.waitingForLogin = false;
        return token;
      },
      baseUrl: BACKEND_BASE_URL,
      fallbackBaseUrls: LOBBY_WS_FALLBACK_URLS,
      onFrame: (frame) => this.handleFrame(frame),
      onStatus: (status) => this.handleStatus(status)
    });
    // 先把「当前阶段 + 公开开关」塞给客户端,再让它连。
    // `sendProfile` 在没有 socket 时不会发出去,但**会记住这两个值**——
    // 客户端连上以后的第一帧 hello 就带着它们。
    // 不这么做的后果:用户把「公开我的信息」关掉了,第一次 hello 报的还是
    // 默认的 public=true → 他明明关了开关却还是出现在别人列表里。
    this.client.sendProfile(this.lastPhase, this.state.publicVisible);
    this.client.start();

    // 阶段每 2 秒看一眼,变了就推一帧 profile。
    // ⚠️ 不用自己去探测游戏客户端 —— `src/main/index.ts` 启动时已经调过
    // `matchPoller.start()`,凭据和阶段都是轮询器自己在维护。
    // 这里再探一遍等于每 30 秒白跑一次 spawn PowerShell 的检测。
    if (!this.phaseTimer) {
      this.phaseTimer = setInterval(() => this.syncPhase(), PHASE_POLL_MS);
      this.phaseTimer.unref?.();
    }
    // 握手被拒之后客户端就停了 —— 靠这个盯着 token,换了自动重连。
    if (!this.tokenTimer) {
      this.tokenTimer = setInterval(() => this.checkTokenChange(), TOKEN_CHECK_MS);
      this.tokenTimer.unref?.();
    }
  }

  /** 应用退出时调。 */
  stop(): void {
    this.client?.stop();
    this.client = null;
    for (const timer of [this.playersTimer, this.historyTimer, this.phaseTimer, this.tokenTimer]) {
      if (timer) clearInterval(timer);
    }
    this.playersTimer = null;
    this.historyTimer = null;
    this.phaseTimer = null;
    this.tokenTimer = null;
  }

  // ---- 公开开关 ----------------------------------------------------------

  setPublicVisible(publicVisible: boolean): LobbyState {
    writeLobbyPrefs({ publicVisible });
    this.state = { ...this.state, publicVisible };
    // 立刻告诉服务端 —— 不然要等到下次心跳
    this.client?.sendProfile(this.lastPhase, publicVisible);
    this.push();
    return this.state;
  }

  // ---- 发言 --------------------------------------------------------------

  say(text: string): { ok: boolean; message?: string } {
    if (this.state.status === 'unauthorized') {
      return { ok: false, message: '登录已过期,去重新兑换同步码' };
    }
    if (!this.client) {
      return { ok: false, message: '大厅还没连上,等一会儿再试' };
    }
    if (this.state.degraded) {
      return { ok: false, message: '现在是轮询降级模式,发不了消息 —— 等 WS 连回来' };
    }
    this.client.say(text);
    return { ok: true };
  }

  /** 拉一个人进房间。 */
  async invite(nickname: string, gameId: string): Promise<LobbyInviteResult> {
    return await invitePlayer(nickname, gameId);
  }

  /**
   * 登录成功了 —— 立刻重连。
   *
   * <p>两种情况都归这里管:
   * <ul>
   *   <li>首次启动时还没兑换同步码,大厅连不上是正常的 —— 这会儿退避计时器
   *       已经退到 30 秒,用户登录完还得干等一轮;</li>
   *   <li>token 过期被拒之后重新登录,换了新 token。</li>
   * </ul>
   * 登录是个明确的信号,直接把连接重开一次,不等计时器。
   */
  onLogin(): void {
    this.checkTokenChange();
  }

  /**
   * 退出登录了 —— 断开大厅连接。
   *
   * <p>不清的话人还挂在大厅在线名单里(服务端那边连接还在),
   * 而且用的是已经作废的 token —— 服务端一旦开始校验就会把他踢掉,
   * 表现成「自己在大厅里,别人看不见他,他也看不见别人」。
   *
   * <p>同时把 {@code waitingForLogin} 置上 —— 下次登录时
   * {@link #onLogin()} 会把连接重新连起来。
   */
  onLogout(): void {
    this.failedToken = null;
    this.waitingForLogin = true;
    this.client?.stop();
    this.stopPolling();
  }

  // ---- 内部 --------------------------------------------------------------

  /** 阶段变了就推一帧 `profile`。 */
  private syncPhase(): void {
    const phase = matchPoller.getPhase();
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.client?.sendProfile(phase, this.state.publicVisible);
  }

  /**
   * token 换了就重连。
   *
   * <p>握手被拒之后 WS 客户端就停了(重连也没用,token 还是不认)。
   * 用户重新登录之后 token 会变 —— 这时候把旧的客户端扔掉重开一个,
   * **不用让他重启整个应用**。
   */
  private checkTokenChange(): void {
    // 刚才是因为没登录才连不上的 —— 现在有 token 了就马上重连。
    // 不走这条的话,退避计时器最长 30 秒才轮到下一次,那段大厅是空的。
    if (this.waitingForLogin) {
      if (!getStoredToken()) return;
      if (!this.client) return;
      this.waitingForLogin = false;
      this.reconnect();
      return;
    }
    if (this.state.status !== 'unauthorized') return;
    const token = getStoredToken();
    if (!token || token === this.failedToken) return;
    if (!this.client) return;
    this.failedToken = null;
    this.reconnect();
  }

  /** 把当前连接扔掉重开一个。服务已经停了就不动 —— 别把它又拉起来。 */
  private reconnect(): void {
    if (!this.client) return;
    this.client.stop();
    this.client = null;
    this.start();
  }

  private handleStatus(status: LobbyState['status']): void {
    const unauthorized = status === 'unauthorized';
    if (unauthorized) {
      this.failedToken = getStoredToken();
    }
    this.state = {
      ...this.state,
      status,
      // 只要没连上就算降级 —— 连不上的时候走的确实是轮询那条路,
      // 界面上得说实话
      degraded: status !== 'connected',
      error: unauthorized ? '登录已过期,去重新兑换同步码' : null
    };
    if (status === 'connected') {
      this.stopPolling();
    } else if (unauthorized) {
      // token 不认的时候 REST 一样进不去 —— 再轮询只是白刷一串 401。
      this.stopPolling();
    } else {
      this.startPolling();
    }
    this.push();
  }

  private handleFrame(frame: LobbyServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.state = {
          ...this.state,
          // 跟 REST 走同一个整理函数 —— WS 和 REST 的数据形状必须一模一样,
          // 否则「WS 正常、降级就崩」这种问题最难查。
          snapshot: normalizeSnapshot({
            online: frame.online,
            offline: frame.offline,
            stats: frame.stats,
            me: frame.me
          }),
          messages: mergeMessages(this.state.messages, frame.history ?? [])
        };
        break;
      }
      case 'chat': {
        const message: LobbyMessage = {
          id: frame.id,
          userId: frame.userId,
          nickname: frame.nickname,
          gameId: frame.gameId,
          zone: frame.zone,
          text: frame.text,
          createdAt: frame.createdAt
        };
        this.state = { ...this.state, messages: appendMessages(this.state.messages, message) };
        break;
      }
      case 'presence': {
        const snapshot = this.state.snapshot;
        // presence 帧只带 online 和 stats —— 离线候选和「我」保留上一份
        if (snapshot) {
          this.state = {
            ...this.state,
            snapshot: normalizeSnapshot({
              online: frame.online,
              offline: snapshot.offline,
              stats: frame.stats,
              me: snapshot.me
            })
          };
        }
        break;
      }
      case 'error': {
        this.state = { ...this.state, error: frame.reason || frame.code };
        break;
      }
      case 'pong':
      default:
        return;
    }
    this.push();
  }

  // ---- 降级轮询 ----------------------------------------------------------

  private startPolling(): void {
    if (this.playersTimer) return;
    const pollPlayers = async (): Promise<void> => {
      try {
        const snapshot = await fetchLobbyPlayers();
        this.state = {
          ...this.state,
          snapshot,
          error: null
        };
        this.push();
      } catch (e: unknown) {
        // 鉴权失败时别用「拉取失败」盖掉「登录已过期」—— 那条更准。
        if (this.state.status === 'unauthorized') return;
        this.state = {
          ...this.state,
          error: (e as { message?: string }).message ?? '拉取大厅列表失败'
        };
        this.push();
      }
    };
    const pollHistory = async (): Promise<void> => {
      try {
        const messages = await fetchLobbyHistory(LOBBY_HISTORY_LIMIT);
        this.state = { ...this.state, messages: mergeMessages(this.state.messages, messages) };
        this.push();
      } catch {
        // 历史拉不到不影响列表 —— 下一轮再试
      }
    };
    this.playersTimer = setInterval(() => void pollPlayers(), POLL_PLAYERS_MS);
    this.historyTimer = setInterval(() => void pollHistory(), POLL_HISTORY_MS);
    this.playersTimer.unref?.();
    this.historyTimer.unref?.();
    void pollPlayers();
    void pollHistory();
  }

  private stopPolling(): void {
    if (this.playersTimer) {
      clearInterval(this.playersTimer);
      this.playersTimer = null;
    }
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
  }

  // ---- 推给渲染进程 ------------------------------------------------------

  private push(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(LOBBY_EVENT_CHANNEL, this.state);
    }
  }
}

export const lobbyService = new LobbyService();
