import { describe, expect, it } from 'vitest';
import { parseChampSelectMembers, parseChampSelectSession } from '../champSelect';
import type { StaticData } from '../staticData';

const staticData: StaticData = {
  version: '14.1.1',
  champions: new Map([
    [1, { name: '安妮', iconUrl: 'https://cdn/annie.png' }],
    [64, { name: '李青', iconUrl: 'https://cdn/lee.png' }]
  ]),
  items: new Map(),
  runes: new Map()
};

describe('parseChampSelectMembers', () => {
  it('中文名取静态数据,头像地址按 id 拼', () => {
    const members = parseChampSelectMembers(
      [{ championId: 1, assignedPosition: 'MIDDLE', cellId: 3, summonerId: 111 }],
      staticData
    );
    expect(members).toEqual([
      {
        championId: 1,
        championName: '安妮',
        championIconUrl: 'lcuicon://champion/1.png',
        assignedPosition: 'MIDDLE',
        cellId: 3,
        summonerId: 111
      }
    ]);
  });

  it('静态数据里没有的英雄退回 #id,头像地址照样按 id 拼', () => {
    const members = parseChampSelectMembers([{ championId: 999 }], staticData);
    expect(members[0].championName).toBe('#999');
    expect(members[0].championIconUrl).toBe('lcuicon://champion/999.png');
  });

  it('非数组输入返回空数组', () => {
    expect(parseChampSelectMembers({}, staticData)).toEqual([]);
  });
});

describe('parseChampSelectSession', () => {
  const raw = {
    localPlayerCellId: 4,
    myTeam: [
      { championId: 64, assignedPosition: 'JUNGLE', cellId: 4, summonerId: 222 },
      { championId: 1, assignedPosition: 'MIDDLE', cellId: 5, summonerId: 333 }
    ],
    theirTeam: [{ championId: 1, assignedPosition: 'TOP', cellId: 0, summonerId: 999 }],
    bans: { myTeamBans: [64, 0], theirTeamBans: [1] }
  };

  it('通过 summonerId 认出「我」', () => {
    const session = parseChampSelectSession(raw, staticData, 222);
    expect(session?.myChampionId).toBe(64);
    expect(session?.myRole).toBe('JUNGLE');
    expect(session?.myCellId).toBe(4);
  });

  it('summonerId 对不上时退回 localPlayerCellId', () => {
    const session = parseChampSelectSession(raw, staticData, -1);
    expect(session?.myChampionId).toBe(64);
    expect(session?.myCellId).toBe(4);
  });

  it('禁用英雄带出名字,并过滤掉 0', () => {
    const session = parseChampSelectSession(raw, staticData, 222);
    expect(session?.bannedChampions.map((c) => c.championId)).toEqual([64, 1]);
    expect(session?.bannedChampions[0].championName).toBe('李青');
  });

  it('两边都没人时返回 null', () => {
    expect(parseChampSelectSession({ myTeam: [], theirTeam: [] }, staticData, 1)).toBeNull();
  });

  it('非对象输入返回 null', () => {
    expect(parseChampSelectSession(null, staticData, 1)).toBeNull();
  });
});
