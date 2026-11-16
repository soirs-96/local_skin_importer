<template>
  <el-card class="status-card" shadow="never">
    <div class="status-row">
      <div class="status-left">
        <span class="hx-diamond" :class="{ 'hx-diamond--blue': isBusy }" />
        <span class="status-label hx-label">客户端状态</span>
        <span class="status-value" :class="stateClass">{{ stateLabel }}</span>
      </div>
      <el-button class="hx-gold" :loading="loading" @click="$emit('refresh')">立即刷新</el-button>
    </div>

    <div class="body-row">
      <div class="left-col">
        <div v-if="summoner" class="summoner-row">
          <div class="summoner-field">
            <span class="field-label hx-label">当前账号</span>
            <span class="field-value account-value">
              <img
                v-if="avatarUrl && !isBroken(avatarUrl)"
                class="account-avatar"
                :src="avatarUrl"
                :alt="summonerName"
                @error="markBroken(avatarUrl)"
              />
              <span class="account-name">{{ summonerName }}</span>
            </span>
          </div>
          <div v-if="live" class="summoner-field">
            <span class="field-label hx-label">对局时间</span>
            <span class="field-value">{{ formatDuration(live.gameTime) }}</span>
          </div>
          <div v-if="live" class="summoner-field">
            <span class="field-label hx-label">当前金币</span>
            <span class="field-value">{{ Math.round(live.currentGold) }}</span>
          </div>
        </div>

        <!-- 账号下面空着一块,自动接受开关放这儿 -->
        <AutoAcceptSwitch />
      </div>

      <!-- 段位贴在账号右边:那本来就是「我的」信息,单独一张卡是多余的 -->
      <div v-if="ranked.length > 0" class="ranked-block">
        <div class="ranked-head">
          <span class="field-label hx-label">排位段位</span>
          <span v-if="sourceLabel" class="rank-source hx-label">{{ sourceLabel }}</span>
        </div>
        <div v-for="entry in ranked" :key="entry.queueType" class="rank-row">
          <img
            v-if="tierIcon(entry)"
            class="tier-icon"
            :src="tierIcon(entry) ?? ''"
            :alt="entry.display"
          />
          <span v-else class="tier-icon tier-icon--empty">—</span>

          <div class="rank-info">
            <span class="rank-queue">{{ queueLabel(entry.queueType) }}</span>
            <span class="rank-tier">{{ entry.display }}</span>
          </div>

          <div class="rank-stat rank-stat--record">
            <span class="stat-value">{{ entry.wins }} / {{ entry.losses }}</span>
            <span class="stat-label hx-label">胜负</span>
          </div>

          <div class="rank-stat rank-stat--rate">
            <span class="stat-value">{{ Math.round(entry.winrate * 100) }}%</span>
            <span class="stat-label hx-label">胜率</span>
          </div>

          <div v-if="entry.leaguePoints > 0" class="rank-stat rank-stat--lp">
            <span class="stat-value">{{ entry.leaguePoints }}</span>
            <span class="stat-label hx-label">胜点</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="live?.gameMode" class="mode-row">
      <span class="hx-label">模式</span>
      <span class="mode-value">{{ live.gameMode }}</span>
    </div>

    <div class="ws-row">
      <span class="hx-label">事件加速</span>
      <span class="ws-value" :class="wsClass">{{ wsLabel }}</span>
      <span class="ws-hint">{{ wsHint }}</span>
    </div>

    <div v-if="snapshot?.lastError" class="error-row">
      {{ snapshot.lastError }}
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LcuWsStatus, MatchSnapshot, MatchState, RankedEntry } from '../../../../shared/match';
import { lcuIconUrl } from '../../../../shared/icons';
import { queueLabel } from '../../../../shared/rankLabels';
import { tierIconDataUrl } from '../../../../shared/tierIcon';
import { useBrokenIcons } from '../../composables/useBrokenIcons';
import AutoAcceptSwitch from '../AutoAcceptSwitch.vue';

const props = defineProps<{
  snapshot: MatchSnapshot | null;
  loading: boolean;
  /** 排位段位(贴在账号右边) */
  ranked?: RankedEntry[];
  /** 段位是从哪儿来的 */
  rankedSource?: string | null;
}>();

defineEmits<{ refresh: [] }>();

const STATE_LABELS: Record<MatchState, string> = {
  idle: '未连接',
  lobby: '客户端大厅',
  champ_select: '英雄选择',
  in_game: '对局进行中'
};

const state = computed<MatchState>(() => props.snapshot?.state ?? 'idle');
const stateLabel = computed<string>(() => STATE_LABELS[state.value]);
const summoner = computed(() => props.snapshot?.summoner ?? null);
const live = computed(() => props.snapshot?.live ?? null);
const isBusy = computed<boolean>(() => state.value === 'champ_select' || state.value === 'in_game');

