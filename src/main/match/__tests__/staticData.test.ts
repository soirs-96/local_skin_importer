import { describe, expect, it } from 'vitest';
import {
  championIndexEntries,
  parseDdragonChampionFiles,
  parseDdragonChampions,
  parseDdragonItems,
  parseLcuChampionSummaries,
  parseLcuChampions,
  parseLcuItems,
  parseLcuSkins,
  parseRunes,
  type ChampionInfo
} from '../staticData';

describe('parseLcuSkins', () => {
  // 客户端 skins.json 的真实形状(国服实测)
  const skinsJson = {
    '1000': {
      id: 1000,
      name: '黑暗之女',
      isBase: true,
      skinClassification: 'kChampion',
      splashPath: '/lol-game-data/assets/ASSETS/Characters/Annie/Skins/Base/Images/annie_splash_centered_0.jpg'
    },
    '1001': {
      id: 1001,
      name: '哥特萝莉 安妮',
      isBase: false,
      skinClassification: 'kChampion',
      splashPath:
        '/lol-game-data/assets/ASSETS/Characters/Annie/Skins/Skin01/Images/annie_splash_centered_1.jpg'
    },
    '266001': {
      id: 266001,
      name: '异画师 剑魔',
      skinClassification: 'kChampion',
      splashPath:
        '/lol-game-data/assets/ASSETS/Characters/Aatrox/Skins/Skin01/Images/aatrox_splash_centered_1.jpg'
    }
  };

  it('按「皮肤 id = 英雄编号 × 1000 + 序号」把皮肤归到英雄名下', () => {
    const { byChampion } = parseLcuSkins(skinsJson);
    expect(byChampion.get(1)).toEqual([1000, 1001]);
    expect(byChampion.get(266)).toEqual([266001]);
  });

  it('皮肤目录条目:中文名 + 序号 + 美术资源路径', () => {
    const { infos } = parseLcuSkins(skinsJson);
    expect(infos.get(1001)).toEqual({
      id: 1001,
      index: 1,
      championId: 1,
      name: '哥特萝莉 安妮',
      splashPath:
        '/lol-game-data/assets/ASSETS/Characters/Annie/Skins/Skin01/Images/annie_splash_centered_1.jpg',
      uncenteredSplashPath: null,
      loadScreenPath: null
    });
  });

  it('数组形状也认', () => {
    const { byChampion } = parseLcuSkins([
      { id: 1000, skinClassification: 'kChampion' },
      { id: 1001, skinClassification: 'kChampion' }
    ]);
    expect(byChampion.get(1)).toEqual([1000, 1001]);
  });

  it('非英雄皮肤的分类不收', () => {
    const { byChampion } = parseLcuSkins([
      { id: 1000, skinClassification: 'kChampion' },
      { id: 2000, skinClassification: 'kMap' }
    ]);
    expect(byChampion.get(2)).toBeUndefined();
  });

  it('splash 文件名末尾的序号跟 id 对不上 → 这条皮肤不收(宁可认不出来)', () => {
    const { byChampion, infos } = parseLcuSkins([
      { id: 1001, skinClassification: 'kChampion', splashPath: '/x/annie_splash_centered_7.jpg' }
    ]);
    expect(byChampion.size).toBe(0);
    expect(infos.size).toBe(0);
  });
});

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

describe('championIndexEntries', () => {
  it('只收有名字的英雄,英文名一并带上', () => {
    const entries = championIndexEntries({
      version: null,
      champions: new Map<number, ChampionInfo>([
        [1, { name: '安妮', iconUrl: 'lcuicon://champion/1.png', nameEn: 'Annie' }],
        [2, { name: '', iconUrl: null }]
      ]),
      items: new Map(),
      runes: new Map(),
      skinsByChampion: new Map(),
      skins: new Map()
    });
    expect(entries).toEqual([{ id: 1, name: '安妮', nameEn: 'Annie' }]);
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

describe('parseLcuChampionSummaries', () => {
  it('同时给出中文名和英文 key', () => {
    const map = parseLcuChampionSummaries([
      { id: 1, alias: 'Annie', name: '黑暗之女', description: '安妮', roles: ['mage'] }
    ]);
    expect(map.get(1)).toEqual({ name: '安妮', nameEn: 'Annie' });
  });

  it('皮肤条目不顶掉英雄本体的英文 key', () => {
    const map = parseLcuChampionSummaries([
      { id: 1, alias: 'Jade_Annie', name: '玉剑传说 安妮', skinId: 1001 },
      { id: 1, alias: 'Annie', name: '安妮', roles: ['mage'] }
    ]);
    expect(map.get(1)?.nameEn).toBe('Annie');
  });

  it('alias 缺失时退回 key / nameId', () => {
    const map = parseLcuChampionSummaries([{ id: 62, key: 'MonkeyKing', name: '孙悟空' }]);
    expect(map.get(62)?.nameEn).toBe('MonkeyKing');
  });

  it('非数组输入返回空表', () => {
    expect(parseLcuChampionSummaries(null).size).toBe(0);
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
