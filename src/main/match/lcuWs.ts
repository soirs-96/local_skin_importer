/**
 * LCU WebSocket 通道。
 *
 * 干两件事:
 *
 * 1. **事件加速** —— 客户端状态(进对局 / 进选人 / 回大厅)一变,立刻推一条
 *    事件过来,不用干等下一轮 2 秒轮询。Python 版靠 lcu-driver 做这件事,
 *    这边没有现成库,按 WAMP v1 协议自己连。
 * 2. **段位兜底** —— 新版客户端把 `/lol-ranked/*` 那几个 REST 端点删了,
 *    段位只能从事件流里捞。Python 版这路是死代码(写了但没人调用),
 *    这里是真接上的。
 *
 * 协议是 WAMP v1:
 *   - 握手走普通 HTTP Upgrade,认证头 `Authorization: Basic base64("riot:" + token)`;
 *   - 订阅用 SUBSCRIBE(opcode 5),topic 写 `OnJsonApiEvent` 就是**全量事件流**;
 *   - 客户端推过来的消息形如 `[8, "OnJsonApiEvent", { uri, eventType, data }]`。
 *
 * 客户端是自签名证书,所以 `rejectUnauthorized` 关掉 —— 通道本身靠
 * 「随机端口 + 一次性 token」保密,证书只是本机回环。
 */

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import type { LcuWsStatus, RankedEntry } from '../../shared/match';
import { parseRankedEntries } from './ranked';

export interface LcuWsEvent {
  uri: string;
  eventType: string;
  data: unknown;
}

/**
 * 只声明用得到的三个方法的最小 socket 抽象。
 *
 * 这么写有两个好处:测试可以塞假 socket 进去,不用真的开一条 TLS 连接;
 * 代码也不必依赖 `ws` 的类型声明(`ws` 是运行期依赖,类型只在本文件里自给自足)。
 */
