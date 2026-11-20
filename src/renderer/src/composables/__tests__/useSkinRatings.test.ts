// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSkinRatings } from '../useSkinRatings';

const api = {
  fetchMyRatings: vi.fn()
};

function installApi(): void {
  (window as unknown as { api: unknown }).api = api;
}

const rating = (skinId: number, content: string | null = null) => ({
  skinId,
  handFeel: 5,
  artwork: 4,
  model: 3,
  mockery: 2,
  content
});

describe('useSkinRatings', () => {
  beforeEach(() => {
    installApi();
    api.fetchMyRatings.mockReset();
  });

  it('按站内皮肤 id 建索引', async () => {
    api.fetchMyRatings.mockResolvedValue([rating(42, '手感真好')]);

    const ratings = useSkinRatings();
    await ratings.load();

    expect(ratings.get(42)?.content).toBe('手感真好');
    expect(ratings.get(43)).toBeNull();
  });

  it('没登录时把错误留住,不炸', async () => {
    api.fetchMyRatings.mockRejectedValue(new Error('未登录:请先登录后再打分'));

    const ratings = useSkinRatings();
    await ratings.load();

    expect(ratings.error.value).toContain('未登录');
    expect(ratings.myRatings.value.size).toBe(0);
  });

  it('打完分立刻能查到 —— 卡片上的「已评」角标马上变', async () => {
    api.fetchMyRatings.mockResolvedValue([]);

    const ratings = useSkinRatings();
    await ratings.load();
    ratings.set(rating(42));

    expect(ratings.get(42)?.handFeel).toBe(5);
  });

  it('跳过没有皮肤 id 的记录', async () => {
    api.fetchMyRatings.mockResolvedValue([rating(0)]);

    const ratings = useSkinRatings();
    await ratings.load();

    expect(ratings.myRatings.value.size).toBe(0);
  });
});
