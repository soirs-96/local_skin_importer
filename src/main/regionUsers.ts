import axios from 'axios';
import { clearStoredToken, getStoredToken } from './auth';
import { REGION_USERS_LIMIT } from '../shared/regionUsers';
import type {
  RankProfile,
  RegionUser,
  RegionUsersQuery,
  RegionUsersResult
} from '../shared/regionUsers';
import type { PositionCode } from '../shared/matchProfile';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const REGION_USERS_TIMEOUT_MS = 15_000;

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

function positionArray(v: unknown): PositionCode[] {
  return strArray(v) as PositionCode[];
}

/** 后端的一段位 → 界面上的形状。 */
function normalizeRank(raw: unknown): RankProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const tier = str(r.tier);
  if (!tier) return null;
  return {
    queueType: str(r.queueType),
    tier,
    division: str(r.division),
    leaguePoints: num(r.leaguePoints),
    wins: num(r.wins),
    losses: num(r.losses),
    score: num(r.score),
    label: str(r.label) || tier
  };
}

/**
 * 把后端那份响应整理成能直接渲染的形状。
 *
 * 后端 `Result` 是 `NON_NULL` 的 —— 字段可能是 undefined 不是 null。
 * 渲染进程不判空就崩,这里一次判干净。
 */
function normalize(raw: RegionUsersResult): RegionUsersResult {
  const users: RegionUser[] = Array.isArray(raw.users)
    ? raw.users.filter(Boolean).map(u => ({
        id: num(u.id),
        nickname: str(u.nickname),
        gameId: str(u.gameId),
        avatarUrl: str(u.avatarUrl),
        skinCount: num(u.skinCount),
        rank: normalizeRank(u.rank),
        rankScoreDiff: numOrNull(u.rankScoreDiff),
        collectionScore: numOrNull(u.collectionScore),
        collectionDiff: numOrNull(u.collectionDiff),
        positions: positionArray(u.positions),
        positionLabels: strArray(u.positionLabels),
        vip: u.vip === true
      }))
    : [];
  return {
    myZone: str(raw.myZone) || null,
    myZoneKnown: raw.myZoneKnown === true,
    totalInZone: num(raw.totalInZone),
    userCount: num(raw.userCount) || users.length,
    myRank: normalizeRank(raw.myRank),
    myCollectionScore: numOrNull(raw.myCollectionScore),
    myPositions: positionArray(raw.myPositions),
    myPositionLabels: strArray(raw.myPositionLabels),
    myVip: raw.myVip === true,
    myVipUntil: str(raw.myVipUntil) || null,
    users
  };
}

/**
 * 拉同大区的用户。
 *
 * @param gameZone 客户端现场读到的大区(编号或名字);空 = 没有。
 *                 后端以库里同步时上报的为准,这个只是兜底。
 * @param limit    最多几条
 * @param query    匹配条件(位置 / 段位窗口 / VIP 拉高分段)
 */
export async function fetchRegionUsers(
  gameZone = '',
  limit = REGION_USERS_LIMIT,
  query: RegionUsersQuery = {}
): Promise<RegionUsersResult> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再拉取同区用户');

  const url = `${BACKEND_BASE_URL}/api/map/region-users`;
  try {
    const { data } = await axios.get<BackendEnvelope<RegionUsersResult>>(url, {
      timeout: REGION_USERS_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}` },
      params: {
        gameZone: gameZone || undefined,
        limit,
        positions: query.positions?.length ? query.positions.join(',') : undefined,
        tierGap: query.tierGap,
        includeHigher: query.includeHigher,
        higherTierGap: query.higherTierGap,
        collectionGap: query.collectionGap,
        includeUnknown: query.includeUnknown
      }
    });
    if (data.code !== 200 || !data.data) {
      throw new Error(data.message || '拉取同区用户失败');
    }
    return normalize(data.data);
  } catch (e) {
    // token 过期就清掉 —— 留着只会让「已登录」的假象一直挂着。
    // 这里直接看 isAxiosError 字段,不用 axios.isAxiosError() ——
    // 单测里 axios 被整体 mock,那个 helper 会变成永远返回 false 的空壳。
    const looksLikeAxiosError =
      typeof e === 'object' && e !== null && (e as { isAxiosError?: unknown }).isAxiosError === true;
    if (looksLikeAxiosError) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        clearStoredToken();
        throw new Error('登录已过期,请用同步码重新登录');
      }
      // 后端的话比「status code 403」有用 —— 比如「拉高分段是 VIP 权益」。
      const backendMsg = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
      if (typeof backendMsg === 'string' && backendMsg.length > 0) {
        throw new Error(backendMsg);
      }
    }
    throw e;
  }
}
