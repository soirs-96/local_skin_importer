<template>
  <el-dialog
    v-model="visible"
    title="皮肤总览"
    width="94%"
    top="3vh"
    destroy-on-close
    class="skin-overview-dialog"
    @open="onOpen"
  >
    <div class="overview">
      <div class="overview-header">
        <div class="overview-stats">
          <span class="stat-main">
            已拥有 {{ stats.ownedMatched }} / {{ catalogSize }}
          </span>
          <span class="stat-sub">{{ ownedSourceText }}</span>
          <span v-if="stats.ownedMissingFromCatalog > 0" class="stat-sub">
            {{ stats.ownedMissingFromCatalog }} 件目录未收录
          </span>
        </div>
        <div class="overview-filters">
          <el-input
            v-model="filters.keyword"
            placeholder="搜索皮肤名 / 英雄名"
            clearable
            class="filter-search"
          />
          <el-select v-model="filters.heroId" placeholder="全部英雄" clearable class="filter-select">
            <el-option
              v-for="h in heroOptions"
              :key="h.heroId"
              :label="h.heroName"
              :value="h.heroId"
            />
          </el-select>
          <el-select v-model="filters.rarity" placeholder="全部稀有度" clearable class="filter-select">
            <el-option v-for="r in rarityOptions" :key="r" :label="r" :value="r" />
          </el-select>
          <el-checkbox v-model="filters.onlyUnowned">只看未拥有</el-checkbox>
        </div>
      </div>

      <el-alert
        v-if="!skinIdFieldPresent"
        type="error"
        show-icon
        :closable="false"
        title="服务端版本过低，未返回皮肤 ID，无法比对已拥有状态"
        class="overview-alert"
      />
      <el-alert
        v-else-if="stats.skinIdCoverage < 0.5"
        type="warning"
        show-icon
        :closable="false"
        :title="`部分皮肤缺少 ID（覆盖率 ${Math.round(stats.skinIdCoverage * 100)}%），这些皮肤无法比对拥有状态`"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'none'"
        type="warning"
        show-icon
        :closable="false"
        title="未能获取已拥有皮肤，当前全部按未拥有显示"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'backend'"
        type="info"
        show-icon
        :closable="false"
        title="数据来自上次同步"
        class="overview-alert"
      />

      <div v-if="loading && catalogSize === 0" class="overview-loading">正在加载皮肤目录…</div>
      <div v-else-if="error" class="overview-error">
        <p>{{ error }}</p>
        <el-button type="primary" @click="reload">重试</el-button>
      </div>
      <SkinGrid
        v-else
        :key="filterSignature"
        :skins="filteredSkins"
        :owned-ids="ownedIds"
        class="overview-grid"
        @select="openDetail"
      />

      <div class="overview-footer">
        <el-button size="small" :loading="loading" @click="reload">刷新目录</el-button>
        <span class="footer-count">共 {{ filteredSkins.length }} 件</span>
      </div>
    </div>

    <SkinDetailDialog v-model="detailVisible" :skin="selectedSkin" :owned="selectedOwned" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue';
import SkinDetailDialog from './SkinDetailDialog.vue';
import SkinGrid from './SkinGrid.vue';
import type { CatalogSkin } from '../../../preload/index';
import { filterSkins, isOwned } from '../composables/skinCatalogLogic';
import { useSkinCatalog } from '../composables/useSkinCatalog';

const visible = ref(false);
const detailVisible = ref(false);
const selectedSkin = shallowRef<CatalogSkin | null>(null);

const filters = reactive({
  keyword: '',
  heroId: null as number | null,
  rarity: null as string | null,
  onlyUnowned: false
});

const {
  loading,
  error,
  skins,
  ownedIds,
  ownedSource,
  skinIdFieldPresent,
  catalogSize,
  stats,
  load
} = useSkinCatalog();

const filteredSkins = computed(() =>
  filterSkins(skins.value, ownedIds.value, {
    keyword: filters.keyword,
    heroId: filters.heroId,
    rarity: filters.rarity,
    onlyUnowned: filters.onlyUnowned
  })
);

/**
 * 筛选条件变了就换 key 重挂网格,滚动位置自然归零。
 * 直接监听数组做不到:后台静默刷新目录也会换引用,那样会把用户拽回顶部。
 */
const filterSignature = computed(
  () => `${filters.keyword}|${filters.heroId ?? ''}|${filters.rarity ?? ''}|${filters.onlyUnowned}`
);

const heroOptions = computed(() => {
  const map = new Map<number, string>();
  for (const s of skins.value) {
    if (s.heroId != null && !map.has(s.heroId)) map.set(s.heroId, s.heroName ?? '未知英雄');
  }
  return [...map.entries()].map(([heroId, heroName]) => ({ heroId, heroName }));
});

const rarityOptions = computed(() => {
  const set = new Set<string>();
  for (const s of skins.value) {
    if (s.rarity) set.add(s.rarity);
  }
  return [...set].sort();
});

const ownedSourceText = computed(() => {
  if (ownedSource.value === 'lcu') return 'LCU 实时数据';
  if (ownedSource.value === 'backend') return '数据来自上次同步';
  return '未能获取已拥有皮肤';
});

const selectedOwned = computed(() =>
  selectedSkin.value ? isOwned(selectedSkin.value, ownedIds.value) : false
);

async function onOpen(): Promise<void> {
  await load();
}

async function reload(): Promise<void> {
  filters.keyword = '';
  filters.heroId = null;
  filters.rarity = null;
  filters.onlyUnowned = false;
  await load({ force: true });
}

function openDetail(skin: CatalogSkin): void {
  selectedSkin.value = skin;
  detailVisible.value = true;
}

function open(): void {
  visible.value = true;
}

defineExpose({ open });
</script>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(94vh - 200px);
}
.overview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.overview-stats {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.stat-main {
  font-size: 18px;
  font-weight: 600;
}
.stat-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.overview-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.filter-search {
  width: 220px;
}
.filter-select {
  width: 150px;
}
.overview-alert {
  margin: 0;
}
.overview-loading,
.overview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
}
.overview-grid {
  flex: 1;
  min-height: 0;
}
.overview-footer {
  display: flex;
  align-items: center;
  gap: 12px;
}
.footer-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

<style>
/* el-dialog 的 body 默认 overflow:auto,会和网格的内层滚动区打架(双滚动条) */
.skin-overview-dialog .el-dialog__body {
  overflow: hidden;
  padding: 12px 16px;
}
</style>
