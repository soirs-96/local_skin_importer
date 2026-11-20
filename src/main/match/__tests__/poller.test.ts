import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MatchPoller } from '../poller';
import { getAllGameData, getPlayerStats } from '../liveClient';
import { getMatchSummoner } from '../summoner';
import { getChampSelectSession } from '../champSelect';
import { getRankedEntries } from '../ranked';
import { getRecentMatches } from '../recentMatches';
import { resolveLcuAuthAsync } from '../../lcu';
import type { LcuWsEvent } from '../lcuWs';
import type { LcuWsStatus } from '../../../shared/match';
import type { LocalSettlement } from '../../../shared/settlement';

vi.mock('../../lcu', () => {
  // 错误类要带上裁决层给的 code / summary —— 轮询器优先显示 summary。
  class LcuNotRunningError extends Error {
    readonly code = 'client-not-running';
    readonly summary = '未检测到游戏客户端,请先启动它。';
    readonly details: string[] = [];
  }
  class LcuUnreachableError extends Error {
    readonly code = 'stale-credentials';
    readonly summary = '游戏客户端端口已失效(客户端重启过),请重新启动客户端。';
  }
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

vi.mock('../liveClient', () => ({ getAllGameData: vi.fn(), getPlayerStats: vi.fn() }));
vi.mock('../summoner', () => ({ getMatchSummoner: vi.fn() }));
vi.mock('../champSelect', () => ({ getChampSelectSession: vi.fn() }));
// ranked 的解析函数要留真的 —— lcuWs 靠它从事件载荷里刨段位
vi.mock('../ranked', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ranked')>();
  return { ...actual, getRankedEntries: vi.fn() };
});
// recentMatches 只拦「最近对局」那个入口 —— 局末补齐用的 findJustFinishedMatch
// 留真的,不然 poller 里的 import 会拿到 undefined。
vi.mock('../recentMatches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../recentMatches')>();
  return { ...actual, getRecentMatches: vi.fn() };
});
vi.mock('../staticData', () => ({
  loadStaticData: vi.fn(async () => ({
    version: '14.1.1',
    // 英雄 64 = 盲僧。局末的 Live Client 英雄名是占位符,
    // 结算卡上的名字要靠这张表。
    champions: new Map([[64, { name: '盲僧', iconUrl: null }]]),
    items: new Map(),
    runes: new Map(),
    skinsByChampion: new Map()
  })),
  emptyStaticData: vi.fn(() => ({
    version: null,
    champions: new Map(),
    items: new Map(),
    runes: new Map(),
    skinsByChampion: new Map()
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
  summonerId: 42,
  profileIconId: 588
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
  vi.mocked(getPlayerStats).mockResolvedValue(null);
  authMock.mockResolvedValue({ port: 1234, token: 'tok', protocol: 'https', host: '127.0.0.1' });
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
      mySkinId: 0,
      mySelectedSkinId: -1,
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

  it('错误优先显示裁决层给的中文结论', async () => {
    const err = new Error('raw');
    (err as unknown as { summary: string; code: string }).summary =
      '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。';
    (err as unknown as { summary: string; code: string }).code = 'not-cn-client';
    authMock.mockRejectedValue(err);
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.lastError).toContain('国际服');
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

    wsFire({
      uri: '/lol-gameflow/v1/session',
      eventType: 'Update',
      data: { phase: 'ChampSelect' }
    });
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
        queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', wins: 3, losses: 1 }]
      }
    });
    await flush();

    const snapshot = poller.getSnapshot();
    expect(snapshot.rankedSource).toBe('ws');
    expect(snapshot.ranked).toHaveLength(1);
    expect(snapshot.ranked[0].tier).toBe('GOLD');
    expect(snapshot.ranked[0].display).toBe('荣耀黄金 II');

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

describe('MatchPoller 的局末检测', () => {
  const myChampSelect = {
    myTeam: [],
    theirTeam: [],
    myRole: 'MIDDLE',
    myChampionId: 64,
    mySkinId: 161013,
    mySelectedSkinId: -1,
    myCellId: -1,
    bannedChampions: []
  };

  it('phase 进入 PreEndOfGame 时产生一次结算', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();
    settlements.length = 0;

    wsFire({
      uri: '/lol-gameflow/v1/session',
      eventType: 'Update',
      data: { phase: 'PreEndOfGame' }
    });
    await flush();

    expect(settlements).toHaveLength(1);
    expect(settlements[0].championId).toBe(64);
    expect(settlements[0].usedSkin.riotSkinId).toBe(161013);
    expect(settlements[0].usedSkin.source).toBe('champ-select');
    poller.stop();
  });

  it('同一局只触发一次 —— 后面再来两个结束阶段也不重复', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    for (const phase of ['PreEndOfGame', 'EndOfGame', 'PostGame']) {
      wsFire({
        uri: '/lol-gameflow/v1/session',
        eventType: 'Update',
        data: { phase }
      });
      await flush();
    }

    expect(settlements).toHaveLength(1);
    poller.stop();
  });

  it('打完一局、进下一局后会再触发一次', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PreEndOfGame' } });
    await flush();
    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'None' } });
    await flush();
    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PreEndOfGame' } });
    await flush();

    expect(settlements).toHaveLength(2);
    poller.stop();
  });

  it('国服 gameflow 只给皮肤序号时,按「英雄编号 × 1000 + 序号」换算', async () => {
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();
    settlements.length = 0;

    // 局中:gameflow 事件带上队伍条目(国服给的是 lastSelectedSkinIndex)
    wsFire({
      uri: '/lol-gameflow/v1/session',
      eventType: 'Update',
      data: {
        phase: 'InProgress',
        gameData: {
          teamOne: [
            { championId: 64, puuid: 'ally-puuid', lastSelectedSkinIndex: 3 },
            { championId: 64, puuid: 'my-puuid', teamOwner: true, lastSelectedSkinIndex: 7 }
          ]
        }
      }
    });
    await flush();

    wsFire({
      uri: '/lol-gameflow/v1/session',
      eventType: 'Update',
      data: { phase: 'PreEndOfGame' }
    });
    await flush();

    expect(settlements).toHaveLength(1);
    expect(settlements[0].championId).toBe(64);
    expect(settlements[0].usedSkin.riotSkinId).toBe(64007);
    expect(settlements[0].usedSkin.source).toBe('gameflow-index');
    // 英雄名按英雄编号从静态数据里取(局末 Live Client 给的是占位符)
    expect(settlements[0].championName).toBe('盲僧');
    poller.stop();
  });

  it('应用刚启动、客户端停在结算画面上 → 不产生结算(没打过这一局)', async () => {
    // champSelectMock 默认就是 null,currentChampionId 拿不到,lastLive 也是 null
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PostGame' } });
    await flush();

    expect(settlements).toHaveLength(0);
    poller.stop();
  });
});
