<template>
  <div class="ranked">
    <div class="row row--head">
      <span>类型</span>
      <span>总场次</span>
      <span>胜率</span>
      <span>胜场</span>
      <span>负场</span>
      <span>段位</span>
      <span>胜点</span>
    </div>

    <div v-for="row in rows" :key="row.entry.queueType" class="row">
      <span class="cell cell--type">{{ row.queueName }}</span>
      <span class="cell">{{ row.entry.wins + row.entry.losses }}</span>
      <span class="cell cell--rate">{{ Math.round(row.entry.winrate * 100) }}%</span>
      <span class="cell cell--win">{{ row.entry.wins }}</span>
      <span class="cell cell--lose">{{ row.entry.losses }}</span>
      <span class="cell cell--tier">
        <img v-if="row.badge" class="tier-badge" :src="row.badge" alt="" />
        {{ row.entry.display }}
      </span>
      <span class="cell">{{ row.entry.leaguePoints || '—' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RankedEntry } from '../../../../shared/match';
import { queueLabel } from '../../../../shared/rankLabels';
import { tierIconDataUrl } from '../../../../shared/tierIcon';

const props = defineProps<{ entries: RankedEntry[] }>();

interface RankedRow {
  entry: RankedEntry;
  queueName: string;
  /** 段位徽章;这个段位不认识就是 null */
  badge: string | null;
}

const rows = computed<RankedRow[]>(() =>
  props.entries.map((entry) => ({
    entry,
    queueName: queueLabel(entry.queueType),
    badge: tierIconDataUrl(entry.tier, entry.division)
  }))
);
</script>

<style scoped>
.ranked {
  border: 1px solid var(--hx-line);
  background: var(--hx-panel);
}
.row {
  display: grid;
  grid-template-columns: 1.5fr repeat(3, 0.9fr) 0.9fr 1.6fr 0.9fr;
  align-items: center;
  border-top: 1px solid var(--hx-line);
}
.row:first-child {
  border-top: none;
}
.row--head {
  background: var(--hx-panel-2);
}
.row--head span {
  padding: 9px 12px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hx-text-faint);
  text-align: center;
}
.row--head span:first-child {
  text-align: left;
}
.cell {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--hx-text);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.cell--type {
  text-align: left;
  color: var(--hx-text-dim);
}
.cell--rate {
  color: var(--hx-gold);
}
.cell--win {
  color: var(--hx-blue);
}
.cell--lose {
  color: var(--hx-text-faint);
}
.cell--tier {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--hx-gold);
}
.tier-badge {
  width: 18px;
  height: 18px;
}
</style>
