import { describe, expect, it } from 'vitest';
import {
  parseGameflowSelf,
  parseMatchHistorySkinId,
  parseSkinIndex,
  resolveSkinIndex,
  resolveSkinValue,
  resolveUsedSkin
} from '../usedSkin';

describe('parseMatchHistorySkinId', () => {
  it('认得出来的字段名都试一遍', () => {
    expect(parseMatchHistorySkinId({ skinId: 161013 })).toBe(161013);
    expect(parseMatchHistorySkinId({ skin_id: 161013 })).toBe(161013);
  });

  it('皮肤给的是名字而不是 id → null(不拿英雄 id 顶替)', () => {
    expect(parseMatchHistorySkinId({ skin: 'game_character_displayname_Ahri' })).toBeNull();
    expect(parseMatchHistorySkinId({})).toBeNull();
    expect(parseMatchHistorySkinId(null)).toBeNull();
  });
});

describe('resolveSkinValue', () => {
  const ahriSkins = [103000, 103005, 103006];

  it('值在皮肤清单里 → 它就是皮肤 id', () => {
    expect(resolveSkinValue(103, 103005, ahriSkins)).toBe(103005);
  });

  it('值是皮肤序号 → 换算成 id', () => {
    expect(resolveSkinValue(103, 5, ahriSkins)).toBe(103005);
  });

  it('清单里没有 → 认不出来(不硬算一个可能不存在的皮肤)', () => {
    expect(resolveSkinValue(103, 9, ahriSkins)).toBe(0);
  });

  it('没有清单可校验:1000 以上当 id,小的当序号', () => {
    expect(resolveSkinValue(103, 103005)).toBe(103005);
    expect(resolveSkinValue(103, 5)).toBe(103005);
  });

  it('没有英雄编号 → 认不出来', () => {
    expect(resolveSkinValue(0, 5, ahriSkins)).toBe(0);
  });
});

describe('resolveSkinIndex', () => {
  it('皮肤 id = 英雄编号 × 1000 + 皮肤序号', () => {
    // 安妮(1)的「玉剑传说」= 1001 —— 国服客户端自己的数据
    expect(resolveSkinIndex(1, 1)).toBe(1001);
    // Aatrox(266)的一款皮肤 = 266001
    expect(resolveSkinIndex(266, 1)).toBe(266001);
    // 序号 0 是默认皮肤
    expect(resolveSkinIndex(103, 0)).toBe(103000);
    expect(resolveSkinIndex(103, 0) % 1000).toBe(0);
  });

  it('清单里没有 → 认不出来', () => {
    expect(resolveSkinIndex(103, 9, [103000, 103005])).toBe(0);
  });

  it('编号差对不上 → 按清单里的位置算(皮肤 id 不连续时位置 ≠ 编号差)', () => {
    // 清单是 [103000, 103005, 103006] —— 序号 1 指的是「第二个」那款
    expect(resolveSkinIndex(103, 1, [103000, 103005, 103006])).toBe(103005);
  });
});

describe('parseSkinIndex', () => {
  it('国服给的是 lastSelectedSkinIndex', () => {
    expect(parseSkinIndex({ lastSelectedSkinIndex: 3 })).toBe(3);
    expect(parseSkinIndex({ lastSelectedSkinIndex: '3' })).toBe(3);
    expect(parseSkinIndex({ selectedSkinIndex: 2 })).toBe(2);
  });

  it('序号 0 也是合法值(默认皮肤)', () => {
    expect(parseSkinIndex({ lastSelectedSkinIndex: 0 })).toBe(0);
  });

  it('字段缺 / 是空串 → 没有序号(不能当成 0)', () => {
    expect(parseSkinIndex({})).toBe(-1);
    expect(parseSkinIndex({ lastSelectedSkinIndex: '' })).toBe(-1);
    expect(parseSkinIndex({ lastSelectedSkinIndex: -1 })).toBe(-1);
  });
});

describe('parseGameflowSelf', () => {
  const team = [
    { championId: 64, teamOwner: false, puuid: 'ally-puuid', lastSelectedSkinIndex: 5 },
    { championId: 103, teamOwner: true, puuid: 'my-puuid', lastSelectedSkinIndex: 7 }
  ];

  it('认 teamOwner 那条 —— 皮肤只从「我」这条上取', () => {
    const self = parseGameflowSelf({ gameData: { teamOne: team } });
    expect(self.isSelf).toBe(true);
    expect(self.championId).toBe(103);
    expect(self.skinIndex).toBe(7);
  });

  it('没有 teamOwner 时靠 puuid 对上', () => {
    const self = parseGameflowSelf(
      { gameData: { teamOne: [{ championId: 103, puuid: 'my-puuid', lastSelectedSkinIndex: 2 }] } },
      'my-puuid'
    );
    expect(self.isSelf).toBe(true);
    expect(self.championId).toBe(103);
    expect(self.skinIndex).toBe(2);
  });

  it('认不出「我」是谁 → 皮肤不认,英雄编号可以宽松拿一个', () => {
    const noOwner = [
      { championId: 64, puuid: 'ally-puuid', lastSelectedSkinIndex: 5 },
      { championId: 103, puuid: 'my-puuid', lastSelectedSkinIndex: 7 }
    ];
    // 没给 puuid,队伍里也没有 teamOwner → 认定不了哪条是「我」
    const unknown = parseGameflowSelf({ gameData: { teamOne: noOwner } });
    expect(unknown.isSelf).toBe(false);
    expect(unknown.skinIndex).toBe(-1);
    expect(unknown.skinId).toBe(0);
    // 英雄编号宽松:队伍里第一个带英雄编号的
    expect(unknown.championId).toBe(64);
  });

  it('载荷不是那个形状 → 全空', () => {
    const self = parseGameflowSelf(null);
    expect(self.isSelf).toBe(false);
    expect(self.championId).toBe(0);
    expect(self.skinIndex).toBe(-1);
    expect(self.skinValue).toBe(-1);
  });

  it('国服给的 selectedSkinId 也认(是 id 还是序号靠清单消歧)', () => {
    const self = parseGameflowSelf({
      gameData: { teamOne: [{ championId: 103, teamOwner: true, selectedSkinId: 5 }] }
    });
    expect(self.skinValue).toBe(5);
    // 缺 selectedSkinId → -1(不能当成 0 = 默认皮肤)
    const missing = parseGameflowSelf({
      gameData: { teamOne: [{ championId: 103, teamOwner: true }] }
    });
    expect(missing.skinValue).toBe(-1);
  });
});

