import { describe, expect, it } from 'vitest';
import type { CatalogSkin } from '../../../../preload/index';
import {
  computeStats,
  computeVisibleRange,
  dedupeBySkinId,
  filterSkins,
  isOwned
} from '../skinCatalogLogic';

function skin(partial: Partial<CatalogSkin> & { skinId: number | null }): CatalogSkin {
  return {
    id: 0,
    heroId: 7,
    heroName: '暗裔剑魔',
    name: '皮肤',
    nameEn: 'Skin',
    rarity: '传说',
    priceRp: 3250,
    splashUrl: 's.jpg',
    iconUrl: 'i.jpg',
    ...partial
  };
}

describe('isOwned', () => {
  it('returns true when the skin id is in the owned set', () => {
    expect(isOwned(skin({ skinId: 161013 }), new Set([161013]))).toBe(true);
  });

  it('returns false when the skin id is not owned', () => {
    expect(isOwned(skin({ skinId: 161013 }), new Set([1]))).toBe(false);
  });

  it('returns false when the skin has no id', () => {
    expect(isOwned(skin({ skinId: null }), new Set([1]))).toBe(false);
  });
});

describe('dedupeBySkinId', () => {
  it('keeps only the first row for a duplicated skin id', () => {
    const rows = [
      skin({ id: 1, skinId: 100 }),
      skin({ id: 2, skinId: 100, name: '重复' }),
      skin({ id: 3, skinId: 200 })
    ];

    const result = dedupeBySkinId(rows);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].skinId).toBe(200);
  });

  it('keeps every row that has no skin id', () => {
    const rows = [skin({ id: 1, skinId: null }), skin({ id: 2, skinId: null })];

    expect(dedupeBySkinId(rows)).toHaveLength(2);
  });
});

describe('filterSkins', () => {
  const rows = [
    skin({
      id: 1,
      skinId: 100,
      name: '冠军猩红',
      // 英文名不能带 "night" —— Knight 里就含 night,子串匹配会把它也捞进来
      nameEn: 'Crimson Warden',
      heroName: '暗裔剑魔',
      heroId: 7,
      rarity: '传说'
    }),
    skin({
      id: 2,
      skinId: 200,
      name: '暗夜之刃',
      nameEn: 'Night Blade',
      heroName: '暗裔剑魔',
      heroId: 7,
      rarity: '史诗'
    }),
    skin({
      id: 3,
      skinId: 300,
      name: '冰霜女巫',
      nameEn: 'Frost Witch',
      heroName: '冰霜女巫',
      heroId: 9,
      rarity: '传说'
    })
  ];
  const owned = new Set([100]);

  it('returns everything when no filter is set', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: null, onlyUnowned: false })
    ).toHaveLength(3);
  });

  it('matches the keyword against name, nameEn and heroName, case-insensitively', () => {
    const byName = filterSkins(rows, owned, {
      keyword: '冠军',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byName.map((s) => s.id)).toEqual([1]);

    const byEn = filterSkins(rows, owned, {
      keyword: 'night',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byEn.map((s) => s.id)).toEqual([2]);

    const byHero = filterSkins(rows, owned, {
      keyword: '冰霜女巫',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byHero.map((s) => s.id)).toEqual([3]);
  });

  it('filters by hero and by rarity', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: 9, rarity: null, onlyUnowned: false }).map(
        (s) => s.id
      )
    ).toEqual([3]);

    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: '史诗', onlyUnowned: false }).map(
        (s) => s.id
      )
    ).toEqual([2]);
  });

  it('keeps only unowned skins when onlyUnowned is on', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: null, onlyUnowned: true }).map(
        (s) => s.id
      )
    ).toEqual([2, 3]);
  });

  it('keeps skins without an id in the only-unowned view', () => {
    const withNull = [...rows, skin({ id: 4, skinId: null })];

    expect(
      filterSkins(withNull, owned, {
        keyword: '',
        heroId: null,
        rarity: null,
        onlyUnowned: true
      }).map((s) => s.id)
    ).toEqual([2, 3, 4]);
  });
});

describe('computeVisibleRange', () => {
  it('returns an empty range for an empty list', () => {
    expect(computeVisibleRange(0, 600, 188, 6, 0)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('returns an empty range when cols is zero', () => {
    expect(computeVisibleRange(0, 600, 188, 0, 100)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('starts at the first row on the first screen', () => {
    const range = computeVisibleRange(0, 600, 188, 6, 100);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBeGreaterThan(0);
  });

  it('advances with the scroll position and stays on a column boundary', () => {
    const range = computeVisibleRange(188 * 10, 600, 188, 6, 600);
    expect(range.startIndex % 6).toBe(0);
    expect(range.startIndex).toBeGreaterThan(0);
    expect(range.endIndex).toBeGreaterThan(range.startIndex);
  });

  it('never exceeds the item count at the bottom', () => {
    const range = computeVisibleRange(188 * 1000, 600, 188, 6, 30);
    expect(range.endIndex).toBe(30);
    expect(range.startIndex).toBeLessThanOrEqual(30);
    expect(range.startIndex).toBeLessThan(range.endIndex);
  });

  it('includes the overscan rows', () => {
    const tight = computeVisibleRange(188 * 10, 188, 188, 6, 600, 0);
    const loose = computeVisibleRange(188 * 10, 188, 188, 6, 600, 2);
    expect(loose.startIndex).toBeLessThan(tight.startIndex);
    expect(loose.endIndex).toBeGreaterThan(tight.endIndex);
  });
});

describe('computeStats', () => {
  it('counts matched owned skins without double counting duplicates', () => {
    const rows = [
      skin({ id: 1, skinId: 100 }),
      skin({ id: 2, skinId: 100 }),
      skin({ id: 3, skinId: 200 }),
      skin({ id: 4, skinId: null })
    ];

    const stats = computeStats(rows, new Set([100]), 87);

    expect(stats.ownedMatched).toBe(1);
    expect(stats.ownedReported).toBe(87);
    expect(stats.ownedMissingFromCatalog).toBe(86);
  });

  it('reports the skin id coverage', () => {
    const rows = [skin({ id: 1, skinId: 100 }), skin({ id: 2, skinId: null })];

    expect(computeStats(rows, new Set(), 0).skinIdCoverage).toBe(0.5);
  });

  it('reports zero coverage for an empty catalog', () => {
    expect(computeStats([], new Set(), 0).skinIdCoverage).toBe(0);
  });
});
