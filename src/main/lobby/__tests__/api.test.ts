import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchLobbyHistory, fetchLobbyPlayerProfile, fetchLobbyPlayers } from '../api';
import { getStoredToken } from '../../auth';

vi.mock('axios');
vi.mock('../../auth');
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

describe('大厅 REST', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('拉玩家列表带 Bearer token', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          online: [{ userId: 1, nickname: '林俊杰', gameId: '18557' }],
          offline: [],
          stats: { online: 1, sameZone: 1, invitable: 1 },
          me: { userId: 9, nickname: '我' }
        }
      }
    });

    const snap = await fetchLobbyPlayers();

    expect(snap.stats.online).toBe(1);
    expect(snap.online[0].nickname).toBe('林俊杰');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/lobby/players'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('没登录就说没登录', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(fetchLobbyPlayers()).rejects.toThrow(/未登录/);
  });

  it('token 过期就清掉并说清楚', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error('401'), {
        isAxiosError: true,
        response: { status: 401, data: { code: 401, message: '未登录' } }
      })
    );
    await expect(fetchLobbyPlayers()).rejects.toThrow(/登录已过期/);
  });

  it('缺字段的脏响应补成空值,不炸', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 200, data: {} } });
    const snap = await fetchLobbyPlayers();
    expect(snap.online).toEqual([]);
    expect(snap.offline).toEqual([]);
    expect(snap.stats.online).toBe(0);
    expect(snap.me).toBeNull();
  });

  it('悬浮卡片:按人取近 10 场档案', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          userId: 7,
          matchCount: 3,
          winCount: 2,
          winRate: 0.6667,
          score: 71,
          avgKda: 3.2,
          avgCs: 6.8,
          topPosition: 'mid',
          topPositionLabel: '中单',
          positions: [{ position: 'mid', label: '中单', count: 2 }],
          champions: [{ championId: 1, championName: '安妮', count: 2 }],
          matches: []
        }
      }
    });

    const profile = await fetchLobbyPlayerProfile(7);

    expect(profile.score).toBe(71);
    expect(profile.positions[0].label).toBe('中单');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/lobby/player/7/recent'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt' })
      })
    );
  });

  it('历史消息也整理成一样形状', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: [{ id: 1, userId: 7, nickname: '林俊杰', text: '来两把' }] }
    });
    const msgs = await fetchLobbyHistory(50);
    expect(msgs[0].text).toBe('来两把');
    expect(msgs[0].gameId).toBe('');
  });
});
