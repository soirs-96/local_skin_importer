import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getStoredToken } from '../auth';
import { fetchCatalog, fetchCatalogSkinBySkinId, fetchMyOwned } from '../catalog';

vi.mock('axios');
vi.mock('../auth');
// catalog.ts → ./auth → electron. Mock electron too so the transitive
// import doesn't try to load the real `electron` package from node_modules.
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

function ok(data: unknown) {
  return { data: { code: 200, data } };
}

function rawSkin(id: number, skinId: number | null): Record<string, unknown> {
  return {
    id,
    skinId,
    heroId: 7,
    heroName: '暗裔剑魔',
    name: `skin-${id}`,
    nameEn: `Skin ${id}`,
    rarity: '传说',
    priceRp: 3250,
    splashUrl: `splash-${id}.jpg`,
    iconUrl: `icon-${id}.jpg`
  };
}

describe('catalog.fetchCatalog', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('maps records and detects the skinId field', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        current: 1,
        size: 20000,
        total: 2,
        pages: 1,
        records: [rawSkin(1, 161013), rawSkin(2, null)]
      })
    );

    const result = await fetchCatalog();

    expect(result.total).toBe(2);
    expect(result.skinIdFieldPresent).toBe(true);
    expect(result.records[0].skinId).toBe(161013);
    expect(result.records[1].skinId).toBeNull();
    expect(result.records[0].heroName).toBe('暗裔剑魔');
    expect(result.records[0].iconUrl).toBe('icon-1.jpg');
  });

  it('reports skinIdFieldPresent=false when the backend omits the field', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        current: 1,
        size: 20000,
        total: 1,
        pages: 1,
        records: [{ id: 1, heroId: 7, heroName: '暗裔剑魔', name: 'x' }]
      })
    );

    const result = await fetchCatalog();

    expect(result.skinIdFieldPresent).toBe(false);
  });

  it('throws with the backend message when the envelope code is not 200', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 500, message: '数据库炸了' } });

    await expect(fetchCatalog()).rejects.toThrow('数据库炸了');
  });

  it('re-paginates with 2000 per page when the first page was truncated', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => rawSkin(i + 1, i + 1));
    const page2 = Array.from({ length: 1500 }, (_, i) => rawSkin(i + 1001, i + 1001));
    vi.mocked(axios.get)
      .mockResolvedValueOnce(
        ok({ current: 1, size: 20000, total: 2500, pages: 1, records: [rawSkin(1, 1)] })
      )
      .mockResolvedValueOnce(ok({ current: 1, size: 2000, total: 2500, pages: 2, records: page1 }))
      .mockResolvedValueOnce(ok({ current: 2, size: 2000, total: 2500, pages: 2, records: page2 }));

    const result = await fetchCatalog();

    expect(result.total).toBe(2500);
    expect(result.records).toHaveLength(2500);
    expect(axios.get).toHaveBeenCalledTimes(3);
  });
});

describe('catalog.fetchMyOwned', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('throws without sending a request when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);

    await expect(fetchMyOwned()).rejects.toThrow('未登录');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns the total count, the owned skin ids and the last sync time', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        totalOwnedCount: 87,
        ownedSkinIds: [161013, 1001],
        lastSyncAt: '2026-10-30 16:20:33'
      })
    );

    const result = await fetchMyOwned();

    expect(result).toEqual({
      totalOwnedCount: 87,
      ownedSkinIds: [161013, 1001],
      lastSyncAt: '2026-10-30 16:20:33'
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/my-owned'),
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-abc' } })
    );
  });

  it('drops non-numeric skin ids', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({ totalOwnedCount: 2, ownedSkinIds: [161013, null] })
    );

    const result = await fetchMyOwned();

    expect(result.ownedSkinIds).toEqual([161013]);
  });

  it('falls back to the id count when totalOwnedCount is absent', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(ok({ ownedSkinIds: [1, 2] }));

    const result = await fetchMyOwned();

    expect(result.totalOwnedCount).toBe(2);
  });

  it('returns lastSyncAt=null when the user has never synced', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({ totalOwnedCount: 0, ownedSkinIds: [] })
    );

    const result = await fetchMyOwned();

    expect(result.lastSyncAt).toBeNull();
  });
});

describe('catalog.fetchCatalogSkinBySkinId', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('fetchCatalogSkinBySkinId 命中时返回站内那条', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          current: 1,
          size: 1,
          total: 1,
          pages: 1,
          records: [
            {
              id: 42,
              skinId: 161013,
              heroId: 7,
              heroName: '暗裔剑魔',
              name: '黑暗之女',
              nameEn: 'Dark Crystal',
              rarity: '传说',
              priceRp: 1350,
              splashUrl: 'https://x/splash.jpg',
              iconUrl: 'https://x/icon.jpg'
            }
          ]
        }
      }
    });

    const skin = await fetchCatalogSkinBySkinId(161013);

    expect(skin?.id).toBe(42);
    expect(skin?.name).toBe('黑暗之女');
    expect(vi.mocked(axios.get).mock.calls[0][0]).toContain('skinId=161013');
  });

  it('fetchCatalogSkinBySkinId 不带 Authorization —— 带了 DESKTOP token 会被拦成 403', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: { current: 1, size: 1, total: 0, pages: 0, records: [] } }
    });

    await fetchCatalogSkinBySkinId(161013);

    const options = vi.mocked(axios.get).mock.calls[0][1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(options?.headers?.Authorization).toBeUndefined();
  });

  it('fetchCatalogSkinBySkinId 查不到时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: { current: 1, size: 1, total: 0, pages: 0, records: [] } }
    });

    await expect(fetchCatalogSkinBySkinId(161013)).resolves.toBeNull();
  });
});
