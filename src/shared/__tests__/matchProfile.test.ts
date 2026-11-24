import { describe, expect, it } from 'vitest';
import { normalizeQueueType, positionCodeLabel, toPositionCode } from '../matchProfile';

describe('normalizeQueueType', () => {
  it('大小写归一', () => {
    expect(normalizeQueueType('RANKED_SOLO_5X5')).toBe('RANKED_SOLO_5x5');
    expect(normalizeQueueType('ranked_solo_5x5')).toBe('RANKED_SOLO_5x5');
    expect(normalizeQueueType('RANKED_FLEX_5X5')).toBe('RANKED_FLEX_5x5');
  });

  it('同一个灵活排位有的版本叫 SR', () => {
    expect(normalizeQueueType('RANKED_FLEX_SR')).toBe('RANKED_FLEX_5x5');
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
