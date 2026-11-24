/**
 * 开黑大厅的 WebSocket 客户端。
 *
 * <p>跟 `src/main/match/lcuWs.ts` 一个路子:把 socket 造法做成可注入的口子,
 * 测试塞假 socket 进去,不用真开一条连接;代码也不必依赖 `ws` 的类型声明。
 */

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { LOBBY_TEXT_MAX_LEN, type LobbyClientFrame, type LobbyClientStatus, type LobbyServerFrame } from '../../shared/lobby';

/** 只声明用得到的三个方法的最小 socket 抽象。 */
export interface LobbySocket {
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export type LobbySocketFactory = (url: string) => LobbySocket;

export interface LobbyClientOptions {
  /** 取桌面 token。每次重连都要重新取 —— token 过期了得换。 */
  resolveToken: () => Promise<string>;
  /** 后端地址;ws:// + 后端根地址 + 路径 */
  baseUrl: string;
  /**
   * 备用后端地址 —— 主地址握手失败就按顺序换。
   *
   * <p>为什么需要:同一个后端在 nginx 上有两个入口(IP 和域名),
   * 两套 server 块。IP 那套不一定开了 WebSocket 的 Upgrade 转发 ——
   * nginx 不转的话后端收到的是普通 GET,Spring 的握手检查直接回 400。
   * 域名那套是 chat 小程序一直在用的,通着。**谁先通用谁**,别让大厅卡死在降级模式。
   */
  fallbackBaseUrls?: string[];
  /** 造 socket 的口子,测试用假实现顶掉 */
  createSocket?: LobbySocketFactory;
  onFrame: (frame: LobbyServerFrame) => void;
  onStatus?: (status: LobbyClientStatus) => void;
  /** 首次重连延迟(ms) */
  baseBackoffMs?: number;
  /** 重连延迟上限(ms) */
  maxBackoffMs?: number;
}

/** 心跳间隔 —— 后端 60 秒没收到帧就断开,所以必须比它短。 */
export const LOBBY_HEARTBEAT_MS = 20_000;

function defaultSocketFactory(url: string): LobbySocket {
  const nodeRequire = createRequire(import.meta.url);
  const ws = nodeRequire('ws') as { WebSocket: new (u: string) => unknown };
  return new ws.WebSocket(url) as LobbySocket;
}

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  }
  return '';
}

/**
 * 握手失败的响应正文。
 *
 * <p>nginx 的错误页会直接写明原因("400 Request Header Or Cookie Too Large"、
 * "The plain HTTP request was sent to HTTPS port" 之类),
 * Spring 的 400 正文是空的 —— 正文空 + 状态码 400 = 请求到了后端但不是一次协议升级。
 *
 * <p>只读前 500 字节:错误页再大也不会超过这个量,读多了是给自己找麻烦。
 */
async function readErrorBody(res: unknown): Promise<string> {
  const stream = res as {
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
    setEncoding?: (encoding: string) => void;
  };
  if (!stream || typeof stream.on !== 'function') return '';
  return await new Promise<string>((resolve) => {
    let buf = '';
    const done = (): void => resolve(buf.trim());
    stream.on?.('data', (chunk: unknown) => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : '';
      buf += text;
      if (buf.length > 500) buf = buf.slice(0, 500);
    });
    stream.on?.('end', done);
    stream.on?.('error', done);
    stream.on?.('close', done);
  });
}

export class LobbyClient {
  private socket: LobbySocket | null = null;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private status: LobbyClientStatus = 'disconnected';
  private backoffMs: number;
  private phase = '';
  private publicVisible = true;

