import { describe, expect, it } from 'vitest';
import { RECENT_MATCH_LIMIT, buildRecentReports } from '../recentProfile';
import { emptyStaticData } from '../staticData';

const staticData = emptyStaticData();

/** 造一局「简化版」对局 —— stats 直接挂在顶层。 */
function game(over: Record<string, unknown> = {}): unknown {
  return {
    gameId: 1,
    mapId: 11,
    queueId: 420,
    queueType: 'RANKED_SOLO_5x5',
    gameCreation: 1_700_000_000_000,
    gameDuration: 1800,
    championId: 1,
    timeline: { lane: 'MIDDLE', role: 'NONE' },
    stats: { kills: 5, deaths: 2, assists: 8, totalMinionsKilled: 210, win: true },
    ...over
  };
}

describe('buildRecentReports', () => {
  it('排位才留 —— 大乱斗和匹配都剔掉', () => {
    const reports = buildRecentReports(
      [
        game({ gameId: 1, queueType: 'RANKED_SOLO_5x5' }),
        game({ gameId: 2, queueType: 'ARAM' }),
        game({ gameId: 3, queueType: 'NORMAL_BLIND' })
      ],
      staticData
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].gameId).toBe('1');
  });

  it('队列串归一 —— 后端只认后端那套', () => {
    const reports = buildRecentReports([game({ queueType: 'RANKED_SOLO_5X5' })], staticData);
    expect(reports[0].queueType).toBe('RANKED_SOLO_5x5');
  });

  it('最多 10 场', () => {
    const games = Array.from({ length: 25 }, (_, i) =>
      game({ gameId: i + 1, gameCreation: 1_700_000_000_000 + i * 1000 })
    );
    const reports = buildRecentReports(games, staticData);
    expect(reports).toHaveLength(RECENT_MATCH_LIMIT);
  });

  it('新的在前', () => {
    const reports = buildRecentReports(
      [
        game({ gameId: 1, gameCreation: 1_700_000_000_000 }),
        game({ gameId: 2, gameCreation: 1_700_000_600_000 })
      ],
      staticData
    );
    expect(reports.map((r) => r.gameId)).toEqual(['2', '1']);
  });

  it('同一局只留一次', () => {
    const reports = buildRecentReports([game({ gameId: 7 }), game({ gameId: 7 })], staticData);
    expect(reports).toHaveLength(1);
  });

  it('读不出 gameId 的那场丢掉 —— 后端靠 gameId 对账', () => {
    const reports = buildRecentReports([game({ gameId: 0 })], staticData);
    expect(reports).toHaveLength(0);
  });

  it('位置从分路推出来', () => {
    const reports = buildRecentReports([game({ timeline: { lane: 'MIDDLE', role: 'NONE' } })], staticData);
    expect(reports[0].position).toBe('mid');
  });

  it('大乱斗的位置认不出来 —— 记空串,不瞎猜', () => {
    const reports = buildRecentReports(
      [game({ mapId: 12, queueType: 'RANKED_SOLO_5x5', timeline: { lane: 'MIDDLE', role: 'NONE' } })],
      staticData
    );
    expect(reports[0].position).toBe('');
  });

  it('每场都带一个 0~100 的单场分', () => {
    const reports = buildRecentReports([game()], staticData);
    const score = reports[0].score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('没有对局就空着 —— 不塞假数据', () => {
    expect(buildRecentReports([], staticData)).toEqual([]);
  });
});
