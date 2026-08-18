import axios from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const AXIOS_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS: readonly number[] = [200, 800];

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
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
        const msg =
          typeof backendMsg === 'string'
            ? `${backendMsg} (HTTP ${axiosErr.response?.status})`
            : axiosErr.message;
        const err = new Error(msg) as Error & { status?: number; code?: string };
        err.name = axiosErr.name;
        err.status = axiosErr.response?.status;
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