<template>
  <div class="tools-view">
    <div class="page-head">
      <span class="hx-diamond" />
      <span class="page-title">实用功能</span>
      <span class="page-hint">跟游戏客户端直接打交道的那些小工具</span>
    </div>

    <el-card class="tool-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span class="hx-diamond" />
          <span class="hx-label">自动接受对局</span>
          <span class="status-dot" :class="dotClass" />
          <span class="status-text">{{ statusText }}</span>
          <el-switch
            class="switch"
            :model-value="state?.enabled ?? false"
            active-text="开启"
            inactive-text="关闭"
            @change="onToggle"
          />
        </div>
      </template>

      <div class="meta-row">
        <div class="meta-field">
          <span class="hx-label">客户端阶段</span>
          <span class="meta-value">{{ phaseText }}</span>
        </div>
        <div class="meta-field">
          <span class="hx-label">接受延时</span>
          <el-select
            class="delay-select"
            size="small"
            :model-value="state?.delaySeconds ?? DEFAULT_ACCEPT_DELAY_SECONDS"
            @change="onDelayChange"
          >
            <el-option
              v-for="sec in ACCEPT_DELAY_OPTIONS"
              :key="sec"
              :label="sec === 0 ? '不等待' : sec + ' 秒'"
              :value="sec"
            />
          </el-select>
        </div>
        <div class="meta-field">
          <span class="hx-label">倒计时</span>
          <span class="meta-value" :class="{ 'meta-value--hot': countdownActive }">
            {{ countdownText }}
          </span>
        </div>
        <div class="meta-field">
          <span class="hx-label">已接受</span>
          <span class="meta-value">{{ state?.acceptedCount ?? 0 }} 次</span>
        </div>
        <div class="meta-field">
          <span class="hx-label">最近一次</span>
          <span class="meta-value">{{ lastAcceptedText }}</span>
        </div>
      </div>

      <div v-if="state?.lastError" class="warn-row">
        {{ state.lastError }}
      </div>

      <div class="tip-row">
        <p class="tip-line">什么时候会触发:</p>
        <ul class="tip-list">
          <li>匹配成功后的「接受对局」弹窗 —— 自动点掉。</li>
          <li>选人阶段锁定英雄后 —— 自动点确认。</li>
        </ul>
        <p class="tip-line">倒计时期间你还能改主意:</p>
        <ul class="tip-list">
          <li>先等「接受延时」那么久,再动手 —— 不给你反应时间就太霸道了。</li>
          <li>这段时间里换英雄,倒计时重新开始。</li>
          <li>自己在客户端里点了接受,倒计时也会自己取消。</li>
        </ul>
        <p class="tip-line">它不会做的事:</p>
        <ul class="tip-list">
          <li>不替你选英雄 —— 锁定英雄这一步仍然由你决定。</li>
          <li>不替你开局排位 —— 只在客户端已经弹出对局时动作。</li>
        </ul>
      </div>
    </el-card>

    <!-- 同区开黑搭子:把同一个大区的人拉出来,复制游戏ID去加好友 -->
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
            <span class="region-name">{{ displayName(u) }}</span>
            <span class="region-id">{{ u.gameId }}</span>
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
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElNotification } from 'element-plus';
import { ACCEPT_DELAY_OPTIONS, DEFAULT_ACCEPT_DELAY_SECONDS } from '../../../shared/autoAccept';
import { describeRegion, displayName, emptyRegionText } from '../../../shared/regionUsers';
import type { RegionUser, RegionUsersResult } from '../../../shared/regionUsers';
import { useAutoAccept } from '../composables/useAutoAccept';

const {
  state,
  statusText,
  phaseText,
  countdownText,
  countdownActive,
  lastAcceptedText,
  toggle,
  setDelay
} = useAutoAccept();

const dotClass = computed<string>(() => {
  const s = state.value;
  if (!s || !s.enabled) return 'is-off';
  if (s.status === 'error') return 'is-off';
  if (s.status === 'accepted') return 'is-on';
  return 'is-idle';
});

function onToggle(value: string | number | boolean): void {
  void toggle(value === true);
}

/** 改「接受延时」。 */
function onDelayChange(value: unknown): void {
  const seconds = typeof value === 'number' ? value : Number(value);
  void setDelay(seconds);
}

// ---------------------------------------------------------------- 同区开黑搭子

const regionResult = ref<RegionUsersResult | null>(null);
const regionLoading = ref(false);
const regionError = ref('');

const regionText = computed<string>(() => describeRegion(regionResult.value));
const regionEmptyText = computed<string>(() => emptyRegionText(regionResult.value));
const regionUsers = computed<RegionUser[]>(() => regionResult.value?.users ?? []);

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
    regionResult.value = await window.api.fetchRegionUsers();
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
.tools-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.page-title {
  font-size: 15px;
  color: var(--hx-gold);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.page-hint {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.is-on {
  background: var(--hx-blue);
  box-shadow: 0 0 8px var(--hx-blue-glow);
}
.status-dot.is-idle {
  background: var(--hx-gold);
  opacity: 0.7;
}
.status-dot.is-off {
  background: var(--hx-text-faint);
}
.status-text {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.switch {
  margin-left: 14px;
}
.meta-row {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.meta-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-value {
  font-size: 13px;
  color: var(--hx-text);
  font-family: monospace;
}
/* 倒计时在走的时候得显眼 —— 这是用户等着改主意的窗口。 */
.meta-value--hot {
  color: var(--hx-gold);
}
.delay-select {
  width: 110px;
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
