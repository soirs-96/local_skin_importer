import { describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import { getMatchSummoner } from '../summoner';

function fakeClient(data: unknown): AxiosInstance {
  return {
    get: () => Promise.resolve({ data })
  } as unknown as AxiosInstance;
}

describe('getMatchSummoner', () => {
  it('国服客户端 displayName 是空的,真名在 gameName 里', async () => {
    const summoner = await getMatchSummoner(
      fakeClient({
        displayName: '',
        gameName: '林俊杰',
        tagLine: '18557',
        puuid: 'puuid-1',
        summonerId: 17785561676
      })
    );
    expect(summoner?.displayName).toBe('林俊杰');
    expect(summoner?.tagLine).toBe('18557');
  });

  it('displayName 有值时也认', async () => {
    const summoner = await getMatchSummoner(fakeClient({ displayName: 'Tester', tagLine: 'CN1' }));
    expect(summoner?.displayName).toBe('Tester');
  });

  it('头像编号从资料里带出来', async () => {
    const summoner = await getMatchSummoner(fakeClient({ gameName: '林俊杰', profileIconId: 10002 }));
    expect(summoner?.profileIconId).toBe(10002);
  });

  it('客户端没给头像编号就是 0 —— 不画假头像', async () => {
    const summoner = await getMatchSummoner(fakeClient({ gameName: '林俊杰' }));
    expect(summoner?.profileIconId).toBe(0);
  });

  it('响应不是对象就当没查到', async () => {
    expect(await getMatchSummoner(fakeClient('nope'))).toBeNull();
  });
});
