import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { resolveOwnedSkinIds } from '../owned';

const mocks = vi.hoisted(() => ({
  getInventoryOwnedSkinIds: vi.fn(),
  getStoreOwnedSkinIds: vi.fn(),
  fetchCatalogSkinIds: vi.fn()
}));

vi.mock('../lcu', () => ({
  getInventoryOwnedSkinIds: mocks.getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds: mocks.getStoreOwnedSkinIds
}));

vi.mock('../catalog', () => ({
  fetchCatalogSkinIds: mocks.fetchCatalogSkinIds
}));

const client = {} as AxiosInstance;

describe('resolveOwnedSkinIds', () => {
  beforeEach(() => {
    mocks.getInventoryOwnedSkinIds.mockReset();
    mocks.getStoreOwnedSkinIds.mockReset();
    mocks.fetchCatalogSkinIds.mockReset();
  });

  it('keeps only the inventory items the site catalog knows', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(new Set([161013, 2005]));
    // 库存里的原始集合:混着炫彩、长 id(经典卡)、目录没收录的皮肤
    mocks.getInventoryOwnedSkinIds.mockResolvedValue([161013, 2005, 10011, 60064301, 33018]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [161013, 2005],
      source: 'inventory',
      catalogFiltered: true
    });
  });

  it('drops hero default skins — the game collection does not count them', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(new Set([1000, 161013]));
    mocks.getInventoryOwnedSkinIds.mockResolvedValue([1000, 161013]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [161013],
      source: 'inventory',
      catalogFiltered: true
    });
  });

  it('falls back to the store catalog when the inventory endpoint is unavailable', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(new Set([161013]));
    mocks.getInventoryOwnedSkinIds.mockRejectedValue(new Error('404 Not Found'));
    mocks.getStoreOwnedSkinIds.mockResolvedValue([161013, 2005]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [161013],
      source: 'store',
      catalogFiltered: true
    });
  });

  it('keeps the inventory result even when the player owns nothing', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(new Set([161013]));
    mocks.getInventoryOwnedSkinIds.mockResolvedValue([]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [],
      source: 'inventory',
      catalogFiltered: true
    });
    expect(mocks.getStoreOwnedSkinIds).not.toHaveBeenCalled();
  });

  it('skips the catalog intersection when the backend does not expose skinId', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(null);
    mocks.getStoreOwnedSkinIds.mockResolvedValue([161013, 2005, 1000]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [161013, 2005],
      source: 'store',
      catalogFiltered: false
    });
    expect(mocks.getInventoryOwnedSkinIds).not.toHaveBeenCalled();
  });

  it('falls back to the store catalog when the site catalog cannot be fetched', async () => {
    mocks.fetchCatalogSkinIds.mockRejectedValue(new Error('network down'));
    mocks.getStoreOwnedSkinIds.mockResolvedValue([161013]);

    await expect(resolveOwnedSkinIds(client)).resolves.toEqual({
      ownedSkinIds: [161013],
      source: 'store',
      catalogFiltered: false
    });
  });

  it('propagates a store failure when the inventory endpoint is also down', async () => {
    mocks.fetchCatalogSkinIds.mockResolvedValue(new Set([161013]));
    mocks.getInventoryOwnedSkinIds.mockRejectedValue(new Error('404 Not Found'));
    mocks.getStoreOwnedSkinIds.mockRejectedValue(new Error('client not running'));

    await expect(resolveOwnedSkinIds(client)).rejects.toThrow('client not running');
  });
});
