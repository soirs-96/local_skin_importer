import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MatchPoller } from '../poller';
import { getAllGameData } from '../liveClient';
import { getMatchSummoner } from '../summoner';
import { getChampSelectSession } from '../champSelect';
import { getRankedEntries } from '../ranked';
import { getRecentMatches } from '../recentMatches';
import { resolveLcuAuthAsync } from '../../lcu';

vi.mock('../../lcu', () => {
  class LcuNotRunningError extends Error {}
  class LcuUnreachableError extends Error {}
  return {
    LcuNotRunningError,
    LcuUnreachableError,
    resolveLcuAuthAsync: vi.fn(),
    createLcuClient: vi.fn(() => ({ get: vi.fn() }))
  };
});

vi.mock('../liveClient', () => ({ getAllGameData: vi.fn() }));
vi.mock('../summoner', () => ({ getMatchSummoner: vi.fn() }));
vi.mock('../champSelect', () => ({ getChampSelectSession: vi.fn() }));
vi.mock('../ranked', () => ({ getRankedEntries: vi.fn() }));
vi.mock('../recentMatches', () => ({ getRecentMatches: vi.fn() }));
vi.mock('../staticData', () => ({
  loadStaticData: vi.fn(async () => ({
    version: '14.1.1',
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  }))
}));

const liveMock = vi.mocked(getAllGameData);
const summonerMock = vi.mocked(getMatchSummoner);
const champSelectMock = vi.mocked(getChampSelectSession);
const rankedMock = vi.mocked(getRankedEntries);
const recentMock = vi.mocked(getRecentMatches);
const authMock = vi.mocked(resolveLcuAuthAsync);

const summoner = {
  displayName: '测试召唤师',
  tagLine: 'CN1',
  puuid: 'puuid-1',
  summonerId: 42
};

beforeEach(() => {
  vi.clearAllMocks();
  liveMock.mockResolvedValue(null);
  authMock.mockResolvedValue({ port: 1234, token: 'tok' });
  summonerMock.mockResolvedValue(summoner);
  champSelectMock.mockResolvedValue(null);
  rankedMock.mockResolvedValue({ entries: [], source: '/lol-ranked/v1/current-ranked-stats' });
  recentMock.mockResolvedValue({ total: 0, wins: 0, winrate: 0, matches: [] });
});

describe('MatchPoller', () => {
  it('客户端没开时是 idle,并把原因写在 lastError 上', async () => {
    authMock.mockRejectedValue(new Error('没开'));
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.state).toBe('idle');
    expect(snapshot.lastError).toBeTruthy();
  });

  it('不在局里也不在选人时是大厅', async () => {
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.state).toBe('lobby');
    expect(snapshot.summoner?.displayName).toBe('测试召唤师');
  });

  it('选人阶段能拿到选人会话', async () => {
    champSelectMock.mockResolvedValue({
      myTeam: [],
      theirTeam: [],
      myRole: 'MIDDLE',
      myChampionId: 1,
      myCellId: -1,
      bannedChampions: []
    });
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.state).toBe('champ_select');
    expect(snapshot.champSelect?.myRole).toBe('MIDDLE');
  });

  it('对局中以 Live Client 为准', async () => {
    liveMock.mockResolvedValue({
      summonerName: '测试召唤师',
      currentGold: 500,
      gameTime: 300,
      gameMode: 'CLASSIC'
    });
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.state).toBe('in_game');
    expect(snapshot.live?.currentGold).toBe(500);
    // 在对局里不该去问 LCU
    expect(authMock).not.toHaveBeenCalled();
  });

  it('大厅里才去拉段位和最近对局', async () => {
    const poller = new MatchPoller();
    await poller.refreshNow();
    expect(rankedMock).toHaveBeenCalled();
    expect(recentMock).toHaveBeenCalled();
  });

  it('凭据解析失败会退避,不每 2 秒重试', async () => {
    authMock.mockRejectedValue(new Error('没开'));
    const poller = new MatchPoller();
    await poller.refreshNow();
    await poller.refreshNow();
    expect(authMock).toHaveBeenCalledTimes(1);
  });
});
