<template>
  <el-dialog
    v-model="visible"
    title="皮肤图鉴"
    width="94%"
    top="3vh"
    destroy-on-close
    class="skin-overview-dialog"
    @open="onOpen"
  >
    <div class="overview">
      <div class="overview-header">
        <div class="overview-stats">
          <div class="stat-ring" :style="{ '--pct': `${ringDegrees}deg` }">
            <span class="stat-ring-value">{{ completionPercent }}%</span>
          </div>
          <div class="stat-lines">
            <span class="stat-head">
              <span class="hx-diamond" />
              <span class="stat-main">
                已拥有 {{ stats.ownedMatched }} / {{ collectableTotal }}
              </span>
            </span>
            <span class="stat-sub">{{ ownedSourceText }}</span>
            <span v-if="ownedSource === 'backend' && ownedLastSyncAt" class="stat-sub">
              上次同步:{{ lastSyncText }}
            </span>
            <span v-if="stats.ownedMissingFromCatalog > 0" class="stat-sub">
              {{ stats.ownedMissingFromCatalog }} 款暂未收录到图鉴
            </span>
            <span class="stat-sub">绝版(已下架)皮肤也能读到;与游戏内收藏册的差额是经典版英雄皮肤卡(图鉴未收录)</span>
          </div>
        </div>
        <div class="overview-filters">
          <el-input
            v-model="filters.keyword"
            placeholder="搜索皮肤名或英雄名"
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
          <el-select v-model="filters.ownership" class="filter-select filter-ownership">
            <el-option label="查看全部" value="all" />
            <el-option label="只看已拥有" value="owned" />
            <el-option label="只看未拥有" value="unowned" />
          </el-select>
        </div>
      </div>

      <el-alert
        v-if="!skinIdFieldPresent"
        type="error"
        show-icon
        :closable="false"
        title="服务器版本较旧,暂时无法判断哪些皮肤你已经拥有"
        class="overview-alert"
      />
      <el-alert
        v-else-if="stats.skinIdCoverage < 0.5"
        type="warning"
        show-icon
        :closable="false"
        :title="`有部分皮肤暂时无法判断是否已拥有(覆盖率 ${Math.round(stats.skinIdCoverage * 100)}%)`"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'none'"
        type="warning"
        show-icon
        :closable="false"
        title="暂时读不到你的皮肤,已按未拥有显示"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'backend'"
        type="info"
        show-icon
        :closable="false"
        title="显示的是上次同步的数据,点「读取我的皮肤」可以更新"
        class="overview-alert"
      />

      <el-alert
        v-if="!loggedIn"
        type="info"
        show-icon
        :closable="false"
        title="用同步码登录后,就能给已拥有的皮肤打分并写评价"
        class="overview-alert"
      />

      <div v-if="loading && catalogSize === 0" class="overview-loading">正在加载皮肤图鉴…</div>
      <div v-else-if="error" class="overview-error">
        <p>{{ error }}</p>
        <el-button type="primary" @click="reload">重试</el-button>
      </div>
      <SkinGrid
        v-else
        :key="filterSignature"
        :skins="filteredSkins"
        :owned-ids="ownedIds"
        :rated-ids="ratedIds"
        class="overview-grid"
        @select="openDetail"
        @rate="openRate"
      />

      <div class="overview-footer">
        <el-button size="small" class="hx-gold" :loading="loading" @click="reload">刷新图鉴</el-button>
        <span class="footer-count">共 {{ filteredSkins.length }} 款</span>
      </div>
    </div>

    <SkinDetailDialog v-model="detailVisible" :skin="selectedSkin" :owned="selectedOwned" />

    <SkinRateDialog
      v-model="rateVisible"
      :skin="rateTarget"
      :my-rating="rateMyRating"
      @saved="onRated"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue';
import { ElNotification } from 'element-plus';
import { storeToRefs } from 'pinia';
import SkinDetailDialog from './SkinDetailDialog.vue';
import SkinGrid from './SkinGrid.vue';
import SkinRateDialog from './SkinRateDialog.vue';
import type { CatalogSkin, MySkinRating } from '../../../preload/index';
import {
  filterSkins,
  isOwned,
  parseServerTime,
  type OwnershipFilter
} from '../composables/skinCatalogLogic';
import { useSkinCatalog } from '../composables/useSkinCatalog';
import { useSkinRatings } from '../composables/useSkinRatings';
import { useAuthStore } from '../stores/auth';

const visible = ref(false);
const detailVisible = ref(false);
const selectedSkin = shallowRef<CatalogSkin | null>(null);

/** 打分弹窗的目标皮肤 */
const rateVisible = ref(false);
const rateTarget = shallowRef<CatalogSkin | null>(null);

const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);

const filters = reactive({
  keyword: '',
  heroId: null as number | null,
  rarity: null as string | null,
  ownership: 'all' as OwnershipFilter
});

