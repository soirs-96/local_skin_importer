import { describe, expect, it, vi } from 'vitest';
import { parseLobbyPrefs } from '../prefs';

// prefs.ts 顶部 import 了 electron —— 得先 mock 掉,
// 否则 node_modules 里那个 electron 包不是真 Electron,导不出 app。
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => process.cwd()) }
}));

describe('parseLobbyPrefs', () => {
  it('空内容 → 默认公开', () => {
    expect(parseLobbyPrefs('')).toEqual({ publicVisible: true });
  });

  it('坏 JSON → 默认公开', () => {
    expect(parseLobbyPrefs('{ 这不是 JSON')).toEqual({ publicVisible: true });
  });

  it('显式关了就是不公开', () => {
    expect(parseLobbyPrefs('{"publicVisible":false}')).toEqual({ publicVisible: false });
  });

  it('字段类型不对 → 退回默认', () => {
    expect(parseLobbyPrefs('{"publicVisible":"no"}')).toEqual({ publicVisible: true });
  });

  it('缺字段 → 默认公开', () => {
    expect(parseLobbyPrefs('{}')).toEqual({ publicVisible: true });
  });
});
