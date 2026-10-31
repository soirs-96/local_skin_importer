<template>
  <el-card class="rec-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond hx-diamond--blue" />
        <span class="hx-label">AI 阵容推荐</span>
        <span v-if="state?.generatedAt" class="generated-at">{{ generatedAtText }}</span>
      </div>
    </template>

    <div class="action-row">
      <el-button type="primary" :loading="busy" :disabled="!available" @click="onRecommend">
        生成推荐
      </el-button>
      <span v-if="!available" class="hint-text">进入英雄选择阶段后可用</span>
      <span v-else-if="state?.usedFallback" class="hint-text hint-text--warn">
        这次是降级内容(AI 响应不完整)
      </span>
    </div>

    <div v-if="state?.error" class="error-row">{{ state.error }}</div>

    <!-- 渲染的是 renderMarkdown 的产物,输入已做 HTML 转义 -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="html" class="md-body" v-html="html" />
    <div v-else-if="!busy" class="empty-text">
      还没有生成过推荐。选人阶段点「生成推荐」,AI 会给出主推英雄、备选、天赋与出装。
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { RecommendationState } from '../../../../shared/match';
import { renderMarkdown } from '../../utils/markdown';

defineProps<{ available: boolean }>();

const state = ref<RecommendationState | null>(null);
const busy = ref<boolean>(false);

const html = computed<string>(() =>
  state.value?.markdown ? renderMarkdown(state.value.markdown) : ''
);

const generatedAtText = computed<string>(() => {
  if (!state.value?.generatedAt) return '';
  const d = new Date(state.value.generatedAt);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

async function onRecommend(): Promise<void> {
  busy.value = true;
  try {
    state.value = await window.api.requestRecommendation();
    if (state.value.error) {
      ElMessage.error(state.value.error);
    }
  } catch (e: unknown) {
    const msg = (e as { message?: string }).message ?? '生成失败';
    ElMessage.error(msg);
    state.value = { ...(state.value ?? emptyState()), error: msg };
  } finally {
    busy.value = false;
  }
}

function emptyState(): RecommendationState {
  return {
    markdown: null,
    usedFallback: false,
    error: null,
    inflight: false,
    generatedAt: null
  };
}

onMounted(async () => {
  try {
    state.value = await window.api.getRecommendation();
  } catch {
    state.value = emptyState();
  }
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.generated-at {
  margin-left: auto;
  font-family: monospace;
  font-size: 11px;
  color: var(--hx-text-faint);
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.hint-text {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.hint-text--warn {
  color: var(--hx-gold);
}
.error-row {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--hx-danger);
  background: rgba(255, 107, 107, 0.08);
  color: var(--hx-danger);
  font-size: 12px;
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
  line-height: 1.6;
}
.md-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--hx-text);
}
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5) {
  margin: 14px 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hx-gold);
}
.md-body :deep(h3) {
  border-left: 2px solid var(--hx-gold-deep);
  padding-left: 8px;
}
.md-body :deep(p) {
  margin: 6px 0;
}
.md-body :deep(ul) {
  margin: 6px 0;
  padding-left: 20px;
}
.md-body :deep(li) {
  margin: 3px 0;
}
.md-body :deep(strong) {
  color: var(--hx-blue);
}
.md-body :deep(code) {
  padding: 1px 5px;
  background: var(--hx-panel-3);
  color: var(--hx-gold-bright);
  font-family: monospace;
}
.md-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 2px solid var(--hx-line-strong);
  color: var(--hx-text-dim);
}
.md-body :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
  overflow-x: auto;
}
</style>
