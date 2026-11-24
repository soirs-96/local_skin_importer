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
        <span class="score-label">近期分</span>
      </div>
    </div>

    <div v-if="loading" class="state-row">正在拉取近 10 场排位…</div>

    <div v-else-if="error" class="state-row state-row--error">{{ error }}</div>

    <div v-else-if="!profile || profile.matchCount === 0" class="state-row">
      这个人还没上报过近 10 场排位。
    </div>

    <template v-else>
      <div class="stat-row">
        <div class="stat-cell">
          <span class="stat-value">{{ winRateText }}</span>
          <span class="stat-label">胜率</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ profile.matchCount }}</span>
          <span class="stat-label">场次</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ kdaText }}</span>
          <span class="stat-label">平均KDA</span>
        </div>
        <div class="stat-cell">
          <span class="stat-value">{{ csText }}</span>
          <span class="stat-label">平均补刀</span>
        </div>
      </div>

      <div v-if="profile.positions.length > 0" class="section">
        <div class="section-title hx-label">主玩位置</div>
        <div class="chip-row">
          <span v-for="p in profile.positions" :key="p.position" class="chip">
            {{ p.label }}<i class="chip-count">{{ p.count }}</i>
          </span>
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
            <span class="match-score">{{ m.score }}</span>
          </div>
        </div>
      </div>
    </template>

    <div class="card-foot">近期分只看近 10 场「排位」的表现,跟皮肤评分无关。</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 大厅列表的悬浮档案卡。
 *
 * <p>内容全部来自「近 10 场排位」—— 桌面端同步时上报,后端存下来。
 * 这里不掺任何皮肤评分维度。
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

/** 近期分 —— 没数据就写「—」,不写 0。 */
const scoreText = computed<string>(() => {
  const score = props.profile?.score;
  if (score === null || score === undefined) return '—';
  return String(score);
});

const winRateText = computed<string>(() => {
  const profile = props.profile;
  if (!profile || profile.matchCount === 0) return '—';
  return `${Math.round(profile.winRate * 100)}%`;
});

const kdaText = computed<string>(() => {
  const kda = props.profile?.avgKda;
  if (kda === null || kda === undefined) return '—';
  return kda.toFixed(1);
});

const csText = computed<string>(() => {
  const cs = props.profile?.avgCs;
  if (cs === null || cs === undefined) return '—';
  return cs.toFixed(1);
});

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
  font-size: 24px;
  line-height: 1;
  color: var(--hx-blue-bright);
  font-family: monospace;
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
.stat-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
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
.section {
  margin-top: 14px;
}
.section-title {
  margin-bottom: 6px;
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
  width: 24px;
  flex-shrink: 0;
  text-align: right;
  color: var(--hx-blue);
  font-family: monospace;
}
.card-foot {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--hx-line);
  font-size: 10px;
  line-height: 1.6;
  color: var(--hx-text-faint);
}
</style>
