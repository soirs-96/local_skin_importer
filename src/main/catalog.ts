import axios from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const CATALOG_TIMEOUT_MS = 60_000;
const OWNED_TIMEOUT_MS = 30_000;
/** 补拉时的分页大小 */
const CATALOG_PAGE_SIZE = 2000;
/** 首次请求的「大页」,正常一次就能拿完 1.2 万条 */
const CATALOG_FIRST_PAGE_SIZE = 20000;

export interface CatalogSkin {
  id: number;
  skinId: number | null;
  heroId: number | null;
  heroName: string | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  priceRp: number | null;
  splashUrl: string | null;
  iconUrl: string | null;
}

export interface CatalogResult {
  total: number;
  records: CatalogSkin[];
  /**
   * 响应里是否存在 `skinId` 这个 key。
   * false = 后端未升级,无法比对已拥有状态。
   */
  skinIdFieldPresent: boolean;
}

export interface OwnedSnapshot {
  /** 已同步到后端的已拥有总数(含目录未收录的) */
  totalOwnedCount: number;
  /** 已拥有且目录里有对应行的 skinId 列表 */
  ownedSkinIds: number[];
}

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

interface CatalogPage {
  current: number;
  size: number;
  total: number;
  pages: number;
  records: Record<string, unknown>[];
}

interface OwnedPayload {
  totalOwnedCount?: number;
  ownedSkins?: { skinId?: number | null }[];
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toCatalogSkin(raw: Record<string, unknown>): CatalogSkin {
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    skinId: numOrNull(raw.skinId),
    heroId: numOrNull(raw.heroId),
    heroName: strOrNull(raw.heroName),
    name: strOrNull(raw.name),
    nameEn: strOrNull(raw.nameEn),
    rarity: strOrNull(raw.rarity),
    priceRp: numOrNull(raw.priceRp),
    splashUrl: strOrNull(raw.splashUrl),
    iconUrl: strOrNull(raw.iconUrl)
  };
}

async function fetchCatalogPage(current: number, size: number): Promise<CatalogPage> {
  const url = `${BACKEND_BASE_URL}/api/skins/list?current=${current}&size=${size}`;
  const { data } = await axios.get<BackendEnvelope<CatalogPage>>(url, {
    timeout: CATALOG_TIMEOUT_MS
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(data.message ?? '获取皮肤目录失败');
  }
  return data.data;
}

export async function fetchCatalog(): Promise<CatalogResult> {
  const first = await fetchCatalogPage(1, CATALOG_FIRST_PAGE_SIZE);
  let raw = first.records;

  // 后端把结果截断了(理论上不会:1.2 万 < 2 万),按 2000/页补拉。
  if (raw.length < first.total) {
    const pages = Math.ceil(first.total / CATALOG_PAGE_SIZE);
    raw = [];
    for (let current = 1; current <= pages; current++) {
      const page = await fetchCatalogPage(current, CATALOG_PAGE_SIZE);
      raw.push(...page.records);
    }
  }

  // 老后端的响应里根本没有 `skinId` 这个 key;新后端会带(值可能是 null)。
  // 必须在映射之前看原始 JSON 的 key 是否存在 —— 用「非空比例」判断会把
  // 「后端没升级」和「库里大量 skin_id 为 NULL」两种故障混为一谈。
  const skinIdFieldPresent =
    raw.length > 0 && Object.prototype.hasOwnProperty.call(raw[0], 'skinId');

  return {
    total: first.total,
    records: raw.map(toCatalogSkin),
    skinIdFieldPresent
  };
}

export async function fetchMyOwned(): Promise<OwnedSnapshot> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再查看已拥有皮肤');

  const url = `${BACKEND_BASE_URL}/api/skins/my-owned`;
  const { data } = await axios.get<BackendEnvelope<OwnedPayload>>(url, {
    timeout: OWNED_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` }
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(data.message ?? '获取已拥有皮肤失败');
  }
  const ownedSkinIds = (data.data.ownedSkins ?? [])
    .map((s) => s.skinId)
    .filter((v): v is number => typeof v === 'number');
  return {
    totalOwnedCount: data.data.totalOwnedCount ?? ownedSkinIds.length,
    ownedSkinIds
  };
}
