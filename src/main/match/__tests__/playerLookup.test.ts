import { describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  describeLookupFailure,
  extractSummoner,
  failedLookup,
  lookupPlayer,
  parseLookupQuery,
  toPlayerLookup
} from '../playerLookup';

/** 记录被请求的 URL 和参数,方便断言「走的到底是哪条路」。 */
function fakeClient(
  handlers: Record<string, unknown>,
  seen: { url: string; params?: unknown }[] = []
): AxiosInstance {
  return {
    get: (url: string, config?: { params?: unknown }) => {
      seen.push({ url, params: config?.params });
      if (!(url in handlers)) {
        const error = new Error(`404 ${url}`) as Error & { response?: { status: number } };
        error.response = { status: 404 };
        return Promise.reject(error);
      }
      return Promise.resolve({ data: handlers[url] });
    }
  } as unknown as AxiosInstance;
}

describe('parseLookupQuery', () => {
  it('带 # 的按 riotId 查', () => {
    expect(parseLookupQuery('林俊杰#18557')).toEqual({ kind: 'riotId', riotId: '林俊杰#18557' });
  });

  it('全数字按游戏 ID 查', () => {
    expect(parseLookupQuery('17785561676')).toEqual({ kind: 'summonerId', summonerId: 17785561676 });
  });

  it('裸名字判为格式错 —— 国服搜人不接受', () => {
    const parsed = parseLookupQuery('林俊杰');
    expect(parsed.kind).toBe('invalid');
  });

  it('空的判为格式错', () => {
    expect(parseLookupQuery('   ').kind).toBe('invalid');
  });

  it('# 前后缺一段都算格式错', () => {
    expect(parseLookupQuery('#18557').kind).toBe('invalid');
    expect(parseLookupQuery('林俊杰#').kind).toBe('invalid');
  });

  it('两边的空格去掉', () => {
    expect(parseLookupQuery(' 林俊杰 # 18557 ')).toEqual({
      kind: 'riotId',
      riotId: '林俊杰#18557'
    });
  });
});

describe('extractSummoner', () => {
  it('对象直接用', () => {
    expect(extractSummoner({ puuid: 'p1' })).toEqual({ puuid: 'p1' });
  });

  it('单元素数组取第一个', () => {
    expect(extractSummoner([{ puuid: 'p1' }])).toEqual({ puuid: 'p1' });
  });

  it('嵌套在 summoner 里的也认', () => {
    expect(extractSummoner({ summoner: { puuid: 'p1' } })).toEqual({ puuid: 'p1' });
  });

  it('认不出来就是 null', () => {
    expect(extractSummoner(null)).toBeNull();
    expect(extractSummoner('nope')).toBeNull();
  });
});

describe('toPlayerLookup', () => {
  it('拼出 riotId、等级、游戏 ID', () => {
    const lookup = toPlayerLookup(
      '林俊杰#18557',
      {
        gameName: '林俊杰',
        tagLine: '18557',
        summonerId: 17785561676,
        puuid: 'puuid-1',
        summonerLevel: 231
      },
      ''
    );
    expect(lookup.found).toBe(true);
    expect(lookup.riotId).toBe('林俊杰#18557');
    expect(lookup.displayName).toBe('林俊杰');
    expect(lookup.summonerLevel).toBe(231);
    expect(lookup.summonerId).toBe(17785561676);
    expect(lookup.isSelf).toBe(false);
  });

  it('头像编号从资料里带出来', () => {
    const lookup = toPlayerLookup('x#1', { profileIconId: 588 }, '');
    expect(lookup.profileIconId).toBe(588);
  });

  it('客户端没给头像编号就是 0 —— 不画假头像', () => {
    const lookup = toPlayerLookup('x#1', { puuid: 'p' }, '');
    expect(lookup.profileIconId).toBe(0);
  });

  it('puuid 对上就是自己', () => {
    const lookup = toPlayerLookup('林俊杰#18557', { puuid: 'puuid-1' }, 'puuid-1');
    expect(lookup.isSelf).toBe(true);
  });

  it('段位从 regalia 里刨出来', () => {
    const lookup = toPlayerLookup(
      'x#1',
      { regalia: { highestRankedEntry: { tier: 'GOLD', division: 'III' } } },
      ''
    );
    expect(lookup.rankedDisplay).toBe('荣耀黄金 III');
  });

  it('段位从 rankedQueues 里刨出来', () => {
    const lookup = toPlayerLookup('x#1', { rankedQueues: [{ tier: 'PLATINUM', division: 'IV' }] }, '');
    expect(lookup.rankedDisplay).toBe('华贵铂金 IV');
  });

  it('客户端没给段位就是空串 —— 不猜', () => {
    const lookup = toPlayerLookup('x#1', { puuid: 'p' }, '');
    expect(lookup.rankedDisplay).toBe('');
    expect(lookup.rankedTier).toBe('');
    expect(lookup.rankedDivision).toBe('');
  });

  it('段位徽章的 tier/division 单独拆出来 —— 画徽章要用', () => {
    const lookup = toPlayerLookup(
      'x#1',
      { regalia: { highestRankedEntry: { tier: 'GOLD', division: 'III' } } },
      ''
    );
    expect(lookup.rankedTier).toBe('GOLD');
    expect(lookup.rankedDivision).toBe('III');
  });

  it('各队列的段位明细也一起带出来', () => {
    const lookup = toPlayerLookup(
      'x#1',
      {
        rankedQueues: [
          { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'III', wins: 30, losses: 20, leaguePoints: 45 },
          { queueType: 'RANKED_FLEX_5x5', tier: 'PLATINUM', division: 'IV', wins: 10, losses: 10, leaguePoints: 12 }
        ]
      },
      ''
    );
    expect(lookup.ranked).toHaveLength(2);
    expect(lookup.ranked[0].queueType).toBe('RANKED_SOLO_5x5');
    expect(lookup.ranked[0].wins).toBe(30);
    expect(lookup.ranked[0].losses).toBe(20);
    expect(lookup.ranked[0].winrate).toBeCloseTo(0.6);
  });

  it('一场没打的队列不显示 —— 总场次 0 是假数据', () => {
    const lookup = toPlayerLookup(
      'x#1',
      { rankedQueues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'III', wins: 0, losses: 0 }] },
      ''
    );
    expect(lookup.ranked).toHaveLength(0);
  });
});

