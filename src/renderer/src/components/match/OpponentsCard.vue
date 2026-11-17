<template>
  <el-card class="opponents-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond" />
        <span class="hx-label">{{ cardTitle }}</span>
        <span v-if="queueLabel" class="queue-label hx-label">{{ queueLabel }}</span>
        <span v-if="phaseLabel" class="phase-tag hx-label">{{ phaseLabel }}</span>
        <el-button
          class="refresh-btn"
          size="small"
          text
          :loading="loading"
          @click="onRefresh"
        >
          刷新
        </el-button>
      </div>
    </template>

    <div v-if="roster.length === 0" class="empty-text">
      还没进选人,也没有对局 —— 进入<strong>选人</strong>后这里会列出我方队友,开局后是完整两队人
    </div>

    <template v-else>
      <div v-for="side in sides" :key="side.key" class="team-block">
        <div class="team-title hx-label">{{ side.title }}</div>
        <div class="team-list">
          <div
            v-for="player in side.players"
            :key="player.key"
            class="player-row"
            :class="{ 'player-row--self': player.isSelf }"
          >
            <img
              v-if="player.championIconUrl && !isBroken(player.championIconUrl)"
              class="champ-icon"
              :src="player.championIconUrl"
              :alt="player.championName"
              @error="markBroken(player.championIconUrl)"
            />
            <span v-else class="champ-icon champ-icon--empty">—</span>

            <img
              v-if="player.avatarUrl && !isBroken(player.avatarUrl)"
              class="avatar"
              :src="player.avatarUrl"
              :alt="player.name"
              @error="markBroken(player.avatarUrl)"
            />

            <div class="player-info">
              <span class="player-name">
                {{ player.name || '未知召唤师' }}
                <span v-if="player.isSelf" class="tag-self">我</span>
              </span>
              <span class="player-sub">
                {{ player.championName || '未选英雄' }}
                <span v-if="player.rankText" class="player-rank">{{ player.rankText }}</span>
                <span v-if="player.level > 0" class="player-level">Lv.{{ player.level }}</span>
              </span>
            </div>

            <!-- 评分:进选人就有 —— 不用再一个个点「查战绩」 -->
            <div class="player-score" :title="player.scoreTitle">
              <span v-if="player.scoreState === 'loading'" class="score-pending">算分中…</span>
              <template v-else-if="player.scoreState === 'value'">
                <span class="score-value">{{ player.scoreValue }}</span>
                <span class="score-meta">{{ player.scoreMeta }}</span>
              </template>
              <span v-else-if="player.scoreState === 'none'" class="score-none">无排位</span>
              <span v-else class="score-unknown" title="没拉到这个人最近的对局">—</span>
            </div>

            <el-button
              v-if="player.summonerId > 0"
              class="lookup-btn"
              size="small"
              text
              @click="goLookup(player)"
            >
              查战绩
            </el-button>
          </div>
        </div>
      </div>

      <p class="hint">
        <template v-if="!enemyKnown">
          选人阶段只拿得到<strong>我方</strong> —— 对方的身份客户端不给,得等开局。
        </template>
        <template v-else-if="phaseLabel === '对局结束'">
          这一局已经结束,上面是刚才那局的两队人。
        </template>
        分数是<strong>自动算</strong>的 —— 最近 10 场排位的评分。
        这个分走的是<strong>腾讯的对局服务</strong> —— 客户端给不了别人的战绩。
        点「查战绩」会跳到<strong>战绩查询</strong>页,看这个人的全部对局。
      </p>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { ChampSelectSession, OpponentsSnapshot } from '../../../../shared/match';
import { buildRoster, type RosterPlayer } from '../../../../shared/roster';
import { queueLabel as formatQueueLabel } from '../../../../shared/rankLabels';
import { lcuPhaseLabel } from '../../../../shared/gameLabels';
import { useBrokenIcons } from '../../composables/useBrokenIcons';
import {
  describeRosterScore,
  useRosterScores,
  type RosterScoreState
} from '../../composables/useRosterScores';

const props = defineProps<{
  snapshot: OpponentsSnapshot | null;
  /** 选人会话 —— 有它就说明在选人阶段,那时候只有我方拿得到 */
  champSelect?: ChampSelectSession | null;
  loading?: boolean;
}>();

