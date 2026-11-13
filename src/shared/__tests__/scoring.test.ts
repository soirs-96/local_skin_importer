import { describe, expect, it } from 'vitest';
import {
  buildScoreIndex,
  isRankedGame,
  ratioToSubScore,
  scoreGame,
  summarizePlayerScores,
  targetOf
} from '../scoring';
import { resolvePosition } from '../gameLabels';
import type { PlayerGame, PlayerPeer } from '../match';

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

/** 一队几个人 —— `tag` 用来保证 puuid 不撞车。 */
function team(
  teamId: number,
  tag: string,
  count: number,
  overrides: Partial<PlayerPeer> = {}
): PlayerPeer[] {
  return Array.from({ length: count }, (_, i) =>
    peer({ puuid: `${tag}-${teamId}-${i}`, teamId, ...overrides })
  );
}

/** 十个人的一局(两队各五人),召唤师峡谷单双排。 */
function game(peers: PlayerPeer[], overrides: Partial<PlayerGame> = {}): PlayerGame {
  return {
    gameId: 'TJ101_1',
    timestampMs: 0,
    durationS: 1800,
    queueId: 420,
    gameMode: 'KIWI',
    mapId: 11,
    championId: 1,
    championName: '甲',
    championIconUrl: null,
    kills: 2,
    deaths: 2,
    assists: 2,
    kda: '2/2/2',
    win: true,
    lane: 'MIDDLE',
    role: 'SOLO',
    goldEarned: 10000,
    damageToChampions: 10000,
    minionKills: 100,
    items: [],
    peers,
    ...overrides
  };
}

/**
 * 一局标准的排位局 —— 蓝队 5 人、红队 5 人,
 * 蓝队第一个人是「被查的那个人」,而且他打得比队友和对手都好。
 */
function rankedGame(gameId: string, overrides: Partial<PlayerGame> = {}): PlayerGame {
  const peers = [...team(100, 'blue', 5), ...team(200, 'red', 5)];
  peers[0] = { ...peers[0], kills: 4, deaths: 1, assists: 4, kda: '4/1/4', isTarget: true };
  return game(peers, { gameId, ...overrides });
}

describe('resolvePosition', () => {
  it('分路说了算', () => {
    expect(resolvePosition(11, 'JUNGLE', 'NONE')).toBe('JUNGLE');
    expect(resolvePosition(11, 'MIDDLE', 'SOLO')).toBe('MID');
    expect(resolvePosition(11, 'TOP', 'NONE')).toBe('TOP');
  });

  it('下路按定位分射手和辅助', () => {
    expect(resolvePosition(11, 'BOTTOM', 'CARRY')).toBe('ADC');
    expect(resolvePosition(11, 'BOTTOM', 'SUPPORT')).toBe('SUPPORT');
  });

  it('辅助优先于分路 —— 辅助抢中路也是辅助', () => {
    expect(resolvePosition(11, 'MIDDLE', 'SUPPORT')).toBe('SUPPORT');
  });

  it('分路认不出来就退到定位', () => {
    expect(resolvePosition(11, '', 'SOLO')).toBe('MID');
    expect(resolvePosition(11, '', 'CARRY')).toBe('ADC');
  });

  it('都认不出来就说认不出来 —— 不猜', () => {
    expect(resolvePosition(11, '', 'NONE')).toBe('UNKNOWN');
    expect(resolvePosition(11, '', 'DUO')).toBe('UNKNOWN');
  });

  it('大乱斗一律认不出来', () => {
    expect(resolvePosition(12, 'MIDDLE', 'SUPPORT')).toBe('UNKNOWN');
  });
});

describe('ratioToSubScore', () => {
  it('正好是基准给一半', () => {
    expect(ratioToSubScore(1)).toBeCloseTo(0.5, 5);
  });

  it('比基准高一倍给 0.75', () => {
    expect(ratioToSubScore(2)).toBeCloseTo(0.75, 5);
  });

  it('四倍封顶,四分之一见底', () => {
    expect(ratioToSubScore(4)).toBeCloseTo(1, 5);
    expect(ratioToSubScore(100)).toBeCloseTo(1, 5);
    expect(ratioToSubScore(0.25)).toBeCloseTo(0, 5);
  });

  it('比值是 0 就是 0', () => {
    expect(ratioToSubScore(0)).toBe(0);
  });
});

