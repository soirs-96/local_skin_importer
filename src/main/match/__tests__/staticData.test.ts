import { describe, expect, it } from 'vitest';
import {
  parseDdragonChampionFiles,
  parseDdragonChampions,
  parseDdragonItems,
  parseLcuChampions,
  parseLcuItems,
  parseRunes
} from '../staticData';

describe('parseDdragonChampions', () => {
  it('图标走 lcuicon 协议,不指向外网 CDN', () => {
    const map = parseDdragonChampions([
      { id: 266, key: '266', name: '暗裔剑魔', image: { full: 'Aatrox.png' } }
    ]);
    expect(map.get(266)).toEqual({
      name: '暗裔剑魔',
      iconUrl: 'lcuicon://champion/266.png'
    });
  });

  it('没有图片信息也照样给图标 URL', () => {
    const map = parseDdragonChampions([{ id: 1, name: '安妮' }]);
    expect(map.get(1)?.iconUrl).toBe('lcuicon://champion/1.png');
  });

  it('非数组输入返回空表', () => {
    expect(parseDdragonChampions({ oops: true }).size).toBe(0);
  });
});

describe('parseDdragonChampionFiles', () => {
  it('取出英雄在 Data Dragon 上的图片文件名', () => {
    const map = parseDdragonChampionFiles([
      { id: 266, name: '暗裔剑魔', image: { full: 'Aatrox.png' } },
      { id: 1, name: '安妮' }
    ]);
    expect(map.get(266)).toBe('Aatrox.png');
    expect(map.has(1)).toBe(false);
  });
});

describe('parseDdragonItems', () => {
  it('按 id 建表并给出物品图标地址', () => {
    const map = parseDdragonItems({
      '1001': { id: 1001, name: '破败王者之刃', image: { full: '1001.png' } }
    });
    expect(map.get(1001)?.name).toBe('破败王者之刃');
    expect(map.get(1001)?.iconUrl).toBe('lcuicon://item/1001.png');
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

  it('带 skinId 的皮肤条目再像本体也排后面', () => {
    const map = parseLcuChampions([
      { id: 266, alias: 'AatroxSkin', name: '异画师', skinId: 266001 },
      { id: 266, alias: 'Aatrox', name: '暗裔剑魔' }
    ]);
    expect(map.get(266)?.name).toBe('暗裔剑魔');
  });

  it('名字没空格的皮肤名也认得出来(靠 skinId)', () => {
    const map = parseLcuChampions([
      { id: 266, alias: 'Aatrox', name: '暗裔剑魔', skinId: 0 },
      { id: 266, alias: 'AshenKnight', name: '异画师', skinId: 266002 }
    ]);
    expect(map.get(266)?.name).toBe('暗裔剑魔');
  });

  it('本体条目的 roles 是最强信号', () => {
    const map = parseLcuChampions([
      { id: 266, alias: '', name: '异画师' },
      { id: 266, alias: '', name: '暗裔剑魔', roles: ['mage'] }
    ]);
    expect(map.get(266)?.name).toBe('暗裔剑魔');
  });

  it('同分时 alias 短的更像本体', () => {
    const map = parseLcuChampions([
      { id: 266, alias: 'AatroxSkin', name: '异画师' },
      { id: 266, alias: 'Aatrox', name: '暗裔剑魔' }
    ]);
    expect(map.get(266)?.name).toBe('暗裔剑魔');
  });

  it('图标 URL 走 lcuicon 协议', () => {
    const map = parseLcuChampions([{ id: 266, alias: 'Aatrox', name: '暗裔剑魔' }]);
    expect(map.get(266)?.iconUrl).toBe('lcuicon://champion/266.png');
  });

  it('腾讯客户端的 name 是称号,取 description 里的英雄名', () => {
    const map = parseLcuChampions([
      { id: 1, alias: 'Annie', name: '黑暗之女', description: '安妮', roles: ['mage'] }
    ]);
    expect(map.get(1)?.name).toBe('安妮');
  });

  it('description 是一整句皮肤描述时退回 name', () => {
    const map = parseLcuChampions([
      { id: 1, alias: 'Annie', name: '黑暗之女', description: '这位英雄曾经差点成为召唤师最大的敌人' }
    ]);
    expect(map.get(1)?.name).toBe('黑暗之女');
  });
});

describe('parseLcuItems', () => {
  it('按 id 建表并给出物品图标地址', () => {
    const map = parseLcuItems({ '1001': { id: 1001, name: '破败王者之刃' } });
    expect(map.get(1001)?.name).toBe('破败王者之刃');
    expect(map.get(1001)?.iconUrl).toBe('lcuicon://item/1001.png');
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
