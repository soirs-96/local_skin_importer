import { describe, expect, it, vi } from 'vitest';
import { LobbyClient, type LobbySocket } from '../client';
import type { LobbyClientFrame } from '../../../shared/lobby';

/** 假 socket —— 跟 `src/main/match/__tests__/poller.test.ts` 一个路子。 */
function fakeSocket(): LobbySocket & { sent: string[]; handlers: Map<string, (...a: unknown[]) => void> } {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const sent: string[] = [];
  return {
    sent,
    handlers,
    send(data: string) {
      sent.push(data);
    },
    close() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler);
    }
  };
}

function frameOf(sent: string[]): LobbyClientFrame[] {
  return sent.map((s) => JSON.parse(s) as LobbyClientFrame);
}

describe('LobbyClient', () => {
  it('连上以后先发 hello', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt-1',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    await vi.waitFor(() => expect(socket.sent.length).toBe(1));
    // phase 初始是空串 —— **不猜**。游戏客户端的阶段由 service 拿到后
    // 用 profile 帧补上来(空 = 未知,按不可拉处理)。
    expect(frameOf(socket.sent)[0]).toEqual({ type: 'hello', phase: '', public: true });
  });

  it('token 拼进查询串', async () => {
    const socket = fakeSocket();
    let url = '';
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt-1',
      createSocket: (u) => {
        url = u;
        return socket;
      },
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(url).not.toBe(''));
    expect(url).toContain('/api/ws/lobby');
    expect(url).toContain('token=jwt-1');
  });

  it('收到服务端帧就交给 onFrame', async () => {
    const socket = fakeSocket();
    const frames: unknown[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: (f) => frames.push(f)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    socket.handlers.get('message')?.(JSON.stringify({ type: 'pong' }));
    expect(frames).toEqual([{ type: 'pong' }]);
  });

  it('坏 JSON 不炸 —— 直接丢掉', async () => {
    const socket = fakeSocket();
    const frames: unknown[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: (f) => frames.push(f)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    socket.handlers.get('message')?.('{ 不是 JSON');
    expect(frames).toHaveLength(0);
  });

  it('握手被拒(401/403)→ 状态 unauthorized,不再重连', async () => {
    const socket = fakeSocket();
    const statuses: string[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {},
      onStatus: (s) => statuses.push(s)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('error')).toBe(true));
    socket.handlers.get('error')?.(new Error('Unexpected server response: 401'));
    expect(statuses).toContain('unauthorized');
    client.stop();
  });

  it('说一句话就是一条 say 帧', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    client.say('来两把');
    const frames = frameOf(socket.sent);
    expect(frames[frames.length - 1]).toEqual({ type: 'say', text: '来两把' });
  });

  it('正文超长先截断 —— 不把超长内容发到线上', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    client.say('一'.repeat(200));
    const frames = frameOf(socket.sent);
    const say = frames[frames.length - 1] as { type: string; text: string };
    expect(say.text).toHaveLength(64);
  });
});
