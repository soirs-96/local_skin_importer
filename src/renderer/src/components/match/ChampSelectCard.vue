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
          :title="memberTitle(member)"
        >
          <div class="champ-icon-wrap">
            <img
              v-if="member.championIconUrl && !isBroken(member.championIconUrl)"
              class="champ-icon"
              :src="member.championIconUrl"
              :alt="member.championName"
              @error="markBroken(member.championIconUrl)"
            />
            <span v-else class="champ-icon champ-icon--empty">?</span>
            <img
              v-if="avatarOf(member) && !isBroken(avatarOf(member))"
              class="summoner-avatar"
              :src="avatarOf(member) ?? ''"
              :alt="memberName(member)"
              @error="markBroken(avatarOf(member))"
            />
          </div>
          <span class="summoner-name">{{ memberName(member) }}</span>
          <span class="champ-rank">{{ rankText(member) }}</span>
          <span class="champ-role">{{ roleLabel(member.assignedPosition) }}</span>
        </div>
        <span v-if="session.myTeam.length === 0" class="empty-text">—</span>
      </div>
    </div>

    <div class="hx-divider" />

    <!-- 对面在选人阶段就是几个英雄图标 —— 身份本来就不给,也不去硬凑 -->
    <div class="team-block">
      <span class="team-label hx-label">敌方</span>
      <div class="champ-row">
        <div
          v-for="member in session.theirTeam"
          :key="`their-${member.cellId}`"
          class="champ champ--enemy"
        >
          <div class="champ-icon-wrap">
            <img
              v-if="member.championIconUrl && !isBroken(member.championIconUrl)"
              class="champ-icon"
              :src="member.championIconUrl"
              :alt="member.championName"
              @error="markBroken(member.championIconUrl)"
            />
            <span v-else class="champ-icon champ-icon--empty">?</span>
          </div>
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
              v-if="champ.championIconUrl && !isBroken(champ.championIconUrl)"
              class="ban-icon"
              :src="champ.championIconUrl"
              :alt="champ.championName"
              @error="markBroken(champ.championIconUrl)"
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
import { lcuIconUrl } from '../../../../shared/icons';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

const props = defineProps<{ session: ChampSelectSession }>();

const { isBroken, markBroken } = useBrokenIcons();

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

/** 召唤师昵称;没查到就空着 —— 不拿英雄名顶替。 */
function memberName(member: ChampSelectMember): string {
  return member.displayName;
}

/** 头像 URL;没有头像编号就是没有。 */
function avatarOf(member: ChampSelectMember): string | null {
  return member.profileIconId > 0 ? lcuIconUrl('profile', member.profileIconId) : null;
}

/**
 * 段位。
 * 没查到资料 → 「—」(是没查到,不是没有段位);
 * 查到了但没段位 → 「未定级」。
 */
function rankText(member: ChampSelectMember): string {
  if (!member.displayName) return '—';
  return member.rankedDisplay || '未定级';
}

/** 悬浮提示:把等级也露出来。 */
function memberTitle(member: ChampSelectMember): string {
  const parts: string[] = [];
  if (member.displayName) parts.push(member.displayName);
  if (member.summonerLevel > 0) parts.push(`等级 ${member.summonerLevel}`);
  if (member.rankedDisplay) parts.push(member.rankedDisplay);
  return parts.join(' · ');
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
  gap: 10px;
  flex-wrap: wrap;
}
.champ {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 84px;
  padding: 6px 4px;
  border: 1px solid transparent;
  /* 队友一条金线,对面一条灰线 —— 谁是谁一眼能分 */
  border-bottom: 1px solid var(--hx-gold-deep);
}
.champ.is-me {
  border-color: var(--hx-blue);
  border-bottom-color: var(--hx-blue);
  box-shadow: 0 0 10px var(--hx-blue-glow);
}
.champ--enemy {
  border-bottom-color: var(--hx-line);
}
.champ-icon-wrap {
  position: relative;
  width: 44px;
  height: 44px;
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
/* 召唤师头像挂在英雄头像的右下角 —— 一眼能看出是谁 */
.summoner-avatar {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--hx-gold-deep);
  background: var(--hx-panel-2);
}
.summoner-name,
.champ-name {
  max-width: 100%;
  font-size: 12px;
  color: var(--hx-text);
  text-align: center;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.champ-rank {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--hx-gold);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
