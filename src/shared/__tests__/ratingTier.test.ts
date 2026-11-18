import { describe, expect, it } from 'vitest';
import { RATING_DIMENSIONS, RATING_TIERS, rankMap, scoreToTier, toTen } from '../ratingTier';

describe('toTen', () => {
  it('1~5 分制换算成 10 分制,保留一位小数', () => {
    expect(toTen(1)).toBe(2);
    expect(toTen(3)).toBe(6);
    expect(toTen(4.5)).toBe(9);
    expect(toTen(2.5)).toBe(5);
  });

  it('空值原样返回 null —— 不拿 0 顶替', () => {
    expect(toTen(null)).toBeNull();
    expect(toTen(undefined)).toBeNull();
  });
});

describe('scoreToTier', () => {
  it('10 分制总分映射到段位', () => {
    expect(scoreToTier(9)).toBe('hang');
    expect(scoreToTier(9.5)).toBe('hang');
    expect(scoreToTier(8.9)).toBe('top');
    expect(scoreToTier(8)).toBe('top');
    expect(scoreToTier(6.5)).toBe('above');
    expect(scoreToTier(5)).toBe('npc');
    expect(scoreToTier(4.9)).toBe('trash');
  });

  it('空值当 NPC —— 跟小程序一致', () => {
    expect(scoreToTier(null)).toBe('npc');
    expect(scoreToTier(undefined)).toBe('npc');
  });
});

describe('rankMap', () => {
  it('单维星级映射到段位文案', () => {
    expect(rankMap(5)).toBe('夯');
    expect(rankMap(4)).toBe('顶级');
    expect(rankMap(3)).toBe('人上人');
    expect(rankMap(2)).toBe('NPC');
    expect(rankMap(1)).toBe('拉完了');
  });

  it('认不出来的星级返回空串', () => {
    expect(rankMap(0)).toBe('');
    expect(rankMap(2.5)).toBe('');
  });
});

describe('两套口径不能合并', () => {
  it('scoreToTier 吃 10 分制,rankMap 吃 1~5 星 —— 同一个数结论不一样', () => {
    // 5.0 分的总分是「NPC」,但 5 不是合法的星级
    expect(scoreToTier(5)).toBe('npc');
    expect(rankMap(5)).toBe('夯');
    // 2.5 星在 rankMap 里没有对应项
    expect(rankMap(2.5)).toBe('');
    expect(scoreToTier(2.5)).toBe('trash');
  });
});

describe('维度标签', () => {
  it('四个维度的标签跟小程序一字不差', () => {
    expect(RATING_DIMENSIONS.map((d) => d.label)).toEqual([
      '手感巅峰',
      '原画天花板',
      '局部模型',
      '嘲讽拉满'
    ]);
    expect(RATING_DIMENSIONS.map((d) => d.key)).toEqual([
      'handFeel',
      'artwork',
      'model',
      'mockery'
    ]);
  });
});

describe('段位元数据', () => {
  it('五个段位都有文案', () => {
    expect(Object.keys(RATING_TIERS)).toEqual(['hang', 'top', 'above', 'npc', 'trash']);
    expect(RATING_TIERS.hang.label).toBe('夯');
    expect(RATING_TIERS.npc.label).toBe('NPC');
  });
});
