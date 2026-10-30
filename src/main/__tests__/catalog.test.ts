import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getStoredToken } from '../auth';
import { fetchCatalog, fetchMyOwned } from '../catalog';

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

  it('returns the total count and the owned skin ids', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        totalOwnedCount: 87,
        ownedSkins: [{ skinId: 161013 }, { skinId: 1001 }]
      })
    );

    const result = await fetchMyOwned();

    expect(result).toEqual({ totalOwnedCount: 87, ownedSkinIds: [161013, 1001] });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/my-owned'),
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-abc' } })
    );
  });

  it('drops non-numeric skin ids', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({ totalOwnedCount: 2, ownedSkins: [{ skinId: 161013 }, { skinId: null }] })
    );

    const result = await fetchMyOwned();

    expect(result.ownedSkinIds).toEqual([161013]);
  });

  it('falls back to the id count when totalOwnedCount is absent', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(ok({ ownedSkins: [{ skinId: 1 }, { skinId: 2 }] }));

    const result = await fetchMyOwned();

    expect(result.totalOwnedCount).toBe(2);
  });
});
