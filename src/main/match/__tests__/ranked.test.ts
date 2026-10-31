import { describe, expect, it } from 'vitest';
import {
  extractRankedFromProfile,
  formatRankDisplay,
  parseRankedEntries,
  queueLabel
} from '../ranked';

describe('formatRankDisplay', () => {
  it('给出中文段位 + 罗马数字', () => {
    expect(formatRankDisplay('GOLD', 'II')).toBe('华贵黄金 II');
  });

  it('大师段位没有小分区时只显示段位名', () => {
    expect(formatRankDisplay('MASTER', '')).toBe('超凡大师');
  });

  it('未知段位原样返回', () => {
    expect(formatRankDisplay('WHATEVER', '')).toBe('WHATEVER');
  });
});

describe('queueLabel', () => {
  it('已知队列给中文名', () => {
    expect(queueLabel('RANKED_SOLO_5x5')).toBe('单双排');
  });

  it('未知队列原样返回', () => {
    expect(queueLabel('CUSTOM_5X5')).toBe('CUSTOM_5X5');
  });
});

describe('parseRankedEntries', () => {
  it('解析数组形状并算胜率', () => {
    const entries = parseRankedEntries([
      {
        queueType: 'RANKED_SOLO_5x5',
        tier: 'GOLD',
        division: 'II',
        wins: 30,
        losses: 20,
        leaguePoints: 45
      }
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].display).toBe('华贵黄金 II');
    expect(entries[0].winrate).toBeCloseTo(0.6);
    expect(entries[0].leaguePoints).toBe(45);
  });

  it('解析 { queues: [...] } 形状', () => {
    const entries = parseRankedEntries({
      queues: [
        { queueType: 'RANKED_FLEX_SR', tier: 'PLATINUM', division: 'IV', wins: 1, losses: 1 }
      ]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].queueType).toBe('RANKED_FLEX_SR');
  });

  it('老客户端的 rank 字段也认', () => {
    const entries = parseRankedEntries([{ queueType: 'X', tier: 'SILVER', rank: 'III' }]);
    expect(entries[0].division).toBe('III');
  });

  it('没有 tier 的条目直接丢掉', () => {
    expect(parseRankedEntries([{ queueType: 'X', wins: 3 }])).toEqual([]);
  });

  it('胜场负场都是 0 时胜率是 0 而不是 NaN', () => {
    const entries = parseRankedEntries([{ queueType: 'X', tier: 'GOLD', wins: 0, losses: 0 }]);
    expect(entries[0].winrate).toBe(0);
  });
});

describe('extractRankedFromProfile', () => {
  it('从 rankedQueues 里取', () => {
    const entries = extractRankedFromProfile({
      rankedQueues: [
        { queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', division: 'I', wins: 5, losses: 5 }
      ]
    });
    expect(entries[0].tier).toBe('DIAMOND');
  });

  it('退到 regalia.highestRankedEntry', () => {
    const entries = extractRankedFromProfile({
      regalia: { highestRankedEntry: { tier: 'EMERALD', division: 'IV', queue: 'RANKED_FLEX_SR' } }
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].tier).toBe('EMERALD');
    expect(entries[0].queueType).toBe('RANKED_FLEX_SR');
    expect(entries[0].wins).toBe(0);
  });

  it('什么都没有时返回空数组', () => {
    expect(extractRankedFromProfile({})).toEqual([]);
    expect(extractRankedFromProfile(null)).toEqual([]);
  });
});
