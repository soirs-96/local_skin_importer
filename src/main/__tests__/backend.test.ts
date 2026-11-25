import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  syncOwnedSkins,
  rebindOwnedSkins,
  fetchBindingInfo,
  shouldSkipSync,
  minIntervalFor,
  AUTO_SYNC_MIN_INTERVAL_MS,
  MANUAL_SYNC_MIN_INTERVAL_MS
} from '../backend';
import { getStoredToken } from '../auth';

vi.mock('axios');
vi.mock('../auth');
// backend.ts → ./auth → electron. Mock electron too so the transitive
// import doesn't try to load the real `electron` package from node_modules.
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

describe('backend.syncOwnedSkins', () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('sends a POST with Bearer JWT and returns the counts', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 3, updated: 0, totalOwned: 3 } }
    });

    const result = await syncOwnedSkins('0123456789abcdef0123456789abcdef', 'Foo', [1001, 1002, 2005]);

    expect(result).toEqual({ added: 3, updated: 0, totalOwned: 3 });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/sync-user-skins'),
      expect.objectContaining({
        puuid: '0123456789abcdef0123456789abcdef',
        summonerName: 'Foo',
        ownedSkinIds: [1001, 1002, 2005]
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('sends the top champions in the same request', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 0, updated: 0, totalOwned: 0 } }
    });

    await syncOwnedSkins('p', 's', [1], [
      { championId: 1, championName: '安妮', championNameEn: 'Annie', championPoints: 231381 }
    ]);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/sync-user-skins'),
      expect.objectContaining({
        topChampions: [
          { championId: 1, championName: '安妮', championNameEn: 'Annie', championPoints: 231381 }
        ]
      }),
      expect.anything()
    );
  });

  it('sends the summoner tag and the game zone in the same request', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 0, updated: 0, totalOwned: 0 } }
    });

    await syncOwnedSkins('p', '林俊杰', [1], [], { summonerTag: '18557', gameZone: '1' });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/sync-user-skins'),
      expect.objectContaining({
        summonerTag: '18557',
        gameZone: '1'
      }),
      expect.anything()
    );
  });

  it('sends empty strings when the profile is unknown', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 0, updated: 0, totalOwned: 0 } }
    });

    await syncOwnedSkins('p', '林俊杰', [1]);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/sync-user-skins'),
      expect.objectContaining({
        summonerTag: '',
        gameZone: ''
      }),
      expect.anything()
    );
  });

  it('throws when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(syncOwnedSkins('p', 's', [1])).rejects.toThrow(/未登录/);
  });

  it('retries 3x on ECONNRESET then succeeds', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post)
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValueOnce({ data: { code: 200, data: { added: 1, updated: 0, totalOwned: 1 } } });

    const result = await syncOwnedSkins('p', 's', [1]);
    expect(result.added).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx — passes through and hoists the backend message', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    const axiosErr = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: {
        status: 409,
        data: { code: 409, message: '账号已绑定其他 LOL 账号,请在桌面端改绑后重新同步' }
      },
      code: 'ERR_BAD_REQUEST'
    });
    vi.mocked(axios.post).mockRejectedValue(axiosErr);

    await expect(syncOwnedSkins('p', 's', [1])).rejects.toMatchObject({
      message: '账号已绑定其他 LOL 账号,请在桌面端改绑后重新同步',
      status: 409,
      name: 'BackendError'
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('throws last error after 3 ECONNRESET attempts', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    const err = { code: 'ECONNRESET' };
    vi.mocked(axios.post).mockRejectedValue(err);
    await expect(syncOwnedSkins('p', 's', [1])).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});

describe('backend.rebindOwnedSkins', () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('posts to the rebind endpoint with Bearer JWT', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 12, updated: 0, totalOwned: 12 } }
    });

    const result = await rebindOwnedSkins('0123456789abcdef0123456789abcdef', 'Bar', [1001]);

    expect(result).toEqual({ added: 12, updated: 0, totalOwned: 12 });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/rebind-user-skins'),
      expect.objectContaining({
        puuid: '0123456789abcdef0123456789abcdef',
        summonerName: 'Bar',
        ownedSkinIds: [1001]
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('throws when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(rebindOwnedSkins('p', 's', [1])).rejects.toThrow(/未登录/);
  });

  it('passes the 409 through without retrying', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    const axiosErr = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: {
        status: 409,
        data: { code: 409, message: '已经是这个 LOL 账号,不需要改绑' }
      },
      code: 'ERR_BAD_REQUEST'
    });
    vi.mocked(axios.post).mockRejectedValue(axiosErr);

    await expect(rebindOwnedSkins('p', 's', [1])).rejects.toMatchObject({
      message: '已经是这个 LOL 账号,不需要改绑',
      status: 409
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('backend.fetchBindingInfo', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('gets the binding info with Bearer JWT', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          bound: true,
          boundAccount: 'Foo#1234',
          nickname: 'Foo',
          gameId: '1234',
          gameZone: '艾欧尼亚',
          skinCount: 42,
          lastSyncAt: '2026-11-25 10:00:00'
        }
      }
    });

    const info = await fetchBindingInfo();

    expect(info.boundAccount).toBe('Foo#1234');
    expect(info.skinCount).toBe(42);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/my-binding'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('throws when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(fetchBindingInfo()).rejects.toThrow(/未登录/);
  });
});

describe('shouldSkipSync', () => {
  it('skips when the last sync was more recent than the minimum interval', () => {
    expect(
      shouldSkipSync(1_000_000, 1_000_000 + 5_000, MANUAL_SYNC_MIN_INTERVAL_MS)
    ).toBe(true);
  });

  it('does not skip when the minimum interval has elapsed', () => {
    expect(
      shouldSkipSync(1_000_000, 1_000_000 + MANUAL_SYNC_MIN_INTERVAL_MS, MANUAL_SYNC_MIN_INTERVAL_MS)
    ).toBe(false);
  });

  it('does not skip when there is no previous sync', () => {
    expect(shouldSkipSync(null, 1_000_000, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(false);
  });

  it('uses a wider interval for automatic syncs', () => {
    expect(shouldSkipSync(1_000_000, 1_030_000, AUTO_SYNC_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldSkipSync(1_000_000, 1_030_000, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(false);
  });

  it('maps the sync mode to its threshold', () => {
    expect(minIntervalFor('auto')).toBe(AUTO_SYNC_MIN_INTERVAL_MS);
    expect(minIntervalFor('manual')).toBe(MANUAL_SYNC_MIN_INTERVAL_MS);
  });
});