export interface LcuWsSocket {
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface LcuWsConnectOptions {
  headers: Record<string, string>;
  rejectUnauthorized: boolean;
}

export type LcuWsSocketFactory = (url: string, options: LcuWsConnectOptions) => LcuWsSocket;

export interface LcuWsClientOptions {
  /**
   * 取 LCU 凭据。**每次重连都要重新取** —— 客户端重启会换端口和 token,
   * 用旧凭据连上去只会一直失败。
   */
  resolveAuth: () => Promise<{ port: number; token: string }>;
  /** 造 socket 的口子,测试用假实现顶掉 */
  createSocket?: LcuWsSocketFactory;
  onEvent?: (event: LcuWsEvent) => void;
  onStatus?: (status: LcuWsStatus) => void;
  /** 握手被拒(401/403)时回调,让上层把缓存的凭据作废 */
  onAuthRejected?: () => void;
  /** 首次重连延迟(ms) */
  baseBackoffMs?: number;
  /** 重连延迟上限(ms) */
  maxBackoffMs?: number;
}

const SUBSCRIBE_TOPIC = 'OnJsonApiEvent';
const WAMP_SUBSCRIBE = 5;
const WAMP_EVENT = 8;

/**
 * 会影响界面状态的 URI 前缀。
 *
 * 段位的 URI 一并算进去:段位变了也值得立刻刷新一次卡片。
 */
const ACCELERATED_URI_PREFIXES = [
  '/lol-gameflow/v1/session',
  '/lol-champ-select/v1/session',
  '/lol-summoner/v1/current-summoner'
];

export function buildAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`riot:${token}`).toString('base64')}`;
}

/** 订阅全量事件流的消息体。 */
export function buildSubscribeMessage(): string {
  return JSON.stringify([WAMP_SUBSCRIBE, SUBSCRIBE_TOPIC]);
}

/** 把一条 WAMP 消息解成事件;不是事件(心跳、ack 之类)返回 null。 */
export function parseWampEvent(raw: unknown): LcuWsEvent | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  if (raw[0] !== WAMP_EVENT) return null;
  const payload = raw[2];
  if (typeof payload !== 'object' || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const uri = typeof rec.uri === 'string' ? rec.uri : '';
  if (!uri) return null;
  return {
    uri,
    eventType: typeof rec.eventType === 'string' ? rec.eventType : '',
    data: rec.data
  };
}

/** 这条事件是不是段位相关的。 */
export function isRankedEvent(event: LcuWsEvent): boolean {
  return event.uri.includes('/lol-ranked');
}

/** 这条事件值不值得立刻去采一次。 */
export function isAcceleratedEvent(event: LcuWsEvent): boolean {
  if (isRankedEvent(event)) return true;
  return ACCELERATED_URI_PREFIXES.some((prefix) => event.uri.startsWith(prefix));
}

/**
 * 从事件里刨出段位条目。
 *
 * 段位事件的载荷形状不统一:有的是队列数组,有的是 `{ queues: [...] }`,
 * 还有的裹了一层 `{ data: ... }`。所以依次试,试到有东西为止。
 */
export function extractRankedEntriesFromEvent(event: LcuWsEvent): RankedEntry[] {
  const direct = parseRankedEntries(event.data);
  if (direct.length > 0) return direct;
  if (typeof event.data === 'object' && event.data !== null) {
    const nested = (event.data as Record<string, unknown>).data;
    const inner = parseRankedEntries(nested);
    if (inner.length > 0) return inner;
  }
  return [];
}

function defaultSocketFactory(url: string, options: LcuWsConnectOptions): LcuWsSocket {
  // `ws` 是运行期依赖,类型在本文件里自给自足,不值得为它单独装一份类型声明。
  //
  // 走 createRequire 而不是裸 `require()`:tsconfig 是 module: ESNext,
  // 裸 require() 会被判成「这里本可以用 import」而报错;走 createRequire 之后
  // 它只是个普通函数调用,既不报错,也不会被构建工具改写。
  // 放在函数里是因为 import.meta.url 在打包产物里才指向最终的文件位置。
  const nodeRequire = createRequire(import.meta.url);
  const ws = nodeRequire('ws') as { WebSocket: new (u: string, o: unknown) => unknown };
  return new ws.WebSocket(url, {
    headers: options.headers,
    rejectUnauthorized: options.rejectUnauthorized
  }) as LcuWsSocket;
}

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  }
  return '';
}

export class LcuWsClient {
  private socket: LcuWsSocket | null = null;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private status: LcuWsStatus = 'disconnected';
  private authRejected = false;
  private backoffMs: number;

  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly resolveAuth: () => Promise<{ port: number; token: string }>;
  private readonly createSocket: LcuWsSocketFactory;
  private readonly onEvent?: (event: LcuWsEvent) => void;
  private readonly onStatus?: (status: LcuWsStatus) => void;
  private readonly onAuthRejected?: () => void;

  constructor(options: LcuWsClientOptions) {
    this.resolveAuth = options.resolveAuth;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
    this.onAuthRejected = options.onAuthRejected;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.baseBackoffMs;
  }

  getStatus(): LcuWsStatus {
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
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // 已经断了,关不上也无所谓
      }
    }
    this.setStatus('disconnected');
  }

  private setStatus(status: LcuWsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  /** 断线后退避重连:1s → 2s → 4s …… 到上限就按上限来。 */
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

    let auth: { port: number; token: string };
    try {
      auth = await this.resolveAuth();
    } catch {
      // 客户端没开 —— 凭据解析失败不是致命伤,退避后重试
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    this.authRejected = false;
    const url = `wss://127.0.0.1:${auth.port}/`;
    const options: LcuWsConnectOptions = {
      headers: { Authorization: buildAuthHeader(auth.token) },
      rejectUnauthorized: false
    };

    let socket: LcuWsSocket;
    try {
      socket = this.createSocket(url, options);
    } catch (e: unknown) {
      console.warn('[lcuWs] 建立连接失败', e);
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      this.backoffMs = this.baseBackoffMs;
      this.setStatus('connected');
      this.subscribe(socket);
    });
    socket.on('message', (raw: unknown) => {
      this.handleMessage(raw);
    });
    socket.on('error', (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      // 401/403 = 凭据过期(客户端重启换了 token),上层要作废缓存重取
      if (/40[13]|unauthorized|forbidden/i.test(text)) {
        this.authRejected = true;
      }
      console.warn('[lcuWs] 连接报错', text);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.setStatus('disconnected');
      if (this.authRejected) this.onAuthRejected?.();
      this.scheduleReconnect();
    });
  }

  private subscribe(socket: LcuWsSocket): void {
    try {
      socket.send(buildSubscribeMessage());
    } catch (e: unknown) {
      console.warn('[lcuWs] 订阅失败', e);
    }
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
    const event = parseWampEvent(parsed);
    if (!event) return;
    this.onEvent?.(event);
  }
}