const emit = defineEmits<{ refresh: [] }>();

const router = useRouter();
const { isBroken, markBroken } = useBrokenIcons();

const queueLabel = computed<string>(() =>
  props.snapshot?.queueType ? formatQueueLabel(props.snapshot.queueType) : ''
);

/**
 * 这一局的状态。
 * gameflow 没给阶段,但选人会话在 —— 那就是选人阶段。
 */
const phaseLabel = computed<string>(() => {
  const phase = props.snapshot?.phase ?? '';
  if (phase) return lcuPhaseLabel(phase);
  return props.champSelect ? lcuPhaseLabel('ChampSelect') : '';
});

/** 卡上该显示的人:选人阶段是我方,其余时候是两队人。 */
const roster = computed<RosterPlayer[]>(() =>
  buildRoster(props.snapshot?.opponents ?? [], props.champSelect ?? null)
);

/**
 * 每个人的评分。
 *
 * 分数走腾讯的对局服务 —— 客户端那层只给得出自己的战绩,所以每个人都要
 * 单独拉一次(带缓存和并发限流,见 useRosterScores)。
 */
const { scores, loading, refresh: refreshScores } = useRosterScores(() => roster.value);

/** 点「刷新」:名单和分数一起重来 —— 分数挂了三次就放弃,这是唯一的手动出口。 */
function onRefresh(): void {
  refreshScores();
  emit('refresh');
}

/** 一行玩家 —— 多带一个评分那一列要显示的东西。 */
interface ScoredPlayer extends RosterPlayer {
  scoreState: RosterScoreState;
  scoreValue: string;
  scoreMeta: string;
  scoreTitle: string;
}

const scoredRoster = computed<ScoredPlayer[]>(() =>
  roster.value.map((player) => {
    const display = describeRosterScore(player.puuid, scores.value, loading.value);
    return {
      ...player,
      scoreState: display.state,
      scoreValue: display.value,
      scoreMeta: display.meta,
      scoreTitle: display.title
    };
  })
);

/** 对面看得见吗?选人阶段看不见。 */
const enemyKnown = computed<boolean>(
  () =>
    !props.champSelect && (props.snapshot?.opponents ?? []).some((p) => p.side === 'enemy')
);

/**
 * 卡标题。
 * 只列得出我方的时候不写「对局双方」 —— 写着两队、只给一队,是在骗人。
 */
const cardTitle = computed<string>(() =>
  roster.value.length > 0 && !enemyKnown.value ? '我方队友' : '对局双方'
);

const sides = computed<{ key: string; title: string; players: ScoredPlayer[] }[]>(() => {
  const players = scoredRoster.value;
  return [
    { key: 'ally', title: '我方', players: players.filter((p) => p.side === 'ally') },
    { key: 'enemy', title: '对方', players: players.filter((p) => p.side === 'enemy') }
  ].filter((group) => group.players.length > 0);
});

/** 跳到战绩查询页,顺便把要查的人带过去。 */
function goLookup(player: RosterPlayer): void {
  void router.push({
    path: '/players',
    query: { sid: String(player.summonerId), puuid: player.puuid }
  });
}
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
.phase-tag {
  font-size: 10px;
  color: var(--hx-gold);
  padding: 0 5px;
  border: 1px solid var(--hx-line);
}
.refresh-btn {
  margin-left: auto;
  color: var(--hx-blue);
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
}
.empty-text strong {
  color: var(--hx-text-dim);
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
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--hx-line-strong);
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
  display: flex;
  align-items: center;
  gap: 8px;
}
.player-rank {
  color: var(--hx-gold);
}
.player-level {
  color: var(--hx-text-dim);
}
/* 评分 —— 右边一列,跟「查战绩」按钮分开 */
.player-score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 76px;
  margin-left: auto;
}
.score-value {
  font-size: 15px;
  line-height: 1.1;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.score-meta {
  font-size: 10px;
  color: var(--hx-text-faint);
  letter-spacing: 0.06em;
}
.score-pending,
.score-none,
.score-unknown {
  font-size: 11px;
  color: var(--hx-text-faint);
  letter-spacing: 0.08em;
}
/* 拉不到 —— 比「无排位」更淡,那不是「没打排位」,是「没问到」 */
.score-unknown {
  opacity: 0.55;
}
.lookup-btn {
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