  private readonly resolveToken: () => Promise<string>;
  /** 后端入口列表 —— 第一个是主入口,后面是备的。 */
  private readonly baseUrls: string[];
  /** 当前轮到第几个入口。 */
  private hostIndex = 0;
  private readonly createSocket: LobbySocketFactory;
  private readonly onFrame: (frame: LobbyServerFrame) => void;
  private readonly onStatus?: (status: LobbyClientStatus) => void;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: LobbyClientOptions) {
    this.resolveToken = options.resolveToken;
    this.baseUrls = [options.baseUrl, ...(options.fallbackBaseUrls ?? [])].map((u) =>
      u.replace(/^http/, 'ws').replace(/\/$/, '')
    );
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.onFrame = options.onFrame;
    this.onStatus = options.onStatus;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.baseBackoffMs;
  }

  getStatus(): LobbyClientStatus {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // 已经断了
      }
    }
    this.setStatus('disconnected');
  }

  /** 首次 hello —— 上报当前阶段和公开开关。 */
  sendHello(phase: string, publicVisible: boolean): void {
    this.phase = phase;
    this.publicVisible = publicVisible;
    this.send({ type: 'hello', phase, public: publicVisible });
  }

  /** 状态变了 —— 阶段变了或者公开开关变了。 */
  sendProfile(phase: string, publicVisible: boolean): void {
    this.phase = phase;
    this.publicVisible = publicVisible;
    this.send({ type: 'profile', phase, public: publicVisible });
  }

  /** 说一句话。超长先截断 —— 后端也会截,但本地截一次少传一次。 */
  say(text: string): void {
    const trimmed = text.trim().slice(0, LOBBY_TEXT_MAX_LEN);
    if (!trimmed) return;
    this.send({ type: 'say', text: trimmed });
  }

  private setStatus(status: LobbyClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private send(frame: LobbyClientFrame): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch (e: unknown) {
      console.warn('[lobby] 发送失败', e);
    }
  }

  /** 退避重连:1s → 2s → 4s …… 到上限就按上限来。 */
  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus('connecting');

    let token: string;
    try {
      token = await this.resolveToken();
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${this.baseUrls[this.hostIndex]}/api/ws/lobby?token=${encodeURIComponent(token)}`;
    let socket: LobbySocket;
    try {
      socket = this.createSocket(url);
    } catch (e: unknown) {
      console.warn('[lobby] 建立连接失败', e);
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      this.backoffMs = this.baseBackoffMs;
      this.setStatus('connected');
      this.startHeartbeat();
      this.sendHello(this.phase, this.publicVisible);
    });
    socket.on('message', (raw: unknown) => {
      this.handleMessage(raw);
    });
    // 一次连接只换一次入口 —— 'error' 和 'unexpected-response' 会连着来,
    // 不加这道闸会一连退到最后一个入口。
    let switched = false;
    const switchHost = (): void => {
      if (switched) return;
      switched = true;
      if (this.baseUrls.length <= 1) return;
      this.hostIndex = (this.hostIndex + 1) % this.baseUrls.length;
      console.warn(`[lobby] 换用下一个入口 ${this.baseUrls[this.hostIndex]}`);
    };

    socket.on('error', (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (/40[13]|unauthorized|forbidden/i.test(text)) {
        // 握手被拒 —— 重连也没用,得让用户重新登录。
        // 401 和 403 都当「token 不认」:后端那边 Spring 会把 401 盖成 403,
        // 反正大厅只有一种鉴权方式,握手失败就是没登录。
        this.setStatus('unauthorized');
        this.stopHeartbeat();
        this.stopped = true;
        return;
      }
      console.warn('[lobby] 连接报错', text);
      switchHost();
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    /**
     * 服务端没给 101(协议升级成功)—— 这条分支比 'error' 有用得多。
     *
     * <p>没有这个监听的话,ws 只会甩一句 "Unexpected server response: 400",
     * 看不出是 nginx 没转 Upgrade 头、是 token 不认、还是路径不对。
     * 这里把状态码和响应正文都打出来 —— nginx 的错误页会直接写明原因。
     */
    socket.on('unexpected-response', (_req: unknown, res: unknown) => {
      const status = (res as { statusCode?: number }).statusCode ?? 0;
      const server = (res as { headers?: Record<string, unknown> }).headers?.['server'];
      // 状态码和响应头是同步拿到的,先打出来 —— 正文可能读不全
      // (ws 会在这个监听返回后把请求销毁掉)。
      console.warn(`[lobby] 握手被拒 status=${status}${server ? ` server=${server}` : ''}`);
      void readErrorBody(res).then((body) => {
        if (body) console.warn(`[lobby] 握手响应正文 ${body}`);
      });
      if (status === 401 || status === 403) {
        this.setStatus('unauthorized');
        this.stopHeartbeat();
        this.stopped = true;
        return;
      }
      // 400 = 请求到了后端但不是一次协议升级(多半是 nginx 没转 Upgrade 头)——
      // 换个入口再试。
      switchHost();
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.stopHeartbeat();
      if (this.stopped) return;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: unknown): void {
    const text = toText(raw);
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as LobbyServerFrame;
    if (typeof frame.type !== 'string') return;
    this.onFrame(frame);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ type: 'ping' });
    }, LOBBY_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
