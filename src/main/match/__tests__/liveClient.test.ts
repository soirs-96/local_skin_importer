import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { getAllGameData, getPlayerStats } from '../liveClient';

vi.mock('axios');

function ok(data: unknown): { data: unknown; status: number } {
  return { data, status: 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAllGameData', () => {
  it('认得出英雄名和我用的皮肤资源名', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: { summonerName: '我', currentGold: 500, championName: '阿狸' },
        gameData: { gameTime: 300, gameMode: 'CLASSIC' },
        allPlayers: [{ summonerName: '我', skin: 'game_character_displayname_Ahri_Snow_Dawn' }]
      })
    );

    const live = await getAllGameData();

    expect(live?.championName).toBe('阿狸');
    expect(live?.skinName).toBe('game_character_displayname_Ahri_Snow_Dawn');
  });

  it('国服走 Riot ID 时也能认出「我」那条', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: { riotIdGameName: '林俊杰', riotIdTagLine: 'CN1', championName: '墨拉斯特' },
        gameData: { gameTime: 1200 },
        allPlayers: [
          {
            riotIdGameName: '别人',
            riotIdTagLine: 'CN2',
            skin: 'game_character_displayname_Ashe_Default'
          },
          {
            riotIdGameName: '林俊杰',
            riotIdTagLine: 'CN1',
            championName: '墨拉斯特',
            skin: 'game_character_displayname_Malzahar_NorthernSky'
          }
        ]
      })
    );

    const live = await getAllGameData();

    expect(live?.championName).toBe('墨拉斯特');
    expect(live?.skinName).toBe('game_character_displayname_Malzahar_NorthernSky');
  });

  it('端口不通时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getAllGameData()).resolves.toBeNull();
  });
});

describe('getPlayerStats', () => {
  it('从 activePlayer 里读出 KDA / 补刀 / 经济', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: {
          championsKilled: 8,
          deaths: 2,
          assists: 5,
          minionsKilled: 186,
          goldEarned: 12400,
          damageDealtToChampions: 23400,
          level: 16
        }
      })
    );

    const score = await getPlayerStats();

    expect(score?.kills).toBe(8);
    expect(score?.deaths).toBe(2);
    expect(score?.assists).toBe(5);
    expect(score?.minionKills).toBe(186);
    expect(score?.goldEarned).toBe(12400);
    expect(score?.level).toBe(16);
  });

  it('activePlayer 没统计时退到 allPlayers 里按召唤师名找', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: { summonerName: '我' },
        allPlayers: [
          { summonerName: '别人', kills: 1 },
          { summonerName: '我', kills: 3, deaths: 1, assists: 7, minionsKilled: 150 }
        ]
      })
    );

    const score = await getPlayerStats();

    expect(score?.kills).toBe(3);
    expect(score?.minionKills).toBe(150);
  });

  it('字段名不认识 / 一个数都没读到 → null', async () => {
    vi.mocked(axios.get).mockResolvedValue(ok({ activePlayer: { foo: 'bar' } }));
    await expect(getPlayerStats()).resolves.toBeNull();
  });

  it('端口不通时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getPlayerStats()).resolves.toBeNull();
  });
});