describe('resolveUsedSkin', () => {
  it('选人会话优先', () => {
    expect(
      resolveUsedSkin({
        champSelectSkinId: 111,
        gameflowSkinId: 333,
        matchHistorySkinId: 222,
        liveClientSkinName: 'name'
      })
    ).toEqual({ riotSkinId: 111, displayName: null, source: 'champ-select' });
  });

  it('选人会话没有就退到 gameflow', () => {
    expect(
      resolveUsedSkin({ gameflowSkinId: 333, matchHistorySkinId: 222, liveClientSkinName: 'name' })
    ).toEqual({ riotSkinId: 333, displayName: null, source: 'gameflow' });
  });

  it('国服只给皮肤序号 → 按「英雄编号 × 1000 + 序号」换算', () => {
    expect(
      resolveUsedSkin({
        gameflowSkinIndex: 7,
        gameflowChampionId: 103,
        matchHistorySkinId: 222,
        liveClientSkinName: 'name'
      })
    ).toEqual({ riotSkinId: 103007, displayName: null, source: 'gameflow-index' });
  });

  it('序号必须跟英雄编号成对 —— 没有英雄编号就不换算', () => {
    expect(resolveUsedSkin({ gameflowSkinIndex: 7 })).toEqual({
      riotSkinId: 0,
      displayName: null,
      source: null
    });
  });

  it('gameflow 给的数字 id 比序号换算更准', () => {
    expect(
      resolveUsedSkin({ gameflowSkinId: 103008, gameflowSkinIndex: 7, gameflowChampionId: 103 })
    ).toEqual({ riotSkinId: 103008, displayName: null, source: 'gameflow' });
  });

  it('选人会话和 gameflow 都没有就退到 match history', () => {
    expect(resolveUsedSkin({ matchHistorySkinId: 222, liveClientSkinName: 'name' })).toEqual({
      riotSkinId: 222,
      displayName: null,
      source: 'match-history'
    });
  });

  it('国服选人会话的 selectedSkinId —— 拿皮肤清单消歧', () => {
    expect(
      resolveUsedSkin({
        champSelectSkinValue: 5,
        champSelectChampionId: 103,
        knownSkinIds: (championId) => (championId === 103 ? [103000, 103005] : [])
      })
    ).toEqual({ riotSkinId: 103005, displayName: null, source: 'champ-select-value' });
  });

  it('选人会话那个值消歧不通过 → 不挡后面的来源', () => {
    expect(
      resolveUsedSkin({
        champSelectSkinValue: 9,
        champSelectChampionId: 103,
        knownSkinIds: () => [103000, 103005],
        gameflowSkinId: 333
      })
    ).toEqual({ riotSkinId: 333, displayName: null, source: 'gameflow' });
  });

  it('gameflow 序号换算出来的 id 不在清单里 → 认不出来', () => {
    expect(
      resolveUsedSkin({
        gameflowSkinIndex: 9,
        gameflowChampionId: 103,
        knownSkinIds: () => [103000, 103005]
      })
    ).toEqual({ riotSkinId: 0, displayName: null, source: null });
  });

  it('gameflow 的 selectedSkinId —— 拿皮肤清单消歧', () => {
    expect(
      resolveUsedSkin({
        gameflowSkinValue: 5,
        gameflowChampionId: 103,
        knownSkinIds: (championId) => (championId === 103 ? [103000, 103005] : [])
      })
    ).toEqual({ riotSkinId: 103005, displayName: null, source: 'gameflow-value' });
  });

  it('gameflow 的 selectedSkinId 消歧不通过 → 不挡后面的来源', () => {
    expect(
      resolveUsedSkin({
        gameflowSkinValue: 9,
        gameflowChampionId: 103,
        knownSkinIds: () => [103000, 103005],
        matchHistorySkinId: 222
      })
    ).toEqual({ riotSkinId: 222, displayName: null, source: 'match-history' });
  });

  it('gameflow 的 selectedSkinId 排前面(它是「id」,比序号可信)', () => {
    expect(
      resolveUsedSkin({
        gameflowSkinValue: 103005,
        gameflowSkinIndex: 9,
        gameflowChampionId: 103,
        knownSkinIds: () => [103000, 103005]
      })
    ).toEqual({ riotSkinId: 103005, displayName: null, source: 'gameflow-value' });
  });

  it('只剩 Live Client 的名字 → 只给名字,不编 id', () => {
    expect(resolveUsedSkin({ liveClientSkinName: 'name' })).toEqual({
      riotSkinId: 0,
      displayName: 'name',
      source: 'live-client'
    });
  });

  it('一条都没拿到 → 空(不猜,不按默认皮肤编一个 id)', () => {
    expect(resolveUsedSkin({})).toEqual({
      riotSkinId: 0,
      displayName: null,
      source: null
    });
  });
});
