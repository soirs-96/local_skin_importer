<template>
  <div class="games">
    <div class="games-head">
      <div class="head-left">
        <span class="hx-diamond" />
        <span class="hx-label">近期对局</span>
        <span class="head-count">{{ games.length }} 场</span>
        <span v-if="summary" class="head-summary">{{ summary }}</span>
      </div>

      <div class="head-right">
        <div v-if="champions.length > 0" class="champ-strip">
          <template v-for="champ in champions" :key="champ.championId">
            <img
              v-if="champ.iconUrl && !isBroken(champ.iconUrl)"
              class="champ-strip-icon"
              :src="champ.iconUrl"
              :alt="champ.name"
              :title="`${champ.name} × ${champ.count}`"
              @error="markBroken(champ.iconUrl)"
            />
            <span v-else class="champ-strip-icon champ-strip-icon--empty" :title="champ.name" />
          </template>
        </div>

        <el-select v-model="filter" class="filter" size="small">
          <el-option label="全部" value="all" />
          <el-option label="只看胜利" value="win" />
          <el-option label="只看失败" value="lose" />
        </el-select>
      </div>
    </div>

    <div v-if="loading" class="state hx-label">正在从腾讯拉取对局…</div>
    <div v-else-if="error" class="state state--error">{{ error }}</div>
    <div v-else-if="visibleGames.length === 0" class="state">没有符合条件的对局</div>

    <div v-else class="game-list">
      <div v-for="game in visibleGames" :key="game.gameId" class="game">
        <div class="game-row" :class="game.win ? 'is-win' : 'is-lose'" @click="toggle(game.gameId)">
          <span class="result-bar" />

          <img
            v-if="game.championIconUrl && !isBroken(game.championIconUrl)"
            class="champ-icon"
            :src="game.championIconUrl"
            :alt="game.championName"
            @error="markBroken(game.championIconUrl)"
          />
          <span v-else class="champ-icon champ-icon--empty">?</span>

          <div class="game-info">
            <span class="game-title">
              <span class="champ-name">{{ game.championName }}</span>
              <span class="result-tag">{{ game.win ? '胜利' : '失败' }}</span>
              <span v-if="positionLabel(game.mapId, game.lane, game.role)" class="lane-tag">
                {{ positionLabel(game.mapId, game.lane, game.role) }}
              </span>
            </span>
            <span class="game-mode">{{ modeText(game) }}</span>
          </div>

          <div class="game-kda">
            <span class="kda-main">{{ game.kills }} / {{ game.deaths }} / {{ game.assists }}</span>
            <span class="kda-sub">补刀 {{ game.minionKills }}</span>
          </div>

          <div class="game-items">
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

          <div class="game-gold">
            <span class="gold-main">{{ formatGold(game.goldEarned) }}</span>
            <span class="gold-sub">金币</span>
          </div>

          <div class="game-time">
            <span class="time-main">{{ formatDuration(game.durationS) }}</span>
            <span class="time-sub">{{ formatTime(game.timestampMs) }}</span>
          </div>

          <div class="game-score">
            <span v-if="targetScores.get(game.gameId)" class="score-num">
              {{ targetScores.get(game.gameId)?.score.toFixed(1) }}
            </span>
            <span v-if="targetScores.get(game.gameId)" class="score-rank">
              {{ targetScores.get(game.gameId)?.rank }}/{{ game.peers.length }}
            </span>
          </div>

          <span class="chevron" :class="{ 'is-open': expandedId === game.gameId }">›</span>
        </div>

        <GamePeersPanel
          v-if="expandedId === game.gameId"
          :game="game"
          :score="scores?.[game.gameId]"
          @select="$emit('select-peer', $event)"
        />
      </div>
    </div>

    <div v-if="canLoadMore" class="games-more">
      <el-button size="small" text :loading="loadingMore" @click="$emit('load-more')">
        再看 20 局
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PlayerGame, PlayerPeer } from '../../../../shared/match';
import type { GameScore, PlayerScoreDetail } from '../../../../shared/scoring';
import { gameTitle, positionLabel } from '../../../../shared/gameLabels';
import { useBrokenIcons } from '../../composables/useBrokenIcons';
import GamePeersPanel from './GamePeersPanel.vue';

const props = defineProps<{
  games: PlayerGame[];
  loading?: boolean;
  error?: string | null;
  loadingMore?: boolean;
  canLoadMore?: boolean;
  /** 每一局的评分 —— 对局号 → 评分 */
  scores?: Record<string, GameScore>;
}>();

defineEmits<{ 'load-more': []; 'select-peer': [peer: PlayerPeer] }>();

/** 每一局里「我」的分数和名次。 */
const targetScores = computed<Map<string, PlayerScoreDetail>>(() => {
  const map = new Map<string, PlayerScoreDetail>();
  for (const [gameId, result] of Object.entries(props.scores ?? {})) {
    const target = result.players.find((p) => p.isTarget);
    if (target) map.set(gameId, target);
  }
  return map;
});

const { isBroken, markBroken } = useBrokenIcons();

type Filter = 'all' | 'win' | 'lose';

const filter = ref<Filter>('all');
const expandedId = ref<string | null>(null);

