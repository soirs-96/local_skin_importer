<template>
  <el-dialog
    :model-value="modelValue"
    class="settlement-dialog"
    width="520px"
    align-center
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="dialog-head">
        <span class="hx-diamond" />
        <span class="hx-label">本局结算</span>
        <span v-if="championName" class="champ-name">{{ championName }}</span>
      </div>
    </template>

    <div v-if="view" class="settlement">
      <!-- 皮肤 -->
      <div class="skin-block">
        <div class="skin-art">
          <img
            v-if="skinImage && !imageBroken"
            :src="skinImage"
            :alt="skinName"
            @error="onImageError"
          />
          <span v-else class="skin-art--empty">无图</span>
        </div>
        <div class="skin-meta">
          <span class="skin-name">{{ skinName }}</span>
          <span v-if="rarity" class="skin-rarity">{{ rarity }}</span>
          <span v-if="chromaNote" class="skin-chroma">{{ chromaNote }}</span>
          <span v-if="defaultFallbackNote" class="skin-unknown">{{ defaultFallbackNote }}</span>
          <span v-else-if="!view.usedSkin.riotSkinId" class="skin-unknown">
            未识别到具体皮肤 —— 这一局用的哪款皮肤没读出来
          </span>
          <span v-else-if="!view.skin" class="skin-unknown">
            这款皮肤还不在皮肤鉴赏目录里
          </span>
        </div>
      </div>

      <!-- 本局战绩 -->
      <div v-if="battleLine" class="battle">
        <span class="hx-label">本局</span>
        <span class="battle-text">{{ battleLine }}</span>
      </div>

      <!-- 现有评分 -->
      <div class="section">
        <div class="section-head">
          <span class="hx-label">现有评分</span>
          <span v-if="hasStats" class="stat-count">{{ view.stats?.totalCount }} 人评过</span>
        </div>
        <div v-if="hasStats" class="stat-block">
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

      <!-- 打分 -->
      <div v-if="canRate" class="section">
        <div class="section-head">
          <span class="hx-label">给它打分</span>
          <span v-if="view.myRating" class="rated-hint">你已打过,再提交会覆盖</span>
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
          <el-button class="later-btn" text @click="emit('update:modelValue', false)">
            稍后再评
          </el-button>
          <el-button class="submit-btn" type="primary" :loading="submitting" @click="onSubmit">
            提交评分
          </el-button>
        </div>
      </div>

      <p v-else class="blocked-text">{{ blockedReason }}</p>
    </div>

    <p v-else class="empty-text">这一局的信息还没取到</p>
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
} from '../../../../shared/ratingTier';
import type { SettlementView } from '../../../../shared/settlement';
import { positionLabel } from '../../../../shared/gameLabels';

const props = defineProps<{
  modelValue: boolean;
  view: SettlementView | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

/** 四维星级。1~5 整数 —— 小程序就是整数星,半星会破坏口径对齐。 */
const ratings = ref<Record<RatingDimensionKey, number>>({
  handFeel: 0,
  artwork: 0,
  model: 0,
  mockery: 0
});

const submitting = ref(false);
const submitError = ref('');
/** 星级存上了但评价文字没存上 —— 后端只放行桌面端/管理员账号的文字 */
const contentWarn = ref('');
/** 评价文字 */
const content = ref('');
/** 图片降级链:图标 → 原画 → 占位符(抄小程序 skin-drawer) */
const imageBroken = ref(false);
const imageStage = ref<'icon' | 'splash'>('icon');

/**
 * 表单复位。
 *
 * ⚠️ **只在「换皮肤」或「重新打开」时复位** —— 结算数据补齐(胜负/位置)
 * 会刷新 view,跟着复位会把玩家正在写的评价文字吃掉。
 */
function resetForm(): void {
  imageBroken.value = false;
  imageStage.value = 'icon';
  submitError.value = '';
  contentWarn.value = '';
  const view = props.view;
  ratings.value = {
    handFeel: view?.myRating?.handFeel ?? 0,
    artwork: view?.myRating?.artwork ?? 0,
    model: view?.myRating?.model ?? 0,
    mockery: view?.myRating?.mockery ?? 0
  };
  content.value = view?.myRating?.content ?? '';
}

// 换了一条皮肤 → 复位
watch(() => props.view?.skin?.id ?? 0, resetForm, { immediate: true });
// 重新打开 → 复位(同一款皮肤关掉再打开,skin 没变,得靠这个)
watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  }
);

