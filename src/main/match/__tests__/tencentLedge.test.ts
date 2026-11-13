import { describe, expect, it } from 'vitest';
import { parseLedgeGame, parseLedgeGames, summarizePlayerGames } from '../tencentLedge';
import type { StaticData } from '../staticData';

/**
 * 腾讯 ledge 网关的真实响应形状(2026-11-13 实测)。
 *
 * 关键点:`json.participants[]` 是**平铺**的 —— 字段直接挂在 participant 上,
 * 不在 `stats` 子对象里(跟国服 LCU 那套不一样)。
 */
const ME = '11677d0f-1b9e-5c24-b28c-5af3d22b68ec';
const OTHER = 'bb668455-b573-50d3-a172-4ce55bfebc35';

const staticData: StaticData = {
  version: '16.22',
  champions: new Map([[21, { name: '厄运小姐', iconUrl: null }]]),
  items: new Map([[3040, { name: '无尽之刃', iconUrl: null }]]),
  runes: new Map()
};

function participant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    puuid: ME,
    participantId: 6,
    riotIdGameName: '我',
    riotIdTagline: '00001',
    championId: 21,
    championName: 'MissFortune',
    kills: 13,
    deaths: 9,
    assists: 13,
    win: true,
    lane: 'MIDDLE',
    role: 'SUPPORT',
    teamId: 200,
    goldEarned: 20213,
    totalDamageDealtToChampions: 39359,
    totalMinionsKilled: 45,
    item0: 3040,
    item1: 0,
    item2: 3116,
    item3: 6653,
    item4: 4645,
    item5: 3089,
    item6: 220013,
    ...overrides
  };
}

/** 一局 —— `{metadata, json}` 的形状。 */
function game(participants: Record<string, unknown>[]): unknown {
  return {
    metadata: {
      product: 'lol',
      tags: ['normal', 'q_2400', '_prefix'],
      participants: participants.map((p) => p.puuid),
      timestamp: '1794537993666',
      match_id: 'TJ101_401186650860'
    },
    json: {
      endOfGameResult: 'GameComplete',
      gameId: 401186650860,
      gameMode: 'KIWI',
      gameDuration: 1225,
      gameEndTimestamp: 1794537993666,
      queueId: 2400,
      mapId: 12,
      platformId: 'TJ101',
      participants
    }
  };
}

/** 列表响应 —— `{games:[...]}` 的形状。 */
function payload(games: unknown[]): unknown {
  return { games };
}

describe('parseLedgeGame', () => {
  it('按 puuid 找到目标玩家,取出 KDA 和胜负', () => {
    const parsed = parseLedgeGame(
      game([participant(), participant({ puuid: OTHER })]),
      ME,
      staticData
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.kills).toBe(13);
    expect(parsed?.deaths).toBe(9);
    expect(parsed?.assists).toBe(13);
    expect(parsed?.kda).toBe('13/9/13');
    expect(parsed?.win).toBe(true);
  });

  it('英雄名优先用静态数据的中文名', () => {
    const parsed = parseLedgeGame(game([participant()]), ME, staticData);
    expect(parsed?.championName).toBe('厄运小姐');
    expect(parsed?.championId).toBe(21);
  });

  it('静态数据里没有就退回腾讯给的英文名', () => {
    const empty: StaticData = { version: null, champions: new Map(), items: new Map(), runes: new Map() };
    const parsed = parseLedgeGame(game([participant()]), ME, empty);
    expect(parsed?.championName).toBe('MissFortune');
  });

  it('装备只收非空槽', () => {
    const parsed = parseLedgeGame(game([participant()]), ME, staticData);
    expect(parsed?.items.map((i) => i.itemId)).toEqual([3040, 3116, 6653, 4645, 3089, 220013]);
    expect(parsed?.items[0].name).toBe('无尽之刃');
  });

  it('对局号和时间取自腾讯的字段', () => {
    const parsed = parseLedgeGame(game([participant()]), ME, staticData);
    expect(parsed?.gameId).toBe('TJ101_401186650860');
    expect(parsed?.timestampMs).toBe(1794537993666);
    expect(parsed?.durationS).toBe(1225);
    expect(parsed?.queueId).toBe(2400);
    expect(parsed?.gameMode).toBe('KIWI');
  });

  it('这一局里没有目标玩家就当没有', () => {
    const parsed = parseLedgeGame(game([participant({ puuid: OTHER })]), ME, staticData);
    expect(parsed).toBeNull();
  });

  it('形状不对时返回 null,而不是抛异常', () => {
    expect(parseLedgeGame(null, ME, staticData)).toBeNull();
    expect(parseLedgeGame({}, ME, staticData)).toBeNull();
    expect(parseLedgeGame({ metadata: {} }, ME, staticData)).toBeNull();
  });
});

describe('parseLedgeGames', () => {
  it('剥掉外层的 games 包装', () => {
    const games = parseLedgeGames(payload([game([participant()])]), ME, staticData);
    expect(games).toHaveLength(1);
  });

  it('裸数组也认', () => {
    const games = parseLedgeGames([game([participant()])], ME, staticData);
    expect(games).toHaveLength(1);
  });

  it('垃圾输入得到空列表', () => {
    expect(parseLedgeGames(null, ME, staticData)).toHaveLength(0);
    expect(parseLedgeGames('nope', ME, staticData)).toHaveLength(0);
    expect(parseLedgeGames({ games: 'nope' }, ME, staticData)).toHaveLength(0);
  });
});

describe('peers', () => {
  it('把一局里的人全带出来,并标出被查的那个', () => {
    const parsed = parseLedgeGame(
      game([participant(), participant({ puuid: OTHER, riotIdGameName: '对手' })]),
      ME,
      staticData
    );
    expect(parsed?.peers).toHaveLength(2);
    expect(parsed?.peers[0].puuid).toBe(ME);
    expect(parsed?.peers[0].isTarget).toBe(true);
    expect(parsed?.peers[1].puuid).toBe(OTHER);
    expect(parsed?.peers[1].isTarget).toBe(false);
  });

  it('队伍信息分给每个人', () => {
    const parsed = parseLedgeGame(
      game([participant(), participant({ puuid: OTHER, teamId: 100 })]),
      ME,
      staticData
    );
    expect(parsed?.peers[0].teamId).toBe(200);
    expect(parsed?.peers[1].teamId).toBe(100);
  });

  it('人名拼成「名字#标签」', () => {
    const parsed = parseLedgeGame(
      game([participant({ riotIdGameName: '林俊杰', riotIdTagline: '18557' })]),
      ME,
      staticData
    );
    expect(parsed?.peers[0].displayName).toBe('林俊杰#18557');
  });

  it('每人也带 KDA', () => {
    const parsed = parseLedgeGame(game([participant()]), ME, staticData);
    expect(parsed?.peers[0].kda).toBe('13/9/13');
    expect(parsed?.peers[0].win).toBe(true);
  });
});

describe('summarizePlayerGames', () => {
  it('算胜场和胜率', () => {
    const games = parseLedgeGames(
      payload([game([participant()]), game([participant({ win: false })])]),
      ME,
      staticData
    );
    const summary = summarizePlayerGames(games);
    expect(summary.total).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.winrate).toBe(0.5);
  });

  it('没对局时胜率是 0,不是 NaN', () => {
    const summary = summarizePlayerGames([]);
    expect(summary.total).toBe(0);
    expect(summary.winrate).toBe(0);
  });
});
