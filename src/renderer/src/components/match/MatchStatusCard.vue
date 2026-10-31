<template>
  <el-card class="status-card" shadow="never">
    <div class="status-row">
      <div class="status-left">
        <span class="hx-diamond" :class="{ 'hx-diamond--blue': isBusy }" />
        <span class="status-label hx-label">客户端状态</span>
        <span class="status-value" :class="stateClass">{{ stateLabel }}</span>
      </div>
      <el-button class="hx-gold" :loading="loading" @click="$emit('refresh')">立即刷新</el-button>
    </div>

    <div v-if="summoner" class="summoner-row">
      <div class="summoner-field">
        <span class="field-label hx-label">当前账号</span>
        <span class="field-value">{{ summonerName }}</span>
      </div>
      <div v-if="live" class="summoner-field">
        <span class="field-label hx-label">对局时间</span>
        <span class="field-value">{{ formatDuration(live.gameTime) }}</span>
      </div>
      <div v-if="live" class="summoner-field">
        <span class="field-label hx-label">当前金币</span>
        <span class="field-value">{{ Math.round(live.currentGold) }}</span>
      </div>
    </div>

    <div v-if="live?.gameMode" class="mode-row">
      <span class="hx-label">模式</span>
      <span class="mode-value">{{ live.gameMode }}</span>
    </div>

    <div v-if="snapshot?.lastError" class="error-row">
      {{ snapshot.lastError }}
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MatchSnapshot, MatchState } from '../../../../shared/match';

const props = defineProps<{
  snapshot: MatchSnapshot | null;
  loading: boolean;
}>();

defineEmits<{ refresh: [] }>();

const STATE_LABELS: Record<MatchState, string> = {
  idle: '未连接',
  lobby: '客户端大厅',
  champ_select: '英雄选择',
  in_game: '对局进行中'
};

const state = computed<MatchState>(() => props.snapshot?.state ?? 'idle');
const stateLabel = computed<string>(() => STATE_LABELS[state.value]);
const summoner = computed(() => props.snapshot?.summoner ?? null);
const live = computed(() => props.snapshot?.live ?? null);
const isBusy = computed<boolean>(() => state.value === 'champ_select' || state.value === 'in_game');

const summonerName = computed<string>(() => {
  const s = summoner.value;
  if (!s) return '';
  return s.tagLine ? `${s.displayName}#${s.tagLine}` : s.displayName;
});

const stateClass = computed<string>(() => {
  if (state.value === 'idle') return 'is-idle';
  if (state.value === 'in_game') return 'is-live';
  return 'is-online';
});

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.status-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-value {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.status-value.is-idle {
  color: var(--hx-text-faint);
}
.status-value.is-online {
  color: var(--hx-gold);
}
.status-value.is-live {
  color: var(--hx-blue);
}
.summoner-row {
  display: flex;
  gap: 28px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.summoner-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-value {
  font-size: 14px;
  color: var(--hx-text);
}
.mode-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.mode-value {
  font-size: 12px;
  color: var(--hx-text-dim);
}
.error-row {
  margin-top: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--hx-danger);
  background: rgba(255, 107, 107, 0.08);
  color: var(--hx-danger);
  font-size: 12px;
}
</style>
