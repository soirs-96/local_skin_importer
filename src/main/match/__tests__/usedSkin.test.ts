import { describe, expect, it } from 'vitest';
import { parseMatchHistorySkinId, resolveUsedSkin } from '../usedSkin';

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
