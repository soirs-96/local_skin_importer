<template>
  <div class="result-panel">
    <!-- 资料 -->
    <div v-if="loading" class="panel-loading hx-label">正在查资料…</div>

    <div v-else-if="result && !result.found" class="panel-error">
      <span class="hx-diamond hx-diamond--blue" />
      <span>{{ result.error }}</span>
    </div>

    <template v-else-if="result">
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
    </template>

    <!-- 战绩:资料出来之后自己去腾讯那边拉,慢一拍 -->
    <div v-if="targetPuuid" class="games">
      <div class="games-head">
        <span class="hx-label">历史战绩</span>
        <span v-if="games.length > 0" class="games-summary">{{ gamesSummary }}</span>
        <span v-if="gamesLoading" class="games-state hx-label">正在从腾讯拉…</span>
        <span v-else-if="gamesError" class="games-state games-state--error">{{ gamesError }}</span>
      </div>

      <div v-if="games.length > 0" class="games-list">
        <div v-for="game in games" :key="game.gameId" class="game-block">
          <button class="game-row" type="button" @click="toggleGame(game.gameId)">
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
            <span class="chevron" :class="{ 'is-open': expandedGameId === game.gameId }">›</span>
          </button>

          <div v-if="expandedGameId === game.gameId" class="peers">
            <div v-for="team in peerTeams(game)" :key="team.teamId" class="peer-team">
              <div class="peer-team-title hx-label">
                {{ team.teamId === 100 ? '蓝方' : '红方' }}
                <span v-if="team.wins" class="peer-team-result">胜</span>
              </div>
              <div v-for="peer in team.peers" :key="peer.puuid" class="peer-row">
                <img
                  v-if="peer.championIconUrl && !isBroken(peer.championIconUrl)"
                  class="peer-icon"
                  :src="peer.championIconUrl"
                  :alt="peer.championName"
                  @error="markBroken(peer.championIconUrl)"
                />
                <span v-else class="peer-icon peer-icon--empty">?</span>
                <span class="peer-name" :class="{ 'is-target': peer.isTarget }">
                  {{ peer.displayName || peer.championName }}
                </span>
                <span class="peer-kda">{{ peer.kda }}</span>
                <span class="peer-result" :class="peer.win ? 'is-win' : 'is-lose'">
                  {{ peer.win ? '胜' : '败' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="canLoadMore" class="games-more">
        <el-button size="small" text :loading="loadingMore" @click="loadMore">
          再看 20 局
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PlayerGame, PlayerLookup, PlayerPeer } from '../../../../shared/match';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

const props = defineProps<{
  /** 查到的资料;null = 还没查到 */
  result: PlayerLookup | null;
  /** 资料还在查 */
  loading?: boolean;
  /**
   * 直接给的 puuid(对手场景下手上就有)。
   * 给了就立刻去拉战绩,不用等资料 —— 资料是本机回环,战绩要出网。
   */
  puuid?: string;
}>();

const { isBroken, markBroken } = useBrokenIcons();

/** 一次拉多少局 */
const PAGE_SIZE = 20;

const games = ref<PlayerGame[]>([]);
const gamesLoading = ref(false);
const gamesError = ref<string | null>(null);
const loadingMore = ref(false);
const expandedGameId = ref<string | null>(null);

const targetPuuid = computed<string>(() => props.puuid || props.result?.puuid || '');

const gamesSummary = computed<string>(() => {
  if (games.value.length === 0) return '';
  const wins = games.value.filter((g) => g.win).length;
  return `${games.value.length} 场 · ${wins} 胜 · ${Math.round((wins / games.value.length) * 100)}%`;
});

/** 拉完了还可能还有 —— 腾讯那边最多能翻到全部历史。 */
const canLoadMore = computed<boolean>(
  () => !gamesLoading.value && !loadingMore.value && games.value.length > 0 && !gamesError.value
);

watch(
  targetPuuid,
  (puuid) => {
    games.value = [];
    gamesError.value = null;
    expandedGameId.value = null;
    if (!puuid) return;
    void loadGames(puuid, 0, false);
  },
  { immediate: true }
);

async function loadGames(puuid: string, startIndex: number, append: boolean): Promise<void> {
  if (append) loadingMore.value = true;
  else gamesLoading.value = true;
  try {
    const summary = await window.api.fetchPlayerGames(puuid, startIndex, PAGE_SIZE);
    games.value = append ? [...games.value, ...summary.games] : summary.games;
    gamesError.value = null;
  } catch (e: unknown) {
    gamesError.value = describeGamesFailure(e);
  } finally {
    gamesLoading.value = false;
    loadingMore.value = false;
  }
}

function loadMore(): void {
  if (!targetPuuid.value) return;
  void loadGames(targetPuuid.value, games.value.length, true);
}

function toggleGame(gameId: string): void {
  expandedGameId.value = expandedGameId.value === gameId ? null : gameId;
}

function describeGamesFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|超时/.test(message)) {
    return '连不上腾讯战绩服务(检查一下网络)';
  }
  return `战绩没取到:${message}`;
}

interface PeerTeam {
  teamId: number;
  wins: boolean;
  peers: PlayerPeer[];
}

/** 把这一局的十个人按阵营分成两队。 */
function peerTeams(game: PlayerGame): PeerTeam[] {
  const teams = new Map<number, PlayerPeer[]>();
  for (const peer of game.peers) {
    const list = teams.get(peer.teamId) ?? [];
    list.push(peer);
    teams.set(peer.teamId, list);
  }
  return [...teams.entries()]
    .map(([teamId, peers]) => ({
      teamId,
      wins: peers.some((p) => p.win),
      peers
    }))
    .sort((a, b) => a.teamId - b.teamId);
}

const LANE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  NONE: '未知位置'
};

function gameMeta(game: PlayerGame): string {
  const lane = LANE_LABELS[game.lane.toUpperCase()] ?? game.lane;
  return `${lane} · ${formatTime(game.timestampMs)}`;
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
.panel-loading {
  padding: 10px 0;
  color: var(--hx-text-faint);
}
.panel-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.3);
  color: var(--hx-danger);
  font-size: 13px;
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

.games {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--hx-line);
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
.games-state {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.games-state--error {
  margin-left: auto;
  color: var(--hx-danger);
}
.games-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 460px;
  overflow-y: auto;
}
.game-block {
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.game-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 10px 6px 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.game-row:hover {
  background: var(--hx-panel-3);
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
.chevron {
  color: var(--hx-text-faint);
  font-size: 16px;
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.chevron.is-open {
  transform: rotate(-90deg);
}

.peers {
  padding: 8px 12px 10px;
  border-top: 1px dashed var(--hx-line);
  background: var(--hx-panel);
}
.peer-team + .peer-team {
  margin-top: 10px;
}
.peer-team-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--hx-text-faint);
}
.peer-team-result {
  color: var(--hx-blue);
}
.peer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.peer-icon {
  width: 18px;
  height: 18px;
  object-fit: cover;
  flex-shrink: 0;
}
.peer-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
}
.peer-name {
  flex: 1;
  font-size: 12px;
  color: var(--hx-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peer-name.is-target {
  color: var(--hx-gold);
  font-weight: 600;
}
.peer-kda {
  font-family: monospace;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.peer-result {
  font-size: 11px;
  width: 22px;
  text-align: right;
}
.peer-result.is-win {
  color: var(--hx-blue);
}
.peer-result.is-lose {
  color: var(--hx-danger);
}

.games-more {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}
</style>
