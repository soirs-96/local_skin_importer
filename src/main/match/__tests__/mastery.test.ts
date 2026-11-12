import { describe, expect, it } from 'vitest';
import { masteryPath, parseChampionMastery } from '../mastery';
import type { StaticData } from '../staticData';

const staticData: StaticData = {
  version: '14.1.1',
  champions: new Map([
    [523, { name: '阿萝拉', iconUrl: 'lcuicon://champion/523.png' }],
    [142, { name: '凯南', iconUrl: 'lcuicon://champion/142.png' }]
  ]),
  items: new Map(),
  runes: new Map()
};

describe('masteryPath', () => {
  it('路径里放的是 puuid', () => {
    expect(masteryPath('abc-123')).toBe('/lol-champion-mastery/v1/abc-123/champion-mastery');
  });

  it('没有 puuid 就没路径', () => {
    expect(masteryPath('')).toBeNull();
  });
});

describe('parseChampionMastery', () => {
  it('读出等级、点数、评级和最近使用时间', () => {
    const entries = parseChampionMastery(
      [
        {
          championId: 523,
          championLevel: 24,
          championPoints: 231381,
          highestGrade: 'S+',
          lastPlayTime: 1794315181000,
          tokensEarned: 32
        }
      ],
      staticData
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].championName).toBe('阿萝拉');
    expect(entries[0].championLevel).toBe(24);
    expect(entries[0].championPoints).toBe(231381);
    expect(entries[0].highestGrade).toBe('S+');
    expect(entries[0].lastPlayTime).toBe(1794315181000);
    expect(entries[0].tokensEarned).toBe(32);
    expect(entries[0].championIconUrl).toBe('lcuicon://champion/523.png');
  });

  it('按点数降序 —— 点数最高的那个就是本命英雄', () => {
    const entries = parseChampionMastery(
      [
        { championId: 142, championLevel: 13, championPoints: 116404 },
        { championId: 523, championLevel: 24, championPoints: 231381 }
      ],
      staticData
    );
    expect(entries.map((e) => e.championId)).toEqual([523, 142]);
  });

  it('静态数据里没有这个英雄时名字退回编号', () => {
    const entries = parseChampionMastery([{ championId: 999, championPoints: 10 }], staticData);
    expect(entries[0].championName).toBe('#999');
    expect(entries[0].championIconUrl).toBe('lcuicon://champion/999.png');
  });

  it('缺字段不炸,按 0 / 空串处理', () => {
    const entries = parseChampionMastery([{ championId: 142 }], staticData);
    expect(entries[0].championLevel).toBe(0);
    expect(entries[0].championPoints).toBe(0);
    expect(entries[0].highestGrade).toBe('');
    expect(entries[0].lastPlayTime).toBe(0);
  });

  it('非数组输入返回空数组', () => {
    expect(parseChampionMastery({ oops: true }, staticData)).toEqual([]);
    expect(parseChampionMastery(null, staticData)).toEqual([]);
  });

  it('没有 championId 的条目丢掉', () => {
    expect(parseChampionMastery([{ championPoints: 100 }], staticData)).toEqual([]);
  });
});
