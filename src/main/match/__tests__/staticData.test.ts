import { describe, expect, it } from 'vitest';
import {
  parseDdragonChampions,
  parseDdragonItems,
  parseLcuChampions,
  parseRunes
} from '../staticData';

const VERSION = '14.1.1';

describe('parseDdragonChampions', () => {
  it('把 image.full 拼成完整 CDN 地址', () => {
    const map = parseDdragonChampions(
      [{ id: 266, key: '266', name: '暗裔剑魔', image: { full: 'Aatrox.png' } }],
      VERSION
    );
    expect(map.get(266)).toEqual({
      name: '暗裔剑魔',
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${VERSION}/img/champion/Aatrox.png`
    });
  });

  it('没有图片时 iconUrl 为 null', () => {
    const map = parseDdragonChampions([{ id: 1, name: '安妮' }], VERSION);
    expect(map.get(1)?.iconUrl).toBeNull();
  });

  it('非数组输入返回空表', () => {
    expect(parseDdragonChampions({ oops: true }, VERSION).size).toBe(0);
  });
});

describe('parseDdragonItems', () => {
  it('按 id 建表并拼出物品图标地址', () => {
    const map = parseDdragonItems(
      { '1001': { id: 1001, name: '破败王者之刃', image: { full: '1001.png' } } },
      VERSION
    );
    expect(map.get(1001)?.name).toBe('破败王者之刃');
    expect(map.get(1001)?.iconUrl).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${VERSION}/img/item/1001.png`
    );
  });
});

describe('parseLcuChampions', () => {
  it('皮肤变体条目不会覆盖英雄本体的名字', () => {
    const map = parseLcuChampions([
      { id: 1, alias: 'Jade_Annie', name: '玉剑传说 安妮' },
      { id: 1, alias: 'Annie', name: '安妮' }
    ]);
    expect(map.get(1)?.name).toBe('安妮');
  });

  it('只有皮肤条目时用皮肤条目兜底(名字至少不为空)', () => {
    const map = parseLcuChampions([{ id: 21, alias: 'PROJECT_MissFortune', name: '伊人eko' }]);
    expect(map.get(21)?.name).toBe('伊人eko');
  });

  it('本体条目先到就先占位', () => {
    const map = parseLcuChampions([
      { id: 1, alias: 'Annie', name: '安妮' },
      { id: 1, alias: 'Jade_Annie', name: '玉剑传说 安妮' }
    ]);
    expect(map.get(1)?.name).toBe('安妮');
  });
});

describe('parseRunes', () => {
  it('同时收下天赋树名和单个天赋名', () => {
    const map = parseRunes([
      {
        id: 8000,
        name: '精密',
        slots: [{ runes: [{ id: 8021, name: '致命节奏' }] }]
      }
    ]);
    expect(map.get(8000)).toBe('精密');
    expect(map.get(8021)).toBe('致命节奏');
  });

  it('非数组输入返回空表', () => {
    expect(parseRunes(null).size).toBe(0);
  });
});
