import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchMyRating, fetchMyRatings, fetchSkinRatingStats, submitSkinRating } from '../rating';
import { getStoredToken } from '../auth';

vi.mock('axios');
vi.mock('../auth', () => ({
  getStoredToken: vi.fn(() => 'desktop-token'),
  clearStoredToken: vi.fn()
}));

const tokenMock = vi.mocked(getStoredToken);

function page(records: Record<string, unknown>[]): { data: unknown } {
  return {
    data: { code: 200, data: { current: 1, size: 10, total: records.length, pages: 1, records } }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.mockReturnValue('desktop-token');
});

describe('fetchSkinRatingStats', () => {
  it('把后端的一条聚合评分映射出来', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([
        {
          skinId: 42,
          skinName: '黑暗之女',
          skinIconUrl: 'https://x/i.jpg',
          skinSplashUrl: 'https://x/s.jpg',
          rarity: '传说',
          totalCount: 12,
          avgScore: 8.4,
          avgHandFeel: 8,
          avgArtwork: 9,
          avgModel: 8.5,
          avgMockery: 7
        }
      ])
    );

    const stats = await fetchSkinRatingStats(42);

    expect(stats?.skinId).toBe(42);
    expect(stats?.totalCount).toBe(12);
    expect(stats?.avgScore).toBe(8.4);
    expect(stats?.iconUrl).toBe('https://x/i.jpg');
  });

  it('带 Authorization —— 桌面端 token 不带会被拦成 403', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));

    await fetchSkinRatingStats(42);

    const options = vi.mocked(axios.get).mock.calls[0][1] as
      | { headers?: Record<string, string>; params?: Record<string, unknown> }
      | undefined;
    expect(options?.headers?.Authorization).toBe('Bearer desktop-token');
    expect(options?.params?.skinIds).toBe('42');
  });

  it('后端没给数据时返回 null', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));
    await expect(fetchSkinRatingStats(42)).resolves.toBeNull();
  });
});

describe('fetchMyRating', () => {
  it('查到我打过的分(连评价文字一起)', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([{ handFeel: 5, artwork: 4, model: 3, mockery: 2, content: '手感真好' }])
    );

    const mine = await fetchMyRating(42, 7);

    expect(mine).toEqual({
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2,
      content: '手感真好'
    });
  });

  it('没写评价 → content 是 null', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([{ handFeel: 5, artwork: 4, model: 3, mockery: 2, content: '' }])
    );

    const mine = await fetchMyRating(42, 7);

    expect(mine?.content).toBeNull();
  });

  it('没打过 → null', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));
    await expect(fetchMyRating(42, 7)).resolves.toBeNull();
  });
});

describe('fetchMyRatings', () => {
  it('maps every rating I gave', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([
        { skinId: 42, handFeel: 5, artwork: 4, model: 3, mockery: 2, content: '手感真好' },
        { skinId: 43, handFeel: 3, artwork: 3, model: 3, mockery: 1, content: '' }
      ])
    );

    const list = await fetchMyRatings(7);

    expect(list).toHaveLength(2);
    expect(list[0].skinId).toBe(42);
    expect(list[0].content).toBe('手感真好');
    // 空文字按「没写」处理,不是空串
    expect(list[1].content).toBeNull();
  });

  it('asks for my own ratings with the desktop token', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));

    await fetchMyRatings(7);

    const options = vi.mocked(axios.get).mock.calls[0][1] as
      | { headers?: Record<string, string>; params?: Record<string, unknown> }
      | undefined;
    expect(options?.headers?.Authorization).toBe('Bearer desktop-token');
    expect(options?.params?.userId).toBe(7);
  });
});

describe('submitSkinRating', () => {
  it('POST 四个维度,再拉一次聚合评分', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 200, data: {} } });
    vi.mocked(axios.get).mockResolvedValue(page([{ skinId: 42, totalCount: 13, avgScore: 8.5 }]));

    const result = await submitSkinRating({
      skinId: 42,
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2
    });

    const body = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({
      skinId: 42,
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2,
      content: null
    });
    expect(result.stats?.totalCount).toBe(13);
  });

  it('把评价文字一起发上去,并读回后端存下来的那份', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { content: '  手感真好  ' } }
    });
    vi.mocked(axios.get).mockResolvedValue(page([{ skinId: 42, totalCount: 1 }]));

    const result = await submitSkinRating({
      skinId: 42,
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2,
      content: '  手感真好  '
    });

    const body = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body.content).toBe('手感真好');
    expect(result.savedContent).toBe('  手感真好  ');
  });

  it('后端把评价文字清掉了(没有写文字的权限)时如实报回去', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 200, data: { content: null } } });
    vi.mocked(axios.get).mockResolvedValue(page([{ skinId: 42, totalCount: 1 }]));

    const result = await submitSkinRating({
      skinId: 42,
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2,
      content: '这段评价'
    });

    expect(result.savedContent).toBeNull();
    expect(result.stats?.totalCount).toBe(1);
  });

  it('没登录时报错', async () => {
    tokenMock.mockReturnValue(null);
    await expect(
      submitSkinRating({ skinId: 42, handFeel: 5, artwork: 4, model: 3, mockery: 2 })
    ).rejects.toThrow('未登录');
  });
});
