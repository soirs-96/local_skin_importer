import axios from 'axios';
import { BrowserWindow, Notification, clipboard, ipcMain } from 'electron';
import * as lcu from './lcu';
import * as auth from './auth';
import { syncOwnedSkins, shouldSkipSync, minIntervalFor } from './backend';
import { fetchRegionUsers } from './regionUsers';
import { fetchCatalog, fetchMyOwned } from './catalog';
import { buildSettlementView } from './match/settlement';
import { fetchMyRatings, fetchSkinRatingStats, submitSkinRating } from './rating';
import { resolveOwnedSkinIds } from './owned';
import { readSyncState, writeSyncState } from './syncState';
import { matchPoller } from './match/poller';
import { getTopChampions } from './match/mastery';
import {
  getRecommendationState,
  requestRecommendation
} from './match/recommendationService';
import { clearLlmApiKey, getLlmStatus, saveLlmApiKey } from './llm';
import { autoAcceptService } from './match/autoAccept';
import { fetchMatchProfile } from './match/positionStats';
import { writeAutoAcceptPrefs } from './autoAcceptState';
import { lobbyService } from './lobby/service';
import * as devLogger from './devLogger';
import { MATCH_STATE_CHANNEL } from '../shared/match';
import type { TopChampion } from '../shared/match';
import type { MatchProfile, PositionReport, RankedReport, RecentMatchReport } from '../shared/matchProfile';
import type { RegionUsersQuery } from '../shared/regionUsers';
import { SETTLEMENT_CHANNEL } from '../shared/settlement';
import type { LocalSettlement } from '../shared/settlement';

/** 评价文字的长度上限 —— 截断而不是报错,用户写到一半不该被挡下来 */
const MAX_RATING_CONTENT_LENGTH = 500;

interface SubmitRatingPayload {
  skinId: number;
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
  /** 评价文字;空 = 只打星 */
  content?: string;
}

interface RedeemPayload {
  code: string;
}

interface LlmKeyPayload {
  apiKey: string;
}

interface LookupPayload {
  query: string;
}

interface PlayerGamesPayload {
  puuid: string;
  /** 起始位置;0 = 最近的一局 */
  startIndex?: number;
  /** 要几局 */
  count?: number;
}

interface AutoAcceptPayload {
  enabled: boolean;
}

/** 「在大厅公开我的信息」开关。 */
interface LobbyPublicPayload {
  publicVisible: boolean;
}

/** 大厅里发的一句话。 */
interface LobbySendPayload {
  text: string;
}

/** 拉一个人进房间。 */
interface LobbyInvitePayload {
  nickname: string;
  gameId: string;
}

/** 悬浮卡片要看的那个人的 id。 */
interface LobbyPlayerProfilePayload {
  userId: number;
}

interface AutoAcceptDelayPayload {
  delaySeconds: number;
}

interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
  /** 本命英雄(熟练度前 N)—— 后端收藏册按它排序 */
  topChampions?: TopChampion[];
  /** 排位段位 —— 后端拿来筛「分数差不多」的搭子 */
  ranked?: RankedReport[];
  /** 主玩位置 —— 后端拿来筛「一起打这个位」的搭子 */
  positions?: PositionReport[];
  /** 近 10 场排位 —— 后端拿来算大厅的「近期评分」和「近 10 场主玩位置」 */
  recentMatches?: RecentMatchReport[];
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
  /** Riot ID 的标签(# 后面那串)—— 后端回填小程序的「游戏ID」 */
  summonerTag?: string;
  /** 大区编号(腾讯那套)—— 后端转成大区名回填。认不出来就不带 */
  gameZone?: string;
}

/**
 * JSON-safe Error shape thrown across the IPC boundary. Electron serializes
 * thrown values via the structured-clone algorithm, which strips axios-specific
 * fields like `isAxiosError`, `code`, and `response.status`. Wrapping as a real
 * Error (not a plain object) is what lets the renderer keep `error.message`,
 * `error.name`, and `error.stack`; throwing a bare `{...}` from an IPC handler
 * surfaces as `[object Object]` in the renderer.
 */
