import { describe, expect, it, vi } from 'vitest';
import { buildInviteCandidates, invitePlayer, type LcuInviteClient } from '../invite';

// invite.ts 用了 electron 的剪贴板,还 import 了 ../lcu(它自己也摸 electron)
// —— 都得先 mock 掉,否则 node_modules 里那个 electron 包导不出这些东西。
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  app: { getPath: vi.fn(() => process.cwd()) }
}));

function fakeClient(): LcuInviteClient {
  return {
    get: async () => ({ data: {} }),
    post: async () => ({})
  };
}

describe('buildInviteCandidates', () => {
  it('候选路由按优先级排 —— 新的在前', () => {
    const candidates = buildInviteCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].path).toContain('/lol-lobby/');
  });
});

describe('invitePlayer', () => {
  it('没有游戏ID就退化成复制', async () => {
    const result = await invitePlayer('林俊杰', '', async () => fakeClient());
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('copied');
  });

  it('游戏客户端没开 → 降级复制,不抛异常', async () => {
    const result = await invitePlayer('林俊杰', '18557', async () => {
      throw new Error('客户端没开');
    });
    expect(result.mode).toBe('copied');
    expect(result.message).toContain('18557');
  });

  it('搜不到这个人 → 降级复制', async () => {
    const result = await invitePlayer('林俊杰', '18557', async () => ({
      get: async () => ({ data: {} }),
      post: async () => ({})
    }));
    expect(result.mode).toBe('copied');
    expect(result.message).toContain('18557');
  });
});