const summonerName = computed<string>(() => {
  const s = summoner.value;
  if (!s) return '';
  if (!s.displayName) return s.tagLine ? `#${s.tagLine}` : '';
  return s.tagLine ? `${s.displayName}#${s.tagLine}` : s.displayName;
});

// 召唤师头像走 `lcuicon://profile/{id}.jpg` —— 图在客户端本机,不用出网。
const { isBroken, markBroken } = useBrokenIcons();
const avatarUrl = computed<string | null>(() =>
  summoner.value && summoner.value.profileIconId > 0
    ? lcuIconUrl('profile', summoner.value.profileIconId)
    : null
);

const stateClass = computed<string>(() => {
  if (state.value === 'idle') return 'is-idle';
  if (state.value === 'in_game') return 'is-live';
  return 'is-online';
});

// 事件加速(WebSocket)的状态。没连上不是故障 —— 客户端没开时就是这样,
// 这时候靠 2 秒轮询顶着,所以额外写一句当前是哪种刷新方式。
const wsStatus = computed<LcuWsStatus>(() => props.snapshot?.wsStatus ?? 'disconnected');
const wsLabel = computed<string>(() => {
  if (wsStatus.value === 'connected') return '已连接';
  if (wsStatus.value === 'connecting') return '连接中';
  return '未连接';
});
const wsHint = computed<string>(() =>
  wsStatus.value === 'connected' ? '状态变化实时推送' : '按 2 秒轮询刷新'
);
const wsClass = computed<string>(() => (wsStatus.value === 'connected' ? 'is-connected' : 'is-idle'));

/** 排位段位。 */
const ranked = computed<RankedEntry[]>(() => props.ranked ?? []);

/**
 * 段位是从哪儿来的。
 *
 * 显示出来是有必要的:新版客户端把 /lol-ranked/* 端点删了之后,段位只能走
 * 事件流兜底,这时候跟「客户端接口」拿到的不是一回事,用户得能看出来。
 */
const sourceLabel = computed<string>(() => {
  const s = props.rankedSource;
  if (!s) return '';
  if (s === 'ws') return '来源:事件流';
  if (s === 'summoner-profile') return '来源:召唤师档案';
  return '来源:客户端接口';
});

function tierIcon(entry: RankedEntry): string | null {
  return tierIconDataUrl(entry.tier, entry.division);
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.status-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-value {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.status-value.is-idle {
  color: var(--hx-text-faint);
}
.status-value.is-online {
  color: var(--hx-gold);
}
.status-value.is-live {
  color: var(--hx-blue);
}
.body-row {
  display: flex;
  align-items: flex-start;
  gap: 28px;
  margin-top: 14px;
  flex-wrap: wrap;
}
/* 左列:账号那几项 + 下面的自动接受开关 */
.left-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.summoner-row {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}
.summoner-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-value {
  font-size: 14px;
  color: var(--hx-text);
}
.account-value {
  display: flex;
  align-items: center;
  gap: 8px;
}
.account-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--hx-gold-deep);
  box-shadow: 0 0 6px var(--hx-gold-glow);
}
.account-name {
  white-space: nowrap;
}
/* 段位块贴在账号右边 */
.ranked-block {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ranked-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.rank-source {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.tier-icon {
  width: 30px;
  height: 30px;
  object-fit: contain;
  flex-shrink: 0;
}
.tier-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hx-text-faint);
}
.rank-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 108px;
}
.rank-queue {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hx-text-faint);
}
.rank-tier {
  font-size: 14px;
  color: var(--hx-gold);
  font-weight: 600;
}
/* 三个数字列固定宽度 —— 每一行是独立的 flex 容器,不定宽的话
   「282 / 277」和「2 / 1」宽度不同,列就散了。 */
.rank-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
  flex: 0 0 auto;
}
.rank-stat--record {
  width: 86px;
}
.rank-stat--rate {
  width: 54px;
}
.rank-stat--lp {
  width: 54px;
}
.stat-value {
  font-size: 15px;
  color: var(--hx-text);
  font-family: monospace;
}
.stat-label {
  font-size: 10px;
}
.mode-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.mode-value {
  font-size: 12px;
  color: var(--hx-text-dim);
}
.ws-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.ws-value {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.ws-value.is-connected {
  color: var(--hx-blue);
}
.ws-value.is-idle {
  color: var(--hx-text-faint);
}
.ws-hint {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.error-row {
  margin-top: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--hx-danger);
  background: var(--hx-tint-danger-soft);
  color: var(--hx-danger);
  font-size: 12px;
}
</style>
