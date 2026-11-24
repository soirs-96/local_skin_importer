<template>
  <el-card class="tool-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond hx-diamond--blue" />
        <span class="hx-label">同区开黑搭子</span>
        <span class="status-text">{{ regionText || '同一个大区才组得到双排' }}</span>
        <el-button
          class="region-fetch"
          type="primary"
          size="small"
          :loading="regionLoading"
          @click="onFetchRegion"
        >
          {{ regionResult ? '重新拉取' : '拉取同区用户' }}
        </el-button>
      </div>
    </template>

    <div v-if="regionError" class="warn-row">
      {{ regionError }}
    </div>

    <div class="filter-row">
      <div class="filter-field">
        <span class="hx-label">一起打的位置</span>
        <el-select
          class="position-select"
          size="small"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="不限位置"
          :model-value="selectedPositions"
          @change="onPositionsChange"
        >
          <el-option
            v-for="code in POSITION_OPTIONS"
            :key="code"
            :label="POSITION_LABELS[code]"
            :value="code"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="hx-label">段位范围</span>
        <el-select
          class="tier-select"
          size="small"
          :model-value="tierGap"
          @change="onTierGapChange"
        >
          <el-option
            v-for="opt in TIER_GAP_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="hx-label">收藏分差距</span>
        <el-select
          class="gap-select"
          size="small"
          :model-value="collectionGap"
          @change="onCollectionGapChange"
        >
          <el-option
            v-for="opt in COLLECTION_GAP_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="hx-label">拉高分段</span>
        <el-switch
          class="higher-switch"
          :model-value="includeHigher"
          :disabled="higherDisabled"
          active-text="只看比我高的"
          @change="onIncludeHigherChange"
        />
        <span v-if="higherDisabled" class="filter-hint">VIP 权益</span>
      </div>
    </div>

    <div v-if="myMatchText" class="me-row">
      {{ myMatchText }}
    </div>

    <div v-if="regionUsers.length > 0" class="region-list">
      <div v-for="u in regionUsers" :key="u.id + ':' + u.gameId" class="region-row">
        <img
          v-if="u.avatarUrl"
          class="region-avatar"
          :src="u.avatarUrl"
          :alt="displayName(u)"
        />
        <span v-else class="region-avatar region-avatar--fallback">{{ initialOf(u) }}</span>
        <div class="region-info">
          <span class="region-name">
            {{ displayName(u) }}
            <span v-if="u.vip" class="vip-badge">VIP</span>
          </span>
          <span class="region-id">{{ u.gameId }}</span>
          <span v-if="matchMetaOf(u)" class="region-meta">{{ matchMetaOf(u) }}</span>
        </div>
        <span class="region-skins">{{ u.skinCount }} 款皮肤</span>
        <el-button class="hx-gold region-copy" size="small" text @click="onCopyGameId(u)">
          复制ID
        </el-button>
      </div>
    </div>
    <div v-else-if="regionResult" class="region-empty">{{ regionEmptyText }}</div>
    <div v-else class="region-empty">
      点右上角拉同区的人 —— 只有同一个大区的召唤师才组得到双排。
    </div>

    <div class="tip-row">
      <p class="tip-line">它是怎么认大区的:</p>
      <ul class="tip-list">
        <li>你同步过一次皮肤,大区就记下来了 —— 直接用它。</li>
        <li>还没同步过,但游戏客户端开着的话,会现场读一次。</li>
        <li>两个都认不出来,就先去同步一次皮肤。</li>
      </ul>
      <p class="tip-line">怎么才算「分数差不多」:</p>
      <ul class="tip-list">
        <li>段位 —— 你和他在段位窗口内(段位范围里选)。</li>
        <li>站内收藏分 —— 皮肤越稀有分越高,差得太多也不拉。</li>
        <li>位置 —— 选了位置就只看主玩那个位置的人。</li>
        <li>「拉高分段」是 VIP 权益 —— 开通后能专门捞比你分高的人,段位范围变成「往上看几段」。</li>
      </ul>
    </div>
  </el-card>
