<template>
  <div class="peers">
    <div class="peers-hint hx-label">点名字就能查他的战绩</div>
    <div v-for="team in teams" :key="team.teamId" class="peer-team">
      <div class="peer-team-title hx-label">
        {{ team.teamId === 100 ? '蓝方' : '红方' }}
        <span class="peer-team-result">{{ team.wins ? '胜' : '败' }}</span>
      </div>
      <div
        v-for="peer in team.peers"
        :key="peer.puuid"
        class="peer-row"
        :class="{ 'is-clickable': canSelect(peer) }"
        :title="canSelect(peer) ? '点他查他的战绩' : ''"
        @click="onSelect(peer)"
      >
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
        <span class="peer-champ hx-label">{{ peer.championName }}</span>
        <span class="peer-kda">{{ peer.kda }}</span>
        <span class="peer-result" :class="peer.win ? 'is-win' : 'is-lose'">
          {{ peer.win ? '胜' : '败' }}
        </span>
        <span v-if="canSelect(peer)" class="peer-go">›</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayerGame, PlayerPeer } from '../../../../shared/match';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

const props = defineProps<{ game: PlayerGame }>();

const emit = defineEmits<{ select: [peer: PlayerPeer] }>();

const { isBroken, markBroken } = useBrokenIcons();

/** 只有能叫出名字的人才能拿去查 —— 没名字的点了也查不了。 */
function canSelect(peer: PlayerPeer): boolean {
  return Boolean(peer.displayName || peer.puuid);
}

function onSelect(peer: PlayerPeer): void {
  if (!canSelect(peer)) return;
  emit('select', peer);
}

interface PeerTeam {
  teamId: number;
  wins: boolean;
  peers: PlayerPeer[];
}

/** 把这一局的十个人按阵营分成两队。 */
const teams = computed<PeerTeam[]>(() => {
  const grouped = new Map<number, PlayerPeer[]>();
  for (const peer of props.game.peers) {
    const list = grouped.get(peer.teamId) ?? [];
    list.push(peer);
    grouped.set(peer.teamId, list);
  }
  return [...grouped.entries()]
    .map(([teamId, peers]) => ({
      teamId,
      wins: peers.some((peer) => peer.win),
      peers
    }))
    .sort((a, b) => a.teamId - b.teamId);
});
</script>

<style scoped>
.peers {
  padding: 10px 14px 12px;
  border-top: 1px dashed var(--hx-line);
  background: var(--hx-panel);
}
.peer-team + .peer-team {
  margin-top: 10px;
}
.peers-hint {
  margin-bottom: 6px;
  color: var(--hx-text-faint);
  font-size: 10px;
}
.peer-team-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
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
.peer-row.is-clickable {
  cursor: pointer;
}
.peer-row.is-clickable:hover .peer-name {
  color: var(--hx-blue);
}
.peer-row.is-clickable:hover .peer-go {
  color: var(--hx-blue);
}
.peer-go {
  color: var(--hx-text-faint);
  font-size: 14px;
  width: 10px;
  text-align: right;
}
.peer-icon {
  width: 18px;
  height: 18px;
  object-fit: cover;
  flex-shrink: 0;
}
.peer-icon--empty {
  background: var(--hx-panel-3);
}
.peer-name {
  width: 170px;
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
.peer-champ {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
