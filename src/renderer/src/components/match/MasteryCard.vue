<template>
  <el-card class="mastery-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">英雄熟练度</span>
        <span class="mastery-count hx-label">{{ entries.length }} 个英雄</span>
        <div class="sort-switch" v-show="!collapsed">
          <button
            class="sort-btn"
            :class="{ 'is-active': mode === 'mastery' }"
            type="button"
            @click="mode = 'mastery'"
          >
            熟练度
          </button>
          <button
            class="sort-btn"
            :class="{ 'is-active': mode === 'winrate' }"
            type="button"
            @click="mode = 'winrate'"
          >
            近 20 局胜率
          </button>
        </div>
        <button class="fold-btn" type="button" @click="collapsed = !collapsed">
          {{ collapsed ? '展开' : '收起' }}
        </button>
      </div>
    </template>

    <div v-if="collapsed" class="folded-text">英雄熟练度已收起 —— 点右上角「展开」再看</div>

    <div v-else-if="entries.length === 0" class="empty-text">
      暂无熟练度数据(需要游戏客户端运行并已登录)
    </div>

    <div v-else-if="mode === 'winrate' && rows.length === 0" class="empty-text">
      最近 20 局里没有你的英雄 —— 客户端本地只保留 20 局记录
    </div>

    <div v-else class="mastery-list">
      <div v-for="row in visibleRows" :key="row.championId" class="mastery-row">
        <img
          v-if="row.championIconUrl && !isBroken(row.championIconUrl)"
          class="champ-icon"
          :src="row.championIconUrl"
          :alt="row.championName"
          @error="markBroken(row.championIconUrl)"
        />
        <span v-else class="champ-icon champ-icon--empty">?</span>

        <div class="mastery-info">
          <span class="champ-name">{{ row.championName }}</span>
          <span class="mastery-meta">
            <span class="level-tag">Lv.{{ row.championLevel }}</span>
            <span v-if="row.highestGrade" class="grade-tag" :class="gradeClass(row.highestGrade)">
              {{ row.highestGrade }}
            </span>
            <span v-if="row.lastPlayTime" class="last-play">{{ formatDate(row.lastPlayTime) }}</span>
          </span>
        </div>

        <div class="mastery-stat">
          <span class="stat-value">{{ formatPoints(row.championPoints) }}</span>
          <span class="stat-label hx-label">熟练度</span>
        </div>

        <div class="mastery-stat">
          <span v-if="recentStat(row.championId)" class="stat-value">
            {{ recentStat(row.championId)?.wins }} /
            {{ recentStat(row.championId)?.games }}
          </span>
          <span v-else class="stat-value stat-value--muted">—</span>
          <span class="stat-label hx-label">近 20 局</span>
        </div>
      </div>

      <button
        v-if="rows.length > VISIBLE_LIMIT"
        class="expand-btn"
        type="button"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : `展开全部 ${rows.length} 个` }}
      </button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  buildMasteryRows,
  sortMasteryRows,
  type ChampionMastery,
  type MasterySortMode,
  type RecentMatchesSummary
} from '../../../../shared/match';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

const props = defineProps<{ entries: ChampionMastery[]; recent: RecentMatchesSummary | null }>();

const { isBroken, markBroken } = useBrokenIcons();

const mode = ref<MasterySortMode>('mastery');
const expanded = ref<boolean>(false);
/** 整张卡折起来 —— 熟练度在页面最下面,不用时可以整块收掉。 */
const collapsed = ref<boolean>(false);

const VISIBLE_LIMIT = 12;

const rows = computed(() => sortMasteryRows(buildMasteryRows(props.entries, props.recent), mode.value));

const visibleRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, VISIBLE_LIMIT)));

function recentStat(championId: number): { games: number; wins: number } | null {
  const row = rows.value.find((item) => item.championId === championId);
  if (!row || row.recentGames === 0) return null;
  return { games: row.recentGames, wins: row.recentWins };
}

function gradeClass(grade: string): string {
  if (grade.startsWith('S')) return 'grade-tag--top';
  if (grade.startsWith('A')) return 'grade-tag--high';
  return 'grade-tag--mid';
}

function formatPoints(points: number): string {
  if (points >= 10000) return `${(points / 10000).toFixed(1)}万`;
  return String(points);
}

function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mastery-count {
  font-size: 10px;
  color: var(--hx-text-faint);
  margin-right: auto;
}
.sort-switch {
  display: flex;
  border: 1px solid var(--hx-line);
}
.fold-btn {
  background: transparent;
  border: 1px solid var(--hx-line);
  color: var(--hx-text-dim);
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 3px 10px;
  cursor: pointer;
}
.fold-btn:hover {
  color: var(--hx-gold);
  border-color: var(--hx-line-strong);
}
/* 排序按钮和折叠按钮并排时,折叠按钮贴最右 */
.sort-switch + .fold-btn {
  margin-left: 10px;
}
.folded-text {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.sort-btn {
  background: transparent;
  border: none;
  color: var(--hx-text-faint);
  font-size: 11px;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  cursor: pointer;
}
.sort-btn.is-active {
  color: var(--hx-blue);
  background: var(--hx-panel-3);
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
}
.mastery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mastery-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
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
.mastery-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 130px;
}
.champ-name {
  font-size: 13px;
  color: var(--hx-text);
}
.mastery-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--hx-text-faint);
}
.level-tag {
  color: var(--hx-text-dim);
}
.grade-tag {
  font-family: monospace;
  font-weight: 600;
}
.grade-tag--top {
  color: var(--hx-gold);
}
.grade-tag--high {
  color: var(--hx-blue);
}
.grade-tag--mid {
  color: var(--hx-text-dim);
}
.mastery-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
  margin-left: auto;
  min-width: 64px;
}
.stat-value {
  font-size: 15px;
  color: var(--hx-text);
  font-family: monospace;
}
.stat-value--muted {
  color: var(--hx-text-faint);
}
.stat-label {
  font-size: 10px;
}
.expand-btn {
  align-self: center;
  background: transparent;
  border: 1px solid var(--hx-line);
  color: var(--hx-text-dim);
  font-size: 12px;
  padding: 4px 14px;
  cursor: pointer;
}
</style>
