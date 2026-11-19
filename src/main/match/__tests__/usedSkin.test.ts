import { describe, expect, it } from 'vitest';
import {
  parseGameflowSelf,
  parseMatchHistorySkinId,
  parseSkinIndex,
  resolveUsedSkin,
  skinIdFromIndex
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

describe('skinIdFromIndex', () => {
  it('皮肤 id = 英雄编号 × 1000 + 皮肤序号', () => {
    // 安妮(1)的「玉剑传说」= 1001 —— 国服客户端自己的数据
    expect(skinIdFromIndex(1, 1)).toBe(1001);
    // Aatrox(266)的一款皮肤 = 266001
    expect(skinIdFromIndex(266, 1)).toBe(266001);
    // 序号 0 是默认皮肤
    expect(skinIdFromIndex(103, 0)).toBe(103000);
    expect(skinIdFromIndex(103, 0) % 1000).toBe(0);
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
