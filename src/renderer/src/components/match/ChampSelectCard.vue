<template>
  <el-card class="cs-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond hx-diamond--blue" />
        <span class="hx-label">英雄选择</span>
        <span v-if="session.myRole" class="my-role">{{ roleLabel(session.myRole) }}</span>
      </div>
    </template>

    <div class="team-block">
      <span class="team-label hx-label">我方</span>
      <div class="champ-row">
        <div
          v-for="member in session.myTeam"
          :key="`my-${member.cellId}`"
          class="champ"
          :class="{ 'is-me': isMe(member) }"
        >
          <img
            v-if="member.championIconUrl"
            class="champ-icon"
            :src="member.championIconUrl"
            :alt="member.championName"
          />
          <span v-else class="champ-icon champ-icon--empty">?</span>
          <span class="champ-name">{{ member.championName }}</span>
          <span class="champ-role">{{ roleLabel(member.assignedPosition) }}</span>
        </div>
        <span v-if="session.myTeam.length === 0" class="empty-text">—</span>
      </div>
    </div>

    <div class="hx-divider" />

    <div class="team-block">
      <span class="team-label hx-label">敌方</span>
      <div class="champ-row">
        <div v-for="member in session.theirTeam" :key="`their-${member.cellId}`" class="champ">
          <img
            v-if="member.championIconUrl"
            class="champ-icon"
            :src="member.championIconUrl"
            :alt="member.championName"
          />
          <span v-else class="champ-icon champ-icon--empty">?</span>
          <span class="champ-name">{{ member.championName }}</span>
          <span class="champ-role">{{ roleLabel(member.assignedPosition) }}</span>
        </div>
        <span v-if="session.theirTeam.length === 0" class="empty-text">—</span>
      </div>
    </div>

    <template v-if="session.bannedChampions.length > 0">
      <div class="hx-divider" />
      <div class="team-block">
        <span class="team-label hx-label">禁用</span>
        <div class="ban-row">
          <div v-for="champ in session.bannedChampions" :key="champ.championId" class="ban-chip">
            <img
              v-if="champ.championIconUrl"
              class="ban-icon"
              :src="champ.championIconUrl"
              :alt="champ.championName"
            />
            <span>{{ champ.championName }}</span>
          </div>
        </div>
      </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import type { ChampSelectMember, ChampSelectSession } from '../../../../shared/match';

const props = defineProps<{ session: ChampSelectSession }>();

const ROLE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  SUPPORT: '辅助',
  '': '未定'
};

function roleLabel(position: string): string {
  return ROLE_LABELS[position.toUpperCase()] ?? position;
}

function isMe(member: ChampSelectMember): boolean {
  return props.session.myCellId >= 0 && member.cellId === props.session.myCellId;
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.my-role {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-blue);
  letter-spacing: 0.08em;
}
.team-block {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.team-label {
  flex-shrink: 0;
  padding-top: 4px;
  min-width: 34px;
}
.champ-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.champ {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 68px;
  padding: 6px 4px;
  border: 1px solid transparent;
}
.champ.is-me {
  border-color: var(--hx-blue);
  box-shadow: 0 0 10px var(--hx-blue-glow);
}
.champ-icon {
  width: 44px;
  height: 44px;
  object-fit: cover;
  background: var(--hx-panel-3);
}
.champ-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
  font-size: 18px;
}
.champ-name {
  font-size: 12px;
  color: var(--hx-text);
  text-align: center;
  line-height: 1.2;
}
.champ-role {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--hx-text-faint);
}
.empty-text {
  color: var(--hx-text-faint);
  font-size: 13px;
}
.ban-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ban-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 2px;
  font-size: 11px;
  color: var(--hx-text-dim);
  border: 1px solid var(--hx-line);
  background: var(--hx-panel-2);
}
.ban-icon {
  width: 18px;
  height: 18px;
  object-fit: cover;
}
</style>
