<template>
  <div class="match-view">
    <MatchStatusCard :snapshot="snapshot" :loading="refreshing" @refresh="onRefresh" />

    <ChampSelectCard v-if="champSelect" :session="champSelect" />

    <RecommendationCard :available="canRecommend" />

    <div class="two-col">
      <RankedCard :entries="snapshot?.ranked ?? []" />
      <RecentMatchesCard :summary="snapshot?.recent ?? null" />
    </div>

    <LlmSettingsCard />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import MatchStatusCard from '../components/match/MatchStatusCard.vue';
import ChampSelectCard from '../components/match/ChampSelectCard.vue';
import RankedCard from '../components/match/RankedCard.vue';
import RecentMatchesCard from '../components/match/RecentMatchesCard.vue';
import RecommendationCard from '../components/match/RecommendationCard.vue';
import LlmSettingsCard from '../components/match/LlmSettingsCard.vue';
import type { MatchSnapshot } from '../../../shared/match';

// shallowRef: 快照是主进程 structured-clone 过来的对象,不需要深层响应式,
// 而且深层代理过的对象再往下传容易出问题。
const snapshot = shallowRef<MatchSnapshot | null>(null);
const refreshing = ref<boolean>(false);

let unsubscribe: (() => void) | null = null;

const champSelect = computed(() => snapshot.value?.champSelect ?? null);

// 没选位置就没法给出「按位置推荐」,按钮先置灰。
const canRecommend = computed<boolean>(() => Boolean(champSelect.value?.myRole));

async function onRefresh(): Promise<void> {
  refreshing.value = true;
  try {
    snapshot.value = await window.api.refreshMatchState();
  } catch (e: unknown) {
    console.warn('refresh match state failed', e);
  } finally {
    refreshing.value = false;
  }
}

onMounted(async () => {
  try {
    snapshot.value = await window.api.getMatchState();
  } catch (e: unknown) {
    console.warn('get match state failed', e);
  }
  unsubscribe = window.api.onMatchState((next) => {
    snapshot.value = next;
  });
});

onUnmounted(() => {
  unsubscribe?.();
  unsubscribe = null;
});
</script>

<style scoped>
.match-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
.two-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
