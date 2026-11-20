import axios from 'axios';
import { clearStoredToken, getStoredToken } from './auth';
import type { MyRating, MySkinRating, SkinRatingStats } from '../shared/settlement';

/**
 * 后端的三个评分接口。
 *
 * ⚠️ **这三个请求都带桌面端 token。**
 * 后端 `RatingController` 的 create / list / skin-stats 三个方法都标了
 * `@AllowsDesktopToken` —— 没标的话 DesktopScopeInterceptor 会把 DESKTOP token
 * 的请求全拦成 403(它看的是 tokenType,不是方法要不要鉴权)。
 *
 * ⚠️ 跟 `catalog.ts` 的目录查询相反 —— **那边必须匿名,这边必须带头**。
 */

const BACKEND_BASE_URL = 'http://101.34.210.254';
const RATING_TIMEOUT_MS = 15_000;
/** 「我打过的全部评分」一次拉完的条数上限 */
const MY_RATINGS_PAGE_SIZE = 500;
/** 翻页上限 —— 防止后端返回的 total 异常时无限翻 */
const MY_RATINGS_MAX_PAGES = 20;

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

interface PagePayload {
  records?: Record<string, unknown>[];
  total?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 桌面端 token;没登录就抛 —— 打分这件事必须有身份。 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再打分');
  return { Authorization: `Bearer ${token}` };
}

function toStats(raw: Record<string, unknown>): SkinRatingStats {
  return {
    skinId: num(raw.skinId) ?? 0,
    skinName: str(raw.skinName),
    iconUrl: str(raw.skinIconUrl),
    splashUrl: str(raw.skinSplashUrl),
    rarity: str(raw.rarity),
    totalCount: num(raw.totalCount) ?? 0,
    avgScore: num(raw.avgScore),
    avgHandFeel: num(raw.avgHandFeel),
    avgArtwork: num(raw.avgArtwork),
    avgModel: num(raw.avgModel),
    avgMockery: num(raw.avgMockery)
  };
}

/**
 * 拉某款皮肤的聚合评分。
 *
 * 后端没这条皮肤 → null(不是 0 分,是「没人打过」)。
 */
export async function fetchSkinRatingStats(skinId: number): Promise<SkinRatingStats | null> {
  const { data } = await axios.get<BackendEnvelope<PagePayload>>(
    `${BACKEND_BASE_URL}/api/ratings/skin-stats`,
    {
      timeout: RATING_TIMEOUT_MS,
      params: { skinIds: String(skinId), page: 1, size: 1 },
      headers: await authHeaders()
    }
  );
  if (data.code !== 200 || !data.data) return null;
  const record = data.data.records?.[0];
  return record ? toStats(record) : null;
}

/**
 * 查「我打过的这一条」。
 *
 * 后端按 token 里的 userId 判定「是不是查自己」—— 所以必须带 token,
 * 而且查的 userId 要跟 token 里的一致。
 */
export async function fetchMyRating(skinId: number, userId: number): Promise<MyRating | null> {
  const { data } = await axios.get<BackendEnvelope<PagePayload>>(
    `${BACKEND_BASE_URL}/api/ratings`,
    {
      timeout: RATING_TIMEOUT_MS,
      params: { userId, skinId, page: 1, size: 1 },
      headers: await authHeaders()
    }
  );
  if (data.code !== 200 || !data.data) return null;
  const record = data.data.records?.[0];
  if (!record) return null;
  return {
    handFeel: num(record.handFeel) ?? 0,
    artwork: num(record.artwork) ?? 0,
    model: num(record.model) ?? 0,
    mockery: num(record.mockery) ?? 0
  };
}

/** 后端一条评分记录 → 我打过的这一条。 */
function toMySkinRating(raw: Record<string, unknown>): MySkinRating {
  return {
    skinId: num(raw.skinId) ?? 0,
    handFeel: num(raw.handFeel) ?? 0,
    artwork: num(raw.artwork) ?? 0,
    model: num(raw.model) ?? 0,
    mockery: num(raw.mockery) ?? 0,
    content: str(raw.content)
  };
}

/**
 * 拉「我打过的全部评分」。
 *
 * 一次拉完,界面按站内皮肤 id 建索引 —— 逐个皮肤去查的话上千款皮肤要上千个请求。
 * 后端按 token 里的 userId 判定「是不是查自己」,查自己不过滤,
 * 所以评价文字也能拿回来。
 *
 * 打过分超过一页时往后翻 —— 截断会让老的评分在图鉴里莫名其妙变成「没评过」。
 */
export async function fetchMyRatings(userId: number): Promise<MySkinRating[]> {
  const out: MySkinRating[] = [];
  const headers = await authHeaders();
  for (let page = 1; page <= MY_RATINGS_MAX_PAGES; page += 1) {
    const { data } = await axios.get<BackendEnvelope<PagePayload>>(
      `${BACKEND_BASE_URL}/api/ratings`,
      {
        timeout: RATING_TIMEOUT_MS,
        params: { userId, page, size: MY_RATINGS_PAGE_SIZE },
        headers
      }
    );
    if (data.code !== 200 || !data.data) break;
    const records = data.data.records ?? [];
    out.push(...records.map(toMySkinRating));
    const total = data.data.total ?? out.length;
    if (out.length >= total || records.length === 0) break;
  }
  return out;
}

export interface SubmitRatingPayload {
  skinId: number;
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
  /** 评价文字;空 = 只打星 */
  content?: string;
}

export interface SubmitRatingResult {
  /** 提交后的聚合评分;null = 后端没给 */
  stats: SkinRatingStats | null;
  /**
   * 后端**实际存下来**的评价文字。
   *
   * null 有两种含义:没写文字,或者后端把文字清掉了 ——
   * 后端只放行桌面端 token / 管理员账号的文字(小程序是个人主体,
   * 微信不开放用户生成内容)。界面靠它区分「写没写上」。
   */
  savedContent: string | null;
}

/**
 * 提交评分。
 *
 * 后端按 (userId, skinId) upsert —— 重复提交是覆盖。
 * userId 由后端从 token 里取,**不信请求体**。
 * 提交完再拉一次聚合评分,界面上的角标才是最新的。
 */
export async function submitSkinRating(
  payload: SubmitRatingPayload
): Promise<SubmitRatingResult> {
  const headers = await authHeaders();
  const content = payload.content?.trim() ? payload.content.trim() : null;
  let savedContent: string | null = null;
  try {
    const { data } = await axios.post<BackendEnvelope<Record<string, unknown>>>(
      `${BACKEND_BASE_URL}/api/ratings`,
      {
        skinId: payload.skinId,
        handFeel: payload.handFeel,
        artwork: payload.artwork,
        model: payload.model,
        mockery: payload.mockery,
        content
      },
      {
        timeout: RATING_TIMEOUT_MS,
        headers: { ...headers, 'Content-Type': 'application/json' }
      }
    );
    savedContent = str(data.data?.content);
  } catch (e) {
    // token 过期时清掉本地 token —— 留着过期 token 只会让「已登录」的假象一直挂着
    if (axios.isAxiosError(e) && e.response?.status === 401) {
      clearStoredToken();
      throw new Error('登录已过期,请用同步码重新登录');
    }
    if (axios.isAxiosError(e) && e.response?.status === 403) {
      throw new Error('桌面端暂无打分权限(后端还没放行桌面端 token)');
    }
    throw e;
  }
  const stats = await fetchSkinRatingStats(payload.skinId);
  return { stats, savedContent };
}
