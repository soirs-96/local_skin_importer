<template>
  <el-card class="lookup-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">查玩家</span>
        <el-button v-if="result" class="clear-btn" size="small" text @click="emit('clear')">
          清空
        </el-button>
      </div>
    </template>

    <div class="search-row">
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="名字#标签 或 游戏 ID"
        clearable
        @keyup.enter="onSearch"
      />
      <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
    </div>

    <PlayerResultPanel class="lookup-result" :result="result" :loading="loading" />

    <p class="hint">
      资料来自<strong>游戏客户端</strong>,历史战绩来自<strong>腾讯的对局服务</strong> —— 两者都能查<strong>任意玩家</strong>。
    </p>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayerLookup } from '../../../../shared/match';
import PlayerResultPanel from './PlayerResultPanel.vue';

const props = defineProps<{
  result: PlayerLookup | null;
  loading?: boolean;
  /** 输入框里的查询串;父组件改它就能把对手的名字带进来 */
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [query: string];
  clear: [];
}>();

function onSearch(): void {
  const query = props.modelValue.trim();
  if (!query) return;
  emit('search', query);
}

const keyword = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value)
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.clear-btn {
  margin-left: auto;
  color: var(--hx-text-faint);
}
.search-row {
  display: flex;
  gap: 8px;
}
.search-input {
  flex: 1;
}
.lookup-result {
  margin-top: 14px;
}
.hint {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--hx-text-faint);
}
.hint strong {
  color: var(--hx-text-dim);
}
</style>
