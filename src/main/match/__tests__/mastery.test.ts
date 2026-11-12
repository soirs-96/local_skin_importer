import { describe, expect, it } from 'vitest';
import type { AxiosInstance } from 'axios';
import { getTopChampions, masteryPath, parseChampionMastery, TOP_CHAMPION_LIMIT } from '../mastery';
import type { StaticData } from '../staticData';

/** 只认路径的假客户端:没登记的路径直接 404。 */
function fakeClient(handlers: Record<string, unknown>): AxiosInstance {
  return {
    get: (url: string) => {
      if (!(url in handlers)) return Promise.reject(new Error(`404 ${url}`));
      return Promise.resolve({ data: handlers[url] });
    }
  } as unknown as AxiosInstance;
}

const MASTERY_URL = '/lol-champion-mastery/v1/puuid-1/champion-mastery';
const SUMMARY_URL = '/lol-game-data/assets/v1/champion-summary.json';

const staticData: StaticData = {
  version: '14.1.1',
  champions: new Map([
    [523, { name: '阿萝拉', iconUrl: 'lcuicon://champion/523.png' }],
    [142, { name: '凯南', iconUrl: 'lcuicon://champion/142.png' }]
  ]),
  items: new Map(),
  runes: new Map()
};

describe('masteryPath', () => {
  it('路径里放的是 puuid', () => {
    expect(masteryPath('abc-123')).toBe('/lol-champion-mastery/v1/abc-123/champion-mastery');
  });

  it('没有 puuid 就没路径', () => {
    expect(masteryPath('')).toBeNull();
  });
});

describe('parseChampionMastery', () => {
  it('读出等级、点数、评级和最近使用时间', () => {
    const entries = parseChampionMastery(
      [
        {
          championId: 523,
          championLevel: 24,
          championPoints: 231381,
          highestGrade: 'S+',
          lastPlayTime: 1794315181000,
          tokensEarned: 32
        }
      ],
      staticData
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].championName).toBe('阿萝拉');
    expect(entries[0].championLevel).toBe(24);
    expect(entries[0].championPoints).toBe(231381);
    expect(entries[0].highestGrade).toBe('S+');
    expect(entries[0].lastPlayTime).toBe(1794315181000);
    expect(entries[0].tokensEarned).toBe(32);
    expect(entries[0].championIconUrl).toBe('lcuicon://champion/523.png');
  });

  it('按点数降序 —— 点数最高的那个就是本命英雄', () => {
    const entries = parseChampionMastery(
      [
        { championId: 142, championLevel: 13, championPoints: 116404 },
        { championId: 523, championLevel: 24, championPoints: 231381 }
      ],
      staticData
    );
    expect(entries.map((e) => e.championId)).toEqual([523, 142]);
  });

  it('静态数据里没有这个英雄时名字退回编号', () => {
    const entries = parseChampionMastery([{ championId: 999, championPoints: 10 }], staticData);
    expect(entries[0].championName).toBe('#999');
    expect(entries[0].championIconUrl).toBe('lcuicon://champion/999.png');
  });

  it('缺字段不炸,按 0 / 空串处理', () => {
    const entries = parseChampionMastery([{ championId: 142 }], staticData);
    expect(entries[0].championLevel).toBe(0);
    expect(entries[0].championPoints).toBe(0);
    expect(entries[0].highestGrade).toBe('');
    expect(entries[0].lastPlayTime).toBe(0);
  });

  it('非数组输入返回空数组', () => {
    expect(parseChampionMastery({ oops: true }, staticData)).toEqual([]);
    expect(parseChampionMastery(null, staticData)).toEqual([]);
  });

  it('没有 championId 的条目丢掉', () => {
    expect(parseChampionMastery([{ championPoints: 100 }], staticData)).toEqual([]);
  });
});

describe('getTopChampions', () => {
  it('按点数降序,并带上跟后端对齐用的英文 key', async () => {
    const client = fakeClient({
      [MASTERY_URL]: [
        { championId: 142, championPoints: 116404 },
        { championId: 523, championPoints: 231381 }
      ],
      [SUMMARY_URL]: [
        { id: 142, alias: 'Zoe', name: '魔眼之女', description: '佐伊' },
        { id: 523, alias: 'Aurora', name: '双界灵能', description: '阿萝拉' }
      ]
    });

    const rows = await getTopChampions(client, 'puuid-1');

    expect(rows.map((r) => r.championNameEn)).toEqual(['Aurora', 'Zoe']);
    expect(rows[0].championName).toBe('阿萝拉');
    expect(rows[0].championPoints).toBe(231381);
    expect(rows[0].championId).toBe(523);
  });

  it('最多取前 15 个', async () => {
    const mastery = Array.from({ length: 30 }, (_, i) => ({
      championId: i + 1,
      championPoints: 1000 - i
    }));
    const summary = mastery.map((m) => ({ id: m.championId, alias: `Hero${m.championId}`, name: `英雄${m.championId}` }));
    const client = fakeClient({ [MASTERY_URL]: mastery, [SUMMARY_URL]: summary });

    const rows = await getTopChampions(client, 'puuid-1');

    expect(TOP_CHAMPION_LIMIT).toBe(15);
    expect(rows).toHaveLength(15);
    expect(rows[0].championId).toBe(1);
    expect(rows[14].championId).toBe(15);
  });

  it('认不出英文名的英雄直接不要 —— 报上去后端也认不出来', async () => {
    const client = fakeClient({
      [MASTERY_URL]: [{ championId: 1, championPoints: 5000 }],
      // summary 里没有这个英雄
      [SUMMARY_URL]: []
    });

    expect(await getTopChampions(client, 'puuid-1')).toEqual([]);
  });

  it('英文 key 只是个数字的条目丢掉', async () => {
    const client = fakeClient({
      [MASTERY_URL]: [{ championId: 1, championPoints: 5000 }],
      [SUMMARY_URL]: [{ id: 1, alias: '12345', name: '某人' }]
    });

    expect(await getTopChampions(client, 'puuid-1')).toEqual([]);
  });

  it('熟练度接口拉不到就抛错 —— 不能静默当成空名单', async () => {
    const client = fakeClient({});
    await expect(getTopChampions(client, 'puuid-1')).rejects.toThrow();
  });

  it('没有 puuid 就没名单', async () => {
    const client = fakeClient({});
    expect(await getTopChampions(client, '')).toEqual([]);
  });
});
