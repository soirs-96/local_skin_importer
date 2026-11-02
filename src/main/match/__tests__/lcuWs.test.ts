import { describe, expect, it, vi, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  LcuWsClient,
  buildAuthHeader,
  buildSubscribeMessage,
  extractRankedEntriesFromEvent,
  isAcceleratedEvent,
  isRankedEvent,
  parseWampEvent,
  type LcuWsEvent,
  type LcuWsSocket
} from '../lcuWs';
import type { LcuWsStatus } from '../../../shared/match';

/**
 * 假 socket:只实现协议层用得到的三个方法,不开真的 TLS 连接。
 */
class FakeSocket implements LcuWsSocket {
  sent: string[] = [];
  closed = false;
  private handlers = new Map<string, (...args: unknown[]) => void>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.set(event, handler);
  }

  fire(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * 假时钟下把挂起的 await 链跑完。
 *
 * connect() 里 `await resolveAuth()` 之后才建 socket,推进 0ms 会把微任务队列
 * 跑空,连着推进两次是为了保险 —— 队列里的 promise 一层层 resolve,一次未必够。
 */
const flushFake = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('协议编码', () => {
  it('认证头是 riot:token 的 basic 编码', () => {
    const header = buildAuthHeader('tok');
    expect(header.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('riot:tok');
  });

  it('订阅消息是 WAMP 的 SUBSCRIBE', () => {
    expect(buildSubscribeMessage()).toBe('[5,"OnJsonApiEvent"]');
  });
});

describe('parseWampEvent', () => {
  it('解出事件里的 uri / eventType / data', () => {
    const event = parseWampEvent([
      8,
      'OnJsonApiEvent',
      { uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'ChampSelect' } }
    ]);
    expect(event?.uri).toBe('/lol-gameflow/v1/session');
    expect(event?.eventType).toBe('Update');
    expect(event?.data).toEqual({ phase: 'ChampSelect' });
  });

  it('不是事件的消息返回 null', () => {
    expect(parseWampEvent([1, 'OnJsonApiEvent', {}])).toBeNull();
    expect(parseWampEvent('hello')).toBeNull();
    expect(parseWampEvent(null)).toBeNull();
  });

  it('没有 uri 的载荷不算事件', () => {
    expect(parseWampEvent([8, 'OnJsonApiEvent', { eventType: 'Update' }])).toBeNull();
  });
});

describe('事件分类', () => {
  it('段位事件认 /lol-ranked 开头', () => {
    expect(isRankedEvent({ uri: '/lol-ranked/v1/current-ranked-stats', eventType: '', data: null }))
      .toBe(true);
    expect(isRankedEvent({ uri: '/lol-gameflow/v1/session', eventType: '', data: null })).toBe(false);
  });

  it('状态类事件才值得立刻采一次', () => {
    expect(isAcceleratedEvent({ uri: '/lol-gameflow/v1/session', eventType: '', data: null })).toBe(
      true
    );
    expect(isAcceleratedEvent({ uri: '/lol-champ-select/v1/session', eventType: '', data: null })).toBe(
      true
    );
    expect(isAcceleratedEvent({ uri: '/lol-summoner/v1/current-summoner', eventType: '', data: null }))
      .toBe(true);
    expect(isAcceleratedEvent({ uri: '/lol-ranked/v1/current-ranked-stats', eventType: '', data: null }))
      .toBe(true);
    expect(isAcceleratedEvent({ uri: '/lol-champions/v1/champions', eventType: '', data: null })).toBe(
      false
    );
  });
});

describe('extractRankedEntriesFromEvent', () => {
  it('队列数组形状', () => {
    const entries = extractRankedEntriesFromEvent({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', wins: 3, losses: 1 }]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].display).toBe('荣耀黄金 II');
  });

  it('queues 包装形状', () => {
    const entries = extractRankedEntriesFromEvent({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'PLATINUM', division: 'IV' }] }
    });
    expect(entries[0].queueType).toBe('RANKED_FLEX_SR');
  });

  it('再裹一层 data 也能刨出来', () => {
    const entries = extractRankedEntriesFromEvent({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: { data: { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND' }] } }
    });
    expect(entries[0].tier).toBe('DIAMOND');
  });

  it('没有段位形状就返回空数组', () => {
    const entries = extractRankedEntriesFromEvent({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: { somethingElse: 1 }
    });
    expect(entries).toEqual([]);
  });
});

describe('LcuWsClient', () => {
  it('连上之后订阅全量事件流', async () => {
    const socket = new FakeSocket();
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => socket
    });

    client.start();
    await flush();
    expect(client.getStatus()).toBe('connecting');

    socket.fire('open');
    expect(client.getStatus()).toBe('connected');
    expect(socket.sent).toEqual(['[5,"OnJsonApiEvent"]']);

    client.stop();
    expect(socket.closed).toBe(true);
    expect(client.getStatus()).toBe('disconnected');
  });

  it('收到的消息解成事件交给上层', async () => {
    const socket = new FakeSocket();
    const events: LcuWsEvent[] = [];
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => socket,
      onEvent: (event) => events.push(event)
    });

    client.start();
    await flush();
    socket.fire('open');
    socket.fire(
      'message',
      JSON.stringify([
        8,
        'OnJsonApiEvent',
        { uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'InProgress' } }
      ])
    );

    expect(events).toHaveLength(1);
    expect(events[0].uri).toBe('/lol-gameflow/v1/session');

    client.stop();
  });

  it('坏消息直接丢掉,不带崩连接', async () => {
    const socket = new FakeSocket();
    const events: LcuWsEvent[] = [];
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => socket,
      onEvent: (event) => events.push(event)
    });

    client.start();
    await flush();
    socket.fire('open');
    socket.fire('message', 'not json');
    socket.fire('message', JSON.stringify([1, 'OnJsonApiEvent', {}]));

    expect(events).toEqual([]);
    expect(client.getStatus()).toBe('connected');

    client.stop();
  });

  it('断线之后按 1s / 2s 退避重连', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      baseBackoffMs: 1000,
      maxBackoffMs: 8000
    });

    client.start();
    await flushFake();
    expect(sockets).toHaveLength(1);

    sockets[0].fire('close');
    expect(client.getStatus()).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushFake();
    expect(sockets).toHaveLength(2);

    sockets[1].fire('close');
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushFake();
    expect(sockets).toHaveLength(3);

    client.stop();
  });

  it('握手被拒时通知上层作废凭据', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    let rejected = 0;
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => socket,
      onAuthRejected: () => {
        rejected += 1;
      }
    });

    client.start();
    await flushFake();
    socket.fire('error', new Error('Unexpected server response: 401'));
    socket.fire('close');

    expect(rejected).toBe(1);

    client.stop();
  });

  it('客户端没开时不抛错,退避后接着试', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = new LcuWsClient({
      resolveAuth: async () => {
        calls += 1;
        throw new Error('客户端没开');
      },
      createSocket: () => new FakeSocket(),
      baseBackoffMs: 1000
    });

    client.start();
    await flushFake();
    expect(calls).toBe(1);
    expect(client.getStatus()).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(1000);
    await flushFake();
    expect(calls).toBe(2);

    client.stop();
  });

  it('状态变化会通知上层', async () => {
    const socket = new FakeSocket();
    const statuses: LcuWsStatus[] = [];
    const client = new LcuWsClient({
      resolveAuth: async () => ({ port: 1234, token: 'tok' }),
      createSocket: () => socket,
      onStatus: (status) => statuses.push(status)
    });

    client.start();
    await flush();
    socket.fire('open');
    socket.fire('close');

    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);

    client.stop();
  });
});
