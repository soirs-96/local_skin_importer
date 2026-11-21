import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSettlementView } from '../match/settlement';
import { fetchCatalogSkinBySkinId } from '../catalog';
import { fetchMyRating, fetchSkinRatingStats } from '../rating';
import { getStoredUserId } from '../auth';
import type { LocalSettlement } from '../../shared/settlement';

vi.mock('../catalog', () => ({ fetchCatalogSkinBySkinId: vi.fn() }));
vi.mock('../rating', () => ({
  fetchSkinRatingStats: vi.fn(),
  fetchMyRating: vi.fn()
}));
vi.mock('../auth', () => ({
  getStoredUserId: vi.fn(),
  getStoredToken: vi.fn(() => 'desktop-token'),
  clearStoredToken: vi.fn()
}));

const catalogMock = vi.mocked(fetchCatalogSkinBySkinId);
const statsMock = vi.mocked(fetchSkinRatingStats);
const myRatingMock = vi.mocked(fetchMyRating);
const userIdMock = vi.mocked(getStoredUserId);

const local: LocalSettlement = {
  key: '64-161013-1',
  championId: 64,
  championVerified: true,
  championName: '阿狸',
  usedSkin: { riotSkinId: 161013, displayName: null, source: 'champ-select' },
  live: null,
  match: null,
  endedAt: 1
};

beforeEach(() => {
  vi.clearAllMocks();
  userIdMock.mockReturnValue(7);
  catalogMock.mockResolvedValue({
    id: 42,
    skinId: 161013,
    heroId: 64,
    heroName: '阿狸',
    name: '黑暗之女',
    nameEn: 'Dark Crystal',
    rarity: '传说',
    priceRp: 1350,
    splashUrl: 'https://x/s.jpg',
    iconUrl: 'https://x/i.jpg'
  });
  statsMock.mockResolvedValue({
    skinId: 42,
    skinName: '黑暗之女',
    iconUrl: null,
    splashUrl: null,
    rarity: null,
    totalCount: 3,
    avgScore: 8,
    avgHandFeel: 8,
    avgArtwork: 8,
    avgModel: 8,
    avgMockery: 8
  });
  myRatingMock.mockResolvedValue({
    handFeel: 5,
    artwork: 4,
    model: 3,
    mockery: 2,
    content: '手感真好'
  });
});

describe('buildSettlementView', () => {
  it('把皮肤、现有评分、我打过的分都补上', async () => {
    const view = await buildSettlementView(local);

    expect(view.skin?.id).toBe(42);
    expect(view.stats?.totalCount).toBe(3);
    expect(view.myRating).toEqual({
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2,
      content: '手感真好'
    });
    expect(view.loggedIn).toBe(true);
  });

  it('皮肤不在目录里 → skin 为 null,评分那一块也跳过', async () => {
    catalogMock.mockResolvedValue(null);

    const view = await buildSettlementView(local);

    expect(view.skin).toBeNull();
    expect(view.stats).toBeNull();
    expect(view.myRating).toBeNull();
  });

  it('没登录 → loggedIn false,不给「我打过的分」', async () => {
    userIdMock.mockReturnValue(null);

    const view = await buildSettlementView(local);

    expect(view.loggedIn).toBe(false);
    expect(view.myRating).toBeNull();
  });

  it('后端挂了 → 那一块是 null,整份结算还是能出来', async () => {
    statsMock.mockRejectedValue(new Error('后端挂了'));

    const view = await buildSettlementView(local);

    expect(view.stats).toBeNull();
    expect(view.skin?.id).toBe(42);
  });

  it('认出来的是炫彩 → 站内没有这条炫彩,退到底图那款皮肤', async () => {
    catalogMock.mockImplementation(async (riotSkinId: number) => {
      // 站内目录里没有炫彩
      if (riotSkinId === 200009) return null;
      return {
        id: 43,
        skinId: 200001,
        heroId: 200,
        heroName: '卑尔维斯',
        name: '战场BOSS 卑尔维斯',
        nameEn: null,
        rarity: '传说',
        priceRp: 1350,
        splashUrl: 'https://x/base.jpg',
        iconUrl: 'https://x/base-i.jpg'
      };
    });

    const chroma: LocalSettlement = {
      ...local,
      usedSkin: {
        riotSkinId: 200009,
        displayName: null,
        source: 'gameflow-selection',
        baseRiotSkinId: 200001,
        chromaName: '战场BOSS 卑尔维斯 拒绝之尾'
      }
    };

    const view = await buildSettlementView(chroma);

    // 打分对象是底图那款(站内目录里没有炫彩)
    expect(view.skin?.skinId).toBe(200001);
    expect(view.skin?.name).toBe('战场BOSS 卑尔维斯');
    // 炫彩名留着 —— 界面上另起一行显示
    expect(view.usedSkin.chromaName).toBe('战场BOSS 卑尔维斯 拒绝之尾');
  });

  it('没认到皮肤 → 不去查目录', async () => {
    const noSkin: LocalSettlement = {
      ...local,
      usedSkin: { riotSkinId: 0, displayName: null, source: null }
    };

    const view = await buildSettlementView(noSkin);

    expect(view.skin).toBeNull();
    expect(catalogMock).not.toHaveBeenCalled();
  });
});
