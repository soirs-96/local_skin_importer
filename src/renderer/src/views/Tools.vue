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
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { phaseLabel, statusLabel } from '../../../shared/autoAccept';
import type { AutoAcceptState } from '../../../shared/autoAccept';

const state = ref<AutoAcceptState | null>(null);

/** 状态是后台推的 —— 每 2 秒取一次,页面上就能看到刚接受完。 */
const REFRESH_INTERVAL_MS = 2000;
let timer: ReturnType<typeof setInterval> | null = null;

const statusText = computed<string>(() => {
  const s = state.value;
  if (!s) return '读取中';
  if (!s.enabled) return '未开启';
  if (!s.clientConnected) return '客户端未运行';
  return statusLabel(s.status);
});

const dotClass = computed<string>(() => {
  const s = state.value;
  if (!s || !s.enabled) return 'is-off';
  if (s.status === 'error') return 'is-off';
  if (s.status === 'accepted') return 'is-on';
  return 'is-idle';
});

const phaseText = computed<string>(() => {
  const s = state.value;
  if (!s || !s.phase) return '—';
  return phaseLabel(s.phase);
});

const lastAcceptedText = computed<string>(() => {
  const at = state.value?.lastAcceptedAt;
  if (!at) return '—';
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

async function load(): Promise<void> {
  try {
    state.value = await window.api.getAutoAccept();
  } catch (e: unknown) {
    console.warn('get auto accept state failed', e);
  }
}

async function onToggle(value: string | number | boolean): Promise<void> {
  const enabled = value === true;
  try {
    state.value = await window.api.setAutoAccept(enabled);
    ElMessage.success(enabled ? '自动接受已开启' : '自动接受已关闭');
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string }).message ?? '设置失败');
    await load();
  }
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
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
