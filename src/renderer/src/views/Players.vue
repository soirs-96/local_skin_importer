<template>
  <div class="players-view">
    <PlayerLookupCard
      v-model="keyword"
      :result="lookupResult"
      :loading="lookupLoading"
      @search="onSearch"
      @clear="onClear"
    />

    <OpponentsCard
      :snapshot="opponents"
      :loading="opponentsLoading"
      :lookups="opponentLookups"
      :expanded-id="expandedOpponentId"
      :loading-id="opponentLoadingId"
      @refresh="loadOpponents"
      @lookup="onLookupOpponent"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import PlayerLookupCard from '../components/match/PlayerLookupCard.vue';
import OpponentsCard from '../components/match/OpponentsCard.vue';
import type { OpponentsSnapshot, PlayerLookup } from '../../../shared/match';

const keyword = ref('');
const lookupResult = shallowRef<PlayerLookup | null>(null);
const lookupLoading = ref<boolean>(false);

const opponents = shallowRef<OpponentsSnapshot | null>(null);
const opponentsLoading = ref<boolean>(false);

/** 按游戏 ID 查到的对手资料 */
const opponentLookups = shallowRef<Record<number, PlayerLookup>>({});
/** 展开了谁 */
const expandedOpponentId = ref<number | null>(null);
/** 正在查谁 */
const opponentLoadingId = ref<number | null>(null);

async function onSearch(query: string): Promise<void> {
  lookupLoading.value = true;
  try {
    lookupResult.value = await window.api.lookupPlayer(query);
  } catch (e: unknown) {
    console.warn('lookup player failed', e);
    lookupResult.value = null;
  } finally {
    lookupLoading.value = false;
  }
}

function onClear(): void {
  keyword.value = '';
  lookupResult.value = null;
}

/**
 * 点对手的「查战绩」:就地在那一行下面展开,**不动上面的搜索框**。
 *
 * 战绩走腾讯的对局服务,资料走客户端 —— 两条路各拉各的,谁先回来谁先显示。
 */
async function onLookupOpponent(summonerId: number): Promise<void> {
  if (expandedOpponentId.value === summonerId) {
    expandedOpponentId.value = null;
    return;
  }
  expandedOpponentId.value = summonerId;
  if (opponentLookups.value[summonerId]) return;

  opponentLoadingId.value = summonerId;
  try {
    const result = await window.api.lookupPlayer(String(summonerId));
    opponentLookups.value = { ...opponentLookups.value, [summonerId]: result };
  } catch (e: unknown) {
    console.warn('lookup opponent failed', e);
  } finally {
    opponentLoadingId.value = null;
  }
}

async function loadOpponents(): Promise<void> {
  opponentsLoading.value = true;
  try {
    opponents.value = await window.api.getOpponents();
  } catch (e: unknown) {
    console.warn('get opponents failed', e);
    opponents.value = null;
  } finally {
    opponentsLoading.value = false;
  }
}

onMounted(() => {
  void loadOpponents();
});
</script>

<style scoped>
.players-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
</style>
