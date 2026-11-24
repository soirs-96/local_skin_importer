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
            <el-radio-group v-model="scope" size="small" class="scope-group">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="same">同大区</el-radio-button>
            </el-radio-group>
          </div>
        </template>

        <div class="player-scroll">
          <div class="section-label">
            {{ scope === 'same' ? '同大区在线' : '在线' }} ({{ visibleOnline.length }})
            <span class="section-hint">数字 = 近 10 场排位表现分</span>
          </div>
          <div v-if="visibleOnline.length === 0" class="player-empty">
            现在没人在大厅里。
          </div>
          <div
            v-for="p in visibleOnline"
            :key="p.userId"
            class="player-row"
            :class="{ 'is-hovered': hoverUserId === p.userId }"
            @mouseenter="onRowEnter(p, $event)"
            @mouseleave="onRowLeave"
          >
            <span class="status-dot" :class="'is-' + lobbyStatusOf(p.phase)" />
            <img
              v-if="p.avatarUrl"
              class="player-avatar"
              :src="p.avatarUrl"
              :alt="lobbyPlayerName(p)"
            />
            <span v-else class="player-avatar player-avatar--empty">{{ initialOf(p) }}</span>
            <div class="player-info">
              <span class="player-name">
                {{ lobbyPlayerName(p) }}
                <span v-if="p.vip" class="vip-badge">VIP</span>
                <span class="player-gameid">{{ p.gameId || '无游戏ID' }}</span>
              </span>
              <span class="player-meta">
                {{ lobbyStatusText(p.phase) }}
                <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
                <span v-if="positionLabelsOf(p).length"> · {{ positionLabelsOf(p).join('、') }}</span>
              </span>
            </div>
            <span class="player-score" :class="{ 'is-empty': scoreOf(p) === null }">
              {{ scoreOf(p) ?? '—' }}
            </span>
            <div class="player-actions">
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
          </div>

          <div class="section-label">同区离线候选 ({{ offline.length }})</div>
          <div v-if="offline.length === 0" class="player-empty">
            没有同区的人最近来过大厅。
          </div>
          <div v-for="p in offline" :key="p.userId" class="player-row">
            <span class="status-dot is-offline" />
            <img
              v-if="p.avatarUrl"
              class="player-avatar"
              :src="p.avatarUrl"
              :alt="lobbyPlayerName(p)"
            />
            <span v-else class="player-avatar player-avatar--empty">{{ initialOf(p) }}</span>
            <div class="player-info">
              <span class="player-name">{{ lobbyPlayerName(p) }}</span>
              <span class="player-meta">
                {{ p.gameId || '无游戏ID' }}
                <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
                <span v-if="p.lastLobbyAt"> · 上次在线 {{ lobbyLastSeenText(p.lastLobbyAt) }}</span>
              </span>
            </div>
            <div class="player-actions">
              <el-button class="hx-gold" size="small" text @click="onCopy(p)">复制ID</el-button>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 悬浮档案卡:鼠标停在谁身上就看谁近 10 场排位的表现 -->
    <LobbyProfileCard
      v-if="hoverPlayer"
      :visible="hoverUserId !== null"
      :left="cardPos.left"
      :top="cardPos.top"
      :player="hoverPlayer"
      :profile="hoveredProfile"
      :loading="hoveredLoading"
      :error="hoveredError"
      @enter="cancelClose"
      @leave="scheduleClose"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElNotification } from 'element-plus';
import LobbyProfileCard from '../components/LobbyProfileCard.vue';
import {
  isLobbyInvitable,
  lobbyLastSeenText,
  lobbyPlayerName,
  lobbyPlayerPositions,
  lobbyPlayerRiotId,
  lobbyStatusOf,
  lobbyStatusText
} from '../../../shared/lobby';
import type {
  LobbyMe,
  LobbyMessage,
  LobbyPlayer,
  LobbyPlayerProfile,
  LobbyState
} from '../../../shared/lobby';

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
  cancelClose();
  if (prefetchTimer) clearTimeout(prefetchTimer);
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

