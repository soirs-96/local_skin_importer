import { describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import { getOpponents, parseOpponents } from '../opponents';
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

/** 国服 gameflow 实测形状:teamOne 5 人、teamTwo 4 人,本地玩家带 teamOwner。 */
function gameflow(): unknown {
  return {
    phase: 'InProgress',
    gameData: {
      queue: { id: 420, name: 'CLASSIC' },
      teamOne: [
        {
          championId: 523,
          puuid: 'puuid-me',
          summonerId: 100,
          summonerName: '林俊杰',
          teamOwner: true,
          selectedPosition: 'MIDDLE'
        },
        {
          championId: 142,
          puuid: 'puuid-ally',
          summonerId: 101,
          summonerName: '队友甲'
        }
      ],
      teamTwo: [
        {
          championId: 523,
          puuid: 'puuid-enemy',
          summonerId: 200,
          summonerName: '对手甲'
        }
      ]
    }
  };
}

describe('parseOpponents', () => {
  it('两队人都读出来,标好敌我', () => {
    const snapshot = parseOpponents(gameflow(), staticData, 'puuid-me');

    expect(snapshot.inGame).toBe(true);
    expect(snapshot.phase).toBe('InProgress');
    expect(snapshot.queueType).toBe('CLASSIC');
    expect(snapshot.opponents).toHaveLength(3);

    const ally = snapshot.opponents.filter((p) => p.side === 'ally');
    const enemy = snapshot.opponents.filter((p) => p.side === 'enemy');
    expect(ally).toHaveLength(2);
    expect(enemy).toHaveLength(1);
    expect(enemy[0].summonerName).toBe('对手甲');
  });

  it('本地玩家被标出来', () => {
    const snapshot = parseOpponents(gameflow(), staticData, 'puuid-me');
    const self = snapshot.opponents.filter((p) => p.isSelf);
    expect(self).toHaveLength(1);
    expect(self[0].summonerName).toBe('林俊杰');
  });

  it('没有 teamOwner 时靠 puuid 认自己那队', () => {
    const raw = gameflow() as { gameData: { teamOne: Record<string, unknown>[] } };
    const teamOne = raw.gameData.teamOne.map((m) => ({ ...m }));
    delete teamOne[0].teamOwner;
    raw.gameData.teamOne = teamOne;

    const snapshot = parseOpponents(raw, staticData, 'puuid-me');

    const self = snapshot.opponents.find((p) => p.isSelf);
    expect(self?.side).toBe('ally');
  });

  it('英雄名从静态数据里取,取不到退回编号', () => {
    const snapshot = parseOpponents(
      {
        gameData: {
          teamOne: [{ championId: 523, puuid: 'a', summonerId: 1, summonerName: '甲' }],
          teamTwo: [{ championId: 999, puuid: 'b', summonerId: 2, summonerName: '乙' }]
        }
      },
      staticData
    );

    expect(snapshot.opponents[0].championName).toBe('阿萝拉');
    expect(snapshot.opponents[0].championIconUrl).toBe('lcuicon://champion/523.png');
    expect(snapshot.opponents[1].championName).toBe('#999');
    expect(snapshot.opponents[1].championIconUrl).toBe('lcuicon://champion/999.png');
  });

  it('riotId 形状的名字也认', () => {
    const snapshot = parseOpponents(
      {
        gameData: {
          teamOne: [
            {
              championId: 523,
              puuid: 'a',
              summonerId: 900,
              riotIdGameName: '甲',
              riotIdTagLine: 'CN1'
            }
          ]
        }
      },
      staticData
    );

    expect(snapshot.opponents[0].summonerName).toBe('甲#CN1');
  });

  it('没有队伍数据时是空的,不是崩', () => {
    const snapshot = parseOpponents({ phase: 'None' }, staticData);
    expect(snapshot.inGame).toBe(false);
    expect(snapshot.opponents).toEqual([]);
  });

  it('非对象输入也安全', () => {
    expect(parseOpponents(null, staticData).inGame).toBe(false);
    expect(parseOpponents('nope', staticData).inGame).toBe(false);
  });
});

describe('getOpponents', () => {
  it('拉不到 gameflow 时返回空快照,不抛', async () => {
    const client = {
      get: () => Promise.reject(new Error('404'))
    } as unknown as AxiosInstance;

    const snapshot = await getOpponents(client, staticData);

    expect(snapshot.inGame).toBe(false);
    expect(snapshot.opponents).toEqual([]);
  });

  it('拉到了就解析出来', async () => {
    const client = {
      get: () => Promise.resolve({ data: gameflow() })
    } as unknown as AxiosInstance;

    const snapshot = await getOpponents(client, staticData, 'puuid-me');

    expect(snapshot.opponents).toHaveLength(3);
  });

  it('gameflow 没给名字时,按游戏 ID 去客户端补上', async () => {
    const raw = gameflow() as { gameData: { teamOne: Record<string, unknown>[] } };
    raw.gameData.teamOne = raw.gameData.teamOne.map((member, index) => {
      const copy = { ...member };
      delete copy.summonerName;
      if (index === 0) copy.summonerId = 900;
      return copy;
    });

    const client = {
      get: (url: string) => {
        if (url.startsWith('/lol-gameflow')) return Promise.resolve({ data: raw });
        if (url === '/lol-summoner/v1/summoners/900') {
          return Promise.resolve({ data: { summonerId: 900, gameName: '补出来的名字' } });
        }
        return Promise.reject(new Error('404'));
      }
    } as unknown as AxiosInstance;

    const snapshot = await getOpponents(client, staticData, 'puuid-me');

    // gameflow 里没名字 —— 名字得从召唤师端点来。
    const self = snapshot.opponents.find((p) => p.isSelf);
    expect(self?.summonerName).toBe('补出来的名字');
  });
});
