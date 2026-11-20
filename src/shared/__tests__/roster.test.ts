import { describe, expect, it } from 'vitest';
import { buildRoster, rosterFromOpponent } from '../roster';
import type { ChampSelectMember, ChampSelectSession, Opponent } from '../match';

function member(overrides: Partial<ChampSelectMember> = {}): ChampSelectMember {
  return {
    championId: 523,
    championName: '阿萝拉',
    championIconUrl: 'lcuicon://champion/523.png',
    assignedPosition: 'MIDDLE',
    cellId: 1,
    skinId: 0,
    selectedSkinId: -1,
    summonerId: 100,
    puuid: 'puuid-a',
    displayName: '队友甲',
    tagLine: '',
    summonerLevel: 120,
    profileIconId: 7,
    rankedDisplay: '荣耀黄金 III',
    ...overrides
  };
}

function session(overrides: Partial<ChampSelectSession> = {}): ChampSelectSession {
  return {
    myTeam: [member({ cellId: 1 }), member({ cellId: 2, displayName: '队友乙', puuid: 'puuid-b' })],
    theirTeam: [],
    myRole: 'MIDDLE',
    myChampionId: 523,
    mySkinId: 0,
    mySelectedSkinId: -1,
    myCellId: 1,
    bannedChampions: [],
    ...overrides
  };
}

function opponent(overrides: Partial<Opponent> = {}): Opponent {
  return {
    summonerId: 200,
    puuid: 'puuid-enemy',
    summonerName: '对手甲',
    championId: 142,
    championName: '凯南',
    championIconUrl: 'lcuicon://champion/142.png',
    profileIconId: 0,
    side: 'enemy',
    isSelf: false,
    ...overrides
  };
}

describe('buildRoster', () => {
  it('选人阶段列出我方队友 —— 进选人就有队友信息', () => {
    const roster = buildRoster([], session());

    expect(roster).toHaveLength(2);
    expect(roster.every((p) => p.side === 'ally')).toBe(true);
    expect(roster[0].name).toBe('队友甲');
    expect(roster[0].rankText).toBe('荣耀黄金 III');
    expect(roster[0].level).toBe(120);
    expect(roster[0].avatarUrl).toBe('lcuicon://profile/7.jpg');
  });

  it('选人阶段把「我」标出来', () => {
    const roster = buildRoster([], session());

    expect(roster.filter((p) => p.isSelf)).toHaveLength(1);
    expect(roster.find((p) => p.isSelf)?.name).toBe('队友甲');
  });

  it('选人阶段不列对方 —— 客户端本来就不给身份', () => {
    const roster = buildRoster([opponent({ side: 'enemy' })], session());

    expect(roster.every((p) => p.side === 'ally')).toBe(true);
    expect(roster.some((p) => p.name === '对手甲')).toBe(false);
  });

  it('不在选人阶段就列 gameflow 的两队人', () => {
    const roster = buildRoster(
      [opponent({ side: 'ally', summonerName: '队友甲' }), opponent({ side: 'enemy' })],
      null
    );

    expect(roster).toHaveLength(2);
    expect(roster.filter((p) => p.side === 'ally')).toHaveLength(1);
    expect(roster.filter((p) => p.side === 'enemy')).toHaveLength(1);
  });

  it('没有选人也没有对局就是空的', () => {
    expect(buildRoster([], null)).toEqual([]);
  });
});

describe('rosterFromOpponent', () => {
  it('有头像编号才拼头像地址', () => {
    expect(rosterFromOpponent(opponent({ profileIconId: 9 })).avatarUrl).toBe(
      'lcuicon://profile/9.jpg'
    );
    expect(rosterFromOpponent(opponent({ profileIconId: 0 })).avatarUrl).toBeNull();
  });

  it('gameflow 不给段位和等级 —— 不编一个出来', () => {
    const row = rosterFromOpponent(opponent());

    expect(row.rankText).toBe('');
    expect(row.level).toBe(0);
  });

  it('「我」的标记照搬 gameflow', () => {
    expect(rosterFromOpponent(opponent({ isSelf: true })).isSelf).toBe(true);
  });
});
