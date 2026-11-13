<template>
  <el-card class="lookup-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">查玩家</span>
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

    <div v-if="result && !result.found" class="lookup-error">
      <span class="hx-diamond hx-diamond--blue" />
      <span>{{ result.error }}</span>
    </div>

    <div v-else-if="result" class="lookup-result">
      <div class="result-head">
        <span class="result-name">{{ result.riotId || result.displayName }}</span>
        <span v-if="result.isSelf" class="tag-self">我</span>
      </div>

      <div class="result-grid">
        <div v-if="result.summonerLevel > 0" class="cell">
          <span class="cell-value">{{ result.summonerLevel }}</span>
          <span class="cell-label hx-label">等级</span>
        </div>
        <div v-if="result.rankedDisplay" class="cell">
          <span class="cell-value cell-value--gold">{{ result.rankedDisplay }}</span>
          <span class="cell-label hx-label">段位</span>
        </div>
        <div v-if="result.summonerId > 0" class="cell">
          <span class="cell-value">{{ result.summonerId }}</span>
          <span class="cell-label hx-label">游戏 ID</span>
        </div>
        <div v-if="result.puuid" class="cell cell--wide">
          <span class="cell-value cell-value--mono">{{ result.puuid }}</span>
          <span class="cell-label hx-label">PUUID</span>
        </div>
      </div>

      <div v-if="result.games && result.games.games.length > 0" class="games">
        <div class="games-head">
          <span class="hx-label">历史战绩</span>
          <span class="games-summary">{{ gamesSummary }}</span>
        </div>
        <div class="games-list">
          <div v-for="game in result.games.games" :key="game.gameId" class="game-row">
            <span class="result-bar" :class="game.win ? 'is-win' : 'is-lose'" />

            <img
              v-if="game.championIconUrl && !isBroken(game.championIconUrl)"
              class="champ-icon"
              :src="game.championIconUrl"
              :alt="game.championName"
              @error="markBroken(game.championIconUrl)"
            />
            <span v-else class="champ-icon champ-icon--empty">?</span>

            <div class="game-info">
              <span class="champ-name">{{ game.championName }}</span>
              <span class="game-meta">{{ gameMeta(game) }}</span>
            </div>

            <div class="item-row">
              <template v-for="item in game.items" :key="item.itemId">
                <img
                  v-if="item.iconUrl && !isBroken(item.iconUrl)"
                  class="item-icon"
                  :src="item.iconUrl"
                  :alt="item.name"
                  :title="item.name"
                  @error="markBroken(item.iconUrl)"
                />
                <span v-else class="item-icon item-icon--empty" :title="item.name" />
              </template>
            </div>

            <span class="kda">{{ game.kda }}</span>
            <span class="duration">{{ formatDuration(game.durationS) }}</span>
          </div>
        </div>
      </div>

      <p v-else-if="result.gamesError" class="lookup-error lookup-error--soft">
        <span class="hx-diamond hx-diamond--blue" />
        <span>{{ result.gamesError }}</span>
      </p>
    </div>

    <p class="hint">
      资料来自<strong>游戏客户端</strong>,历史战绩来自<strong>腾讯的对局服务</strong> —— 两者都能查<strong>任意玩家</strong>。
    </p>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayerGame, PlayerLookup } from '../../../../shared/match';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

const props = defineProps<{
  result: PlayerLookup | null;
  loading?: boolean;
  /** 输入框里的查询串;父组件改它就能把对手的名字带进来 */
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [query: string];
}>();

const { isBroken, markBroken } = useBrokenIcons();

function onSearch(): void {
  const query = props.modelValue.trim();
  if (!query) return;
  emit('search', query);
}

const keyword = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value)
});

const gamesSummary = computed<string>(() => {
  const games = props.result?.games;
  if (!games || games.total === 0) return '';
  return `${games.total} 场 · ${games.wins} 胜 · ${Math.round(games.winrate * 100)}%`;
});

const LANE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  '': '未知位置'
};

function laneLabel(lane: string): string {
  return LANE_LABELS[lane.toUpperCase()] ?? lane;
}

function gameMeta(game: PlayerGame): string {
  return `${laneLabel(game.lane)} · ${formatTime(game.timestampMs)}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}分`;
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
.search-row {
  display: flex;
  gap: 8px;
}
.search-input {
  flex: 1;
}
.lookup-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.3);
  color: var(--hx-danger);
  font-size: 13px;
}
.lookup-error--soft {
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.3);
  color: var(--hx-text-dim);
}
.games {
  margin-top: 16px;
}
.games-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.games-summary {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-gold);
  letter-spacing: 0.06em;
}
.games-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  overflow-y: auto;
}
.game-row {
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
.game-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 108px;
}
.champ-name {
  font-size: 13px;
  color: var(--hx-text);
}
.game-meta {
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
.item-icon--empty {
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
.lookup-result {
  margin-top: 14px;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.result-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--hx-gold);
}
.tag-self {
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 1px 6px;
  border: 1px solid var(--hx-line-strong);
  color: var(--hx-blue);
}
.result-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
  padding: 8px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.cell--wide {
  flex: 1;
  min-width: 200px;
}
.cell-value {
  font-size: 15px;
  font-family: monospace;
  color: var(--hx-text);
}
.cell-value--gold {
  color: var(--hx-gold);
}
.cell-value--mono {
  font-size: 11px;
  word-break: break-all;
}
.cell-label {
  font-size: 10px;
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