/**
 * 客户端给的皮肤名是英文资源名(`game_character_displayname_Ahri_Snow_Dawn`)
 * —— 去掉前缀、 underscores 换空格,至少人能读。
 */
function prettySkinName(raw: string): string {
  const short = raw
    .replace(/^game_character_displayname_/i, '')
    .replace(/^gamecharacterdisplayname_/i, '')
    .replace(/_/g, ' ')
    .trim();
  return short || raw;
}

/**
 * 客户端给的炫彩名(「战场BOSS 卑尔维斯 拒绝之尾」);没有 = 不是炫彩。
 *
 * 炫彩名自带底图皮肤名 —— 显示它,不然玩家看到的是自己**没用过**的那款。
 */
const chromaName = computed<string>(() => props.view?.usedSkin.chromaName ?? '');

/**
 * 炫彩提示。
 *
 * 客户端给的炫彩名是「底图皮肤名 + 炫彩名」(如「战场BOSS 卑尔维斯 拒绝之尾」)
 * —— 底图名字打头,炫彩名在后头。把它拆开只留炫彩名,
 * 底图皮肤名由标题那行显示(站内目录里查不到炫彩,评分对象就是底图那款)。
 */
const chromaNote = computed<string>(() => {
  const raw = chromaName.value;
  if (!raw) return '';
  const baseName = props.view?.skin?.name ?? '';
  const short = baseName && raw.startsWith(baseName) ? raw.slice(baseName.length).trim() : raw;
  return short ? `炫彩 · ${short}` : '炫彩';
});

/**
 * 皮肤名 —— 站内目录里那条**真皮肤**的名字。
 *
 * 炫彩在站内目录里没有 —— 查到的是它的底图那款,标题就显示底图。
 * 玩家要的是「这局用了哪款皮肤」,给一款真皮肤就够了(炫彩名另起一行)。
 */
const skinName = computed<string>(() => {
  const view = props.view;
  const skin = view?.skin;
  if (skin?.name) return skin.name;
  if (skin?.nameEn) return skin.nameEn;
  // 站内目录里没有这条皮肤,但本地读到了皮肤名 —— 总比一句「未知皮肤」强
  const displayName = view?.usedSkin.displayName;
  if (displayName) return prettySkinName(displayName);
  return '未知皮肤';
});

/**
 * 只认到英雄默认皮肤时的说明。
 *
 * 没认出具体哪款皮肤就退到**这个英雄自己的默认皮肤** ——
 * 不会打错人(还是这个英雄),但得分记在默认皮肤上,得说清楚。
 */
const defaultFallbackNote = computed<string>(() => {
  if (props.view?.usedSkin.source !== 'champion-default') return '';
  return '没认出具体哪款皮肤,先按这个英雄的默认皮肤记';
});

const rarity = computed<string>(() => props.view?.skin?.rarity ?? '');

const championName = computed<string>(() => props.view?.championName ?? '');

/** 皮肤图:图标优先,挂了退到原画。 */
const skinImage = computed<string>(() => {
  const skin = props.view?.skin;
  if (!skin) return '';
  if (imageStage.value === 'splash') return skin.splashUrl ?? '';
  return skin.iconUrl ?? skin.splashUrl ?? '';
});

function onImageError(): void {
  if (imageStage.value === 'icon') {
    imageStage.value = 'splash';
    return;
  }
  imageBroken.value = true;
}

/**
 * 有没有人给这款皮肤打过分。
 *
 * 0 人时**整块不显示** —— 「总分 —」「段位 NPC」是占位符,不是数据。
 */
const hasStats = computed<boolean>(() => (props.view?.stats?.totalCount ?? 0) > 0);

const totalTen = computed<string>(() => {
  const score = props.view?.stats?.avgScore;
  const ten = toTen(score);
  return ten === null ? '—' : ten.toFixed(1);
});

/**
 * 段位 —— 吃的是 **10 分制** 的总分。
 *
 * ⚠️ 后端给的 `avgScore` 是 **1~5 分制**,得先 `toTen` 换算。
 * 小程序 `pages/skin-detail/index.js:119-120` 就是这么做的:
 * `const total = toTen(vo.avgScore); const tierKey = scoreToTier(total);`
 * 直接把 `avgScore` 丢给 `scoreToTier` 会把 4.2 分算成「拉完了」。
 */
