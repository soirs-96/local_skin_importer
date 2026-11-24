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
  private readonly baseUrl: string;
  private readonly createSocket: LobbySocketFactory;
  private readonly onFrame: (frame: LobbyServerFrame) => void;
  private readonly onStatus?: (status: LobbyClientStatus) => void;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: LobbyClientOptions) {
    this.resolveToken = options.resolveToken;
    this.baseUrl = options.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
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

    const url = `${this.baseUrl}/api/ws/lobby?token=${encodeURIComponent(token)}`;
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
