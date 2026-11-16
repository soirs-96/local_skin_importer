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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ACCEPT_DELAY_OPTIONS, DEFAULT_ACCEPT_DELAY_SECONDS } from '../../../shared/autoAccept';
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
</style>
