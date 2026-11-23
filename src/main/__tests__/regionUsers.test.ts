import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchRegionUsers } from '../regionUsers';
import { getStoredToken } from '../auth';

vi.mock('axios');
vi.mock('../auth');
// regionUsers.ts → ./auth → electron. Mock electron too so the transitive
// import doesn't try to load the real `electron` package from node_modules.
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

describe('fetchRegionUsers', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('带 Bearer token 请求同区列表', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          myZone: '艾欧尼亚',
          myZoneKnown: true,
          totalInZone: 3,
          userCount: 1,
          users: [
            { id: 7, nickname: '林俊杰', gameId: '18557', avatarUrl: '', skinCount: 12 }
          ]
        }
      }
    });

    const result = await fetchRegionUsers();

    expect(result.myZone).toBe('艾欧尼亚');
    expect(result.users[0].gameId).toBe('18557');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/map/region-users'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('没登录就说没登录', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(fetchRegionUsers()).rejects.toThrow(/未登录/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('后端说失败就把后端的话带出来', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 500, message: '服务器开小差了' }
    });
    await expect(fetchRegionUsers()).rejects.toThrow(/服务器开小差了/);
  });

  it('缺字段的脏响应不炸 —— 补成空值', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: { users: [{ id: 7 }] } }
    });

    const result = await fetchRegionUsers();

    expect(result.myZone).toBeNull();
    expect(result.myZoneKnown).toBe(false);
    expect(result.users[0].nickname).toBe('');
    expect(result.users[0].skinCount).toBe(0);
    // 列表长度能当人数用
    expect(result.userCount).toBe(1);
  });

  it('token 过期(401)时清掉本地 token 并说清楚', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    const axiosErr = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 401, data: { code: 401, message: '未登录' } }
    });
    vi.mocked(axios.get).mockRejectedValue(axiosErr);

    await expect(fetchRegionUsers()).rejects.toThrow(/登录已过期/);
  });

  it('匹配条件按查询参数发给后端', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 200, data: { users: [] } } });

    await fetchRegionUsers('艾欧尼亚', 30, {
      positions: ['mid', 'support'],
      tierGap: 2,
      includeHigher: true,
      higherTierGap: 3,
      collectionGap: 0.5
    });

    const params = vi.mocked(axios.get).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params.gameZone).toBe('艾欧尼亚');
    expect(params.positions).toBe('mid,support');
    expect(params.tierGap).toBe(2);
    expect(params.includeHigher).toBe(true);
    expect(params.higherTierGap).toBe(3);
    expect(params.collectionGap).toBe(0.5);
  });

  it('没选位置就不带 positions 参数', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 200, data: { users: [] } } });

    await fetchRegionUsers('', 30, { positions: [] });

    const params = vi.mocked(axios.get).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params.positions).toBeUndefined();
  });

  it('段位 / 收藏分 / 位置都照后端给的整理出来', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          myZone: '艾欧尼亚',
          myZoneKnown: true,
          totalInZone: 3,
          userCount: 1,
          myRank: {
            queueType: 'RANKED_SOLO_5x5',
            tier: 'GOLD',
            division: 'II',
            score: 23400,
            label: '黄金II'
          },
          myCollectionScore: 900,
          myPositions: ['mid'],
          myPositionLabels: ['中单'],
          myVip: true,
          myVipUntil: '2026-12-01T00:00:00',
          users: [
            {
              id: 7,
              nickname: '林俊杰',
              gameId: '18557',
              skinCount: 12,
              rank: {
                queueType: 'RANKED_SOLO_5x5',
                tier: 'GOLD',
                division: 'I',
                score: 24500,
                label: '黄金I'
              },
              rankScoreDiff: 1100,
              collectionScore: 1200,
              collectionDiff: 300,
              positions: ['mid', 'support'],
              positionLabels: ['中单', '辅助'],
              vip: true
            }
          ]
        }
      }
    });

    const result = await fetchRegionUsers();

    expect(result.myVip).toBe(true);
    expect(result.myRank?.label).toBe('黄金II');
    expect(result.myCollectionScore).toBe(900);
    expect(result.myPositionLabels).toEqual(['中单']);
    const user = result.users[0];
    expect(user.rank?.label).toBe('黄金I');
    expect(user.rankScoreDiff).toBe(1100);
    expect(user.collectionScore).toBe(1200);
    expect(user.collectionDiff).toBe(300);
    expect(user.positionLabels).toEqual(['中单', '辅助']);
    expect(user.vip).toBe(true);
  });
});
