import axios from 'axios';
import { getStoredToken, clearStoredToken } from './auth';
import type { TopChampion } from '../shared/match';
import type { PositionReport, RankedReport } from '../shared/matchProfile';
import type { BindingInfo } from '../shared/binding';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const AXIOS_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS: readonly number[] = [200, 800];

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
}

/**
 * 后端把「绑错了 LOL 账号」当 409 抛上来 —— 桌面端据此引导用户改绑。
 *
 * <p>403 在这套后端里还表示「桌面客户端无权访问该接口」,不能拿来区分。
 */
export const PUID_MISMATCH_STATUS = 409;

/** 后端 inventorySyncLimiter 是 10 秒最小间隔 + 60 秒内 5 次。 */
export const MANUAL_SYNC_MIN_INTERVAL_MS = 10_000;
/** 自动同步放宽到 60 秒:用户反复重开应用时不必每次都打后端。 */
export const AUTO_SYNC_MIN_INTERVAL_MS = 60_000;

export type SyncMode = 'auto' | 'manual';

/**
 * 这次同步要不要跳过。纯函数,不碰 IO,方便单测。
 *
 * 后端对同一用户有 10 秒最小间隔的限频,自动同步是静默的——
 * 撞上 429 用户只会觉得「怎么数据不更新」。本地先挡一道。
 */
export function shouldSkipSync(
  lastSyncAt: number | null,
  now: number,
  minIntervalMs: number
): boolean {
  if (lastSyncAt === null) return false;
  return now - lastSyncAt < minIntervalMs;
}

export function minIntervalFor(mode: SyncMode): number {
  return mode === 'auto' ? AUTO_SYNC_MIN_INTERVAL_MS : MANUAL_SYNC_MIN_INTERVAL_MS;
}

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function isNodeNetworkError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

/** 跟皮肤一起带过去的游戏身份 —— 后端回填小程序,用户不用自己手填。 */
export interface SyncProfile {
  /** Riot ID 的标签(# 后面那串) */
  summonerTag?: string;
  /** 大区编号(腾讯那套)—— 认不出来就空着 */
  gameZone?: string;
  /** 排位段位 —— 后端拿它筛「分数差不多」的搭子 */
  ranked?: RankedReport[];
  /** 主玩位置 —— 后端拿它筛「一起打这个位」的搭子 */
  positions?: PositionReport[];
}

/** 同步 / 改绑的请求体 —— 两个接口载荷完全一样。 */
function buildSyncBody(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[],
  topChampions: TopChampion[],
  profile: SyncProfile
): Record<string, unknown> {
  // 本命英雄跟皮肤一起传 —— 后端一次请求就把两样都存了,
  // 收藏册的排序直接按这份名单来。
  // 昵称/召唤师ID/大区也一起传 —— 后端顺手回填小程序的用户资料。
  // 段位和位置也一起传 —— 后端靠这两样筛「分数差不多、位置对得上」的搭子。
  // 空数组表示「这次没读到」,后端保持库里的旧值不动。
  return {
    puuid,
    summonerName,
    ownedSkinIds,
    topChampions,
    summonerTag: profile.summonerTag ?? '',
    gameZone: profile.gameZone ?? '',
    ranked: profile.ranked ?? [],
    positions: profile.positions ?? []
  };
}

/**
 * 打后端。三个接口共用一套错误处理:
 * 401 丢掉过期 token、4xx 原样抛(不重试)、网络错误重试 3 次。
 */
async function callBackend<T>(path: string, method: 'post' | 'get', body?: unknown): Promise<T> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再同步');

  const url = `${BACKEND_BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const resp =
        method === 'post'
          ? await axios.post<BackendEnvelope<T>>(url, body, { timeout: AXIOS_TIMEOUT_MS, headers })
          : await axios.get<BackendEnvelope<T>>(url, { timeout: AXIOS_TIMEOUT_MS, headers });
      const { data } = resp;
      if (data.code !== 200 || data.data === undefined || data.data === null) {
        throw new Error(data.message ?? '同步失败');
      }
      return data.data;
    } catch (e) {
      // 4xx/5xx — pass through, do not retry. 把后端的 Result.message 提上来,
      // 渲染进程看到的是一句中文,不是 "status code 403"。
      // Note: we check `isAxiosError === true` directly because in tests we mock
      // `axios` and the `axios.isAxiosError` helper becomes a no-op mock function.
      const looksLikeAxiosError =
        typeof e === 'object' && e !== null && (e as { isAxiosError?: unknown }).isAxiosError === true;
      if (looksLikeAxiosError) {
        const axiosErr = e as {
          name: string;
          message: string;
          code?: string;
          response?: { status?: number; data?: { message?: unknown } };
        };
        const backendMsg = axiosErr.response?.data?.message;
        const status = axiosErr.response?.status;
        if (status === 401) {
          // token 过期了。留着它只会让每一次同步都静默失败 —— 丢掉它,
          // 并且明确告诉用户要重新用同步码登录,而不是让它看起来像「没同步」。
          clearStoredToken();
          const expired = new Error('登录已过期,请用同步码重新登录') as Error & { status?: number };
          expired.name = 'UnauthorizedError';
          expired.status = 401;
          throw expired;
        }
        const msg =
          typeof backendMsg === 'string' && backendMsg.trim() !== ''
            ? backendMsg
            : axiosErr.message;
        const err = new Error(msg) as Error & { status?: number; code?: string };
        err.name = 'BackendError';
        err.status = status;
        err.code = axiosErr.code;
        throw err;
      }
      if (!isNodeNetworkError(e)) throw e;
      const code = (e as { code?: string }).code!;
      if (!RETRYABLE_NETWORK_CODES.has(code)) throw e;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw new Error('unreachable: retry loop exited without resolving or throwing');
}

export async function syncOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[],
  topChampions: TopChampion[] = [],
  profile: SyncProfile = {}
): Promise<SyncResult> {
  return callBackend<SyncResult>(
    '/api/skins/sync-user-skins',
    'post',
    buildSyncBody(puuid, summonerName, ownedSkinIds, topChampions, profile)
  );
}

/**
 * 改绑 —— 绑错了 LOL 账号时换绑到另一个账号。
 *
 * <p>破坏性操作:后端会清掉旧账号已同步的皮肤数据(皮肤/本命英雄/段位/位置),
 * 不可撤销。
 */
export async function rebindOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[],
  topChampions: TopChampion[] = [],
  profile: SyncProfile = {}
): Promise<SyncResult> {
  return callBackend<SyncResult>(
    '/api/skins/rebind-user-skins',
    'post',
    buildSyncBody(puuid, summonerName, ownedSkinIds, topChampions, profile)
  );
}

/** 当前绑定信息 —— 界面显示「现在绑的是哪个 LOL 账号」。 */
export async function fetchBindingInfo(): Promise<BindingInfo> {
  return callBackend<BindingInfo>('/api/skins/my-binding', 'get');
}