interface NormalizedSyncError extends Error {
  status?: number;
  code?: string;
}

/**
 * 面向用户的中文化错误文案 —— **只给游戏客户端相关的错误用**。
 *
 * axios 的原始 message 是给开发者看的("connect ECONNREFUSED 127.0.0.1:55102"),
 * 直接甩到界面上没人知道该干什么 —— 这类错误九成是「游戏客户端没开 / 重启后换了端口」。
 * 后端/目录接口的网络错误不归这套管,那边连的是服务器,说成"游戏客户端"是误导。
 */
const FRIENDLY_LCU_MESSAGES: Record<string, string> = {
  ECONNREFUSED: '连不上游戏客户端:端口没人监听。请先启动游戏客户端,等它进到主界面再重试。',
  ENOTFOUND: '找不到游戏客户端地址。',
  EHOSTUNREACH: '游戏客户端地址不可达。',
  ENETUNREACH: '网络不可达,连不上游戏客户端。',
  ETIMEDOUT: '连接游戏客户端超时。',
  ECONNRESET: '连接被游戏客户端中断。'
};

const LCU_UNREACHABLE_MESSAGE =
  '游戏客户端未运行,或端口已失效(客户端重启后会换端口)。请先启动游戏客户端,等它进到主界面再重试。';

/** 两条来源(进程命令行 / lockfile)都没拿到凭据。 */
const LCU_NOT_RUNNING_MESSAGE =
  '未检测到游戏客户端:进程命令行和 lockfile 两条来源都没拿到端口。请确认游戏客户端已经进到主界面。';

function normalizeSyncError(e: unknown): NormalizedSyncError {
  if (axios.isAxiosError(e)) {
    const err = new Error(e.message) as NormalizedSyncError;
    err.name = e.name;
    err.status = e.response?.status;
    err.code = (e as { code?: string }).code;
    return err;
  }
  if (e instanceof Error) {
    return e as NormalizedSyncError;
  }
  const err = new Error(String(e)) as NormalizedSyncError;
  err.name = 'UnknownError';
  return err;
}

/** 游戏客户端专属的错误包装:把网络错误码换成用户看得懂的话。 */
function normalizeLcuError(e: unknown): NormalizedSyncError {
  // 裁决层的结论优先 —— 「装的是国际服客户端」比「游戏客户端未运行」有用得多。
  const summary = (e as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.length > 0) {
    const err = new Error(summary) as NormalizedSyncError;
    err.name = e instanceof Error ? e.name : 'LcuError';
    const code = (e as { code?: unknown }).code;
    err.code = typeof code === 'string' ? code : 'LCU_UNREACHABLE';
    return err;
  }
  if (e instanceof lcu.LcuUnreachableError) {
    const err = new Error(LCU_UNREACHABLE_MESSAGE) as NormalizedSyncError;
    err.name = e.name;
    err.code = 'LCU_UNREACHABLE';
    return err;
  }
  if (e instanceof lcu.LcuNotRunningError) {
    const err = new Error(LCU_NOT_RUNNING_MESSAGE) as NormalizedSyncError;
    err.name = e.name;
    err.code = 'LCU_NOT_RUNNING';
    return err;
  }
  if (axios.isAxiosError(e)) {
    const code = (e as { code?: string }).code;
    const friendly = code ? FRIENDLY_LCU_MESSAGES[code] : undefined;
    const err = new Error(friendly ?? e.message) as NormalizedSyncError;
    err.name = e.name;
    err.status = e.response?.status;
    err.code = code;
    return err;
  }
  return normalizeSyncError(e);
}

