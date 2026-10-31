import { computed, ref, shallowRef } from 'vue';
import type { CatalogResult, CatalogSkin, OwnedSnapshot } from '../../../preload/index';
import { computeStats, dedupeBySkinId, dropDefaultSkins } from './skinCatalogLogic';

export type OwnedSource = 'lcu' | 'backend' | 'none';

interface CachedCatalog {
  total: number;
  records: CatalogSkin[];
  skinIdFieldPresent: boolean;
}

/** 目录在会话内缓存:1.2 万条 JSON 有几 MB,每次开弹窗重拉太浪费。 */
let catalogCache: CachedCatalog | null = null;

/** 清掉模块级缓存。测试用它隔离用例之间;线上目前没有调用点。 */
export function resetCatalogCache(): void {
  catalogCache = null;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useSkinCatalog() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  // shallowRef:1.2 万条记录走深层 reactive 代理既慢又可能不可结构化克隆
  const skins = shallowRef<CatalogSkin[]>([]);
  const ownedIds = shallowRef<Set<number>>(new Set());
  const ownedSource = ref<OwnedSource>('none');
  const ownedReported = ref(0);
  /** 后端快照里的最近一次同步时刻(ISO 字符串);null = 从未同步过 */
  const ownedLastSyncAt = ref<string | null>(null);
  const skinIdFieldPresent = ref(true);

  const catalogSize = computed(() => skins.value.length);
  const stats = computed(() =>
    computeStats(skins.value, ownedIds.value, ownedReported.value)
  );

  function applyCatalog(result: CatalogResult): void {
    catalogCache = {
      total: result.total,
      records: result.records,
      skinIdFieldPresent: result.skinIdFieldPresent
    };
    // 原皮(英雄默认皮肤)不是可收集的皮肤,浏览图鉴时不该出现
    skins.value = dedupeBySkinId(dropDefaultSkins(result.records));
    skinIdFieldPresent.value = result.skinIdFieldPresent;
  }

  /** 三级降级:实时 LCU → 后端已同步快照 → 空集。 */
  async function loadOwned(): Promise<void> {
    try {
      const r = await window.api.fetchSkins();
      ownedIds.value = new Set(r.ownedSkinIds);
      ownedReported.value = r.ownedSkinIds.length;
      ownedSource.value = 'lcu';
      ownedLastSyncAt.value = null;
      return;
    } catch {
      // 继续降级
    }

    try {
      const status = await window.api.getAuthStatus();
      if (!status.loggedIn) throw new Error('未登录');
      const snap: OwnedSnapshot = await window.api.fetchMyOwned();
      ownedIds.value = new Set(snap.ownedSkinIds);
      ownedReported.value = snap.totalOwnedCount;
      ownedLastSyncAt.value = snap.lastSyncAt;
      ownedSource.value = 'backend';
      return;
    } catch {
      // 继续降级
    }

    ownedIds.value = new Set();
    ownedReported.value = 0;
    ownedSource.value = 'none';
    ownedLastSyncAt.value = null;
  }

  /** 后台静默刷新:失败保留旧数据,不报错。 */
  async function refreshCatalog(): Promise<void> {
    try {
      applyCatalog(await window.api.fetchCatalog());
    } catch {
      // 静默失败
    }
  }

  async function load(opts: { force?: boolean } = {}): Promise<void> {
    const force = opts.force === true;
    error.value = null;

    const cached = catalogCache;
    if (cached && !force) {
      applyCatalog(cached);
    } else {
      loading.value = true;
    }

    const catalogPromise =
      force || !cached
        ? window.api
            .fetchCatalog()
            .then((r) => {
              applyCatalog(r);
            })
            .catch((e: unknown) => {
              error.value = describeError(e);
            })
        : refreshCatalog();

    await Promise.all([loadOwned(), catalogPromise]);
    loading.value = false;
  }

  return {
    loading,
    error,
    skins,
    ownedIds,
    ownedSource,
    ownedReported,
    ownedLastSyncAt,
    skinIdFieldPresent,
    catalogSize,
    stats,
    load
  };
}