describe('scoreGame', () => {
  it('不是召唤师峡谷不打分', () => {
    expect(scoreGame(rankedGame('g1', { mapId: 12 }))).toBeNull();
  });

  it('人数不够不打分', () => {
    expect(scoreGame(game(team(100, 'blue', 3)))).toBeNull();
  });

  it('强的一方分高', () => {
    const strong = {
      kills: 5,
      deaths: 1,
      assists: 10,
      goldEarned: 20000,
      damageToChampions: 30000,
      minionKills: 180
    };
    const weak = {
      kills: 1,
      deaths: 6,
      assists: 2,
      goldEarned: 8000,
      damageToChampions: 9000,
      minionKills: 90
    };
    const peers = [...team(100, 'blue', 5, strong), ...team(200, 'red', 5, weak)];
    const result = scoreGame(game(peers))!;
    const blue = result.players.filter((p) => p.teamId === 100);
    const red = result.players.filter((p) => p.teamId === 200);
    expect(blue[0].score).toBeGreaterThan(red[0].score);
    expect(blue[0].score).toBeGreaterThan(5);
    expect(red[0].score).toBeLessThan(4);
  });

  it('名次按分数排,1 分最好', () => {
    const peers = [
      ...team(100, 'blue', 5, { kills: 8, deaths: 0, assists: 12, goldEarned: 30000 }),
      ...team(200, 'red', 5, { kills: 0, deaths: 9, assists: 1, goldEarned: 5000 })
    ];
    const result = scoreGame(game(peers))!;
    expect(result.players[0].rank).toBe(1);
    expect(result.players[result.players.length - 1].rank).toBe(result.players.length);
    for (let i = 1; i < result.players.length; i += 1) {
      expect(result.players[i - 1].score).toBeGreaterThanOrEqual(result.players[i].score);
    }
  });

  it('队伍 0 击杀时参团率按基准算,不把整队归零', () => {
    const peers = [
      ...team(100, 'blue', 5, { kills: 0, deaths: 10, assists: 0 }),
      ...team(200, 'red', 5, { kills: 6, deaths: 2, assists: 4 })
    ];
    const result = scoreGame(game(peers))!;
    const blue = result.players.find((p) => p.teamId === 100)!;
    // KP 记成中单的基准值(0.6)—— 不奖不罚,子分正好 0.5
    expect(blue.metrics.kp).toBeCloseTo(0.6, 5);
    expect(blue.breakdown.participation).toBeCloseTo(0.5, 5);
  });

  it('同样的伤害份额,辅助拿到的子分比射手高 —— 基准吸收了角色差异', () => {
    const adc = { lane: 'BOTTOM', role: 'CARRY' };
    const support = { lane: 'BOTTOM', role: 'SUPPORT' };
    const peers = [
      ...team(100, 'blue', 2, adc),
      ...team(100, 'blue2', 2, support),
      peer({ puuid: 'blue-filler', teamId: 100 }),
      ...team(200, 'red', 2, adc),
      ...team(200, 'red2', 2, support),
      peer({ puuid: 'red-filler', teamId: 200 })
    ];
    const result = scoreGame(game(peers))!;
    const adcDetail = result.players.find((p) => p.position === 'ADC')!;
    const supportDetail = result.players.find((p) => p.position === 'SUPPORT')!;
    // 全场伤害份额一样 —— 0.2
    expect(adcDetail.metrics.damageShare).toBeCloseTo(0.2, 5);
    expect(supportDetail.metrics.damageShare).toBeCloseTo(0.2, 5);
    // 但辅助的伤害基准是 0.07、射手是 0.30 —— 辅助不该因此吃亏
    expect(supportDetail.breakdown.damage).toBeGreaterThan(adcDetail.breakdown.damage);
  });
});

describe('isRankedGame', () => {
  it('只认召唤师峡谷的排位队列', () => {
    expect(isRankedGame(game([], { mapId: 11, queueId: 420 }))).toBe(true);
    expect(isRankedGame(game([], { mapId: 11, queueId: 400 }))).toBe(true);
    expect(isRankedGame(game([], { mapId: 11, queueId: 440 }))).toBe(true);
  });

  it('普通匹配、大乱斗、极限闪击都不算排位', () => {
    expect(isRankedGame(game([], { mapId: 11, queueId: 2400 }))).toBe(false);
    expect(isRankedGame(game([], { mapId: 12, queueId: 450 }))).toBe(false);
    expect(isRankedGame(game([], { mapId: 11, queueId: 490 }))).toBe(false);
  });
});

describe('summarizePlayerScores', () => {
  it('只统计排位', () => {
    const summary = summarizePlayerScores([
      rankedGame('g1'),
      rankedGame('g2', { queueId: 2400 }),
      rankedGame('g3', { mapId: 12 })
    ]);

    expect(summary.games).toBe(1);
  });

  it('一场排位都没有时给空成绩单', () => {
    const summary = summarizePlayerScores([rankedGame('g1', { queueId: 2400 })]);
    expect(summary.games).toBe(0);
    expect(summary.score).toBe(0);
    expect(summary.byPosition).toEqual([]);
  });

  it('同场对比 = 我的分减去同场平均分', () => {
    const result = scoreGame(rankedGame('g1'))!;
    const me = targetOf(result)!;

    const summary = summarizePlayerScores([rankedGame('g1')]);

    expect(summary.games).toBe(1);
    expect(summary.score).toBeCloseTo(me.score, 1);
    expect(summary.vsAverage).toBeCloseTo(me.score - result.average, 1);
    // 他这局比队友和对手都打得好 —— 差值得是正的
    expect(summary.vsAverage).toBeGreaterThan(0);
    expect(me.rank).toBe(1);
  });

  it('按位置分组统计', () => {
    const summary = summarizePlayerScores([rankedGame('g1')]);
    const mid = summary.byPosition.find((row) => row.position === 'MID');
    expect(mid?.games).toBe(1);
    expect(mid?.label).toBe('中单');
  });
});

describe('buildScoreIndex', () => {
  it('按对局号建索引', () => {
    const index = buildScoreIndex([rankedGame('g1')]);
    expect(index.g1).toBeDefined();
    expect(index.g1.players).toHaveLength(10);
  });

  it('大乱斗不进索引', () => {
    const index = buildScoreIndex([rankedGame('g1', { mapId: 12 })]);
    expect(index.g1).toBeUndefined();
  });
});
