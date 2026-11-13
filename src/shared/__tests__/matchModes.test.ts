import { describe, expect, it } from 'vitest';
import {
  ALL_MODES,
  filterByMatchMode,
  matchModeKey,
  matchModeLabel,
  matchModeOptions
} from '../matchModes';

describe('matchModeKey', () => {
  it('召唤师峡谷的普通匹配是匹配模式', () => {
    expect(matchModeKey({ mapId: 11, queueId: 2400 })).toBe('normal');
  });

  it('大乱斗按地图认,不靠队列号', () => {
    expect(matchModeKey({ mapId: 12, queueId: 450 })).toBe('aram');
    expect(matchModeKey({ mapId: 12, queueId: 9999 })).toBe('aram');
  });

  it('排位分单双排和灵活排位', () => {
    expect(matchModeKey({ mapId: 11, queueId: 420 })).toBe('solo');
    expect(matchModeKey({ mapId: 11, queueId: 440 })).toBe('solo');
    expect(matchModeKey({ mapId: 11, queueId: 400 })).toBe('flex');
  });

  it('极限闪击跑在召唤师峡谷上', () => {
    expect(matchModeKey({ mapId: 11, queueId: 490 })).toBe('urf');
  });

  it('认不出来的队列号不猜 —— 归到自己那一档', () => {
    expect(matchModeKey({ mapId: 11, queueId: 1234 })).toBe('queue:1234');
    expect(matchModeLabel({ mapId: 11, queueId: 1234 })).toBe('其他模式 #1234');
  });
});

describe('matchModeOptions', () => {
  it('只列真实存在的模式,并给出局数', () => {
    const options = matchModeOptions([
      { mapId: 11, queueId: 420 },
      { mapId: 11, queueId: 440 },
      { mapId: 12, queueId: 450 }
    ]);

    expect(options.map((option) => option.key)).toEqual(['aram', 'solo']);
    expect(options.find((option) => option.key === 'solo')?.count).toBe(2);
    expect(options.find((option) => option.key === 'aram')?.count).toBe(1);
  });

  it('已知的模式按常用程度排,认不出来的排最后', () => {
    const options = matchModeOptions([
      { mapId: 11, queueId: 1234 },
      { mapId: 11, queueId: 490 },
      { mapId: 11, queueId: 2400 },
      { mapId: 11, queueId: 400 }
    ]);

    expect(options.map((option) => option.key)).toEqual(['normal', 'flex', 'urf', 'queue:1234']);
  });

  it('一局都没有就没有选项', () => {
    expect(matchModeOptions([])).toEqual([]);
  });
});

describe('filterByMatchMode', () => {
  const games = [
    { mapId: 11, queueId: 420, tag: '排位' },
    { mapId: 12, queueId: 450, tag: '大乱斗' },
    { mapId: 11, queueId: 2400, tag: '匹配' }
  ];

  it('按模式挑出对局', () => {
    expect(filterByMatchMode(games, 'aram')).toEqual([games[1]]);
    expect(filterByMatchMode(games, 'solo')).toEqual([games[0]]);
  });

  it('全部模式原样返回', () => {
    expect(filterByMatchMode(games, ALL_MODES)).toEqual(games);
  });
});
