import { beforeEach, describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import { clearProfileCache, fetchSummonerProfile, toSummonerProfile } from '../summonerProfile';

function fakeClient(
  handlers: Record<string, unknown>,
  seen: string[] = []
): AxiosInstance {
  return {
    get: (url: string) => {
      seen.push(url);
      if (!(url in handlers)) {
        const error = new Error(`404 ${url}`) as Error & { response?: { status: number } };
        error.response = { status: 404 };
        return Promise.reject(error);
      }
      return Promise.resolve({ data: handlers[url] });
    }
  } as unknown as AxiosInstance;
}

beforeEach(() => {
  clearProfileCache();
});

describe('toSummonerProfile', () => {
  it('国服客户端 displayName 是空的,真名在 gameName 里', () => {
    const profile = toSummonerProfile({ displayName: '', gameName: '林俊杰', tagLine: '18557' });
    expect(profile.displayName).toBe('林俊杰');
    expect(profile.tagLine).toBe('18557');
  });

  it('等级和头像编号照抄', () => {
    const profile = toSummonerProfile({ gameName: '甲', summonerLevel: 231, profileIconId: 588 });
    expect(profile.summonerLevel).toBe(231);
    expect(profile.profileIconId).toBe(588);
  });

  it('段位从 regalia 里刨出来', () => {
    const profile = toSummonerProfile({
      gameName: '甲',
      regalia: { highestRankedEntry: { tier: 'GOLD', division: 'III' } }
    });
    expect(profile.rankedDisplay).toBe('荣耀黄金 III');
  });

  it('没有段位就是空串 —— 不编一个出来', () => {
    expect(toSummonerProfile({ gameName: '甲' }).rankedDisplay).toBe('');
  });
});

describe('fetchSummonerProfile', () => {
  it('按 puuid 查走 v2 那条路', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      { '/lol-summoner/v2/summoners/puuid/puuid-1': { gameName: '甲', summonerLevel: 100 } },
      seen
    );

    const profile = await fetchSummonerProfile(client, 'puuid-1', 0);

    expect(profile?.displayName).toBe('甲');
    expect(seen[0]).toBe('/lol-summoner/v2/summoners/puuid/puuid-1');
  });

  it('按 puuid 查不通就退到按游戏 ID 查', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      { '/lol-summoner/v1/summoners/17785561676': { gameName: '乙', summonerLevel: 200 } },
      seen
    );

    const profile = await fetchSummonerProfile(client, 'puuid-1', 17785561676);

    expect(profile?.displayName).toBe('乙');
    expect(seen).toContain('/lol-summoner/v1/summoners/17785561676');
  });

  it('回包的 puuid 对不上就是查错人了 —— 丢掉', async () => {
    const client = fakeClient({
      '/lol-summoner/v2/summoners/puuid/puuid-1': { puuid: 'puuid-other', gameName: '别人' },
      '/lol-summoner/v1/summoners/by-puuid/puuid-1': { puuid: 'puuid-other', gameName: '别人' }
    });

    const profile = await fetchSummonerProfile(client, 'puuid-1', 0);

    expect(profile).toBeNull();
  });

  it('格位号那种小数字不拿去查资料 —— 会查出另一个人', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      { '/lol-summoner/v1/summoners/3': { gameName: '另一个人' } },
      seen
    );

    const profile = await fetchSummonerProfile(client, '', 3);

    expect(profile).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('查不到就是 null', async () => {
    const client = fakeClient({});
    expect(await fetchSummonerProfile(client, 'puuid-x', 0)).toBeNull();
  });

  it('同一个召唤师短时间内只查一次', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      { '/lol-summoner/v2/summoners/puuid/puuid-1': { gameName: '甲' } },
      seen
    );

    await fetchSummonerProfile(client, 'puuid-1', 0);
    await fetchSummonerProfile(client, 'puuid-1', 0);

    expect(seen).toHaveLength(1);
  });
});
