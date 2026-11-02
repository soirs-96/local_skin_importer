import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MatchPoller } from '../poller';
import { getAllGameData } from '../liveClient';
import { getMatchSummoner } from '../summoner';
import { getChampSelectSession } from '../champSelect';
import { getRankedEntries } from '../ranked';
import { getRecentMatches } from '../recentMatches';
import { resolveLcuAuthAsync } from '../../lcu';
import type { LcuWsEvent } from '../lcuWs';
import type { LcuWsStatus } from '../../../shared/match';

vi.mock('../../lcu', () => {
  class LcuNotRunningError extends Error {}
  class LcuUnreachableError extends Error {}
  return {
    LcuNotRunningError,
    LcuUnreachableError,
    resolveLcuAuthAsync: vi.fn(),
    createLcuClient: vi.fn(() => ({ get: vi.fn() })),
    setSharedLcuAuth: vi.fn(),
    getSharedLcuAuth: vi.fn(() => null),
    invalidateSharedLcuAuth: vi.fn()
  };
});

vi.mock('../liveClient', () => ({ getAllGameData: vi.fn() }));
vi.mock('../summoner', () => ({ getMatchSummoner: vi.fn() }));
vi.mock('../champSelect', () => ({ getChampSelectSession: vi.fn() }));
// ranked 的解析函数要留真的 —— lcuWs 靠它从事件载荷里刨段位
vi.mock('../ranked', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ranked')>();
  return { ...actual, getRankedEntries: vi.fn() };
});
vi.mock('../recentMatches', () => ({ getRecentMatches: vi.fn() }));
vi.mock('../staticData', () => ({
  loadStaticData: vi.fn(async () => ({
    version: '14.1.1',
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  })),
  emptyStaticData: vi.fn(() => ({
    version: null,
    champions: new Map(),
    items: new Map(),
    runes: new Map()
  }))
}));

// 假的 WebSocket 客户端:不连真客户端,只把事件转给轮询器。
// 用 vi.hoisted 是因为 vi.mock 的工厂函数会被提到文件顶部执行,
// 那时普通 const 还没初始化,访问会踩到 TDZ。
const wsClients = vi.hoisted<{ fire: (event: LcuWsEvent) => void }[]>(() => []);

vi.mock('../lcuWs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lcuWs')>();
  class FakeLcuWsClient {
    private readonly handlers: {
      onEvent?: (event: LcuWsEvent) => void;
      onStatus?: (status: LcuWsStatus) => void;
    };

    constructor(options: {
      onEvent?: (event: LcuWsEvent) => void;
      onStatus?: (status: LcuWsStatus) => void;
    }) {
      this.handlers = options;
      wsClients.push({
        fire: (event: LcuWsEvent) => {
          this.handlers.onEvent?.(event);
        }
      });
    }

    start(): void {
      // 假客户端一上来就是「已连接」
      this.handlers.onStatus?.('connected');
    }

    stop(): void {}

    getStatus(): LcuWsStatus {
      return 'connected';
    }
  }
  return { ...actual, LcuWsClient: FakeLcuWsClient };
});

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

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function wsFire(event: LcuWsEvent): void {
  wsClients[wsClients.length - 1]?.fire(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  wsClients.length = 0;
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

describe('MatchPoller 的 WebSocket 通道', () => {
  it('状态类事件会立刻唤醒一轮采集', async () => {
    const poller = new MatchPoller();
    let emissions = 0;
    poller.subscribe(() => {
      emissions += 1;
    });
    poller.start();
    await flush();
    const before = emissions;

    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'ChampSelect' } });
    await flush();

    expect(emissions).toBeGreaterThan(before);
    poller.stop();
  });

  it('HTTP 段位取不到时用事件流兜底,并标出来源', async () => {
    rankedMock.mockResolvedValue({ entries: [], source: null });
    const poller = new MatchPoller();
    poller.start();
    await flush();
    expect(poller.getSnapshot().ranked).toEqual([]);

    wsFire({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: {
        queues: [
          { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', wins: 3, losses: 1 }
        ]
      }
    });
    await flush();

    const snapshot = poller.getSnapshot();
    expect(snapshot.rankedSource).toBe('ws');
    expect(snapshot.ranked).toHaveLength(1);
    expect(snapshot.ranked[0].tier).toBe('GOLD');
    expect(snapshot.ranked[0].display).toBe('华贵黄金 II');

    poller.stop();
  });

  it('HTTP 有段位时不改用事件流', async () => {
    rankedMock.mockResolvedValue({
      entries: [
        {
          queueType: 'RANKED_SOLO_5x5',
          tier: 'DIAMOND',
          division: 'I',
          leaguePoints: 12,
          wins: 5,
          losses: 5,
          display: '璀璨钻石 I',
          winrate: 0.5
        }
      ],
      source: '/lol-ranked/v1/current-ranked-stats'
    });
    const poller = new MatchPoller();
    poller.start();
    await flush();

    wsFire({
      uri: '/lol-ranked/v1/current-ranked-stats',
      eventType: 'Update',
      data: { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD' }] }
    });
    await flush();

    const snapshot = poller.getSnapshot();
    expect(snapshot.rankedSource).toBe('/lol-ranked/v1/current-ranked-stats');
    expect(snapshot.ranked[0].tier).toBe('DIAMOND');

    poller.stop();
  });

  it('快照里带上事件加速通道的状态', async () => {
    const poller = new MatchPoller();
    poller.start();
    await flush();
    expect(poller.getSnapshot().wsStatus).toBe('connected');
    poller.stop();
  });
});
