<template>
  <el-card class="opponents-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">对局双方</span>
        <span v-if="queueLabel" class="queue-label hx-label">{{ queueLabel }}</span>
        <el-button
          class="refresh-btn"
          size="small"
          text
          :loading="loading"
          @click="$emit('refresh')"
        >
          刷新
        </el-button>
      </div>
    </template>

    <div v-if="!snapshot || !snapshot.inGame" class="empty-text">
      客户端里没有对局 —— 开一局之后这里会列出两队人
    </div>

    <template v-else>
      <div v-for="side in sides" :key="side.key" class="team-block">
        <div class="team-title hx-label">{{ side.title }}</div>
        <div class="team-list">
          <div
            v-for="player in side.players"
            :key="`${player.summonerId}-${player.puuid}`"
            class="player-row"
            :class="{ 'player-row--self': player.isSelf }"
          >
            <img
              v-if="player.championIconUrl"
              class="champ-icon"
              :src="player.championIconUrl"
              :alt="player.championName"
            />
            <span v-else class="champ-icon champ-icon--empty">—</span>

            <div class="player-info">
              <span class="player-name">
                {{ player.summonerName || '未知召唤师' }}
                <span v-if="player.isSelf" class="tag-self">我</span>
              </span>
              <span class="player-sub">{{ player.championName || '未选英雄' }}</span>
            </div>

            <el-button
              v-if="player.summonerId > 0"
              class="lookup-btn"
              size="small"
              text
              @click="$emit('lookup', player.summonerId)"
            >
              查战绩
            </el-button>
          </div>
        </div>
      </div>

      <p class="hint">
        队伍信息只保留客户端当前这一局。点「查战绩」会按游戏 ID 拉这个人的历史对局 ——
        那一层走的是<strong>腾讯的对局服务</strong>，客户端自己给不了。
      </p>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Opponent, OpponentsSnapshot } from '../../../../shared/match';
import { queueLabel as formatQueueLabel } from '../../../../shared/rankLabels';

const props = defineProps<{ snapshot: OpponentsSnapshot | null; loading?: boolean }>();

defineEmits<{
  refresh: [];
  lookup: [summonerId: number];
}>();

const queueLabel = computed<string>(() =>
  props.snapshot?.queueType ? formatQueueLabel(props.snapshot.queueType) : ''
);

const sides = computed<{ key: string; title: string; players: Opponent[] }[]>(() => {
  const opponents = props.snapshot?.opponents ?? [];
  return [
    { key: 'ally', title: '我方', players: opponents.filter((p) => p.side === 'ally') },
    { key: 'enemy', title: '对方', players: opponents.filter((p) => p.side === 'enemy') }
  ].filter((group) => group.players.length > 0);
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.queue-label {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.refresh-btn {
  margin-left: auto;
  color: var(--hx-blue);
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
}
.team-block + .team-block {
  margin-top: 14px;
}
.team-title {
  font-size: 10px;
  color: var(--hx-text-faint);
  margin-bottom: 6px;
}
.team-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.player-row--self {
  border-color: var(--hx-line-strong);
}
.champ-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}
.champ-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
}
.player-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.player-name {
  font-size: 13px;
  color: var(--hx-text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.tag-self {
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 0 5px;
  border: 1px solid var(--hx-line-strong);
  color: var(--hx-blue);
}
.player-sub {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.lookup-btn {
  margin-left: auto;
  color: var(--hx-blue);
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
