import { describe, expect, it } from 'vitest';
import { buildLobbyProfile, fetchLobbyPlayerProfile, PROFILE_MATCH_LIMIT } from '../profile';
import type { LobbyProfileSource } from '../profile';
import type { PlayerGame, PlayerLookup, PlayerPeer } from '../../../shared/match';

function peer(overrides: Partial<PlayerPeer> = {}): PlayerPeer {
  return {
    puuid: 'p0',
    displayName: '某人',
    championId: 1,
    championName: '甲',
    championIconUrl: null,
    kills: 2,
    deaths: 2,
    assists: 2,
    kda: '2/2/2',
    win: true,
    teamId: 100,
    isTarget: false,
    goldEarned: 10000,
    damageToChampions: 10000,
    minionKills: 100,
    lane: 'MIDDLE',
    role: 'SOLO',
    ...overrides
  };
}

function team(teamId: number, tag: string, count: number): PlayerPeer[] {
  return Array.from({ length: count }, (_, i) =>
    peer({ puuid: `${tag}-${teamId}-${i}`, teamId })
  );
}

/**
 * 十个人的排位局,蓝队第一个人是「被查的那个人」。
 *
 * <p>位置看的是**目标队友**的 lane/role —— 评分引擎是拿那一个人的明细判位置的,
 * 不是看对局顶层的字段。
 */
function rankedGame(gameId: string, timestampMs: number, overrides: Partial<PlayerGame> = {}): PlayerGame {
  const peers = [...team(100, 'blue', 5), ...team(200, 'red', 5)];
  peers[0] = {
    ...peers[0],
    kills: 4,
    deaths: 1,
    assists: 4,
    kda: '4/1/4',
    isTarget: true,
    lane: overrides.lane ?? 'MIDDLE',
    role: overrides.role ?? 'SOLO'
  };
  return {
    gameId,
    timestampMs,
    durationS: 1800,
    queueId: 420,
    gameMode: 'KIWI',
    mapId: 11,
    championId: 1,
    championName: '甲',
    championIconUrl: null,
    kills: 4,
    deaths: 1,
    assists: 4,
    kda: '4/1/4',
    win: true,
    lane: 'MIDDLE',
    role: 'SOLO',
    goldEarned: 12000,
    damageToChampions: 12000,
    minionKills: 120,
    gameMaxMinionKills: 300,
    items: [],
    peers,
    ...overrides
  };
}

describe('buildLobbyProfile', () => {
  it('只算排位 —— 大乱斗和普通匹配不算', () => {
    const profile = buildLobbyProfile([
      rankedGame('sr-1', 1000),
      rankedGame('aram-1', 2000, { queueId: 450, mapId: 12 }),
      rankedGame('normal-1', 3000, { queueId: 2400 })
    ]);

    expect(profile.games).toBe(1);
    expect(profile.matches).toHaveLength(1);
    expect(profile.matches[0].gameId).toBe('sr-1');
  });

  it('新的在前,最多取近 10 场', () => {
    const games = Array.from({ length: 15 }, (_, i) => rankedGame(`g${i}`, 1000 + i));
    const profile = buildLobbyProfile(games);

    expect(profile.games).toBe(PROFILE_MATCH_LIMIT);
    expect(profile.matches).toHaveLength(PROFILE_MATCH_LIMIT);
    // 时间戳越大越新 —— 最后 10 场(索引 5~14),最新的在头
    expect(profile.matches[0].gameId).toBe('g14');
    expect(profile.matches[profile.matches.length - 1].gameId).toBe('g5');
  });

  it('表现分落在 0~10', () => {
    const profile = buildLobbyProfile([rankedGame('g1', 1000)]);
    expect(profile.score).not.toBeNull();
    expect(profile.score!).toBeGreaterThan(0);
    expect(profile.score!).toBeLessThanOrEqual(10);
  });

  it('场次和胜场出自同一批局 —— 不会出现「10 场 · 11 胜」', () => {
    const games = [
      rankedGame('win-1', 1000, { win: true }),
      rankedGame('lose-1', 2000, { win: false }),
      rankedGame('win-2', 3000, { win: true })
    ];
    const profile = buildLobbyProfile(games);

    expect(profile.games).toBe(3);
    expect(profile.wins).toBe(2);
    expect(profile.wins).toBeLessThanOrEqual(profile.games);
  });

  it('常用英雄按出场次数排,多的在前', () => {
    const profile = buildLobbyProfile([
      rankedGame('g1', 1000, { championId: 10, championName: '甲' }),
      rankedGame('g2', 2000, { championId: 10, championName: '甲' }),
      rankedGame('g3', 3000, { championId: 20, championName: '乙' })
    ]);

    expect(profile.champions[0]).toMatchObject({ championId: 10, count: 2 });
    expect(profile.champions[1]).toMatchObject({ championId: 20, count: 1 });
  });

  it('一场排位都没有 —— 分数是 null,不是 0', () => {
    const profile = buildLobbyProfile([
      rankedGame('aram-1', 1000, { queueId: 450, mapId: 12 })
    ]);

    expect(profile.score).toBeNull();
    expect(profile.games).toBe(0);
    expect(profile.wins).toBe(0);
    expect(profile.matches).toEqual([]);
    expect(profile.champions).toEqual([]);
  });

  it('位置分布按场次排,打得最多的在前', () => {
    const profile = buildLobbyProfile([
      rankedGame('g1', 1000, { lane: 'MIDDLE', role: 'SOLO' }),
      rankedGame('g2', 2000, { lane: 'MIDDLE', role: 'SOLO' }),
      rankedGame('g3', 3000, { lane: 'TOP', role: 'NONE' })
    ]);

    expect(profile.positionLabel).toBe('中单');
    expect(profile.byPosition[0]).toMatchObject({ label: '中单', games: 2 });
    expect(profile.byPosition[1]).toMatchObject({ label: '上单', games: 1 });
  });
});

