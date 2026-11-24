<template>
  <div
    v-if="visible"
    class="profile-card"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @mouseenter="emit('enter')"
    @mouseleave="emit('leave')"
  >
    <div class="card-head">
      <img v-if="player.avatarUrl" class="avatar" :src="player.avatarUrl" :alt="playerName" />
      <span v-else class="avatar avatar--empty">{{ initial }}</span>
      <div class="head-info">
        <div class="name-line">
          {{ playerName }}
          <span v-if="player.vip" class="vip-badge">VIP</span>
        </div>
        <div class="sub-line">
          {{ player.gameId || '无游戏ID' }}
          <span v-if="player.canonicalZone"> · {{ player.canonicalZone }}</span>
        </div>
      </div>
      <div class="score-box">
        <span class="score-value">{{ scoreText }}</span>
        <span class="score-label">表现分</span>
      </div>
    </div>

    <div v-if="loading" class="state-row">正在拉取近 10 场排位…</div>

    <div v-else-if="error" class="state-row state-row--error">{{ error }}</div>

    <div v-else-if="!profile || profile.games === 0" class="state-row">
      没查到这个人的排位记录。
    </div>

    <template v-else>
      <div class="headline">
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

      <div class="stat-row">
        <div class="stat-cell">
          <span class="stat-value">{{ winRateText }}</span>
          <span class="stat-label">胜率</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ profile.games }}</span>
          <span class="stat-label">排位场次</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ kdaText }}</span>
          <span class="stat-label">平均KDA</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ profile.wins }}</span>
          <span class="stat-label">胜场</span>
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

      <div v-if="profile.byPosition.length > 1" class="section">
        <div class="section-title hx-label">位置分布</div>
        <div class="pos-list">
          <div v-for="row in profile.byPosition" :key="row.label" class="pos-row">
            <span class="pos-name">{{ row.label }}</span>
            <span class="pos-score">{{ row.score.toFixed(1) }}</span>
            <span class="pos-games">{{ row.games }} 场</span>
          </div>
        </div>
      </div>

      <div v-if="profile.champions.length > 0" class="section">
        <div class="section-title hx-label">近期常用英雄</div>
        <div class="chip-row">
          <span v-for="c in profile.champions" :key="c.championId" class="chip">
            <img
              v-if="c.championId > 0"
              class="chip-icon"
              :src="championIcon(c.championId)"
              :alt="c.championName"
            />
            {{ c.championName }}<i class="chip-count">{{ c.count }}</i>
          </span>
        </div>
      </div>

      <div v-if="profile.matches.length > 0" class="section">
        <div class="section-title hx-label">近 {{ profile.matches.length }} 场</div>
        <div class="match-list">
          <div
            v-for="m in profile.matches"
            :key="m.gameId"
            class="match-row"
            :class="m.win ? 'is-win' : 'is-lose'"
          >
            <span class="result-bar" />
            <img
              v-if="m.championId > 0"
              class="champ-icon"
              :src="championIcon(m.championId)"
              :alt="m.championName"
            />
            <span class="champ-name">{{ m.championName }}</span>
            <span class="match-pos">{{ m.positionLabel || '—' }}</span>
            <span class="match-kda">{{ m.kills }}/{{ m.deaths }}/{{ m.assists }}</span>
            <span class="match-cs">{{ m.minionKills }}</span>
            <span class="match-score">{{ m.score.toFixed(1) }}</span>
          </div>
        </div>
      </div>
    </template>

    <p class="note">
      表现分按<strong>该位置的基准值</strong>折算 —— 辅助的经济份额天生低,不会因此吃亏。
      同场对比是他跟他同场那几个人比出来的差值。
    </p>
    <div class="card-foot">
      数据来自腾讯的对局服务(跟「战绩查询」页同一套评分),需要游戏客户端开着。
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 大厅列表的悬浮档案卡。
 *
 * <p>内容来自「最近战绩」—— 走腾讯的对局服务,跟「战绩查询」页同一套评分
 * (`shared/scoring.ts`)。表现分 0~10,只看排位表现,跟皮肤评分无关。
 */

import { computed } from 'vue';
import { lcuIconUrl } from '../../../shared/icons';
import type { LobbyPlayer, LobbyPlayerProfile } from '../../../shared/lobby';