function assertSyncPayload(p: unknown): asserts p is SyncPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.puuid !== 'string' || obj.puuid.length < 32) throw new Error('invalid puuid');
  if (typeof obj.summonerName !== 'string') throw new Error('invalid summonerName');
  if (!Array.isArray(obj.ownedSkinIds)) throw new Error('invalid ownedSkinIds');
  if (!(obj.ownedSkinIds as unknown[]).every((n) => typeof n === 'number')) {
    throw new Error('invalid ownedSkinIds');
  }
  if (obj.mode !== undefined && obj.mode !== 'auto' && obj.mode !== 'manual') {
    throw new Error('invalid mode');
  }
  if (obj.topChampions !== undefined && !isTopChampionList(obj.topChampions)) {
    throw new Error('invalid topChampions');
  }
  if (obj.ranked !== undefined && !isRankedReportList(obj.ranked)) {
    throw new Error('invalid ranked');
  }
  if (obj.positions !== undefined && !isPositionReportList(obj.positions)) {
    throw new Error('invalid positions');
  }
  if (obj.recentMatches !== undefined && !isRecentMatchReportList(obj.recentMatches)) {
    throw new Error('invalid recentMatches');
  }
  if (obj.summonerTag !== undefined && typeof obj.summonerTag !== 'string') {
    throw new Error('invalid summonerTag');
  }
  if (obj.gameZone !== undefined && typeof obj.gameZone !== 'string') {
    throw new Error('invalid gameZone');
  }
}

/** 本命英雄名单:每条至少要有英雄编号、英文名和点数。 */
function isTopChampionList(value: unknown): value is TopChampion[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.championId === 'number' &&
      typeof obj.championNameEn === 'string' &&
      typeof obj.championPoints === 'number'
    );
  });
}

/** 段位名单:每条至少要有队列、段位名。 */
function isRankedReportList(value: unknown): value is RankedReport[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return typeof obj.queueType === 'string' && typeof obj.tier === 'string';
  });
}

/** 位置名单:每条至少要有位置代码。 */
function isPositionReportList(value: unknown): value is PositionReport[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return typeof obj.position === 'string';
  });
}

/** 近 10 场排位:每条至少要有 gameId 和分数。 */
function isRecentMatchReportList(value: unknown): value is RecentMatchReport[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.gameId === 'string' &&
      typeof obj.championId === 'number' &&
      typeof obj.championName === 'string' &&
      typeof obj.position === 'string' &&
      typeof obj.queueType === 'string' &&
      typeof obj.kills === 'number' &&
      typeof obj.deaths === 'number' &&
      typeof obj.assists === 'number' &&
      typeof obj.minionKills === 'number' &&
      typeof obj.durationS === 'number' &&
      typeof obj.win === 'boolean' &&
      typeof obj.score === 'number' &&
      typeof obj.playedAtMs === 'number'
    );
  });
}

/** 匹配条件:全可选,空 = 后端默认。 */
function assertRegionUsersQuery(p: unknown): asserts p is RegionUsersQuery {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (obj.positions !== undefined) {
    if (!Array.isArray(obj.positions) || !obj.positions.every((x) => typeof x === 'string')) {
      throw new Error('invalid positions');
    }
  }
  for (const key of ['tierGap', 'higherTierGap', 'collectionGap'] as const) {
    if (obj[key] !== undefined && typeof obj[key] !== 'number') throw new Error(`invalid ${key}`);
  }
  for (const key of ['includeHigher', 'includeUnknown'] as const) {
    if (obj[key] !== undefined && typeof obj[key] !== 'boolean') throw new Error(`invalid ${key}`);
  }
}

function assertRedeemPayload(p: unknown): asserts p is RedeemPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.code !== 'string' || !/^\d{6}$/.test(obj.code)) {
    throw new Error('invalid code (must be 6 digits)');
  }
}

function assertLookupPayload(p: unknown): asserts p is LookupPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.query !== 'string') throw new Error('invalid query');
}

