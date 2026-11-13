<template>
  <div class="profile">
    <div class="profile-main">
      <div class="avatar">
        <img v-if="badgeUrl" class="badge" :src="badgeUrl" :alt="profile.rankedDisplay" />
        <span v-else class="avatar-fallback hx-label">?</span>
        <span v-if="profile.summonerLevel > 0" class="level">{{ profile.summonerLevel }}</span>
      </div>

      <div class="identity">
        <div class="name-row">
          <span class="name">{{ profile.displayName || '未知召唤师' }}</span>
          <span v-if="profile.tagLine" class="tag">#{{ profile.tagLine }}</span>
          <span v-if="profile.isSelf" class="tag-self">我</span>
          <el-button class="copy-btn" size="small" text @click="$emit('copy')">复制 ID</el-button>
        </div>

        <div class="meta-row">
          <span class="meta">游戏 ID {{ profile.summonerId || '—' }}</span>
          <span v-if="profile.rankedDisplay" class="meta meta--gold">{{ profile.rankedDisplay }}</span>
          <span class="meta meta--faint">召唤师等级 {{ profile.summonerLevel || '—' }}</span>
        </div>
      </div>
    </div>

    <div class="profile-side">
      <div class="side-item">
        <span class="side-value">{{ profile.summonerLevel || '—' }}</span>
        <span class="hx-label">等级</span>
      </div>
      <div v-if="profile.ranked.length > 0" class="side-item">
        <span class="side-value">{{ profile.ranked[0].display }}</span>
        <span class="hx-label">当前段位</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayerLookup } from '../../../../shared/match';
import { tierIconDataUrl } from '../../../../shared/tierIcon';

const props = defineProps<{ profile: PlayerLookup }>();

defineEmits<{ copy: [] }>();

/** 段位徽章。没有段位就空着 —— 界面上显示一个问号占位,不编一个段位出来。 */
const badgeUrl = computed<string | null>(() =>
  props.profile.rankedTier
    ? tierIconDataUrl(props.profile.rankedTier, props.profile.rankedDivision)
    : null
);
</script>

<style scoped>
.profile {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px 18px;
  background: linear-gradient(180deg, var(--hx-panel-2), var(--hx-panel));
  border: 1px solid var(--hx-line);
}
.profile-main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}
.avatar {
  position: relative;
  width: 58px;
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hx-line-strong);
  background: var(--hx-panel-3);
  border-radius: 50%;
  overflow: hidden;
}
.badge {
  width: 46px;
  height: 46px;
}
.avatar-fallback {
  font-size: 18px;
  color: var(--hx-text-faint);
}
.level {
  position: absolute;
  bottom: 0;
  right: 0;
  padding: 0 4px;
  font-size: 10px;
  font-family: monospace;
  color: var(--hx-blue);
  background: var(--hx-void);
  border-left: 1px solid var(--hx-line);
  border-top: 1px solid var(--hx-line);
}
.identity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-size: 20px;
  font-weight: 600;
  color: var(--hx-text);
}
.tag {
  font-size: 13px;
  color: var(--hx-text-dim);
  font-family: monospace;
}
.tag-self {
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 1px 6px;
  border: 1px solid var(--hx-line-strong);
  color: var(--hx-blue);
}
.copy-btn {
  color: var(--hx-text-faint);
  font-size: 11px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.meta {
  font-size: 11px;
  color: var(--hx-text-dim);
  letter-spacing: 0.06em;
}
.meta--gold {
  color: var(--hx-gold);
}
.meta--faint {
  color: var(--hx-text-faint);
}
.profile-side {
  display: flex;
  gap: 22px;
  flex-shrink: 0;
}
.side-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.side-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--hx-gold);
}
</style>