const visibleGames = computed<PlayerGame[]>(() => {
  if (filter.value === 'win') return props.games.filter((game) => game.win);
  if (filter.value === 'lose') return props.games.filter((game) => !game.win);
  return props.games;
});

/** 汇总行:胜负场次 + 三个数加起来 + KDA 比。 */
const summary = computed<string>(() => {
  const list = props.games;
  if (list.length === 0) return '';
  const wins = list.filter((game) => game.win).length;
  const kills = list.reduce((sum, game) => sum + game.kills, 0);
  const deaths = list.reduce((sum, game) => sum + game.deaths, 0);
  const assists = list.reduce((sum, game) => sum + game.assists, 0);
  const ratio = deaths > 0 ? ((kills + assists) / deaths).toFixed(1) : '—';
  return `胜: ${wins}  负: ${list.length - wins}  KDA: ${kills}/${deaths}/${assists} (${ratio})`;
});

interface ChampCount {
  championId: number;
  name: string;
  iconUrl: string | null;
  count: number;
}

/** 最近用得最多的英雄,横向排一条。 */
const champions = computed<ChampCount[]>(() => {
  const counts = new Map<number, ChampCount>();
  for (const game of props.games) {
    const entry = counts.get(game.championId);
    if (entry) entry.count += 1;
    else
      counts.set(game.championId, {
        championId: game.championId,
        name: game.championName,
        iconUrl: game.championIconUrl,
        count: 1
      });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
});

function toggle(gameId: string): void {
  expandedId.value = expandedId.value === gameId ? null : gameId;
}

function modeText(game: PlayerGame): string {
  return gameTitle(game.mapId, game.queueId);
}

function formatGold(gold: number): string {
  return gold > 0 ? gold.toLocaleString('en-US') : '—';
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(timestampMs: number): string {
  if (!timestampMs) return '时间未知';
  const d = new Date(timestampMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.games {
  border: 1px solid var(--hx-line);
  background: var(--hx-panel);
}
.games-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  background: var(--hx-panel-2);
  border-bottom: 1px solid var(--hx-line);
}
.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.head-count {
  font-size: 12px;
  color: var(--hx-text-dim);
}
.head-summary {
  font-size: 12px;
  color: var(--hx-gold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.champ-strip {
  display: flex;
  gap: 3px;
}
.champ-strip-icon {
  width: 22px;
  height: 22px;
  object-fit: cover;
  opacity: 0.85;
}
.champ-strip-icon--empty {
  background: var(--hx-panel-3);
}
.filter {
  width: 110px;
}
.state {
  padding: 22px 14px;
  font-size: 13px;
  color: var(--hx-text-faint);
  text-align: center;
}
.state--error {
  color: var(--hx-danger);
}
.game-list {
  display: flex;
  flex-direction: column;
}
.game {
  border-bottom: 1px solid var(--hx-line);
}
.game:last-child {
  border-bottom: none;
}
.game-row {
  display: grid;
  grid-template-columns:
    4px 40px minmax(150px, 1.2fr) 108px minmax(120px, 1fr) 88px 118px 52px 16px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 0;
  cursor: pointer;
  transition: background 0.12s;
}
.game-row:hover {
  background: var(--hx-panel-2);
}
.result-bar {
  align-self: stretch;
  background: var(--hx-text-faint);
}
.game-row.is-win .result-bar {
  background: var(--hx-blue);
}
.game-row.is-lose .result-bar {
  background: var(--hx-danger);
}
.champ-icon {
  width: 36px;
  height: 36px;
  object-fit: cover;
}
.champ-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hx-panel-3);
  color: var(--hx-text-faint);
}
.game-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.game-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.champ-name {
  font-size: 14px;
  color: var(--hx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-tag {
  font-size: 12px;
  font-weight: 600;
}
.game-row.is-win .result-tag {
  color: var(--hx-blue);
}
.game-row.is-lose .result-tag {
  color: var(--hx-danger);
}
.lane-tag {
  font-size: 10px;
  padding: 0 5px;
  border: 1px solid var(--hx-line);
  color: var(--hx-text-faint);
}
.game-mode {
  font-size: 11px;
  color: var(--hx-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.game-kda {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kda-main {
  font-family: monospace;
  font-size: 14px;
  color: var(--hx-text);
}
.kda-sub {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.game-items {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.item-icon {
  width: 22px;
  height: 22px;
  object-fit: cover;
}
.item-icon--empty {
  background: var(--hx-panel-3);
}
.game-gold,
.game-time {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: right;
}
.gold-main {
  font-family: monospace;
  font-size: 13px;
  color: var(--hx-gold);
}
.gold-sub,
.time-sub {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.time-main {
  font-family: monospace;
  font-size: 13px;
  color: var(--hx-text-dim);
}
.chevron {
  color: var(--hx-text-faint);
  font-size: 16px;
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.game-score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.score-num {
  font-family: monospace;
  font-size: 15px;
  color: var(--hx-gold);
}
.score-rank {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.chevron.is-open {
  transform: rotate(-90deg);
}
.games-more {
  display: flex;
  justify-content: center;
  padding: 10px 0;
  border-top: 1px solid var(--hx-line);
}
</style>
