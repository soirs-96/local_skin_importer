import { describe, it, expect } from 'vitest';
import { describeRegion, displayName, emptyRegionText, regionUserRiotId } from '../regionUsers';
import type { RegionUser, RegionUsersResult } from '../regionUsers';

/** 一个同区用户 —— 分数和位置都是匹配时才有,这里默认都没有。 */
function user(overrides: Partial<RegionUser> = {}): RegionUser {
  return {
    id: 1,
    nickname: '林俊杰',
    gameId: '18557',
    avatarUrl: '',
    skinCount: 3,
    rank: null,
    rankScoreDiff: null,
    collectionScore: null,
    collectionDiff: null,
    positions: [],
    positionLabels: [],
    vip: false,
    ...overrides
  };
}

function result(overrides: Partial<RegionUsersResult> = {}): RegionUsersResult {
  return {
    myZone: '艾欧尼亚',
    myZoneKnown: true,
    totalInZone: 12,
    userCount: 0,
    myRank: null,
    myCollectionScore: null,
    myPositions: [],
    myPositionLabels: [],
    myVip: false,
    myVipUntil: null,
    users: [],
    ...overrides
  };
}

describe('describeRegion', () => {
  it('说清楚我在哪个区、这个区多少人', () => {
    expect(describeRegion(result())).toBe('你在 艾欧尼亚 区 · 同区 12 人');
  });

  it('这个区就我一个人时说出来', () => {
    expect(describeRegion(result({ totalInZone: 1 }))).toBe(
      '你在 艾欧尼亚 区 · 这个区目前就你一个人'
    );
  });

  it('认不出大区时给下一步,而不是干巴巴一句无数据', () => {
    const text = describeRegion(result({ myZone: null, totalInZone: 0 }));
    expect(text).toContain('还没认出你在哪个区');
    expect(text).toContain('同步');
  });

  it('还没拉过的时候不瞎编', () => {
    expect(describeRegion(null)).toBe('');
  });
});

describe('displayName', () => {
  it('优先用昵称', () => {
    expect(displayName(user({ nickname: '林俊杰' }))).toBe('林俊杰');
  });

  it('没昵称就退回游戏ID', () => {
    expect(displayName(user({ nickname: '' }))).toBe('18557');
  });

  it('两个都没有也给个能看的名字', () => {
    expect(displayName(user({ nickname: '', gameId: '' }))).toBe('无名召唤师');
  });
});

describe('regionUserRiotId', () => {
  it('昵称和标签拼一起 —— 光有数字标签没法加好友', () => {
    expect(regionUserRiotId(user())).toBe('林俊杰#18557');
  });

  it('没昵称就只有标签', () => {
    expect(regionUserRiotId(user({ nickname: '' }))).toBe('18557');
  });

  it('没标签就只有昵称', () => {
    expect(regionUserRiotId(user({ gameId: '' }))).toBe('林俊杰');
  });

  it('两个都没有就是空串 —— 别复制出「#」', () => {
    expect(regionUserRiotId(user({ nickname: '', gameId: '' }))).toBe('');
  });
});

describe('emptyRegionText', () => {
  it('区里没人时说实话', () => {
    expect(emptyRegionText(result({ totalInZone: 1 }))).toContain('还没别人入驻');
  });

  it('区里有人但没留游戏ID也说清楚', () => {
    expect(emptyRegionText(result())).toContain('没留下游戏ID');
  });

  it('没认出大区时先说大区的事', () => {
    expect(emptyRegionText(result({ myZone: null }))).toBe('先认出大区才能拉同区的人');
  });
});
