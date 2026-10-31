import axios from 'axios';
import { getStoredToken, clearStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const AXIOS_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS: readonly number[] = [200, 800];

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
}

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

export async function syncOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[]
): Promise<SyncResult> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再同步');

  const url = `${BACKEND_BASE_URL}/api/skins/sync-user-skins`;
  const body = { puuid, summonerName, ownedSkinIds };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { data } = await axios.post<BackendEnvelope<SyncResult>>(url, body, {
        timeout: AXIOS_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      if (data.code !== 200 || !data.data) {
        throw new Error(data.message ?? '同步失败');
      }
      return data.data;
    } catch (e) {
      // 4xx/5xx — pass through, do not retry. Hoist the backend's Result.message
      // out so the renderer doesn't just see "status code 403".
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
          typeof backendMsg === 'string'
            ? `${backendMsg} (HTTP ${status})`
            : axiosErr.message;
        const err = new Error(msg) as Error & { status?: number; code?: string };
        err.name = axiosErr.name;
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