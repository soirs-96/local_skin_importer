import { describe, expect, it } from 'vitest';
import {
  normalizeQueueType,
  summarizePositions,
  toRankedReport
} from '../positionStats';
import { emptyStaticData } from '../staticData';

describe('normalizeQueueType', () => {
  it('客户端给的大小写不一样,统一成后端那套', () => {
    expect(normalizeQueueType('RANKED_SOLO_5X5')).toBe('RANKED_SOLO_5x5');
    expect(normalizeQueueType('RANKED_FLEX_5X5')).toBe('RANKED_FLEX_5x5');
    expect(normalizeQueueType('ranked_solo_5x5')).toBe('RANKED_SOLO_5x5');
  });

  it('同一个灵活排位有的版本叫 SR', () => {
    expect(normalizeQueueType('RANKED_FLEX_SR')).toBe('RANKED_FLEX_5x5');
  });

  it('认不出来的原样返回', () => {
    expect(normalizeQueueType('NORMAL')).toBe('NORMAL');
  });
});

describe('toRankedReport', () => {
  it('认得出队列和段位就上报', () => {
    const report = toRankedReport({
      queueType: 'RANKED_SOLO_5X5',
      tier: 'GOLD',
      division: 'II',
      leaguePoints: 40,
      wins: 10,
      losses: 8
    });

    expect(report).toEqual({
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      division: 'II',
      leaguePoints: 40,
      wins: 10,
      losses: 8
    });
  });

  it('没有段位就不上报 —— 不能给后端一个假段位', () => {
    expect(toRankedReport({ queueType: 'RANKED_SOLO_5X5', tier: '' })).toBeNull();
  });

  it('不是排位队列就不上报', () => {
    expect(
      toRankedReport({ queueType: 'NORMAL_BLIND', tier: 'GOLD', division: 'II' })
    ).toBeNull();
  });

  it('小段认不出来就留空 —— 大师及以上本来就没有小段', () => {
    const report = toRankedReport({
      queueType: 'RANKED_FLEX_5X5',
      tier: 'MASTER',
      division: 'MASTER'
    });
    expect(report?.division).toBe('');
  });
});

describe('summarizePositions', () => {
  const staticData = emptyStaticData();

  /** 造一局「简化版」对局 —— stats 直接挂在顶层。 */
  function game(id: number, lane: string): unknown {
    return {
      gameId: id,
      mapId: 11,
      queueId: 420,
      timeline: { lane, role: 'NONE' },
      stats: { kills: 3, deaths: 2, assists: 5, totalMinionsKilled: 120 }
    };
  }

  it('按最近对局统计位置,多的排前面', () => {
    const reports = summarizePositions(
      [game(1, 'MIDDLE'), game(2, 'MIDDLE'), game(3, 'TOP')],
      staticData
    );

    expect(reports).toEqual([
      { position: 'mid', matchCount: 2 },
      { position: 'top', matchCount: 1 }
    ]);
  });

  it('大乱斗没有上下路 —— 那局不算数', () => {
    const aram = {
      gameId: 9,
      mapId: 12,
      queueId: 450,
      timeline: { lane: 'MIDDLE', role: 'NONE' },
      stats: { kills: 3, deaths: 2, assists: 5, totalMinionsKilled: 120 }
    };
    expect(summarizePositions([aram], staticData)).toEqual([]);
  });

  it('没有对局就空着,不塞假数据', () => {
    expect(summarizePositions([], staticData)).toEqual([]);
  });
});