</template>

<script setup lang="ts">
/**
 * 「同区开黑搭子」卡片。
 *
 * <p>从 Tools.vue 抽出来的 —— 大厅页和实用功能页都要用它,
 * 抄两份的话两边迟早会走偏。
 */

import { computed, ref } from 'vue';
import { ElNotification } from 'element-plus';
import { describeRegion, displayName, emptyRegionText } from '../../../shared/regionUsers';
import type { RegionUser, RegionUsersQuery, RegionUsersResult } from '../../../shared/regionUsers';
import { POSITION_CODE_LABELS } from '../../../shared/matchProfile';
import type { PositionCode } from '../../../shared/matchProfile';

/** 位置选择器的选项 —— 顺序跟后端的五个位置一致。 */
const POSITION_OPTIONS: PositionCode[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const POSITION_LABELS = POSITION_CODE_LABELS;

/** 段位窗口:允许跨几个大段位。 */
const TIER_GAP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '同段位' },
  { value: 1, label: '跨 1 段' },
  { value: 2, label: '跨 2 段' },
  { value: 3, label: '跨 3 段' }
];

/**
 * 收藏分的相对差上限。
 *
 * 0.5 = 收藏分差不超过一半 —— 默认值,既卡住「差太远」又不至于把人都筛没。
 */
const COLLECTION_GAP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '不限' },
  { value: 0.5, label: '差 50% 以内' },
  { value: 1, label: '差 100% 以内' }
];

const regionResult = ref<RegionUsersResult | null>(null);
const regionLoading = ref(false);
const regionError = ref('');

const selectedPositions = ref<PositionCode[]>([]);
// 默认跨 1 段:「差不多」但不至于把同区的人筛得一个不剩。
const tierGap = ref<number>(1);
const collectionGap = ref<number>(0.5);
const includeHigher = ref<boolean>(false);

const regionText = computed<string>(() => describeRegion(regionResult.value));
const regionEmptyText = computed<string>(() => emptyRegionText(regionResult.value));
const regionUsers = computed<RegionUser[]>(() => regionResult.value?.users ?? []);

/**
 * 「拉高分段」是不是不可用。
 *
 * 拉过一次就知道自己是不是 VIP 了 —— 不是就别让用户白点一次(后端会 403)。
 * 还没拉过就留着能点:第一次点会直接给出「这是 VIP 权益」的提示。
 */
const higherDisabled = computed<boolean>(
  () => regionResult.value !== null && !regionResult.value.myVip
);

/** 我这一行:段位 + 两个分数 + 主玩位置 —— 让用户知道自己在跟谁比。 */
const myMatchText = computed<string>(() => {
  const result = regionResult.value;
  if (!result) return '';
  const parts: string[] = ['我'];
  if (result.myRank) parts.push(result.myRank.label);
  if (result.myCollectionScore !== null) parts.push(`收藏分 ${result.myCollectionScore}`);
  if (result.myPositionLabels.length > 0) parts.push(`主玩 ${result.myPositionLabels.join('、')}`);
  if (result.myVip) parts.push('VIP');
  return parts.join(' · ');
});

/** 一个候选人的匹配信息 —— 段位 + 分差 + 收藏分 + 位置。 */
function matchMetaOf(user: RegionUser): string {
  const parts: string[] = [];
  if (user.rank) parts.push(user.rank.label);
  if (user.rankScoreDiff !== null) parts.push(`段位差 ${user.rankScoreDiff}`);
  if (user.collectionScore !== null) {
    const diff = user.collectionDiff === null ? '' : ` · 差 ${user.collectionDiff}`;
    parts.push(`收藏分 ${user.collectionScore}${diff}`);
  }
  if (user.positionLabels.length > 0) parts.push(user.positionLabels.join('、'));
  return parts.join(' · ');
}

