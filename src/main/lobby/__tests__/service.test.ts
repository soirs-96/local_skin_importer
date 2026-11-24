import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbyClientStatus } from '../../../shared/lobby';
import { LobbyService } from '../service';

const mocks = vi.hoisted(() => {
  /** 假 WS 客户端 —— 行为跟真的一样:start() 会去取 token,取不到就当连不上。 */
  class FakeLobbyClient {
    static instances: FakeLobbyClient[] = [];
    stopped = false;
    readonly resolveToken: () => Promise<string>;
    readonly onStatus?: (status: LobbyClientStatus) => void;

    constructor(options: {
      resolveToken: () => Promise<string>;
      onStatus?: (status: LobbyClientStatus) => void;
    }) {
      this.resolveToken = options.resolveToken;
      this.onStatus = options.onStatus;
      FakeLobbyClient.instances.push(this);
    }

    async start(): Promise<void> {
      try {
        await this.resolveToken();
      } catch {
        // 没 token —— 连不上,跟真实客户端一个行为
      }
    }

    /** 假装服务端把连接拒了(token 过期)。 */
    emitStatus(status: LobbyClientStatus): void {
      this.onStatus?.(status);
    }

    stop(): void {
      this.stopped = true;
    }

    sendProfile(): void {}

    say(): void {}
  }

  return {
    FakeLobbyClient,
    getStoredToken: vi.fn<() => string | null>(() => null),
    getPhase: vi.fn(() => 'None'),
    readLobbyPrefs: vi.fn(() => ({ publicVisible: true })),
    writeLobbyPrefs: vi.fn(() => ({ publicVisible: true })),
    fetchLobbyPlayers: vi.fn(),
    fetchLobbyHistory: vi.fn(),
    fetchLobbyPlayerProfile: vi.fn(),
    normalizeSnapshot: vi.fn((snapshot: unknown) => snapshot),
    invitePlayer: vi.fn()
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}));

vi.mock('../../auth', () => ({
  getStoredToken: mocks.getStoredToken
}));

vi.mock('../../match/poller', () => ({
  matchPoller: { getPhase: mocks.getPhase }
}));

vi.mock('../api', () => ({
  fetchLobbyPlayers: mocks.fetchLobbyPlayers,
  fetchLobbyHistory: mocks.fetchLobbyHistory,
  fetchLobbyPlayerProfile: mocks.fetchLobbyPlayerProfile,
  normalizeSnapshot: mocks.normalizeSnapshot
}));

vi.mock('../client', () => ({
  LobbyClient: mocks.FakeLobbyClient
}));

vi.mock('../invite', () => ({
  invitePlayer: mocks.invitePlayer
}));

vi.mock('../prefs', () => ({
  readLobbyPrefs: mocks.readLobbyPrefs,
  writeLobbyPrefs: mocks.writeLobbyPrefs
}));

describe('LobbyService 登录之后重连', () => {
  beforeEach(() => {
    mocks.FakeLobbyClient.instances.length = 0;
    mocks.getStoredToken.mockReturnValue(null);
  });

  it('没登录时连不上 —— 登录完立刻重连,不用等退避计时器', () => {
    const service = new LobbyService();
    service.start();
    // 还没兑换同步码 —— 客户端起来了,但连不上
    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);

    mocks.getStoredToken.mockReturnValue('jwt-1');
    service.onLogin();

    // 旧连接被关掉,新连接立刻建起来
    expect(mocks.FakeLobbyClient.instances).toHaveLength(2);
    expect(mocks.FakeLobbyClient.instances[0].stopped).toBe(true);
    expect(mocks.FakeLobbyClient.instances[1].stopped).toBe(false);
    service.stop();
  });

  it('本来就连上了 —— 别乱重连', () => {
    mocks.getStoredToken.mockReturnValue('jwt-1');
    const service = new LobbyService();
    service.start();
    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);

    service.onLogin();

    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);
    service.stop();
  });

  it('服务停了之后再调 onLogin —— 不会把连接又拉起来', () => {
    const service = new LobbyService();
    service.start();
    service.stop();

    mocks.getStoredToken.mockReturnValue('jwt-1');
    service.onLogin();

    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);
  });

  it('token 过期被拒之后重新登录 —— 立刻用新 token 重连', () => {
    mocks.getStoredToken.mockReturnValue('old-token');
    const service = new LobbyService();
    service.start();

    // 握手被拒 —— 服务端不认这个 token
    mocks.FakeLobbyClient.instances[0].emitStatus('unauthorized');
    expect(service.getState().status).toBe('unauthorized');

    // 重新登录,换了新 token
    mocks.getStoredToken.mockReturnValue('new-token');
    service.onLogin();

    expect(mocks.FakeLobbyClient.instances).toHaveLength(2);
    expect(mocks.FakeLobbyClient.instances[0].stopped).toBe(true);
    expect(mocks.FakeLobbyClient.instances[1].stopped).toBe(false);
    service.stop();
  });

  it('还是同一个 token 被拒 —— 不重连(重连了也是白连)', () => {
    mocks.getStoredToken.mockReturnValue('old-token');
    const service = new LobbyService();
    service.start();
    mocks.FakeLobbyClient.instances[0].emitStatus('unauthorized');

    service.onLogin();

    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);
    service.stop();
  });

  it('退出登录 —— 大厅连接断开,不再挂在线名单里', () => {
    mocks.getStoredToken.mockReturnValue('jwt-1');
    const service = new LobbyService();
    service.start();
    expect(mocks.FakeLobbyClient.instances).toHaveLength(1);

    service.onLogout();

    expect(mocks.FakeLobbyClient.instances[0].stopped).toBe(true);
    service.stop();
  });

  it('退出登录之后再登录 —— 又连上', () => {
    mocks.getStoredToken.mockReturnValue('jwt-1');
    const service = new LobbyService();
    service.start();
    service.onLogout();

    mocks.getStoredToken.mockReturnValue('jwt-2');
    service.onLogin();

    expect(mocks.FakeLobbyClient.instances).toHaveLength(2);
    expect(mocks.FakeLobbyClient.instances[1].stopped).toBe(false);
    service.stop();
  });
});

describe('LobbyService 悬浮档案', () => {
  it('按人取近 10 场档案', async () => {
    const profile = { userId: 7, matchCount: 3 };
    mocks.fetchLobbyPlayerProfile.mockResolvedValue(profile);

    const service = new LobbyService();
    await expect(service.playerProfile(7)).resolves.toEqual(profile);
    expect(mocks.fetchLobbyPlayerProfile).toHaveBeenCalledWith(7);
  });
});
