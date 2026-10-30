// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCatalogCache, useSkinCatalog } from '../useSkinCatalog';

const api = {
  fetchSkins: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchMyOwned: vi.fn(),
  getAuthStatus: vi.fn()
};

function installApi(): void {
  (window as unknown as { api: unknown }).api = api;
}

function catalogResult(records: unknown[], skinIdFieldPresent = true) {
  return { total: records.length, records, skinIdFieldPresent };
}

const record = (id: number, skinId: number | null) => ({
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
});

describe('useSkinCatalog', () => {
  beforeEach(() => {
    // 目录缓存是模块级的,用例之间必须清掉,否则第 N 个用例会命中第 1 个用例的缓存
    resetCatalogCache();
    installApi();
    api.fetchSkins.mockReset();
    api.fetchCatalog.mockReset();
    api.fetchMyOwned.mockReset();
    api.getAuthStatus.mockReset();
  });

  it('uses the live LCU list as the owned set', async () => {
    api.fetchSkins.mockResolvedValue({
      summoner: { displayName: 'A', puuid: 'p' },
      ownedSkinIds: [100, 200]
    });
    api.fetchCatalog.mockResolvedValue(
      catalogResult([record(1, 100), record(2, 200), record(3, 300)])
    );

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('lcu');
    expect(catalog.ownedReported.value).toBe(2);
    expect(catalog.stats.value.ownedMatched).toBe(2);
    expect(catalog.catalogSize.value).toBe(3);
  });

  it('falls back to the backend snapshot when the LCU is unavailable', async () => {
    api.fetchSkins.mockRejectedValue(new Error('League client is not running'));
    api.getAuthStatus.mockResolvedValue({ loggedIn: true, tokenPreview: 'jwt...' });
    api.fetchMyOwned.mockResolvedValue({ totalOwnedCount: 87, ownedSkinIds: [100] });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100), record(2, 200)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('backend');
    expect(catalog.ownedReported.value).toBe(87);
    expect(catalog.stats.value.ownedMatched).toBe(1);
    expect(catalog.stats.value.ownedMissingFromCatalog).toBe(86);
  });

  it('skips the backend call when the user is not logged in', async () => {
    api.fetchSkins.mockRejectedValue(new Error('League client is not running'));
    api.getAuthStatus.mockResolvedValue({ loggedIn: false, tokenPreview: null });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('none');
    expect(api.fetchMyOwned).not.toHaveBeenCalled();
    expect(catalog.ownedIds.value.size).toBe(0);
  });

  it('ends up with an empty owned set when every source fails', async () => {
    api.fetchSkins.mockRejectedValue(new Error('nope'));
    api.getAuthStatus.mockRejectedValue(new Error('nope'));
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('none');
    expect(catalog.ownedIds.value.size).toBe(0);
  });

  it('surfaces the catalog error and keeps the message', async () => {
    api.fetchSkins.mockResolvedValue({
      summoner: { displayName: 'A', puuid: 'p' },
      ownedSkinIds: []
    });
    api.fetchCatalog.mockRejectedValue(new Error('服务端响应超时'));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.error.value).toBe('服务端响应超时');
  });

  it('deduplicates the catalog by skin id', async () => {
    api.fetchSkins.mockResolvedValue({
      summoner: { displayName: 'A', puuid: 'p' },
      ownedSkinIds: [100]
    });
    api.fetchCatalog.mockResolvedValue(
      catalogResult([record(1, 100), record(2, 100), record(3, null)])
    );

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.catalogSize.value).toBe(2);
  });

  it('exposes whether the backend returned the skinId field', async () => {
    api.fetchSkins.mockResolvedValue({
      summoner: { displayName: 'A', puuid: 'p' },
      ownedSkinIds: []
    });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, null)], false));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.skinIdFieldPresent.value).toBe(false);
  });
});
