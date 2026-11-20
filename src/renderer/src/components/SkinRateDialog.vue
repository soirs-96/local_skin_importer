<template>
  <el-dialog
    :model-value="modelValue"
    class="skin-rate-dialog"
    width="540px"
    align-center
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <template #header>
      <div class="dialog-head">
        <span class="hx-diamond" />
        <span class="hx-label">给皮肤打分</span>
        <span v-if="skinName" class="head-name">{{ skinName }}</span>
      </div>
    </template>

    <div v-if="skin" class="rate-body">
      <div class="skin-block">
        <div class="skin-art">
          <img v-if="artUrl && !imgFailed" :src="artUrl" :alt="skinName" @error="imgFailed = true" />
          <span v-else class="skin-art--empty">无图</span>
        </div>
        <div class="skin-meta">
          <span class="skin-name">{{ skinName }}</span>
          <span class="skin-sub">{{ skin.heroName ?? '未知英雄' }} · {{ skin.rarity ?? '—' }}</span>
          <span v-if="stats" class="skin-sub">已有 {{ stats.totalCount }} 人评过</span>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="hx-label">现有评分</span>
        </div>
        <div v-if="stats" class="stat-block">
          <div class="stat-total">
            <span class="stat-score">{{ totalTen }}</span>
            <span class="stat-tier" :style="{ color: tierColor }">{{ tierLabel }}</span>
          </div>
          <div class="stat-dims">
            <span v-for="dim in avgDims" :key="dim.key" class="stat-dim">
              <span class="dim-label">{{ dim.label }}</span>
              <span class="dim-value">{{ dim.value }}</span>
            </span>
          </div>
        </div>
        <p v-else class="empty-text">还没有人评分</p>
      </div>

      <div v-if="myRating" class="section">
        <div class="section-head">
          <span class="hx-label">我的评价</span>
        </div>
        <div class="my-block">
          <div class="my-dims">
            <span v-for="dim in myDims" :key="dim.key" class="my-dim">
              <span class="dim-label">{{ dim.label }}</span>
              <span class="dim-value">{{ dim.value }} 星</span>
            </span>
          </div>
          <p v-if="myRating.content" class="my-content">{{ myRating.content }}</p>
          <p v-else class="my-content empty-text">这条只有星级,没写评价文字</p>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="hx-label">给它打分</span>
          <span v-if="myRating" class="rated-hint">再提交会覆盖你之前打的</span>
        </div>
        <div class="rate-list">
          <div v-for="dim in RATING_DIMENSIONS" :key="dim.key" class="rate-row">
            <span class="rate-label">{{ dim.label }}</span>
            <el-rate
              v-model="ratings[dim.key]"
              :max="5"
              :allow-half="false"
              :disabled="submitting"
              class="rate-stars"
            />
          </div>
        </div>
        <el-input
          v-model="content"
          type="textarea"
          :rows="3"
          :maxlength="500"
          show-word-limit
          placeholder="写两句评价(可选)"
          class="content-input"
        />
        <p v-if="submitError" class="submit-error">{{ submitError }}</p>
        <p v-if="contentWarn" class="submit-warn">{{ contentWarn }}</p>
        <div class="actions">
          <el-button class="later-btn" text @click="emit('update:modelValue', false)">取消</el-button>
          <el-button class="submit-btn" type="primary" :loading="submitting" @click="onSubmit">
            提交评分
          </el-button>
        </div>
      </div>
    </div>

    <p v-else class="empty-text">没选中皮肤</p>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  RATING_DIMENSIONS,
  RATING_TIERS,
  scoreToTier,
  toTen,
  type RatingDimensionKey,
  type TierKey
} from '../../../shared/ratingTier';
import type { CatalogSkin, MySkinRating, SkinRatingStats } from '../../../preload/index';

const props = defineProps<{
  modelValue: boolean;
  skin: CatalogSkin | null;
  /** 我之前给这款皮肤打过的分;null = 没打过 */
  myRating: MySkinRating | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved', rating: MySkinRating): void;
}>();

const ratings = ref<Record<RatingDimensionKey, number>>({
  handFeel: 0,
  artwork: 0,
  model: 0,
  mockery: 0
});
const content = ref('');
const stats = ref<SkinRatingStats | null>(null);
const submitting = ref(false);
const submitError = ref('');
/** 星级存上了但评价文字没存上 —— 后端只让管理员账号留文字 */
const contentWarn = ref('');
const imgFailed = ref(false);

/** 把表单恢复成「我打过的分」—— 换皮肤、重新打开都要走这一步。 */
function resetForm(): void {
  imgFailed.value = false;
  submitError.value = '';
  contentWarn.value = '';
  stats.value = null;
  ratings.value = {
    handFeel: props.myRating?.handFeel ?? 0,
    artwork: props.myRating?.artwork ?? 0,
    model: props.myRating?.model ?? 0,
    mockery: props.myRating?.mockery ?? 0
  };
  content.value = props.myRating?.content ?? '';
}

watch(() => props.skin, resetForm, { immediate: true });
// 同一款皮肤关掉再打开,skin 没变,得靠这个再复位一次
watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  }
);

const skinName = computed<string>(() => {
  const skin = props.skin;
  if (!skin) return '';
  return skin.name ?? skin.nameEn ?? '未知皮肤';
});

const artUrl = computed<string>(() => props.skin?.splashUrl ?? props.skin?.iconUrl ?? '');