/**
 * 列表一变就去把每个人的近 10 场排位拉回来。
 *
 * <p>延 1.2 秒再发 —— 刚进大厅时列表还在陆续来,不用每一批都触发一轮。
 */
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
watch(visibleOnline, (players) => {
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => enqueuePrefetch(players), 1200);
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

/**
 * 复制 Riot ID —— 「昵称#标签」。
 *
 * <p>只给数字标签没用:游戏里加好友要的是完整的那个串。
 */
async function onCopy(player: LobbyPlayer): Promise<void> {
  const riotId = lobbyPlayerRiotId(player);
  if (!riotId) return;
  await window.api.copyText(riotId);
  ElNotification({ type: 'success', message: `已复制 ${riotId}`, duration: 2000 });
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

// ---- 悬浮档案卡 ------------------------------------------------------------

/** 卡片宽高跟 LobbyProfileCard 里写死的一致 —— 定位要按它算。 */
const CARD_WIDTH = 344;
const CARD_GAP = 12;

/** 现在悬浮着的是谁。 */
const hoverUserId = ref<number | null>(null);
const hoverPlayer = ref<LobbyPlayer | null>(null);
/** 悬浮那一行在窗口里的位置 —— 卡片按它摆。 */
const anchorRect = ref<DOMRect | null>(null);

/**
 * 拉回来的档案按人缓存 —— 反复悬浮同一个人不用再问后端。
 *
 * <p>用 `reactive` 而不是普通 Map:普通 Map 改了不会通知视图,卡片就永远停在
 * 「还没拉到」的状态。Vue 的 reactive 能追踪 Map 的 set/get。
 */
const profileCache = reactive(new Map<number, LobbyPlayerProfile>());
/** 正在拉的人。 */
const pendingUserIds = ref<number[]>([]);
/** 拉失败的原因,按人记着。 */
const errorsByUser = reactive(new Map<number, string>());

/** 鼠标移出去之后延迟关闭 —— 中间那段空隙不该让卡片闪一下。 */
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const hoveredProfile = computed<LobbyPlayerProfile | null>(() => {
  if (hoverUserId.value === null) return null;
  return profileCache.get(hoverUserId.value) ?? null;
});

const hoveredLoading = computed<boolean>(
  () => hoverUserId.value !== null && pendingUserIds.value.includes(hoverUserId.value)
);

const hoveredError = computed<string | null>(() => {
  if (hoverUserId.value === null) return null;
  return errorsByUser.get(hoverUserId.value) ?? null;
});

/**
 * 卡片摆哪儿。
 *
 * <p>列表在右边 —— 卡片默认往**左**开(跟 HexBox 一样),左边放不下才往右开。
 */
const cardPos = computed<{ left: number; top: number }>(() => {
  const rect = anchorRect.value;
  if (!rect) return { left: 0, top: 0 };
  let left = rect.left - CARD_WIDTH - CARD_GAP;
  if (left < 8) left = rect.right + CARD_GAP;
  const maxLeft = window.innerWidth - CARD_WIDTH - 8;
  if (left > maxLeft) left = Math.max(8, maxLeft);
  let top = rect.top - 8;
  const maxTop = window.innerHeight - 140;
  if (top > maxTop) top = Math.max(8, maxTop);
  return { left, top };
});

/**
 * 拉一个人的近 10 场排位档案。
 *
 * <p>数据走「最近战绩」那条路(腾讯的对局服务)—— 跟「战绩查询」页同一套评分。
 * 需要游戏客户端开着:腾讯的会话令牌是从客户端拿的。
 *
 * @param force  已经失败过的人再试一次(悬浮时用)—— 后台预取失败就不再重试了。
 */
async function loadProfile(player: LobbyPlayer, force = false): Promise<void> {
  const userId = player.userId;
  if (profileCache.has(userId)) return;
  if (pendingUserIds.value.includes(userId)) return;
  if (force) errorsByUser.delete(userId);
  pendingUserIds.value = [...pendingUserIds.value, userId];
  try {
    const profile = await window.api.getLobbyPlayerProfile({
      nickname: lobbyPlayerName(player),
      gameId: player.gameId
    });
    profileCache.set(userId, profile);
    errorsByUser.delete(userId);
  } catch (e: unknown) {
    errorsByUser.set(userId, (e as { message?: string }).message ?? '拉取近期战绩失败');
  } finally {
    pendingUserIds.value = pendingUserIds.value.filter((id) => id !== userId);
  }
}

/**
 * 后台把列表里每个人的近 10 场排位拉回来。
 *
 * <p>列表要显示「近 10 场主玩位置」和表现分,只靠悬浮才拉的话列表永远是空的。
 * 腾讯网关慢,一次只放两个在飞,不然自己先卡住。
 */
const PREFETCH_CONCURRENCY = 2;
/** 队列上限 —— 人再多也不一次全发出去。 */
const PREFETCH_LIMIT = 30;

const prefetchQueue = ref<LobbyPlayer[]>([]);
let inflight = 0;

function enqueuePrefetch(players: LobbyPlayer[]): void {
  const queued = new Set(prefetchQueue.value.map((p) => p.userId));
  for (const player of players) {
    if (queued.size >= PREFETCH_LIMIT) break;
    if (profileCache.has(player.userId)) continue;
    // 失败过的人不再自动重试 —— 免得列表一动就重发一遍。
    // 悬浮时还是能手动再试一次。
    if (errorsByUser.has(player.userId)) continue;
    if (pendingUserIds.value.includes(player.userId)) continue;
    queued.add(player.userId);
    prefetchQueue.value = [...prefetchQueue.value, player];
  }
  pumpPrefetch();
}

function pumpPrefetch(): void {
  while (inflight < PREFETCH_CONCURRENCY && prefetchQueue.value.length > 0) {
    const player = prefetchQueue.value[0];
    prefetchQueue.value = prefetchQueue.value.slice(1);
    inflight += 1;
    void loadProfile(player).finally(() => {
      inflight -= 1;
      pumpPrefetch();
    });
  }
}

function onRowEnter(player: LobbyPlayer, event: MouseEvent): void {
  cancelClose();
  const el = event.currentTarget as HTMLElement | null;
  anchorRect.value = el ? el.getBoundingClientRect() : null;
  hoverPlayer.value = player;
  hoverUserId.value = player.userId;
  void loadProfile(player, true);
}

function onRowLeave(): void {
  scheduleClose();
}

function scheduleClose(): void {
  cancelClose();
  closeTimer = setTimeout(() => {
    hoverUserId.value = null;
    hoverPlayer.value = null;
    anchorRect.value = null;
    closeTimer = null;
  }, 140);
}

function cancelClose(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

/**
 * 列表里显示的主玩位置。
 *
 * <p>近 10 场排位里打得最多的那个位;还没拉到就退回后端统计的历史主玩位置。
 */
function positionLabelsOf(player: LobbyPlayer): string[] {
  const profile = profileCache.get(player.userId);
  if (profile?.positionLabel) return [profile.positionLabel];
  return lobbyPlayerPositions(player).labels.slice(0, 2);
}

/** 列表里显示的表现分(0~10);null = 还没拉到。 */
function scoreOf(player: LobbyPlayer): number | null {
  return profileCache.get(player.userId)?.score ?? null;
}

/** 没头像时的占位字 —— 取名字第一个字。 */
function initialOf(player: LobbyPlayer): string {
  const name = lobbyPlayerName(player);
  return name ? name.slice(0, 1) : '?';
}
</script>

<style scoped>
.lobby-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 1180px;
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
/* 聊天在左,列表在右 —— 列表固定宽度,自己滚 */
.lobby-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.chat-card {
  flex: 1 1 auto;
  min-width: 0;
}
.player-card {
  flex: 0 0 380px;
  min-width: 0;
}
.player-scroll {
  max-height: 620px;
  overflow-y: auto;
  margin-right: -6px;
  padding-right: 6px;
}
.chat-box {
  height: 460px;
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
/* 分数那列的说明 —— 跟着列表标题走,别塞进卡头挤成一团 */
.section-hint {
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--hx-text-faint);
}
/* 全部/同大区 靠右,卡头只留标题 */
.scope-group {
  margin-left: auto;
}
.section-label:first-of-type {
  margin-top: 0;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px 8px 0;
  border-bottom: 1px solid var(--hx-line);
}
.player-row:last-child {
  border-bottom: none;
}
.player-row.is-hovered {
  background: var(--hx-tint-blue-faint);
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
.player-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid var(--hx-line-strong);
  border-radius: 50%;
}
.player-avatar--empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hx-inset);
  color: var(--hx-gold);
  font-size: 13px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-gameid {
  margin-left: 6px;
  font-size: 11px;
  color: var(--hx-text-faint);
  font-family: monospace;
}
.player-meta {
  font-size: 11px;
  color: var(--hx-text-dim);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 近 10 场排位的综合分 —— 没有就写「—」,不写 0 */
.player-score {
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
  font-size: 14px;
  color: var(--hx-blue-bright);
  font-family: monospace;
}
.player-score.is-empty {
  color: var(--hx-text-faint);
}
.player-actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
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
