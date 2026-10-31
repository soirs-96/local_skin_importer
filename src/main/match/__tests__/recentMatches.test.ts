import { describe, expect, it } from 'vitest';
import { extractGames, parseMatchEntry, parseRecentMatches } from '../recentMatches';
import type { StaticData } from '../staticData';

const staticData: StaticData = {
  version: '14.1.1',
  champions: new Map([[1, { name: '安妮', iconUrl: 'https://cdn/annie.png' }]]),
  items: new Map([[1001, { name: '破败王者之刃', iconUrl: 'https://cdn/1001.png' }]]),
  runes: new Map()
};

describe('extractGames', () => {
  it('直接就是数组', () => {
    expect(extractGames([{ gameId: 1 }])).toHaveLength(1);
  });

  it('{"games": [...]}', () => {
    expect(extractGames({ games: [{ gameId: 1 }, { gameId: 2 }] })).toHaveLength(2);
  });

  it('{"games": {"gameId": {...}}}', () => {
    expect(extractGames({ games: { 1: { gameId: 1 } } })).toHaveLength(1);
  });

  it('{"games": {"games": [...], "gameCount": N}}', () => {
    expect(extractGames({ games: { games: [{ gameId: 1 }], gameCount: 1 } })).toHaveLength(1);
  });

  it('认不出来就是空数组', () => {
    expect(extractGames({ nope: 1 })).toEqual([]);
    expect(extractGames(null)).toEqual([]);
  });
});

describe('parseMatchEntry', () => {
  it('解析简化版(stats 挂在顶层)', () => {
    const match = parseMatchEntry(
      {
        gameId: 11,
        championId: 1,
        gameMode: 'CLASSIC',
        gameCreation: 1700000000000,
        gameDuration: 1500,
        stats: { kills: 3, deaths: 1, assists: 8, win: true, item0: 1001 }
      },
      staticData
    );
    expect(match).not.toBeNull();
    expect(match?.championName).toBe('安妮');
    expect(match?.kda).toBe('3/1/8');
    expect(match?.win).toBe(true);
    expect(match?.items[0].name).toBe('破败王者之刃');
  });

  it('标准版靠 puuid 在 participantIdentities 里定位「我」', () => {
    const match = parseMatchEntry(
      {
        gameId: 12,
        participants: [
          {
            participantId: 1,
            championId: 1,
            stats: { kills: 0, deaths: 9, assists: 0, win: false }
          },
          { participantId: 2, championId: 1, stats: { kills: 7, deaths: 2, assists: 3, win: true } }
        ],
        participantIdentities: [
          { participantId: 1, player: { summonerId: 10, puuid: 'other-puuid' } },
          { participantId: 2, player: { summonerId: 20, puuid: 'my-puuid' } }
        ]
      },
      staticData,
      'my-puuid'
    );
    expect(match?.kills).toBe(7);
    expect(match?.win).toBe(true);
  });

  it('没有 puuid 时认不出「我」,只能退到第一条', () => {
    const match = parseMatchEntry(
      {
        gameId: 12,
        participants: [
          {
            participantId: 1,
            championId: 1,
            stats: { kills: 0, deaths: 9, assists: 0, win: false }
          },
          { participantId: 2, championId: 1, stats: { kills: 7, deaths: 2, assists: 3, win: true } }
        ],
        participantIdentities: [
          { participantId: 1, player: { summonerId: 10, puuid: 'other-puuid' } },
          { participantId: 2, player: { summonerId: 20, puuid: 'my-puuid' } }
        ]
      },
      staticData
    );
    expect(match?.kills).toBe(0);
  });

  it('物品列表过滤掉 id 为 0 的空位', () => {
    const match = parseMatchEntry(
      {
        gameId: 13,
        championId: 1,
        stats: { kills: 0, deaths: 0, assists: 0, item0: 0, item1: 1001 }
      },
      staticData
    );
    expect(match?.items).toHaveLength(1);
  });

  it('非对象返回 null', () => {
    expect(parseMatchEntry('nope', staticData)).toBeNull();
  });
});

describe('parseRecentMatches', () => {
  it('统计总数、胜场和胜率', () => {
    const summary = parseRecentMatches(
      {
        games: [
          { gameId: 1, championId: 1, stats: { kills: 1, deaths: 0, assists: 0, win: true } },
          { gameId: 2, championId: 1, stats: { kills: 0, deaths: 1, assists: 0, win: false } }
        ]
      },
      staticData
    );
    expect(summary.total).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.winrate).toBeCloseTo(0.5);
  });

  it('空列表的胜率是 0', () => {
    const summary = parseRecentMatches({ games: [] }, staticData);
    expect(summary.total).toBe(0);
    expect(summary.winrate).toBe(0);
  });
});