describe('describeLookupFailure', () => {
  it('404 说没找到', () => {
    expect(describeLookupFailure(404)).toContain('没找到');
  });

  it('422 说格式不对', () => {
    expect(describeLookupFailure(422)).toContain('名字');
  });

  it('其它状态带上状态码', () => {
    expect(describeLookupFailure(500)).toContain('500');
  });
});

describe('lookupPlayer', () => {
  it('按 riotId 查,走 name 参数', async () => {
    const seen: { url: string; params?: unknown }[] = [];
    const client = fakeClient(
      {
        '/lol-summoner/v1/summoners': {
          gameName: '林俊杰',
          tagLine: '18557',
          summonerId: 17785561676,
          puuid: 'puuid-1',
          summonerLevel: 231
        }
      },
      seen
    );

    const result = await lookupPlayer(client, '林俊杰#18557', 'puuid-1');

    expect(result.found).toBe(true);
    expect(result.isSelf).toBe(true);
    expect(result.summonerLevel).toBe(231);
    expect(seen[0].url).toBe('/lol-summoner/v1/summoners');
    expect(seen[0].params).toEqual({ name: '林俊杰#18557' });
  });

  it('按游戏 ID 查,走路径段', async () => {
    const seen: { url: string; params?: unknown }[] = [];
    const client = fakeClient(
      { '/lol-summoner/v1/summoners/17785561676': { puuid: 'puuid-1', summonerId: 17785561676 } },
      seen
    );

    const result = await lookupPlayer(client, '17785561676');

    expect(result.found).toBe(true);
    expect(seen[0].url).toBe('/lol-summoner/v1/summoners/17785561676');
    expect(seen[0].params).toBeUndefined();
  });

  it('格式不对时压根不请求客户端', async () => {
    const seen: { url: string; params?: unknown }[] = [];
    const client = fakeClient({}, seen);

    const result = await lookupPlayer(client, '林俊杰');

    expect(result.found).toBe(false);
    expect(result.error).toContain('#标签');
    expect(seen).toHaveLength(0);
  });

  it('客户端 404 时给一句人话', async () => {
    const client = fakeClient({});

    const result = await lookupPlayer(client, '林俊杰#18557');

    expect(result.found).toBe(false);
    expect(result.error).toContain('没找到');
  });

  it('连不上客户端时提示先开客户端', async () => {
    const client = {
      get: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1'))
    } as unknown as AxiosInstance;

    const result = await lookupPlayer(client, '林俊杰#18557');

    expect(result.found).toBe(false);
    expect(result.error).toContain('游戏客户端');
  });

  it('搜人响应里没带段位明细时,再去 by-puuid 端点补一次', async () => {
    const seen: { url: string; params?: unknown }[] = [];
    const client = fakeClient(
      {
        '/lol-summoner/v1/summoners/17785561676': { puuid: 'puuid-1', summonerId: 17785561676 },
        '/lol-ranked/v1/ranked-stats/by-puuid/puuid-1': [
          { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'III', wins: 8, losses: 2, leaguePoints: 40 }
        ]
      },
      seen
    );

    const result = await lookupPlayer(client, '17785561676');

    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].wins).toBe(8);
    expect(seen.some((s) => s.url.includes('/lol-ranked/'))).toBe(true);
  });

  it('客户端回空对象时不当成查到了', async () => {
    const client = fakeClient({ '/lol-summoner/v1/summoners': {} });

    const result = await lookupPlayer(client, '林俊杰#18557');

    expect(result.found).toBe(false);
  });
});

describe('failedLookup', () => {
  it('结果对象是空壳,带错误原因', () => {
    const result = failedLookup('x#1', '没找到');
    expect(result.found).toBe(false);
    expect(result.error).toBe('没找到');
    expect(result.summonerId).toBe(0);
  });
});
