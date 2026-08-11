import axios, { AxiosError } from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://124.223.102.20:8080';

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

export async function syncOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[]
): Promise<SyncResult> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再同步');

  const url = `${BACKEND_BASE_URL}/api/skins/sync-user-skins`;
  const body = { puuid, summonerName, ownedSkinIds };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await axios.post<BackendEnvelope<SyncResult>>(url, body, {
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
      lastErr = e;
      const err = e as AxiosError;
      if (err.response) {
        // 4xx/5xx — pass through, do not retry.
        throw e;
      }
      const code = (e as any).code;
      if (!RETRYABLE_NETWORK_CODES.has(code)) throw e;
      if (attempt < 2) {
        await sleep([200, 800, 3200][attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
