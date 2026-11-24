import { describe, expect, it } from 'vitest';
import {
  isRankedQueueType,
  normalizeQueueType,
  positionCodeLabel,
  scoreRecentMatch,
  toPositionCode
} from '../matchProfile';

describe('normalizeQueueType / isRankedQueueType', () => {
  it('大小写归一', () => {
    expect(normalizeQueueType('RANKED_SOLO_5X5')).toBe('RANKED_SOLO_5x5');
    expect(normalizeQueueType('ranked_solo_5x5')).toBe('RANKED_SOLO_5x5');
    expect(normalizeQueueType('RANKED_FLEX_5X5')).toBe('RANKED_FLEX_5x5');
  });

  it('同一个灵活排位有的版本叫 SR', () => {
    expect(normalizeQueueType('RANKED_FLEX_SR')).toBe('RANKED_FLEX_5x5');
  });

  it('只认单双排和灵活排', () => {
    expect(isRankedQueueType('RANKED_SOLO_5x5')).toBe(true);
    expect(isRankedQueueType('RANKED_FLEX_5x5')).toBe(true);
    expect(isRankedQueueType('ARAM')).toBe(false);
    expect(isRankedQueueType('NORMAL_BLIND')).toBe(false);
  });
});

describe('toPositionCode / positionCodeLabel', () => {
  it('机器键 → 后端代码', () => {
    expect(toPositionCode('MID')).toBe('mid');
    expect(toPositionCode('ADC')).toBe('adc');
  });

  it('认不出来返回 null', () => {
    expect(toPositionCode('UNKNOWN')).toBeNull();
  });

  it('代码 → 中文', () => {
    expect(positionCodeLabel('mid')).toBe('中单');
    expect(positionCodeLabel('乱写的')).toBe('');
  });
});

describe('scoreRecentMatch', () => {
  it('满分表现给 100', () => {
    const score = scoreRecentMatch({
      kills: 10,
      deaths: 2,
      assists: 10,
      minionKills: 300,
      durationS: 1800,
      win: true,
      position: 'mid'
    });
    expect(score).toBe(100);
  });

  it('永远落在 0~100', () => {
    const score = scoreRecentMatch({
      kills: 30,
      deaths: 0,
      assists: 30,
      minionKills: 900,
      durationS: 1200,
      win: true,
      position: 'adc'
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('输了但打得好的局不会太低 —— 胜负只占四分之一', () => {
    const score = scoreRecentMatch({
      kills: 8,
      deaths: 3,
      assists: 12,
      minionKills: 260,
      durationS: 1800,
      win: false,
      position: 'mid'
    });
    // KDA 满分(20/3 → 封顶)补刀满分(8.67/6.8 → 封顶)只有胜负扣分
    expect(score).toBe(85);
  });

  it('补刀按位置折算 —— 辅助不会因为补刀少就吃零分', () => {
    const base = {
      kills: 1,
      deaths: 3,
      assists: 10,
      minionKills: 100,
      durationS: 1800,
      win: true
    };
    const adc = scoreRecentMatch({ ...base, position: 'adc' });
    const support = scoreRecentMatch({ ...base, position: 'support' });
    expect(support).toBeGreaterThan(adc);
  });

  it('认不出位置也有基准 —— 不会算出 0 分', () => {
    const score = scoreRecentMatch({
      kills: 3,
      deaths: 2,
      assists: 5,
      minionKills: 120,
      durationS: 1800,
      win: true,
      position: ''
    });
    expect(score).toBeGreaterThan(0);
  });

  it('读不出时长时不至于把补刀率算成 0', () => {
    const score = scoreRecentMatch({
      kills: 3,
      deaths: 2,
      assists: 5,
      minionKills: 120,
      durationS: 0,
      win: true,
      position: 'mid'
    });
    expect(score).toBeGreaterThan(0);
  });
});
