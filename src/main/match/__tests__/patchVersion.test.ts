import { describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import { FALLBACK_PATCH, normalizePatch, patchCandidates } from '../patchVersion';

describe('normalizePatch', () => {
  it('腾讯客户端的分支版本串归一化成 X.Y.1', () => {
    expect(
      normalizePatch('16.18.8165012+branch.releases-16-18.code.publictencent.content.release')
    ).toBe('16.18.1');
  });

  it('官方客户端的版本号原样保留', () => {
    expect(normalizePatch('15.1.1')).toBe('15.1.1');
  });

  it('认不出来就用兜底版本', () => {
    expect(normalizePatch(null)).toBe(FALLBACK_PATCH);
    expect(normalizePatch('')).toBe(FALLBACK_PATCH);
    expect(normalizePatch('not-a-version')).toBe(FALLBACK_PATCH);
  });
});

describe('patchCandidates', () => {
  it('没有客户端时只给兜底版本', async () => {
    expect(await patchCandidates()).toEqual([FALLBACK_PATCH]);
  });

  it('客户端报的版本排最前面,后面跟着上一个小版本和兜底版本', async () => {
    const client = {
      get: async (path: string) => {
        if (path === '/lol-patch/v1/game-version') return { data: '16.18.8165012+branch.x' };
        throw new Error('not found');
      }
    } as unknown as AxiosInstance;
    const candidates = await patchCandidates(client);
    expect(candidates[0]).toBe('16.18.1');
    expect(candidates).toContain('16.17.1');
    expect(candidates[candidates.length - 1]).toBe(FALLBACK_PATCH);
  });
});