const totalTen = computed<string>(() => {
  const ten = toTen(stats.value?.avgScore ?? null);
  return ten === null ? '—' : ten.toFixed(1);
});

const tier = computed<TierKey>(() => scoreToTier(toTen(stats.value?.avgScore ?? null)));
const tierLabel = computed<string>(() => RATING_TIERS[tier.value].label);
const tierColor = computed<string>(() => RATING_TIERS[tier.value].color);

const avgDims = computed<{ key: string; label: string; value: string }[]>(() => {
  const s = stats.value;
  if (!s) return [];
  const raw: { key: RatingDimensionKey; value: number | null }[] = [
    { key: 'handFeel', value: s.avgHandFeel },
    { key: 'artwork', value: s.avgArtwork },
    { key: 'model', value: s.avgModel },
    { key: 'mockery', value: s.avgMockery }
  ];
  return raw.map((item) => {
    const label = RATING_DIMENSIONS.find((d) => d.key === item.key)?.label ?? item.key;
    const ten = toTen(item.value);
    return { key: item.key, label, value: ten === null ? '—' : ten.toFixed(1) };
  });
});

const myDims = computed<{ key: string; label: string; value: number }[]>(() => {
  const mine = props.myRating;
  if (!mine) return [];
  const raw: { key: RatingDimensionKey; value: number }[] = [
    { key: 'handFeel', value: mine.handFeel },
    { key: 'artwork', value: mine.artwork },
    { key: 'model', value: mine.model },
    { key: 'mockery', value: mine.mockery }
  ];
  return raw.map((item) => ({
    key: item.key,
    label: RATING_DIMENSIONS.find((d) => d.key === item.key)?.label ?? item.key,
    value: item.value
  }));
});

/** 打开时拉一次聚合评分 —— 一款皮肤一个请求,不用提前批量拉。 */
async function onOpen(): Promise<void> {
  const skin = props.skin;
  if (!skin) return;
  try {
    stats.value = await window.api.fetchSkinRatingStats(skin.id);
  } catch {
    stats.value = null;
  }
}

async function onSubmit(): Promise<void> {
  const skin = props.skin;
  if (!skin) return;
  const values = Object.values(ratings.value);
  if (values.some((v) => v <= 0)) {
    submitError.value = '四个维度都要打分';
    return;
  }
  submitting.value = true;
  submitError.value = '';
  contentWarn.value = '';
  const typed = content.value.trim();
  try {
    const result = await window.api.submitRating({
      skinId: skin.id,
      handFeel: ratings.value.handFeel,
      artwork: ratings.value.artwork,
      model: ratings.value.model,
      mockery: ratings.value.mockery,
      content: typed === '' ? undefined : typed
    });
    if (typed !== '' && !result.savedContent) {
      contentWarn.value = '星级分已经存上了,但评价文字没存上 —— 后端只放行桌面端/管理员账号的文字';
    }
    emit('saved', {
      skinId: skin.id,
      handFeel: ratings.value.handFeel,
      artwork: ratings.value.artwork,
      model: ratings.value.model,
      mockery: ratings.value.mockery,
      content: result.savedContent
    });
    if (!contentWarn.value) {
      emit('update:modelValue', false);
    }
  } catch (e: unknown) {
    submitError.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.dialog-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.head-name {
  font-size: 12px;
  color: var(--hx-text-faint);
  letter-spacing: 0.08em;
}
.rate-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.skin-block {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.skin-art {
  width: 76px;
  height: 76px;
  flex-shrink: 0;
  border: 1px solid var(--hx-line);
  background: var(--hx-panel-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.skin-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.skin-art--empty {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.skin-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.skin-name {
  font-size: 16px;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.skin-sub {
  font-size: 11px;
  color: var(--hx-text-dim);
}
.section {
  border-top: 1px solid var(--hx-line);
  padding-top: 12px;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.stat-block {
  padding: 10px 12px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.stat-total {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.stat-score {
  font-size: 24px;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.stat-tier {
  font-size: 13px;
}
.stat-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 8px;
}
.stat-dim {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.dim-label {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.dim-value {
  font-size: 13px;
  color: var(--hx-text-regular);
}
.my-block {
  padding: 10px 12px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.my-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.my-dim {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.my-content {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--hx-text-regular);
  white-space: pre-wrap;
}
.rate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.rate-label {
  font-size: 13px;
  color: var(--hx-text-dim);
  width: 66px;
  flex-shrink: 0;
}
.rate-stars {
  --el-rate-fill-color: var(--hx-gold);
  --el-rate-icon-color: var(--hx-text-disabled);
}
.rated-hint {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.content-input {
  --el-textarea-bg-color: var(--hx-inset);
  --el-textarea-text-color: var(--hx-text);
  --el-border-color: var(--hx-line-strong);
}
.submit-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--hx-danger);
}
.submit-warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--hx-gold);
  line-height: 1.6;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
/* 核心操作 = 魔法蓝;次级操作 = 金色文字 */
.submit-btn {
  --el-button-bg-color: var(--hx-blue);
  --el-button-border-color: var(--hx-blue);
  --el-button-hover-bg-color: var(--hx-blue-bright);
  --el-button-hover-border-color: var(--hx-blue-bright);
}
.later-btn {
  color: var(--hx-gold);
}
.empty-text {
  font-size: 12px;
  color: var(--hx-text-faint);
}
</style>
