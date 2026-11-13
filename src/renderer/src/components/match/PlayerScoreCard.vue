<template>
  <el-card class="score-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">表现分</span>
        <span class="scope-label hx-label">近 {{ summary.games }} 场排位</span>
      </div>
    </template>

    <div class="headline">
      <div class="big-score">
        <span class="big-num">{{ summary.score.toFixed(1) }}</span>
        <span class="big-unit">分</span>
      </div>

      <div class="headline-meta">
        <div class="meta-row">
          <span class="meta-key">同场对比</span>
          <span class="meta-val" :class="vsClass">{{ vsText }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-key">主位置</span>
          <span class="meta-val">{{ mainPositionText }}</span>
        </div>
      </div>
    </div>

    <div class="dims">
      <div v-for="dim in dims" :key="dim.key" class="dim-row">
        <span class="dim-name">{{ dim.name }}</span>
        <span class="dim-bar">
          <span class="dim-fill" :style="{ width: dim.pct + '%' }" />
        </span>
        <span class="dim-val">{{ dim.value }}</span>
      </div>
      <div class="dim-row dim-row--muted">
        <span class="dim-name">补刀份额</span>
        <span class="dim-bar dim-bar--empty" />
        <span class="dim-val">{{ csShareText }}</span>
      </div>
    </div>

    <p class="note">
      分数按<strong>该位置的基准值</strong>折算 —— 辅助的经济份额天生低,不会因此吃亏。
      同场对比是他跟他同场那几个人比出来的差值。
    </p>

    <div v-if="summary.byPosition.length > 1" class="pos-list">
      <div v-for="row in summary.byPosition" :key="row.position" class="pos-row">
        <span class="pos-name">{{ row.label }}</span>
        <span class="pos-score">{{ row.score.toFixed(1) }}</span>
        <span class="pos-games">{{ row.games }} 场</span>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayerScoreSummary } from '../../../../shared/scoring';

const props = defineProps<{ summary: PlayerScoreSummary }>();

/** 同场对比:他跟同场那几个人比出来的差值。 */
const vsText = computed<string>(() => {
  const value = props.summary.vsAverage;
  if (value > 0.05) return `比同场平均高 +${value.toFixed(1)}`;
  if (value < -0.05) return `比同场平均低 ${value.toFixed(1)}`;
  return '跟同场平均持平';
});

const vsClass = computed<string>(() => {
  if (props.summary.vsAverage > 0.05) return 'is-up';
  if (props.summary.vsAverage < -0.05) return 'is-down';
  return '';
});

const mainPositionText = computed<string>(() => {
  const main = props.summary.byPosition[0];
  if (!main) return '位置未识别';
  return main.games > 0 ? `${main.label} · ${main.games} 场` : main.label;
});

interface DimRow {
  key: string;
  name: string;
  /** 条形长度 0~100 */
  pct: number;
  /** 右边的原始值 */
  value: string;
}

/** 四个计分维度 —— 条形是子分(0~1),右边是原始指标。 */
const dims = computed<DimRow[]>(() => {
  const s = props.summary;
  return [
    {
      key: 'kp',
      name: '参团率',
      pct: Math.round(s.breakdown.participation * 100),
      value: `${Math.round(s.metrics.kp * 100)}%`
    },
    {
      key: 'gold',
      name: '经济份额',
      pct: Math.round(s.breakdown.economy * 100),
      value: `${Math.round(s.metrics.goldShare * 100)}%`
    },
    {
      key: 'damage',
      name: '伤害份额',
      pct: Math.round(s.breakdown.damage * 100),
      value: `${Math.round(s.metrics.damageShare * 100)}%`
    },
    {
      key: 'kda',
      name: 'KDA',
      pct: Math.round(s.breakdown.kda * 100),
      value: s.metrics.kda.toFixed(1)
    }
  ];
});

/** 补刀份额只展示,不进分数。 */
const csShareText = computed<string>(() => `${Math.round(props.summary.metrics.csShare * 100)}%`);
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.scope-label {
  margin-left: auto;
  color: var(--hx-text-faint);
}
.headline {
  display: flex;
  align-items: center;
  gap: 28px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--hx-line);
}
.big-score {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.big-num {
  font-family: monospace;
  font-size: 38px;
  line-height: 1;
  color: var(--hx-gold-bright);
  text-shadow: 0 0 18px var(--hx-gold-glow);
}
.big-unit {
  font-size: 13px;
  color: var(--hx-text-dim);
}
.headline-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.meta-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
}
.meta-key {
  color: var(--hx-text-faint);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.meta-val {
  color: var(--hx-text);
}
.meta-val.is-up {
  color: var(--hx-blue);
}
.meta-val.is-down {
  color: var(--hx-danger);
}
.dims {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0 0;
}
.dim-row {
  display: grid;
  grid-template-columns: 64px 1fr 56px;
  align-items: center;
  gap: 10px;
}
.dim-name {
  font-size: 12px;
  color: var(--hx-text-dim);
}
.dim-bar {
  height: 6px;
  background: var(--hx-panel-3);
  overflow: hidden;
}
.dim-bar--empty {
  background: transparent;
}
.dim-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--hx-blue-deep), var(--hx-blue));
}
.dim-val {
  font-family: monospace;
  font-size: 12px;
  color: var(--hx-text);
  text-align: right;
}
.dim-row--muted .dim-name,
.dim-row--muted .dim-val {
  color: var(--hx-text-faint);
}
.note {
  margin: 14px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--hx-text-faint);
}
.note strong {
  color: var(--hx-text-dim);
}
.pos-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--hx-line);
}
.pos-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}
.pos-name {
  color: var(--hx-text-dim);
}
.pos-score {
  font-family: monospace;
  color: var(--hx-gold);
}
.pos-games {
  font-size: 11px;
  color: var(--hx-text-faint);
}
</style>