const tier = computed<TierKey>(() => scoreToTier(toTen(props.view?.stats?.avgScore ?? null)));
const tierLabel = computed<string>(() => RATING_TIERS[tier.value].label);
const tierColor = computed<string>(() => RATING_TIERS[tier.value].color);

const avgDims = computed<{ key: string; label: string; value: string }[]>(() => {
  const stats = props.view?.stats;
  if (!stats) return [];
  const raw: { key: RatingDimensionKey; value: number | null }[] = [
    { key: 'handFeel', value: stats.avgHandFeel },
    { key: 'artwork', value: stats.avgArtwork },
    { key: 'model', value: stats.avgModel },
    { key: 'mockery', value: stats.avgMockery }
  ];
  return raw.map((item) => {
    const label = RATING_DIMENSIONS.find((d) => d.key === item.key)?.label ?? item.key;
    const ten = toTen(item.value);
    return { key: item.key, label, value: ten === null ? '—' : ten.toFixed(1) };
  });
});

/** 本局战绩那一行。哪一项缺就整项不显示,不写 0。 */
const battleLine = computed<string>(() => {
  const view = props.view;
  if (!view) return '';
  const parts: string[] = [];

  const score = view.match ?? view.live;
  if (score) {
    parts.push(`${score.kills}/${score.deaths}/${score.assists}`);
  }
  if (view.match) {
    const position = positionLabel(
      view.match.mapId,
      view.match.lane,
      view.match.role,
      view.match.roleBoundItemName
    );
    if (position) parts.push(position);
    parts.push(view.match.win ? '胜利' : '失败');
    if (view.match.durationS > 0) {
      const m = Math.floor(view.match.durationS / 60);
      const s = view.match.durationS % 60;
      parts.push(`${m}:${String(s).padStart(2, '0')}`);
    }
  }
  if (parts.length === 0) return '';
  return parts.join(' · ');
});

/** 能不能打分。 */
const canRate = computed<boolean>(() => {
  const view = props.view;
  if (!view) return false;
  if (!view.loggedIn) return false;
  if (!view.skin) return false;
  if (!view.usedSkin.riotSkinId) return false;
  return true;
});

const blockedReason = computed<string>(() => {
  const view = props.view;
  if (!view) return '';
  if (!view.loggedIn) return '用同步码登录后才能打分';
  if (!view.usedSkin.riotSkinId) return '没识别到具体皮肤,这一局没法打分';
  if (!view.skin) return '这款皮肤还不在皮肤鉴赏目录里';
  return '';
});

async function onSubmit(): Promise<void> {
  const view = props.view;
  if (!view?.skin) return;
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
      skinId: view.skin.id,
      handFeel: ratings.value.handFeel,
      artwork: ratings.value.artwork,
      model: ratings.value.model,
      mockery: ratings.value.mockery,
      content: typed === '' ? undefined : typed
    });
    if (typed !== '' && !result.savedContent) {
      contentWarn.value = '星级分已经存上了,但评价文字没存上 —— 后端只放行桌面端/管理员账号的文字';
    }
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
.champ-name {
  font-size: 11px;
  color: var(--hx-text-faint);
  letter-spacing: 0.1em;
}
.settlement {
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
.skin-rarity {
  font-size: 11px;
  color: var(--hx-text-dim);
}
.skin-chroma {
  font-size: 11px;
  color: var(--hx-blue);
  letter-spacing: 0.04em;
}
.skin-unknown {
  font-size: 11px;
  color: var(--hx-text-faint);
  line-height: 1.6;
}
.battle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.battle-text {
  font-size: 13px;
  color: var(--hx-text-regular);
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
.stat-count {
  font-size: 11px;
  color: var(--hx-text-faint);
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
.rate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.content-input {
  --el-textarea-bg-color: var(--hx-inset);
  --el-textarea-text-color: var(--hx-text);
  --el-border-color: var(--hx-line-strong);
}
.submit-warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--hx-gold);
  line-height: 1.6;
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
.submit-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--hx-danger);
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
.blocked-text {
  font-size: 12px;
  color: var(--hx-text-faint);
  border-top: 1px solid var(--hx-line);
  padding-top: 12px;
}
</style>
