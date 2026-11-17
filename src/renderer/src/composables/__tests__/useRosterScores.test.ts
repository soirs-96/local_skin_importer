import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { clearRosterScoreCache, describeRosterScore, useRosterScores } from '../useRosterScores';
import type { RosterPlayer } from '../../../../shared/roster';
import type { PlayerGame } from '../../../../shared/match';
import type { RosterScore } from '../../../../shared/scoring';

/**
 * 「对局双方」卡上每个人的评分。
 *
 * 分数走腾讯的对局服务 —— 每个人一次请求,所以缓存、并发限流、失败退避
 * 三件事都要在这儿盯住。
 */

const mockApi = {
  fetchPlayerGames: vi.fn()
};

beforeEach(() => {
  clearRosterScoreCache();
  (globalThis as unknown as { window: { api: typeof mockApi } }).window = { api: mockApi };
  mockApi.fetchPlayerGames.mockReset();
});

/** 一局十个人的排位 —— 够评分引擎打分。 */
function rankedGame(win = true): PlayerGame {
  const peers = Array.from({ length: 10 }, (_, i) => ({
    puuid: `p${i}`,
    displayName: `玩家${i}`,
    championId: 1,
    championName: '甲',
    championIconUrl: null,
    kills: 2,
    deaths: 2,
    assists: 2,
    kda: '2/2/2',
    win,
    teamId: i < 5 ? 100 : 200,
    isTarget: i === 0,
    goldEarned: 10000,
    damageToChampions: 10000,
    minionKills: 100,
    lane: 'MIDDLE',
    role: 'SOLO'
  }));
  return {
    gameId: 'g1',
    timestampMs: 0,
    durationS: 1800,
    queueId: 420,
    gameMode: 'KIWI',
    mapId: 11,
    championId: 1,
    championName: '甲',
    championIconUrl: null,
    kills: 2,
    deaths: 2,
    assists: 2,
    kda: '2/2/2',
    win,
    lane: 'MIDDLE',
    role: 'SOLO',
    goldEarned: 10000,
    damageToChampions: 10000,
    minionKills: 100,
    items: [],
    peers
  };
}

function player(puuid: string): RosterPlayer {
  return {
    key: `ally-${puuid}`,
    side: 'ally',
    isSelf: false,
    name: `玩家${puuid}`,
    championName: '甲',
    championIconUrl: null,
    avatarUrl: null,
    rankText: '',
    level: 0,
    summonerId: 0,
    puuid
  };
}

