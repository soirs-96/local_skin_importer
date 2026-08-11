import axios from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://124.223.102.20:8080';
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
      if (axios.isAxiosError(e)) throw e; // 4xx/5xx — pass through, do not retry.
      if (!isNodeNetworkError(e)) throw e; // non-network, non-axios — also throw.
      const code = e.code;
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