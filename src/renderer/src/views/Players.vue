<template>
  <div class="players-view">
    <PlayerLookupCard
      v-model="keyword"
      :result="lookupResult"
      :loading="lookupLoading"
      @search="onSearch"
    />

    <OpponentsCard
      :snapshot="opponents"
      :loading="opponentsLoading"
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

/** 从对手列表点「查资料」:按游戏 ID 查。 */
async function onLookupOpponent(summonerId: number): Promise<void> {
  keyword.value = String(summonerId);
  await onSearch(keyword.value);
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
