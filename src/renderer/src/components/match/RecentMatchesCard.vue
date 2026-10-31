<template>
  <el-card class="recent-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">最近对局</span>
        <span v-if="summary && summary.total > 0" class="summary-meta">{{ summaryText }}</span>
      </div>
    </template>

    <div v-if="!summary || summary.matches.length === 0" class="empty-text">暂无对局记录</div>

    <div v-else class="match-list">
      <div v-for="match in summary.matches" :key="match.gameId" class="match-row">
        <span class="result-bar" :class="match.win ? 'is-win' : 'is-lose'" />

        <img
          v-if="match.championIconUrl"
          class="champ-icon"
          :src="match.championIconUrl"
          :alt="match.championName"
        />
        <span v-else class="champ-icon champ-icon--empty">?</span>

        <div class="match-info">
          <span class="champ-name">{{ match.championName }}</span>
          <span class="match-meta">{{ metaText(match) }}</span>
        </div>

        <div class="item-row">
          <img
            v-for="item in match.items"
            :key="item.itemId"
            class="item-icon"
            :src="item.iconUrl ?? ''"
            :alt="item.name"
            :title="item.name"
            :class="{ 'is-empty': !item.iconUrl }"
          />
        </div>

        <span class="kda">{{ match.kda }}</span>
        <span class="duration">{{ formatDuration(match.durationS) }}</span>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RecentMatch, RecentMatchesSummary } from '../../../../shared/match';

const props = defineProps<{ summary: RecentMatchesSummary | null }>();

const summaryText = computed<string>(() => {
  const s = props.summary;
  if (!s || s.total === 0) return '';
  return `${s.total} 场 · ${s.wins} 胜 · ${Math.round(s.winrate * 100)}%`;
});

function metaText(match: RecentMatch): string {
  return `${roleLabel(match.role)} · ${formatTime(match.timestampMs)}`;
}

const ROLE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  SUPPORT: '辅助',
  '': '未知位置'
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role.toUpperCase()] ?? role;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  return `${m}分`;
}

function formatTime(timestampMs: number): string {
  if (!timestampMs) return '时间未知';
  const d = new Date(timestampMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.summary-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-gold);
  letter-spacing: 0.06em;
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
}
.match-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  overflow-y: auto;
}
.match-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 6px 0;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.result-bar {
  width: 3px;
  align-self: stretch;
  flex-shrink: 0;
}
.result-bar.is-win {
  background: var(--hx-blue);
}
.result-bar.is-lose {
  background: var(--hx-danger);
}
.champ-icon {
  width: 30px;
  height: 30px;
  object-fit: cover;
  flex-shrink: 0;
}
.champ-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
}
.match-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 108px;
}
.champ-name {
  font-size: 13px;
  color: var(--hx-text);
}
.match-meta {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.item-row {
  display: flex;
  gap: 3px;
  flex: 1;
  flex-wrap: wrap;
}
.item-icon {
  width: 20px;
  height: 20px;
  object-fit: cover;
}
.item-icon.is-empty {
  background: var(--hx-panel-3);
}
.kda {
  font-family: monospace;
  font-size: 14px;
  color: var(--hx-gold);
  min-width: 62px;
  text-align: right;
}
.duration {
  font-family: monospace;
  font-size: 12px;
  color: var(--hx-text-dim);
  min-width: 40px;
  text-align: right;
}
</style>