function assertPlayerGamesPayload(p: unknown): asserts p is PlayerGamesPayload {
  if (typeof p !== 'object' || p === null) throw new Error('invalid payload');
  const obj = p as Record<string, unknown>;
  if (typeof obj.puuid !== 'string' || !obj.puuid) throw new Error('invalid puuid');
  if (obj.startIndex !== undefined && typeof obj.startIndex !== 'number') {
    throw new Error('invalid startIndex');
  }
  if (obj.count !== undefined && typeof obj.count !== 'number') {
    throw new Error('invalid count');
  }
}

/**
 * 窗口不在眼前时发一条系统通知。
 *
 * 窗口可见且有焦点时不发 —— 应用内的弹窗已经出来了,再弹一条系统通知是打扰。
 */
function notifySettlement(local: LocalSettlement): void {
  if (!Notification.isSupported()) return;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return;
  const notification = new Notification({
    title: '本局结算',
    body: local.championName
      ? `${local.championName} 这一局结束了,皮肤评分已就绪`
      : '这一局结束了,皮肤评分已就绪'
  });
  notification.on('click', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  notification.show();
}

export function registerIpcHandlers(): void {
  // deep = true 时允许扫盘找客户端。用户手点「检测客户端」走深检测,
  // 界面挂载时的自动检查走浅检测 —— 否则每次开界面都全盘扫一遍。
  ipcMain.handle('lcu:check-status', async (_event, deep?: boolean) => {
    try {
      const result = deep === true ? await lcu.detectLcuDeep() : await lcu.detectLcu();
      if (!result.ok) {
        return {
          running: false,
          code: result.code,
          summary: result.summary,
          diagnosis: result.diagnosis
        };
      }
      return {
        running: true,
        port: result.auth.port,
        summoner: result.summoner
      };
    } catch (error: unknown) {
      // 这条路径在界面上只表现为「检测失败」,不留日志就等于没有线索。
      console.error('[LCU] 检测调用失败', error);
      const normalized = normalizeLcuError(error);
      return {
        running: false,
        error: normalized.message,
        code: 'unknown' as const,
        summary: normalized.message
      };
    }
  });

  ipcMain.handle('lcu:fetch-skins', async () => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth);
      const summoner = await lcu.getCurrentSummoner(client);
      // 大区跟皮肤并行读 —— 读大区只是顺带的,不该拖慢取皮肤
      const [owned, areaId] = await Promise.all([
        resolveOwnedSkinIds(client),
        lcu.fetchAreaId(client)
      ]);
      return {
        summoner,
        ownedSkinIds: owned.ownedSkinIds,
        source: owned.source,
        catalogFiltered: owned.catalogFiltered,
        // 认不出大区就空着 —— 同步时不上报,后端不写
        gameZone: areaId === null ? '' : String(areaId)
      };
    } catch (e) {
      throw normalizeLcuError(e);
    }
  });

  ipcMain.handle('auth:login', async (_event, payload: RedeemPayload) => {
    assertRedeemPayload(payload);
    const token = await auth.redeemSyncCode(payload.code);
    auth.saveToken(token);
    // 大厅之前连不上是因为没 token —— 现在有了,立刻重连,别让用户等退避计时器。
    lobbyService.onLogin();
    return auth.getAuthStatus();
  });

  ipcMain.handle('auth:logout', async () => {
    auth.clearStoredToken();
    // 大厅连接得跟着断 —— 不然人还挂在大厅在线名单里。
    lobbyService.onLogout();
    return { ok: true as const };
  });

  ipcMain.handle('auth:get-status', async () => auth.getAuthStatus());

  ipcMain.handle('backend:sync', async (_event, payload: SyncPayload) => {
    try {
      assertSyncPayload(payload);
      const mode = payload.mode ?? 'manual';
      const minInterval = minIntervalFor(mode);
      const state = readSyncState();
      const now = Date.now();

      if (shouldSkipSync(state.lastSyncAt, now, minInterval)) {
        return {
          skipped: true,
          lastSyncAt: state.lastSyncAt,
          result: null
        };
      }

      const result = await syncOwnedSkins(
        payload.puuid,
        payload.summonerName,
        payload.ownedSkinIds,
        payload.topChampions ?? [],
        {
          summonerTag: payload.summonerTag ?? '',
          gameZone: payload.gameZone ?? '',
          ranked: payload.ranked ?? [],
          positions: payload.positions ?? [],
          recentMatches: payload.recentMatches ?? []
        }
      );
      // 只在成功后记时间戳 —— 失败不能算「已同步」
      writeSyncState({ lastSyncAt: now });
      return {
        skipped: false,
        lastSyncAt: now,
        result
      };
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  ipcMain.handle('catalog:fetch-all', async () => {
    try {
      return await fetchCatalog();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  ipcMain.handle('catalog:fetch-owned', async () => {
    try {
      return await fetchMyOwned();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  // 开发者面板的快捷操作。渲染进程没有 Node 能力,这两件事得走主进程。
  ipcMain.handle('dev:open-devtools', async () => {
    BrowserWindow.getFocusedWindow()?.webContents.openDevTools();
    return { ok: true as const };
  });

  ipcMain.handle('dev:copy-text', async (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('invalid text');
    clipboard.writeText(text);
    return { ok: true as const };
  });
  // 开发日志控制台。渲染进程打开控制台时来挂上,顺手把之前的历史捞回去。
  ipcMain.handle('dev:console-attach', async (_event, afterSeq?: number) => {
    devLogger.attachConsole();
    return devLogger.takeConsoleBacklog(typeof afterSeq === 'number' ? afterSeq : 0);
  });

  ipcMain.handle('dev:console-detach', async () => {
    devLogger.detachConsole();
    return { ok: true as const };
  });

  // ---- 对局助手 ------------------------------------------------------------

  // 轮询器是懒启动的:第一次有人要状态才开跑,用户不打开对局页就一点开销都没有。
  matchPoller.subscribe((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(MATCH_STATE_CHANNEL, snapshot);
    }
  });

  ipcMain.handle('match:get-state', () => {
    matchPoller.start();
    return matchPoller.getSnapshot();
  });

  ipcMain.handle('match:refresh', async () => {
    matchPoller.start();
    return matchPoller.refreshNow();
  });

  /**
   * 取熟练度最高的 15 个英雄(本命英雄)。
   *
   * 单独取一次,不走轮询器 —— 轮询器是懒启动的,用户不看对局页它根本不跑,
   * 而「同步皮肤」这条流程每次启动都会走,本命英雄得跟皮肤一起传上去。
   */
  ipcMain.handle('match:get-top-champions', async () => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth);
      const summoner = await lcu.getCurrentSummoner(client);
      if (!summoner.puuid) return [];
      return await getTopChampions(client, summoner.puuid);
    } catch (error: unknown) {
      throw normalizeLcuError(error);
    }
  });

  /**
   * 读一份「段位 + 主玩位置」。
   *
   * 同步皮肤时一起报给后端 —— 后端靠这两样筛同区搭子。
   * 读不到就返回空的两份(段位/位置都没有),后端保持库里的旧值不动。
   */
  ipcMain.handle('match:get-profile', async (): Promise<MatchProfile> => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth);
      const summoner = await lcu.getCurrentSummoner(client);
      if (!summoner.puuid) return { ranked: [], positions: [], recentMatches: [] };
      return await fetchMatchProfile(client, summoner.puuid);
    } catch (error: unknown) {
      throw normalizeLcuError(error);
    }
  });

  /**
   * 查一个召唤师(任意玩家)的**资料**。
   *
   * 战绩在另一个接口(`match:fetch-player-games`)—— 资料是本机回环,
   * 战绩要出网,合成一次返回会让界面干等。
   */
  ipcMain.handle('match:lookup-player', async (_event, payload: LookupPayload) => {
    assertLookupPayload(payload);
    return matchPoller.lookupPlayer(payload.query);
  });

  /**
   * 查某个玩家的历史战绩(腾讯的对局服务)。
   *
   * `puuid` 可以是**任何人**的 —— 客户端那层把战绩路由裁到只剩「我自己」。
   */
  ipcMain.handle('match:fetch-player-games', async (_event, payload: PlayerGamesPayload) => {
    assertPlayerGamesPayload(payload);
    return matchPoller.fetchPlayerGames(payload.puuid, payload.startIndex, payload.count);
  });

  /** 最近一局的两队人(gameflow)。 */
  ipcMain.handle('match:get-opponents', async () => matchPoller.fetchOpponents());

  /**
   * 英雄名 → 编号 的对照表。
   *
   * AI 推荐只吐名字不吐编号,界面靠这张表把名字配上头像。
   */
  ipcMain.handle('match:get-champion-index', () => matchPoller.getChampionIndex());

  ipcMain.handle('match:get-recommendation', () => getRecommendationState());

  ipcMain.handle('match:recommend', async () => {
    const snapshot = matchPoller.getSnapshot();
    if (!snapshot.champSelect) {
      throw new Error('当前不在英雄选择阶段,无法生成推荐');
    }
    return requestRecommendation(snapshot.champSelect, snapshot.champSelect.myRole);
  });

  // ---- 局末结算 ------------------------------------------------------------

  /**
   * 局末结算:主进程检测到「这一局结束了」就推一条。
   *
   * 推的是**本地事实**(不含站内 id / 现有评分)—— 渲染进程收到后自己再去
   * `match:get-settlement` 拿完整的那份(那边要发三个后端请求,不能阻塞推送)。
   */
  matchPoller.subscribeSettlement((local) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(SETTLEMENT_CHANNEL, local);
    }
    notifySettlement(local);
  });

  /** 取完整的那份结算(本地事实 + 站内皮肤 + 现有评分 + 我打过的分)。 */
  ipcMain.handle('match:get-settlement', async () => {
    const local = matchPoller.getSettlement();
    if (!local) return null;
    return await buildSettlementView(local);
  });

  /** 提交评分。 */
  ipcMain.handle('rating:submit', async (_event, payload: SubmitRatingPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (!Number.isFinite(payload.skinId)) throw new Error('invalid skinId');
    for (const key of ['handFeel', 'artwork', 'model', 'mockery'] as const) {
      const value = payload[key];
      if (!Number.isFinite(value) || value < 1 || value > 5) throw new Error(`invalid ${key}`);
    }
    let content: string | undefined;
    if (payload.content !== undefined && payload.content !== null) {
      if (typeof payload.content !== 'string') throw new Error('invalid content');
      content = payload.content.slice(0, MAX_RATING_CONTENT_LENGTH);
    }
    const result = await submitSkinRating({
      skinId: payload.skinId,
      handFeel: payload.handFeel,
      artwork: payload.artwork,
      model: payload.model,
      mockery: payload.mockery,
      content
    });
    return { ok: true as const, stats: result.stats, savedContent: result.savedContent };
  });

  /** 我打过的全部评分(一次拉完,界面按站内皮肤 id 建索引)。 */
  ipcMain.handle('rating:my-list', async () => {
    const userId = auth.getStoredUserId();
    if (userId === null) throw new Error('未登录:请先登录后再打分');
    return await fetchMyRatings(userId);
  });

  /** 某款皮肤的聚合评分;null = 没人打过 */
  ipcMain.handle('rating:skin-stats', async (_event, skinId: number) => {
    if (!Number.isFinite(skinId)) throw new Error('invalid skinId');
    return await fetchSkinRatingStats(skinId);
  });

  ipcMain.handle('llm:get-status', () => getLlmStatus());

  ipcMain.handle('llm:set-key', async (_event, payload: LlmKeyPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.apiKey !== 'string') throw new Error('invalid apiKey');
    saveLlmApiKey(payload.apiKey);
    return getLlmStatus();
  });

  ipcMain.handle('llm:clear-key', async () => {
    clearLlmApiKey();
    return getLlmStatus();
  });

  // ---- 实用功能 ------------------------------------------------------------

  ipcMain.handle('tools:get-auto-accept', () => autoAcceptService.getState());

  ipcMain.handle('tools:set-auto-accept', async (_event, payload: AutoAcceptPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.enabled !== 'boolean') throw new Error('invalid enabled');
    writeAutoAcceptPrefs({ enabled: payload.enabled });
    return autoAcceptService.setEnabled(payload.enabled);
  });

  ipcMain.handle('tools:set-auto-accept-delay', async (_event, payload: AutoAcceptDelayPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.delaySeconds !== 'number' || !Number.isFinite(payload.delaySeconds)) {
      throw new Error('invalid delaySeconds');
    }
    // 上限 5 分钟 —— 再长就没意义了。
    const seconds = Math.max(0, Math.min(300, Math.round(payload.delaySeconds)));
    writeAutoAcceptPrefs({ delaySeconds: seconds });
    return autoAcceptService.setDelay(seconds);
  });

  /**
   * 拉同大区的用户(找人双排)。
   *
   * 大区以库里同步时上报的为准 —— 那是权威值。
   * 客户端现场读的大区只是兜底(还没同步过皮肤时),所以两条并行:
   * 库里认出来了就不用再等客户端那次。
   */
  ipcMain.handle('tools:fetch-region-users', async (_event, payload?: RegionUsersQuery) => {
    if (payload !== undefined) assertRegionUsersQuery(payload);
    const query: RegionUsersQuery = payload ?? {};
    const localZonePromise = detectLocalZone();
    const first = await fetchRegionUsers('', undefined, query);
    if (first.myZone) return first;
    const localZone = await localZonePromise;
    if (!localZone) return first;
    return await fetchRegionUsers(localZone, undefined, query);
  });

  // ---- 开黑大厅 ------------------------------------------------------------

  /**
   * 大厅状态。
   *
   * <p>大厅服务在应用启动时就起来了(退到托盘也保持连接)——
   * 这里只是把当前状态取出来给渲染进程。
   */
  ipcMain.handle('lobby:get-state', () => lobbyService.getState());

  /** 「在大厅公开我的信息」开关。 */
  ipcMain.handle('lobby:set-public', async (_event, payload: LobbyPublicPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.publicVisible !== 'boolean') throw new Error('invalid publicVisible');
    return lobbyService.setPublicVisible(payload.publicVisible);
  });

  /** 说一句话。 */
  ipcMain.handle('lobby:send', async (_event, payload: LobbySendPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.text !== 'string') throw new Error('invalid text');
    return lobbyService.say(payload.text);
  });

  /** 拉一个人进房间。 */
  ipcMain.handle('lobby:invite', async (_event, payload: LobbyInvitePayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.nickname !== 'string') throw new Error('invalid nickname');
    if (typeof payload.gameId !== 'string') throw new Error('invalid gameId');
    return await lobbyService.invite(payload.nickname, payload.gameId);
  });

  /** 悬浮卡片:某个玩家近 10 场排位的档案。 */
  ipcMain.handle('lobby:player-profile', async (_event, payload: LobbyPlayerProfilePayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.userId !== 'number' || !Number.isFinite(payload.userId)) {
      throw new Error('invalid userId');
    }
    return await lobbyService.playerProfile(payload.userId);
  });
}

/**
 * 现场从游戏客户端读大区编号。读不到就空着 —— 大区不是这功能的必需项,
 * 库里同步过的话后端自己能认出来。
 */
async function detectLocalZone(): Promise<string> {
  try {
    const lcuAuth = await lcu.resolveLcuAuth();
    const client = lcu.createLcuClient(lcuAuth);
    const areaId = await lcu.fetchAreaId(client);
    return areaId === null ? '' : String(areaId);
  } catch {
    // 客户端没开 —— 空着,后端会用自己的口径
    return '';
  }
}