function onPositionsChange(value: unknown): void {
  selectedPositions.value = Array.isArray(value) ? (value as PositionCode[]) : [];
  void onFetchRegion();
}

function onTierGapChange(value: unknown): void {
  tierGap.value = typeof value === 'number' ? value : Number(value);
  void onFetchRegion();
}

function onCollectionGapChange(value: unknown): void {
  collectionGap.value = typeof value === 'number' ? value : Number(value);
  void onFetchRegion();
}

function onIncludeHigherChange(value: string | number | boolean): void {
  includeHigher.value = value === true;
  void onFetchRegion();
}

/**
 * 拉同大区的用户。
 *
 * 拉不到就把原因摊在这张卡上 —— 静默失败的话用户只会觉得「这功能坏了」。
 */
async function onFetchRegion(): Promise<void> {
  if (regionLoading.value) return;
  regionLoading.value = true;
  regionError.value = '';
  try {
    // 位置数组要**复制一份**再过 IPC —— ref 里取出来的是 Vue 的 reactive 代理,
    // 结构化克隆不了那个代理,Electron 会直接抛 "An object could not be cloned"。
    const query: RegionUsersQuery = {
      positions: [...selectedPositions.value],
      tierGap: tierGap.value,
      // 开「拉高分段」时段位范围变成单边的:往上看的段数跟这里同一个滑杆。
      higherTierGap: tierGap.value,
      collectionGap: collectionGap.value,
      includeHigher: includeHigher.value
    };
    regionResult.value = await window.api.fetchRegionUsers(query);
  } catch (e: unknown) {
    regionError.value = (e as { message?: string }).message ?? '拉取同区用户失败';
  } finally {
    regionLoading.value = false;
  }
}

/** 复制游戏ID —— 加好友直接粘。 */
async function onCopyGameId(user: RegionUser): Promise<void> {
  if (!user.gameId) return;
  await window.api.copyText(user.gameId);
  ElNotification({ type: 'success', message: `已复制 ${user.gameId}`, duration: 2000 });
}

/** 没头像时的占位字 —— 取名字第一个字。 */
function initialOf(user: RegionUser): string {
  const name = displayName(user);
  return name ? name.slice(0, 1) : '?';
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-text {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.warn-row {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--hx-gold);
  background: var(--hx-tint-gold-soft);
  color: var(--hx-gold);
  font-size: 12px;
}
.tip-row {
  padding-top: 10px;
  border-top: 1px solid var(--hx-line);
}
.tip-line {
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.tip-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--hx-text-faint);
  line-height: 1.9;
}
/* 同区开黑搭子 */
.region-fetch {
  margin-left: 14px;
}
.filter-row {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.position-select {
  width: 200px;
}
.tier-select {
  width: 110px;
}
.gap-select {
  width: 140px;
}
.higher-switch {
  margin-bottom: 1px;
}
.filter-hint {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--hx-gold);
}
.me-row {
  margin-bottom: 10px;
  padding: 6px 10px;
  border-left: 2px solid var(--hx-blue);
  background: var(--hx-tint-blue-soft);
  color: var(--hx-blue);
  font-size: 12px;
}
.region-meta {
  font-size: 11px;
  color: var(--hx-text-dim);
}
.vip-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid var(--hx-gold);
  color: var(--hx-gold);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.region-list {
  display: flex;
  flex-direction: column;
}
.region-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--hx-line);
}
.region-row:last-child {
  border-bottom: none;
}
.region-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid var(--hx-line-strong);
  border-radius: 0;
}
.region-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hx-inset);
  color: var(--hx-gold);
  font-size: 13px;
}
.region-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.region-name {
  font-size: 13px;
  color: var(--hx-text);
}
.region-id {
  font-size: 12px;
  color: var(--hx-text-faint);
  font-family: monospace;
}
.region-skins {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.region-copy {
  flex-shrink: 0;
}
.region-empty {
  padding: 4px 0;
  font-size: 12px;
  color: var(--hx-text-faint);
}
</style>