const props = defineProps<{
  /** 卡片是否可见 */
  visible: boolean;
  /** 卡片左上角在窗口里的位置 */
  left: number;
  top: number;
  /** 悬浮的那一行 */
  player: LobbyPlayer;
  /** 档案;null = 还没拉到 */
  profile: LobbyPlayerProfile | null;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{ enter: []; leave: [] }>();

const playerName = computed<string>(
  () => props.player.nickname || props.player.gameId || '无名召唤师'
);

const initial = computed<string>(() => (playerName.value ? playerName.value.slice(0, 1) : '?'));

/** 表现分 —— 没数据就写「—」,不写 0。 */
const scoreText = computed<string>(() => {
  const score = props.profile?.score;
  if (score === null || score === undefined) return '—';
  return score.toFixed(1);
});

/** 同场对比:他跟同场那几个人比出来的差值。 */
const vsText = computed<string>(() => {
  const value = props.profile?.vsAverage ?? 0;
  if (value > 0.05) return `比同场平均高 +${value.toFixed(1)}`;
  if (value < -0.05) return `比同场平均低 ${value.toFixed(1)}`;
  return '跟同场平均持平';
});

const vsClass = computed<string>(() => {
  const value = props.profile?.vsAverage ?? 0;
  if (value > 0.05) return 'is-up';
  if (value < -0.05) return 'is-down';
  return '';
});

const mainPositionText = computed<string>(() => {
  const profile = props.profile;
  if (!profile || !profile.positionLabel) return '位置未识别';
  const main = profile.byPosition[0];
  return main && main.games > 0 ? `${profile.positionLabel} · ${main.games} 场` : profile.positionLabel;
});

const winRateText = computed<string>(() => {
  const profile = props.profile;
  if (!profile || profile.games === 0) return '—';
  return `${Math.round((profile.wins / profile.games) * 100)}%`;
});

const kdaText = computed<string>(() => {
  const kda = props.profile?.metrics.kda;
  if (kda === null || kda === undefined) return '—';
  return kda.toFixed(1);
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
  const profile = props.profile;
  if (!profile) return [];
  const m = profile.metrics;
  const b = profile.breakdown;
  return [
    {
      key: 'kp',
      name: '参团率',
      pct: Math.round(b.participation * 100),
      value: `${Math.round(m.kp * 100)}%`
    },
    {
      key: 'gold',
      name: '经济份额',
      pct: Math.round(b.economy * 100),
      value: `${Math.round(m.goldShare * 100)}%`
    },
    {
      key: 'damage',
      name: '伤害份额',
      pct: Math.round(b.damage * 100),
      value: `${Math.round(m.damageShare * 100)}%`
    },
    {
      key: 'kda',
      name: 'KDA',
      pct: Math.round(b.kda * 100),
      value: m.kda.toFixed(1)
    }
  ];
});

/** 补刀份额只展示,不进分数。 */
const csShareText = computed<string>(
  () => `${Math.round((props.profile?.metrics.csShare ?? 0) * 100)}%`
);

/** 英雄头像走本机客户端的图 —— 编号是 Riot 的,每台机器都有。 */
function championIcon(championId: number): string {
  return championId > 0 ? lcuIconUrl('champion', championId) : '';
}
</script>

<style scoped>
.profile-card {
  position: fixed;
  z-index: 2200;
  width: 344px;
  max-height: 76vh;
  overflow-y: auto;
  padding: 14px 16px 10px;
  background: var(--hx-panel);
  border: 1px solid var(--hx-line-strong);
  box-shadow: var(--hx-shadow);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--hx-line);
}
.avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid var(--hx-line-strong);
  border-radius: 50%;
}
.avatar--empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hx-inset);
  color: var(--hx-gold);
  font-size: 16px;
}
.head-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name-line {
  font-size: 14px;
  color: var(--hx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  font-size: 11px;
  color: var(--hx-text-faint);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vip-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid var(--hx-gold);
  color: var(--hx-gold);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.score-box {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.score-value {
  font-size: 26px;
  line-height: 1;
  color: var(--hx-gold-bright);
  font-family: monospace;
  text-shadow: 0 0 14px var(--hx-gold-glow);
}
.score-label {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--hx-text-faint);
}
.state-row {
  margin-top: 14px;
  padding: 10px 12px;
  background: var(--hx-inset);
  color: var(--hx-text-dim);
  font-size: 12px;
  letter-spacing: 0.04em;
}
.state-row--error {
  background: var(--hx-tint-danger-soft);
  color: var(--hx-danger);
}
.headline {
  display: flex;
  align-items: center;
  gap: 28px;
  padding-top: 12px;
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
.stat-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.stat-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  background: var(--hx-inset);
}
.stat-value {
  font-size: 14px;
  color: var(--hx-gold);
  font-family: monospace;
}
.stat-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--hx-text-faint);
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
.section {
  margin-top: 14px;
}
.section-title {
  margin-bottom: 6px;
}
.pos-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
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
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  background: var(--hx-tint-blue-soft);
  border: 1px solid var(--hx-line-soft);
  color: var(--hx-text-regular);
  font-size: 11px;
}
.chip-icon {
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 50%;
}
.chip-count {
  font-style: normal;
  color: var(--hx-blue);
  font-family: monospace;
}
.match-list {
  display: flex;
  flex-direction: column;
}
.match-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
  border-bottom: 1px solid var(--hx-line-lighter);
  font-size: 11px;
}
.match-row:last-child {
  border-bottom: none;
}
.result-bar {
  width: 3px;
  height: 14px;
  flex-shrink: 0;
}
.is-win .result-bar {
  background: var(--hx-blue);
}
.is-lose .result-bar {
  background: var(--hx-text-faint);
}
.champ-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 50%;
}
.champ-name {
  width: 56px;
  flex-shrink: 0;
  color: var(--hx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-pos {
  width: 30px;
  flex-shrink: 0;
  color: var(--hx-text-dim);
}
.match-kda {
  width: 52px;
  flex-shrink: 0;
  color: var(--hx-text-regular);
  font-family: monospace;
}
.match-cs {
  width: 32px;
  flex-shrink: 0;
  text-align: right;
  color: var(--hx-text-dim);
  font-family: monospace;
}
.match-score {
  width: 30px;
  flex-shrink: 0;
  text-align: right;
  color: var(--hx-blue);
  font-family: monospace;
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
.card-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--hx-line);
  font-size: 10px;
  line-height: 1.6;
  color: var(--hx-text-faint);
}
</style>
