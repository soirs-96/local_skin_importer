import { describe, expect, it } from 'vitest';
import { gameModeLabel, gameTitle, laneLabel, queueIdLabel } from '../gameLabels';

describe('gameModeLabel', () => {
  it('认得的游戏代号给出中文名', () => {
    expect(gameModeLabel('CLASSIC')).toBe('召唤师峡谷');
    expect(gameModeLabel('ARAM')).toBe('嚎哭深渊');
  });

  it('小写的代号也认', () => {
    expect(gameModeLabel('kiwi')).toBe('召唤师峡谷');
  });

  it('认不出来的给空串 —— 不显示英文代号', () => {
    expect(gameModeLabel('WHATEVER')).toBe('');
    expect(gameModeLabel('')).toBe('');
  });
});

describe('queueIdLabel', () => {
  it('排位队列有名字', () => {
    expect(queueIdLabel(420)).toBe('单双排');
    expect(queueIdLabel(400)).toBe('灵活排位');
  });

  it('2400 不给名字 —— 腾讯这套编号是匹配还是排位没验证过', () => {
    expect(queueIdLabel(2400)).toBe('');
  });

  it('认不出来的给空串', () => {
    expect(queueIdLabel(99999)).toBe('');
  });
});

describe('laneLabel', () => {
  it('分路有中文', () => {
    expect(laneLabel('MIDDLE')).toBe('中单');
    expect(laneLabel('JUNGLE')).toBe('打野');
  });

  it('没有位置就是空', () => {
    expect(laneLabel('NONE')).toBe('');
    expect(laneLabel('')).toBe('');
  });
});

describe('gameTitle', () => {
  it('模式认不出就退回队列名', () => {
    expect(gameTitle('WHATEVER', 420)).toBe('单双排');
  });

  it('模式和队列同名就只显示一次', () => {
    expect(gameTitle('CLASSIC', 2400)).toBe('召唤师峡谷');
  });

  it('模式和队列不同就两个都显示', () => {
    expect(gameTitle('KIWI', 420)).toBe('召唤师峡谷 · 单双排');
  });
});