describe('fetchLobbyPlayerProfile', () => {
  /** 一个查得到人的假源。 */
  function okSource(): LobbyProfileSource {
    return {
      lookupPlayer: async () => ({
        query: '林俊杰#18557',
        found: true,
        riotId: '林俊杰#18557',
        displayName: '林俊杰',
        tagLine: '18557',
        summonerId: 1,
        puuid: 'puuid-1',
        summonerLevel: 30,
        profileIconId: 0,
        rankedDisplay: '',
        rankedTier: '',
        rankedDivision: '',
        ranked: [],
        isSelf: false,
        error: null
      }),
      fetchPlayerGames: async () => ({
        total: 1,
        wins: 1,
        winrate: 1,
        games: [rankedGame('g1', 1000)]
      })
    };
  }

  it('按「名字#标签」搜人', async () => {
    const queries: string[] = [];
    const src: LobbyProfileSource = {
      lookupPlayer: async (query: string): Promise<PlayerLookup> => {
        queries.push(query);
        return {
          query,
          found: true,
          riotId: query,
          displayName: '林俊杰',
          tagLine: '18557',
          summonerId: 1,
          puuid: 'puuid-1',
          summonerLevel: 30,
          profileIconId: 0,
          rankedDisplay: '',
          rankedTier: '',
          rankedDivision: '',
          ranked: [],
          isSelf: false,
          error: null
        };
      },
      fetchPlayerGames: async () => ({
        total: 1,
        wins: 1,
        winrate: 1,
        games: [rankedGame('g1', 1000)]
      })
    };

    const profile = await fetchLobbyPlayerProfile(src, { nickname: '林俊杰', gameId: '18557' });

    expect(queries).toEqual(['林俊杰#18557']);
    expect(profile.games).toBe(1);
  });

  it('查不到这个人就报错 —— 不给假分数', async () => {
    const src: LobbyProfileSource = {
      lookupPlayer: async () => ({
        query: '查无此人#0000',
        found: false,
        riotId: '',
        displayName: '',
        tagLine: '',
        summonerId: 0,
        puuid: '',
        summonerLevel: 0,
        profileIconId: 0,
        rankedDisplay: '',
        rankedTier: '',
        rankedDivision: '',
        ranked: [],
        isSelf: false,
        error: '查无此人'
      }),
      fetchPlayerGames: async () => ({ total: 0, wins: 0, winrate: 0, games: [] })
    };

    await expect(
      fetchLobbyPlayerProfile(src, { nickname: '查无此人', gameId: '0000' })
    ).rejects.toThrow(/查无此人/);
  });

  it('查得到人但没有召唤师ID —— 拿不到战绩', async () => {
    const src: LobbyProfileSource = {
      lookupPlayer: async () => ({
        query: '林俊杰#18557',
        found: true,
        riotId: '林俊杰#18557',
        displayName: '林俊杰',
        tagLine: '18557',
        summonerId: 1,
        puuid: '',
        summonerLevel: 30,
        profileIconId: 0,
        rankedDisplay: '',
        rankedTier: '',
        rankedDivision: '',
        ranked: [],
        isSelf: false,
        error: null
      }),
      fetchPlayerGames: async () => ({ total: 0, wins: 0, winrate: 0, games: [] })
    };

    await expect(
      fetchLobbyPlayerProfile(src, { nickname: '林俊杰', gameId: '18557' })
    ).rejects.toThrow(/召唤师ID/);
  });

  it('没有昵称或游戏ID —— 拼不出「名字#标签」,直接报错', async () => {
    const src = okSource();
    await expect(
      fetchLobbyPlayerProfile(src, { nickname: '', gameId: '18557' })
    ).rejects.toThrow(/游戏ID/);
    await expect(
      fetchLobbyPlayerProfile(src, { nickname: '林俊杰', gameId: '  ' })
    ).rejects.toThrow(/游戏ID/);
  });
});
