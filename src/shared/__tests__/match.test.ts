import { describe, expect, it } from 'vitest';
import {
  buildMasteryRows,
  sortMasteryRows,
  type ChampionMastery,
  type RecentMatchesSummary
} from '../match';

function mastery(championId: number, championPoints: number): ChampionMastery {
  return {
    championId,
    championName: `英雄${championId}`,
    championIconUrl: null,
    championLevel: 5,
    championPoints,
    highestGrade: 'A+',
    lastPlayTime: 1794315181000,
    tokensEarned: 3
  };
}

function recent(
  matches: { championId: number; win: boolean }[]
): RecentMatchesSummary {
  const list = matches.map((match, index) => ({
    gameId: index,
    championId: match.championId,
    championName: `英雄${match.championId}`,
    championIconUrl: null,
    gameMode: 'CLASSIC',
    role: 'MIDDLE',
    kills: 1,
    deaths: 1,
    assists: 1,
    kda: '1/1/1',
    win: match.win,
    timestampMs: 1794315181000,
    durationS: 1800,
    items: []
  }));
  const wins = list.filter((m) => m.win).length;
  return { total: list.length, wins, winrate: list.length ? wins / list.length : 0, matches: list };
}

describe('buildMasteryRows', () => {
  it('把最近窗口里每个英雄的场次和胜场对上', () => {
    const rows = buildMasteryRows(
      [mastery(1, 100), mastery(2, 50)],
      recent([
        { championId: 1, win: true },
        { championId: 1, win: false },
        { championId: 2, win: true }
      ])
    );
    const first = rows.find((row) => row.championId === 1);
    expect(first?.recentGames).toBe(2);
    expect(first?.recentWins).toBe(1);
  });

  it('窗口里没出现过的英雄场次是 0', () => {
    const rows = buildMasteryRows([mastery(9, 100)], recent([{ championId: 1, win: true }]));
    expect(rows[0].recentGames).toBe(0);
    expect(rows[0].recentWins).toBe(0);
  });

  it('没有窗口数据也照样出得来', () => {
    const rows = buildMasteryRows([mastery(1, 100)], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].recentGames).toBe(0);
  });
});

describe('sortMasteryRows', () => {
  it('按熟练度排序:点数最高的排第一', () => {
    const rows = sortMasteryRows(
      buildMasteryRows([mastery(1, 100), mastery(2, 9999)], null),
      'mastery'
    );
    expect(rows[0].championId).toBe(2);
  });

  it('按胜率排序:只留窗口里出现过的英雄', () => {
    const rows = sortMasteryRows(
      buildMasteryRows(
        [mastery(1, 100), mastery(2, 9999), mastery(3, 5000)],
        recent([
          { championId: 1, win: true },
          { championId: 1, win: true },
          { championId: 1, win: false },
          { championId: 3, win: true }
        ])
      ),
      'winrate'
    );
    // 英雄 2 没在窗口里出现过,没有胜率可言,不参与排名
    expect(rows.map((row) => row.championId)).toEqual([3, 1]);
  });

  it('胜率一样时按熟练度点数组', () => {
    const rows = sortMasteryRows(
      buildMasteryRows(
        [mastery(1, 100), mastery(2, 9999)],
        recent([
          { championId: 1, win: true },
          { championId: 2, win: true }
        ])
      ),
      'winrate'
    );
    expect(rows.map((row) => row.championId)).toEqual([2, 1]);
  });
});
