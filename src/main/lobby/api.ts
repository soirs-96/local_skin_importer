/**
 * 大厅的 REST 通道 —— **只给 WS 连不上时的轮询降级用**。
 *
 * <p>跟 `src/main/regionUsers.ts` 一个套路:统一 `Result` 信封 + 统一脏数据兜底。
 */

import axios from 'axios';
import { clearStoredToken, getStoredToken } from '../auth';
import {
  LOBBY_HISTORY_LIMIT,
  type LobbyMe,
  type LobbyMessage,
  type LobbyPlayer,
  type LobbySnapshot,
  type LobbyStats
} from '../../shared/lobby';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const LOBBY_TIMEOUT_MS = 15_000;

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizePlayer(raw: unknown): LobbyPlayer {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    userId: num(p.userId),
    nickname: str(p.nickname),
    gameId: str(p.gameId),
    zone: str(p.zone),
    canonicalZone: str(p.canonicalZone) || null,
    avatarUrl: str(p.avatarUrl),
    phase: str(p.phase),
    online: p.online === true,
    publicVisible: p.public === true,
    rankScore: numOrNull(p.rankScore),
    rankLabel: str(p.rankLabel) || null,
    collectionScore: numOrNull(p.collectionScore),
    positions: strArray(p.positions),
    positionLabels: strArray(p.positionLabels),
    vip: p.vip === true,
    lastLobbyAt: str(p.lastLobbyAt) || null
  };
}

function normalizeStats(raw: unknown): LobbyStats {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    online: num(s.online),
    sameZone: num(s.sameZone),
    invitable: num(s.invitable)
  };
}

function normalizeMe(raw: unknown): LobbyMe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const userId = num(m.userId);
  // 没有 userId = 服务端没认出「我」—— 别造一个空壳档案出来
  if (!userId) return null;
  return {
    userId,
    nickname: str(m.nickname),
    zone: str(m.zone),
    canonicalZone: str(m.canonicalZone) || null,
    rankScore: numOrNull(m.rankScore),
    rankLabel: str(m.rankLabel) || null,
    collectionScore: numOrNull(m.collectionScore),
    vip: m.vip === true
  };
}

function normalizeMessage(raw: unknown): LobbyMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    id: num(m.id),
    userId: num(m.userId),
    nickname: str(m.nickname),
    gameId: str(m.gameId),
    zone: str(m.zone),
    text: str(m.text),
    createdAt: str(m.createdAt)
  };
}

/**
 * 把后端那份响应整理成能直接渲染的形状。
 *
 * 后端 `Result` 是 `NON_NULL` 的 —— 字段可能是 undefined 不是 null,
 * 渲染进程不判空就崩,这里一次判干净。
 */
export function normalizeSnapshot(raw: unknown): LobbySnapshot {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    online: Array.isArray(s.online) ? s.online.map(normalizePlayer) : [],
    offline: Array.isArray(s.offline) ? s.offline.map(normalizePlayer) : [],
    stats: normalizeStats(s.stats),
    me: normalizeMe(s.me)
  };
}

async function getEnveloped<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再使用开黑大厅');
  const { data } = await axios.get<BackendEnvelope<T>>(`${BACKEND_BASE_URL}${path}`, {
    timeout: LOBBY_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` },
    params
  });
  if (data.code !== 200 || data.data === undefined || data.data === null) {
    throw new Error(data.message || '开黑大厅请求失败');
  }
  return data.data;
}

/** 在线列表 + 离线候选 + 统计。 */
export async function fetchLobbyPlayers(): Promise<LobbySnapshot> {
  try {
    const raw = await getEnveloped<unknown>('/api/lobby/players');
    return normalizeSnapshot(raw);
  } catch (e) {
    throw normalizeLobbyError(e);
  }
}

/** 最近的历史消息。 */
export async function fetchLobbyHistory(limit = LOBBY_HISTORY_LIMIT): Promise<LobbyMessage[]> {
  try {
    const raw = await getEnveloped<unknown[]>('/api/lobby/history', { limit });
    return Array.isArray(raw) ? raw.map(normalizeMessage) : [];
  } catch (e) {
    throw normalizeLobbyError(e);
  }
}

/** token 过期就清掉 —— 留着只会让「已登录」的假象一直挂着。 */
function normalizeLobbyError(e: unknown): unknown {
  const looksLikeAxiosError =
    typeof e === 'object' && e !== null && (e as { isAxiosError?: unknown }).isAxiosError === true;
  if (looksLikeAxiosError) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 401) {
      clearStoredToken();
      return new Error('登录已过期,请用同步码重新登录');
    }
    const backendMsg = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof backendMsg === 'string' && backendMsg.length > 0) {
      return new Error(backendMsg);
    }
  }
  return e;
}