const {
  loading,
  error,
  skins,
  ownedIds,
  ownedSource,
  ownedLastSyncAt,
  skinIdFieldPresent,
  catalogSize,
  stats,
  load
} = useSkinCatalog();

const { myRatings, load: loadMyRatings, get: getMyRating, set: setMyRating } = useSkinRatings();

/** 我打过分了的皮肤 id(站内口径)—— 网格靠它给卡片挂「已评」角标 */
const ratedIds = computed<Set<number>>(() => new Set(myRatings.value.keys()));

const filteredSkins = computed(() =>
  filterSkins(skins.value, ownedIds.value, {
    keyword: filters.keyword,
    heroId: filters.heroId,
    rarity: filters.rarity,
    ownership: filters.ownership
  })
);

/**
 * 筛选条件变了就换 key 重挂网格,滚动位置自然归零。
 * 直接监听数组做不到:后台静默刷新目录也会换引用,那样会把用户拽回顶部。
 */
const filterSignature = computed(
  () => `${filters.keyword}|${filters.heroId ?? ''}|${filters.rarity ?? ''}|${filters.ownership}`
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
  if (ownedSource.value === 'lcu') return '实时读取自游戏客户端';
  if (ownedSource.value === 'backend') return '上次同步的数据';
  return '暂时读不到你的皮肤';
});

/**
 * 分母口径与后端 my-collection 的 totalSkinsInGame 一致:去掉英雄默认皮肤,
 * 跟游戏客户端的收藏册对得上。后端没升级、拿不到 skinId 时退回目录总数。
 */
const collectableTotal = computed(() => stats.value.collectableTotal || catalogSize.value);

/** 完成度环:圆形聚焦,比例取「已拥有 / 可收集总数」。 */
const completionPercent = computed(() => {
  const total = collectableTotal.value;
  if (!total) return 0;
  const pct = (stats.value.ownedMatched / total) * 100;
  return Math.min(100, Math.round(pct * 10) / 10);
});

const ringDegrees = computed(() => completionPercent.value * 3.6);

const lastSyncText = computed(() => {
  const t = parseServerTime(ownedLastSyncAt.value);
  if (t === null) return '—';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return `${Math.floor(diffHour / 24)} 天前`;
});

const selectedOwned = computed(() =>
  selectedSkin.value ? isOwned(selectedSkin.value, ownedIds.value) : false
);

/** 打分弹窗里要显示「我之前打的分」 */
const rateMyRating = computed<MySkinRating | null>(() =>
  rateTarget.value ? getMyRating(rateTarget.value.id) : null
);

async function onOpen(): Promise<void> {
  // 图鉴重开时别把上一次的打分弹窗带出来
  rateVisible.value = false;
  await auth.refresh();
  await load();
  // 没登录时这一步会失败 —— 失败就失败,评分区自然空着,不用报错打断浏览
  await loadMyRatings();
}

async function reload(): Promise<void> {
  filters.keyword = '';
  filters.heroId = null;
  filters.rarity = null;
  filters.ownership = 'all';
  await load({ force: true });
  await loadMyRatings();
}

function openDetail(skin: CatalogSkin): void {
  selectedSkin.value = skin;
  detailVisible.value = true;
}

/** 打分入口。没登录就说清楚差什么,不把按钮藏起来让人猜。 */
function openRate(skin: CatalogSkin): void {
  if (!loggedIn.value) {
    ElNotification({
      title: '还不能打分',
      message: '用同步码登录后才能给已拥有的皮肤打分',
      type: 'warning',
      duration: 4000
    });
    return;
  }
  rateTarget.value = skin;
  rateVisible.value = true;
}

/** 打分弹窗存完之后,本地那份索引跟着更新 —— 卡片上的「已评」角标立刻变。 */
function onRated(rating: MySkinRating): void {
  setMyRating(rating);
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
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hx-line);
}
.overview-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
/* 圆形 = 聚焦:完成度环 */
.stat-ring {
  --pct: 0deg;
  position: relative;
  width: 76px;
  height: 76px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(
    var(--hx-blue) 0deg var(--pct),
    var(--hx-ring-track) var(--pct) 360deg
  );
}
.stat-ring::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--hx-panel);
  border: 1px solid var(--hx-line);
}
.stat-ring-value {
  position: relative;
  font-size: 17px;
  font-weight: 600;
  color: var(--hx-gold);
  letter-spacing: 0.02em;
}
.stat-lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.stat-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stat-main {
  font-size: 18px;
  font-weight: 600;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.stat-sub {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--hx-text-dim);
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
.filter-ownership {
  width: 130px;
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
  color: var(--hx-text-dim);
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
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--hx-text-faint);
}
</style>

<style>
/* el-dialog 的 body 默认 overflow:auto,会和网格的内层滚动区打架(双滚动条) */
.skin-overview-dialog .el-dialog__body {
  overflow: hidden;
  padding: 12px 16px;
}
</style>
