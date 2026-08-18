import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { syncOwnedSkins } from '../backend';
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
    const axiosErr = Object.assign(new Error('Request failed with status code 403'), {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 403, data: { code: 403, message: '账号已绑定其他 LOL 账号' } },
      code: 'ERR_BAD_REQUEST'
    });
    vi.mocked(axios.post).mockRejectedValue(axiosErr);

    await expect(syncOwnedSkins('p', 's', [1])).rejects.toMatchObject({
      message: '账号已绑定其他 LOL 账号 (HTTP 403)',
      status: 403,
      name: 'AxiosError'
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
