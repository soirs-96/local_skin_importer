import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  extractGames,
  findJustFinishedMatch,
  parseMatchEntry,
  parseRecentMatches
} from '../recentMatches';
import { emptyStaticData, type StaticData } from '../staticData';

const staticData: StaticData = {
  version: '14.1.1',
  champions: new Map([[1, { name: '安妮', iconUrl: 'https://cdn/annie.png' }]]),
  items: new Map([
    [1001, { name: '破败王者之刃', iconUrl: 'https://cdn/1001.png' }],
    // 角色任务道具 —— 客户端的 items.json 里有,Data Dragon 没有
    [1204, { name: '打野任务', iconUrl: 'https://cdn/1204.png' }]
  ]),
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
    expect(match?.gameMode).toBe('CLASSIC');
  });

  it('大乱斗的模式串也带出来 —— 界面靠它决定要不要显示位置', () => {
    const match = parseMatchEntry(
      {
        gameId: 13,
        championId: 1,
        gameMode: 'ARAM',
        gameCreation: 1700000000000,
        gameDuration: 1500,
        stats: { kills: 3, deaths: 1, assists: 8, win: true }
      },
      staticData
    );
    expect(match?.gameMode).toBe('ARAM');
  });

  it('地图、队列、分路都带出来 —— 界面靠它们判断大乱斗', () => {
    const match = parseMatchEntry(
      {
        gameId: 20,
        gameMode: 'KIWI',
        mapId: 12,
        queueId: 450,
        participants: [
          {
            participantId: 1,
            championId: 1,
            timeline: { lane: 'BOTTOM', role: 'SUPPORT' },
            stats: { kills: 13, deaths: 11, assists: 18, win: true }
          }
        ]
      },
      staticData
    );
    expect(match?.mapId).toBe(12);
    expect(match?.queueId).toBe(450);
    expect(match?.lane).toBe('BOTTOM');
    expect(match?.role).toBe('SUPPORT');
  });

  it('模式字段挂在 gameMetadata 下面也认', () => {
    const match = parseMatchEntry(
      {
        gameId: 21,
        gameMetadata: { gameMode: 'KIWI', mapId: 11, queueId: 420 },
        stats: { kills: 1, deaths: 0, assists: 0, win: true }
      },
      staticData
    );
    expect(match?.mapId).toBe(11);
    expect(match?.queueId).toBe(420);
    expect(match?.gameMode).toBe('KIWI');
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

  it('角色任务道具的名字带出来 —— 界面靠它判位置', () => {
    const match = parseMatchEntry(
      {
        gameId: 30,
        championId: 1,
        mapId: 11,
        participants: [
          {
            participantId: 1,
            championId: 1,
            timeline: { lane: 'NONE', role: 'SUPPORT' },
            stats: { kills: 3, deaths: 4, assists: 5, win: true, roleBoundItem: 1204 }
          }
        ]
      },
      staticData
    );
    expect(match?.roleBoundItemName).toBe('打野任务');
  });

  it('没有任务道具就空串 —— 位置退回 lane / role 判', () => {
    const match = parseMatchEntry(
      {
        gameId: 31,
        championId: 1,
        mapId: 11,
        participants: [
          {
            participantId: 1,
            championId: 1,
            timeline: { lane: 'BOTTOM', role: 'CARRY' },
            stats: { kills: 3, deaths: 4, assists: 5, win: true }
          }
        ]
      },
      staticData
    );
    expect(match?.roleBoundItemName).toBe('');
  });

  it('补刀和全场最高补刀带出来 —— 判射手还是辅助要用', () => {
    const match = parseMatchEntry(
      {
        gameId: 32,
        championId: 1,
        mapId: 11,
        participants: [
          {
            participantId: 1,
            championId: 1,
            timeline: { lane: 'BOTTOM', role: 'CARRY' },
            stats: { kills: 3, deaths: 4, assists: 31, win: true, totalMinionsKilled: 45 }
          },
          {
            participantId: 2,
            championId: 2,
            stats: { kills: 12, deaths: 3, assists: 5, win: true, totalMinionsKilled: 220 }
          }
        ]
      },
      staticData
    );
    expect(match?.minionKills).toBe(45);
    expect(match?.gameMaxMinionKills).toBe(220);
  });

  it('简化版没有十个人 —— 全场最高补刀就是 0,位置退回 lane / role 判', () => {
    const match = parseMatchEntry(
      {
        gameId: 33,
        championId: 1,
        mapId: 11,
        stats: { kills: 3, deaths: 4, assists: 31, win: true, totalMinionsKilled: 45 }
      },
      staticData
    );
    expect(match?.minionKills).toBe(45);
    expect(match?.gameMaxMinionKills).toBe(0);
  });

  it('非对象返回 null', () => {
    expect(parseMatchEntry('nope', staticData)).toBeNull();
  });

  it('图标地址只认 id —— 静态数据里没有的英雄/物品也要给地址', () => {
    const match = parseMatchEntry(
      {
        gameId: 14,
        championId: 999,
        stats: { kills: 0, deaths: 0, assists: 0, item0: 2003 }
      },
      staticData
    );
    expect(match?.championName).toBe('#999');
    expect(match?.championIconUrl).toBe('lcuicon://champion/999.png');
    expect(match?.items[0].iconUrl).toBe('lcuicon://item/2003.png');
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

describe('findJustFinishedMatch', () => {
  it('命中窗口内 + 英雄一致的那一局', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            {
              gameId: 2,
              gameCreation: now - 60_000,
              participants: [
                {
                  participantId: 1,
                  championId: 64,
                  stats: { kills: 8, deaths: 2, assists: 5, win: true, totalMinionsKilled: 186 },
                  timeline: { lane: 'MIDDLE' }
                }
              ],
              participantIdentities: [{ participantId: 1, player: { puuid: 'p-1' } }]
            }
          ]
        }
      })
    } as unknown as AxiosInstance;

    const found = await findJustFinishedMatch(client, emptyStaticData(), 'p-1', 64, { now });

    expect(found?.match.gameId).toBe(2);
    expect(found?.match.win).toBe(true);
  });

  it('多局都匹配时取 gameCreation 最新的那个', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            { gameId: 1, gameCreation: now - 120_000, participants: [{ championId: 64, stats: {} }] },
            { gameId: 2, gameCreation: now - 30_000, participants: [{ championId: 64, stats: {} }] }
          ]
        }
      })
    } as unknown as AxiosInstance;

    const found = await findJustFinishedMatch(client, emptyStaticData(), '', 64, { now });

    expect(found?.match.gameId).toBe(2);
  });

  it('窗口外 / 英雄对不上 / 一局都没有 → null(不拿最近的那局冒充)', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            {
              gameId: 1,
              gameCreation: now - 60 * 60_000,
              participants: [{ championId: 64, stats: {} }]
            },
            { gameId: 2, gameCreation: now - 60_000, participants: [{ championId: 103, stats: {} }] }
          ]
        }
      })
    } as unknown as AxiosInstance;

    await expect(
      findJustFinishedMatch(client, emptyStaticData(), '', 64, { now })
    ).resolves.toBeNull();
  });
});
