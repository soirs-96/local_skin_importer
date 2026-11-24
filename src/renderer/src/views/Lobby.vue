<template>
  <div class="lobby-view">
    <div class="page-head">
      <span class="hx-diamond" />
      <span class="page-title">开黑大厅</span>
      <span class="page-hint">同一个大区的人,现在都在这儿</span>
      <el-tag v-if="state?.degraded" class="degraded-tag" type="warning" size="small">
        已降级为轮询模式
      </el-tag>
      <el-switch
        class="public-switch"
        :model-value="state?.publicVisible ?? true"
        active-text="在大厅公开我的信息"
        @change="onTogglePublic"
      />
    </div>

    <div class="stat-row">
      <div class="stat-field">
        <span class="hx-label">在线</span>
        <span class="stat-value">{{ state?.snapshot?.stats.online ?? '—' }}</span>
        <span class="stat-hint">应用在运行中</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">同大区</span>
        <span class="stat-value">{{ state?.snapshot?.stats.sameZone ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">可以拉人</span>
        <span class="stat-value">{{ state?.snapshot?.stats.invitable ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">我的段位分</span>
        <span class="stat-value">{{ me?.rankScore ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">我的收藏分</span>
        <span class="stat-value">{{ me?.collectionScore ?? '—' }}</span>
      </div>
    </div>

    <div v-if="state?.error" class="warn-row">{{ state.error }}</div>

    <div class="lobby-body">
      <!-- 左栏:聊天 -->
      <el-card class="chat-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="hx-diamond" />
            <span class="hx-label">大厅聊天</span>
            <span class="status-text">最近 50 条</span>
          </div>
        </template>

        <div ref="chatBox" class="chat-box">
          <div v-if="messages.length === 0" class="chat-empty">
            还没有人说话 —— 说第一句吧。
          </div>
          <div v-for="m in messages" :key="m.id" class="chat-line">
            <span class="chat-time">{{ m.createdAt.slice(11, 16) }}</span>
            <span class="chat-name">{{ m.nickname || m.gameId || '无名召唤师' }}</span>
            <span class="chat-text">{{ m.text }}</span>
          </div>
        </div>

        <div class="chat-input-row">
          <el-input
            v-model="draft"
            class="chat-input"
            size="small"
            maxlength="64"
            placeholder="说点什么 —— 约人、报位置、问段位"
            @keyup.enter="onSend"
          />
          <el-button class="hx-gold" size="small" :disabled="!draft.trim()" @click="onSend">
            发送
          </el-button>
        </div>
        <div class="tip-row">
          <p class="tip-line">单条最多 64 字;10 秒内不超过 5 条。</p>
        </div>
      </el-card>

      <!-- 右栏:玩家列表 -->
      <el-card class="player-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="hx-diamond hx-diamond--blue" />
            <span class="hx-label">玩家列表</span>
            <el-radio-group v-model="scope" size="small">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="same">同大区</el-radio-button>
            </el-radio-group>
          </div>
        </template>

        <div class="section-label">
          {{ scope === 'same' ? '同大区在线' : '在线' }} ({{ visibleOnline.length }})
        </div>
        <div v-if="visibleOnline.length === 0" class="player-empty">
          现在没人在大厅里。
        </div>
        <div v-for="p in visibleOnline" :key="p.userId" class="player-row">
          <span class="status-dot" :class="'is-' + lobbyStatusOf(p.phase)" />
          <div class="player-info">
            <span class="player-name">
              {{ lobbyPlayerName(p) }}
              <span v-if="p.vip" class="vip-badge">VIP</span>
            </span>
            <span class="player-meta">
              {{ p.gameId || '无游戏ID' }}
              <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
              <span v-if="p.collectionScore !== null"> · 收藏分 {{ p.collectionScore }}</span>
              <span v-if="p.positionLabels.length"> · {{ p.positionLabels.join('、') }}</span>
            </span>
          </div>
          <span class="player-status">{{ lobbyStatusText(p.phase) }}</span>
          <el-button class="hx-gold" size="small" text @click="onCopy(p)">复制ID</el-button>
          <el-button
            class="hx-gold"
            size="small"
            text
            :disabled="!isLobbyInvitable(p)"
            @click="onInvite(p)"
          >
            邀请
          </el-button>
        </div>

        <div class="section-label">同区离线候选 ({{ offline.length }})</div>
        <div v-if="offline.length === 0" class="player-empty">
          没有同区的人最近来过大厅。
        </div>
        <div v-for="p in offline" :key="p.userId" class="player-row">
          <span class="status-dot is-offline" />
          <div class="player-info">
            <span class="player-name">{{ lobbyPlayerName(p) }}</span>
            <span class="player-meta">
              {{ p.gameId || '无游戏ID' }}
              <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
              <span v-if="p.lastLobbyAt"> · 上次在线 {{ lobbyLastSeenText(p.lastLobbyAt) }}</span>
            </span>
          </div>
          <span class="player-status">离线</span>
          <el-button class="hx-gold" size="small" text @click="onCopy(p)">复制ID</el-button>
        </div>
      </el-card>
    </div>

    <!-- 同区搭子:按分数筛同区的人(老功能,搬进大厅) -->
    <RegionBuddyCard />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElNotification } from 'element-plus';
import RegionBuddyCard from '../components/RegionBuddyCard.vue';
import {
  isLobbyInvitable,
  lobbyLastSeenText,
  lobbyPlayerName,
  lobbyStatusOf,
  lobbyStatusText
} from '../../../shared/lobby';
import type { LobbyMe, LobbyMessage, LobbyPlayer, LobbyState } from '../../../shared/lobby';

const state = ref<LobbyState | null>(null);
const draft = ref('');
const scope = ref<'all' | 'same'>('all');
const chatBox = ref<HTMLElement | null>(null);

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  state.value = await window.api.getLobbyState();
  unsubscribe = window.api.onLobbyState((next) => {
    state.value = next;
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

const me = computed<LobbyMe | null>(() => state.value?.snapshot?.me ?? null);
const messages = computed<LobbyMessage[]>(() => state.value?.messages ?? []);
const online = computed<LobbyPlayer[]>(() => state.value?.snapshot?.online ?? []);
const offline = computed<LobbyPlayer[]>(() => state.value?.snapshot?.offline ?? []);

/** 我的大区(归一化后的名字)—— 同大区筛选靠它。 */
const myZone = computed<string>(() => me.value?.canonicalZone ?? '');

/**
 * 列表里显示谁。
 *
 * <p>「同大区」这个筛选是**客户端**做的 —— 后端给的 offline 本来就是同大区的,
 * 在线列表里再按大区过滤一遍。两边都用后端归一化过的名字比。
 */
const visibleOnline = computed<LobbyPlayer[]>(() => {
  if (scope.value === 'all') return online.value;
  if (!myZone.value) return online.value;
  // 比的是**归一化后**的大区 —— 库里「艾欧尼亚」和「艾欧尼亚专区」是同一个大区,
  // 直接比原始串会把同区的人漏掉(后端已经归一化过一次,别在前端再各判一次)。
  return online.value.filter((p) => p.canonicalZone === myZone.value);
});

watch(messages, async () => {
  await nextTick();
  const box = chatBox.value;
  if (box) box.scrollTop = box.scrollHeight;
});

function onTogglePublic(value: string | number | boolean): void {
  void window.api.setLobbyPublic(value === true);
}

async function onSend(): Promise<void> {
  const text = draft.value.trim();
  if (!text) return;
  const result = await window.api.sendLobbyMessage(text);
  if (!result.ok) {
    ElNotification({ type: 'warning', message: result.message ?? '发不出去', duration: 2500 });
    return;
  }
  draft.value = '';
}

async function onCopy(player: LobbyPlayer): Promise<void> {
  if (!player.gameId) return;
  await window.api.copyText(player.gameId);
  ElNotification({ type: 'success', message: `已复制 ${player.gameId}`, duration: 2000 });
}

async function onInvite(player: LobbyPlayer): Promise<void> {
  const result = await window.api.inviteLobbyPlayer(
    lobbyPlayerName(player),
    player.gameId
  );
  if (result.mode === 'copied') {
    ElNotification({ type: 'info', message: result.message, duration: 3000 });
    return;
  }
  ElNotification({ type: 'success', message: result.message, duration: 2000 });
}
</script>

<style scoped>
.lobby-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 1100px;
  margin: 0 auto;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-text {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title {
  font-size: 15px;
  color: var(--hx-gold);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.page-hint {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.degraded-tag {
  margin-left: 10px;
}
.public-switch {
  margin-left: auto;
}
.stat-row {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}
.stat-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 15px;
  color: var(--hx-gold);
  font-family: monospace;
}
.stat-hint {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.warn-row {
  padding: 8px 12px;
  border-left: 2px solid var(--hx-gold);
  background: var(--hx-tint-gold-soft);
  color: var(--hx-gold);
  font-size: 12px;
}
.tip-row {
  padding-top: 10px;
  border-top: 1px solid var(--hx-line);
}
.tip-line {
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.lobby-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.chat-card {
  flex: 1 1 55%;
  min-width: 0;
}
.player-card {
  flex: 1 1 45%;
  min-width: 0;
}
.chat-box {
  height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-empty {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.chat-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.chat-time {
  color: var(--hx-text-faint);
  font-family: monospace;
  flex-shrink: 0;
}
.chat-name {
  color: var(--hx-blue);
  flex-shrink: 0;
}
.chat-text {
  color: var(--hx-text);
  word-break: break-all;
}
.chat-input-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.chat-input {
  flex: 1;
}
.section-label {
  margin: 10px 0 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--hx-text-faint);
  text-transform: uppercase;
}
.section-label:first-of-type {
  margin-top: 0;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--hx-line);
}
.player-row:last-child {
  border-bottom: none;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.is-idle {
  background: var(--hx-gold);
  box-shadow: 0 0 8px var(--hx-gold);
}
.status-dot.is-busy {
  background: var(--hx-text-faint);
}
.status-dot.is-unknown {
  background: transparent;
  border: 1px solid var(--hx-text-faint);
}
.status-dot.is-offline {
  background: var(--hx-text-faint);
  opacity: 0.5;
}
.player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.player-name {
  font-size: 13px;
  color: var(--hx-text);
}
.player-meta {
  font-size: 11px;
  color: var(--hx-text-dim);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-status {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--hx-text-dim);
}
.player-empty {
  padding: 4px 0;
  font-size: 12px;
  color: var(--hx-text-faint);
}
.vip-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid var(--hx-gold);
  color: var(--hx-gold);
  font-size: 10px;
  letter-spacing: 0.08em;
}
</style>