describe('useRosterScores', () => {
  it('每个人的分都拉一次,拉完算出成绩单', async () => {
    mockApi.fetchPlayerGames.mockResolvedValue({
      total: 1,
      wins: 1,
      winrate: 1,
      games: [rankedGame()]
    });

    const players = ref<RosterPlayer[]>([player('puuid-1')]);
    const scope = effectScope();
    const { scores } = scope.run(() => useRosterScores(() => players.value))!;

    await vi.waitFor(() => expect(scores.value['puuid-1']).toBeDefined());

    expect(mockApi.fetchPlayerGames).toHaveBeenCalledWith('puuid-1', 0, 10);
    expect(scores.value['puuid-1'].games).toBe(1);
    expect(scores.value['puuid-1'].wins).toBe(1);
    expect(scores.value['puuid-1'].positionLabel).toBe('中单');
    scope.stop();
  });

  it('名单变了但人没换 —— 不重拉', async () => {
    mockApi.fetchPlayerGames.mockResolvedValue({
      total: 1,
      wins: 1,
      winrate: 1,
      games: [rankedGame()]
    });

    const players = ref<RosterPlayer[]>([player('puuid-1')]);
    const scope = effectScope();
    const { scores } = scope.run(() => useRosterScores(() => players.value))!;

    await vi.waitFor(() => expect(scores.value['puuid-1']).toBeDefined());
    expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(1);

    // 轮询器每 2 秒推一次快照,名单数组是新的,但还是同一个人
    players.value = [player('puuid-1')];
    await vi.waitFor(() => expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(1));
    scope.stop();
  });

  it('换了人就再拉一次', async () => {
    mockApi.fetchPlayerGames.mockResolvedValue({
      total: 1,
      wins: 1,
      winrate: 1,
      games: [rankedGame()]
    });

    const players = ref<RosterPlayer[]>([player('puuid-1')]);
    const scope = effectScope();
    const { scores } = scope.run(() => useRosterScores(() => players.value))!;

    await vi.waitFor(() => expect(scores.value['puuid-1']).toBeDefined());

    players.value = [player('puuid-1'), player('puuid-2')];
    await vi.waitFor(() => expect(scores.value['puuid-2']).toBeDefined());
    expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('拉失败就标成失败,不显示假分数', async () => {
    mockApi.fetchPlayerGames.mockRejectedValue(new Error('腾讯会话令牌失效了'));

    const players = ref<RosterPlayer[]>([player('puuid-1')]);
    const scope = effectScope();
    const { scores, failed } = scope.run(() => useRosterScores(() => players.value))!;

    await vi.waitFor(() => expect(failed.value['puuid-1']).toBe(true));
    expect(scores.value['puuid-1']).toBeUndefined();
    scope.stop();
  });

  it('没有 puuid 的人不拉 —— 拉了也是白拉', async () => {
    const players = ref<RosterPlayer[]>([player('')]);
    const scope = effectScope();
    scope.run(() => useRosterScores(() => players.value));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockApi.fetchPlayerGames).not.toHaveBeenCalled();
    scope.stop();
  });

  it('退避到期了会重试 —— 失败的人不能永远停在「—」', async () => {
    vi.useFakeTimers();
    try {
      mockApi.fetchPlayerGames.mockRejectedValue(new Error('腾讯那边炸了'));

      const players = ref<RosterPlayer[]>([player('puuid-1')]);
      const scope = effectScope();
      scope.run(() => useRosterScores(() => players.value));

      await vi.advanceTimersByTimeAsync(0);
      expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(1);

      // 退避 60 秒,第一个 tick(30 秒)还没到 —— 不该重试
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(1);

      // 退避到了,下一个 tick 就该再试一次
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(2);

      scope.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('连着失败三次就放弃 —— 客户端没开的时候一直重试是白费劲', async () => {
    vi.useFakeTimers();
    try {
      mockApi.fetchPlayerGames.mockRejectedValue(new Error('腾讯那边炸了'));

      const players = ref<RosterPlayer[]>([player('puuid-1')]);
      const scope = effectScope();
      scope.run(() => useRosterScores(() => players.value));

      // 三次失败:0 秒、退避后 60 秒、再 60 秒
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(3);

      // 第四次就别试了 —— 等用户点「刷新」
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockApi.fetchPlayerGames).toHaveBeenCalledTimes(3);

      scope.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('describeRosterScore', () => {
  const score: RosterScore = {
    score: 7.84,
    games: 10,
    wins: 6,
    positionLabel: '打野'
  };

  it('算分中就是 loading', () => {
    const display = describeRosterScore('p1', {}, { p1: true });
    expect(display.state).toBe('loading');
  });

  it('有排位数据就给分数和场次', () => {
    const display = describeRosterScore('p1', { p1: score }, {});
    expect(display.state).toBe('value');
    expect(display.value).toBe('7.8');
    expect(display.meta).toBe('10 场 · 6 胜');
    expect(display.title).toContain('打野');
  });

  it('最近没有排位就是 none —— 不是零分', () => {
    const empty: RosterScore = { ...score, score: 0, games: 0, wins: 0 };
    const display = describeRosterScore('p1', { p1: empty }, {});
    expect(display.state).toBe('none');
  });

  it('拉不到就什么都别给 —— 不编一个假分数', () => {
    expect(describeRosterScore('p1', {}, {}).state).toBe('unknown');
    expect(describeRosterScore('', { p1: score }, {}).state).toBe('unknown');
  });
});
