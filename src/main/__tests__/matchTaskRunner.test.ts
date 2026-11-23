import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { MatchTaskRunner } from '../match/matchTaskRunner';
import { getStoredToken } from '../auth';
import { matchPoller } from '../match/poller';
import type { PlayerGame, PlayerLookup } from '../../shared/match';

vi.mock('axios');
vi.mock('../auth', () => ({
  getStoredToken: vi.fn(() => 'desktop-token')
}));
vi.mock('../match/poller', () => ({
  matchPoller: {
    lookupPlayer: vi.fn(),
    fetchPlayerGames: vi.fn()
  }
}));

const tokenMock = vi.mocked(getStoredToken);
const lookupMock = vi.mocked(matchPoller.lookupPlayer);
const fetchGamesMock = vi.mocked(matchPoller.fetchPlayerGames);

/** 后端统一响应体 { code, data } */
function ok(data?: unknown): AxiosResponse {
  return { data: { code: 200, data } } as unknown as AxiosResponse;
}

function lookup(overrides: Partial<PlayerLookup> = {}): PlayerLookup {
  return {
    query: '林俊杰#18557',
    found: true,
    riotId: '林俊杰#18557',
    displayName: '林俊杰',
    tagLine: '18557',
    summonerId: 12345,
    puuid: 'puuid-1',
    summonerLevel: 120,
    profileIconId: 0,
    rankedDisplay: '荣耀黄金 III',
    rankedTier: 'GOLD',
    rankedDivision: 'III',
    ranked: [],
    isSelf: false,
    error: null,
    ...overrides
  };
}

function game(overrides: Partial<PlayerGame> = {}): PlayerGame {
  return {
    gameId: 'TJ101_401186650860',
    timestampMs: 1_700_000_000_000,
    durationS: 1935,
    queueId: 420,
    gameMode: 'CLASSIC',
    mapId: 11,
    championId: 64,
    championName: '盲僧',
    championIconUrl: null,
    kills: 3,
    deaths: 1,
    assists: 8,
    kda: '3/1/8',
    win: true,
    lane: 'MIDDLE',
    role: 'SOLO',
    goldEarned: 12500,
    damageToChampions: 18000,
    minionKills: 210,
    gameMaxMinionKills: 230,
    items: [],
    peers: [],
    ...overrides
  };
}

interface ReportBody {
  result: { player: { riotId: string }; wins: number } | null;
  error: string | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.mockReturnValue('desktop-token');
  lookupMock.mockResolvedValue(lookup());
  fetchGamesMock.mockResolvedValue({ total: 1, wins: 1, winrate: 1, games: [game()] });
});

describe('MatchTaskRunner', () => {
  it('没登录就不去领任务', async () => {
    tokenMock.mockReturnValue(null);

    await new MatchTaskRunner().runOnce();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('没有待办任务就不回传', async () => {
    vi.mocked(axios.post).mockResolvedValue(ok(null));

    await new MatchTaskRunner().runOnce();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('领到任务 → 查资料 → 拉战绩 → 回传结果', async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce(ok({ id: 'task-1', query: '林俊杰#18557' }))
      .mockResolvedValueOnce(ok());

    await new MatchTaskRunner().runOnce();

    expect(lookupMock).toHaveBeenCalledWith('林俊杰#18557');
    expect(fetchGamesMock).toHaveBeenCalledWith('puuid-1', 0, 20);

    const reportCall = vi.mocked(axios.post).mock.calls[1];
    expect(reportCall[0]).toContain('/api/desktop/match-tasks/task-1/result');
    const body = reportCall[1] as ReportBody;
    expect(body.error).toBeNull();
    expect(body.result?.player.riotId).toBe('林俊杰#18557');
    expect(body.result?.wins).toBe(1);
  });

  it('查不到人 → 回传失败原因', async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce(ok({ id: 'task-2', query: '查不到的人#1' }))
      .mockResolvedValueOnce(ok());
    lookupMock.mockResolvedValue(lookup({ found: false, error: '没查到这个玩家' }));

    await new MatchTaskRunner().runOnce();

    expect(fetchGamesMock).not.toHaveBeenCalled();
    const body = vi.mocked(axios.post).mock.calls[1][1] as ReportBody;
    expect(body.result).toBeNull();
    expect(body.error).toBe('没查到这个玩家');
  });

  it('拉战绩失败 → 回传失败原因', async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce(ok({ id: 'task-3', query: '林俊杰#18557' }))
      .mockResolvedValueOnce(ok());
    fetchGamesMock.mockRejectedValue(new Error('客户端没开'));

    await new MatchTaskRunner().runOnce();

    const body = vi.mocked(axios.post).mock.calls[1][1] as ReportBody;
    expect(body.result).toBeNull();
    expect(body.error).toContain('客户端没开');
  });
});
