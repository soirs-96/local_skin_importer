<template>
  <el-card class="ranked-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">排位段位</span>
        <span v-if="sourceLabel" class="rank-source hx-label">{{ sourceLabel }}</span>
      </div>
    </template>

    <div v-if="entries.length === 0" class="empty-text">
      暂无排位数据(需要游戏客户端运行在主界面)
    </div>

    <div v-else class="rank-list">
      <div v-for="entry in entries" :key="entry.queueType" class="rank-row">
        <img
          v-if="tierIcon(entry)"
          class="tier-icon"
          :src="tierIcon(entry) ?? ''"
          :alt="entry.display"
        />
        <span v-else class="tier-icon tier-icon--empty">—</span>

        <div class="rank-info">
          <span class="rank-queue">{{ queueLabel(entry.queueType) }}</span>
          <span class="rank-tier">{{ entry.display }}</span>
        </div>

        <div class="rank-stat">
          <span class="stat-value">{{ entry.wins }} / {{ entry.losses }}</span>
          <span class="stat-label hx-label">胜负</span>
        </div>

        <div class="rank-stat">
          <span class="stat-value">{{ Math.round(entry.winrate * 100) }}%</span>
          <span class="stat-label hx-label">胜率</span>
        </div>

        <div v-if="entry.leaguePoints > 0" class="rank-stat">
          <span class="stat-value">{{ entry.leaguePoints }}</span>
          <span class="stat-label hx-label">胜点</span>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RankedEntry } from '../../../../shared/match';
import { queueLabel } from '../../../../shared/rankLabels';
import { tierIconDataUrl } from '../../../../shared/tierIcon';

const props = defineProps<{ entries: RankedEntry[]; source?: string | null }>();

/**
 * 段位是从哪儿来的。
 *
 * 显示出来是有必要的:新版客户端把 /lol-ranked/* 端点删了之后,段位只能走
 * 事件流兜底,这时候跟「客户端接口」拿到的不是一回事,用户得能看出来。
 */
const sourceLabel = computed<string>(() => {
  const s = props.source;
  if (!s) return '';
  if (s === 'ws') return '来源:事件流';
  if (s === 'summoner-profile') return '来源:召唤师档案';
  return '来源:客户端接口';
});

function tierIcon(entry: RankedEntry): string | null {
  return tierIconDataUrl(entry.tier, entry.division);
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rank-source {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.tier-icon {
  width: 34px;
  height: 34px;
  object-fit: contain;
  flex-shrink: 0;
}
.tier-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
}
.rank-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 130px;
}
.rank-queue {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hx-text-faint);
}
.rank-tier {
  font-size: 14px;
  color: var(--hx-gold);
  font-weight: 600;
}
.rank-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
  margin-left: auto;
}
.rank-stat + .rank-stat {
  margin-left: 0;
  min-width: 56px;
}
.stat-value {
  font-size: 15px;
  color: var(--hx-text);
  font-family: monospace;
}
.stat-label {
  font-size: 10px;
}
</style>
