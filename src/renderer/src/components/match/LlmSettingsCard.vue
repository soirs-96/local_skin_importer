<template>
  <el-card class="llm-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">AI 配置</span>
        <span class="status-dot" :class="status ? 'is-on' : 'is-off'" />
        <span class="status-text">{{ statusText }}</span>
      </div>
    </template>

    <div class="meta-row">
      <div class="meta-field">
        <span class="hx-label">模型</span>
        <span class="meta-value">{{ status?.model ?? '—' }}</span>
      </div>
      <div class="meta-field">
        <span class="hx-label">接口地址</span>
        <span class="meta-value">{{ status?.baseUrl ?? '—' }}</span>
      </div>
    </div>

    <div v-if="status && !status.persisted" class="warn-row">
      系统没有可用的加密存储,Key 只保存在内存里,重启应用后需要重新填写。
    </div>

    <div class="key-row">
      <el-input
        v-model="apiKey"
        type="password"
        show-password
        placeholder="输入 DeepSeek API Key"
        @keyup.enter="onSave"
      />
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      <el-button v-if="status?.configured" class="hx-gold" @click="onClear">清除</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { LlmStatus } from '../../../../shared/match';

const status = ref<LlmStatus | null>(null);
const apiKey = ref<string>('');
const saving = ref<boolean>(false);

const statusText = computed<string>(() => {
  if (!status.value) return '读取中';
  return status.value.configured ? '已配置' : '未配置';
});

async function load(): Promise<void> {
  status.value = await window.api.getLlmStatus();
}

async function onSave(): Promise<void> {
  const key = apiKey.value.trim();
  if (!key) {
    ElMessage.warning('请先填写 API Key');
    return;
  }
  saving.value = true;
  try {
    status.value = await window.api.setLlmApiKey(key);
    apiKey.value = '';
    ElMessage.success('API Key 已保存');
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string }).message ?? '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onClear(): Promise<void> {
  saving.value = true;
  try {
    status.value = await window.api.clearLlmApiKey();
    apiKey.value = '';
    ElMessage.success('API Key 已清除');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.status-dot.is-on {
  background: var(--hx-blue);
  box-shadow: 0 0 8px var(--hx-blue-glow);
}
.status-dot.is-off {
  background: var(--hx-text-faint);
}
.status-text {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-text-dim);
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
  background: rgba(200, 170, 110, 0.08);
  color: var(--hx-gold);
  font-size: 12px;
}
.key-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
