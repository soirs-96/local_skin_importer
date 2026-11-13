<template>
  <div class="players-view">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="search"
        placeholder="名字#标签 或 游戏 ID"
        clearable
        @keyup.enter="onSearch"
      >
        <template #prefix>
          <span class="hx-diamond" />
        </template>
      </el-input>
      <el-button type="primary" :loading="searching" @click="onSearch">查询</el-button>

      <span class="spacer" />

      <el-button class="hx-gold" size="small" :disabled="!selfSummonerId" @click="backToMe">
        回到我
      </el-button>
      <el-button
        class="hx-gold"
        size="small"
        :loading="gamesLoading"
        :disabled="!currentPuuid"
        @click="reloadGames"
      >
        刷新
      </el-button>
    </div>

    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>

    <template v-if="profile">
      <PlayerProfileHeader :profile="profile" @copy="copyId" />

      <PlayerRankedTable v-if="profile.ranked.length > 0" :entries="profile.ranked" />
    </template>

    <PlayerScoreCard v-if="scoreSummary.games > 0" :summary="scoreSummary" />

    <PlayerGameList
      v-if="profile || games.length > 0 || gamesLoading || gamesError"
      :games="games"
      :loading="gamesLoading"
      :error="gamesError"
      :loading-more="loadingMore"
      :can-load-more="canLoadMore"
      :scores="scoreIndex"
      @load-more="loadMore"
      @select-peer="onSelectPeer"
    />

    <div v-if="!profile && games.length === 0 && !gamesLoading && !gamesError && !notice" class="placeholder">
      <p class="placeholder-title">查任意玩家</p>
      <p>资料来自<strong>游戏客户端</strong>,历史战绩来自<strong>腾讯的对局服务</strong> —— 两者都能查任意玩家。</p>
      <p class="placeholder-hint">名字要带标签,格式「名字#标签」;也可以直接输入游戏 ID。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElNotification } from 'element-plus';
import PlayerProfileHeader from '../components/match/PlayerProfileHeader.vue';
import PlayerRankedTable from '../components/match/PlayerRankedTable.vue';
import PlayerGameList from '../components/match/PlayerGameList.vue';
import PlayerScoreCard from '../components/match/PlayerScoreCard.vue';
import { buildScoreIndex, summarizePlayerScores } from '../../../shared/scoring';
import type { PlayerGame, PlayerLookup, PlayerPeer } from '../../../shared/match';

const PAGE_SIZE = 20;

const route = useRoute();
const router = useRouter();

const keyword = ref<string>('');
const profile = shallowRef<PlayerLookup | null>(null);
const games = shallowRef<PlayerGame[]>([]);
const searching = ref<boolean>(false);
const gamesLoading = ref<boolean>(false);
const gamesError = ref<string | null>(null);
const loadingMore = ref<boolean>(false);
const notice = ref<string>('');
/** 软提示:不算错,但用户得知道少了点什么(比如只查到了战绩、没查到资料)。 */
const hint = ref<string>('');

/** 上次加载的是哪一组路由参数 —— 用来挡掉重复加载。 */
let loadedKey = '';

/** 自己的游戏 ID —— 「回到我」用它。 */
const selfSummonerId = ref<number>(0);

/** 当前正在看的人的 puuid —— 资料查不到时靠它(腾讯的 puuid 照样能拉战绩)。 */
const activePuuid = ref<string>('');

const currentPuuid = computed<string>(() => profile.value?.puuid || activePuuid.value);

/** 成绩单 —— 只统计排位。 */
const scoreSummary = computed(() => summarizePlayerScores(games.value));

/** 每一局的评分 —— 给列表和十人面板用。 */
const scoreIndex = computed(() => buildScoreIndex(games.value));

/** 腾讯那边还有没有下一页:上一页拉满了就还有。 */
const canLoadMore = computed<boolean>(
  () => games.value.length > 0 && games.value.length % PAGE_SIZE === 0 && !gamesError.value
);

async function onSearch(): Promise<void> {
  const query = keyword.value.trim();
  if (!query) return;

  searching.value = true;
  notice.value = '';
  hint.value = '';
  try {
    const result = await window.api.lookupPlayer(query);
    if (!result.found) {
      profile.value = null;
      games.value = [];
      notice.value = result.error ?? '没查到这个玩家';
      return;
    }
    profile.value = result;
    keyword.value = result.riotId || query;
    await applyRoute(result.summonerId, result.puuid);
    if (result.puuid) await loadGames(result.puuid, 0, false);
  } catch (e: unknown) {
    notice.value = describeFailure(e);
  } finally {
    searching.value = false;
  }
}

/**
 * 点对局里的某个人 —— 直接查他的战绩。
 *
 * 先按名字查资料(走客户端的搜人接口),拿不到资料就退一步:
 * 腾讯那边的 puuid 照样能拉战绩,只是少了头像/段位那几行。
 */
async function onSelectPeer(peer: PlayerPeer): Promise<void> {
  const name = peer.displayName;
  if (!name && !peer.puuid) return;

  searching.value = true;
  notice.value = '';
  hint.value = '';
  scrollToTop();
  try {
    if (name) {
      const result = await window.api.lookupPlayer(name);
      if (result.found) {
        profile.value = result;
        keyword.value = result.riotId || name;
        await applyRoute(result.summonerId, result.puuid);
        if (result.puuid) await loadGames(result.puuid, 0, false);
        return;
      }
    }
    // 资料没查到 —— 名字是腾讯那边的写法,客户端的搜人接口未必认这个名字。
    profile.value = null;
    games.value = [];
    if (peer.puuid) {
      await loadGames(peer.puuid, 0, false);
      if (games.value.length > 0) {
        hint.value = `没查到 ${name || peer.puuid} 的资料 —— 客户端搜人接口不认这个名字,下面是腾讯的战绩`;
        await applyRoute(0, peer.puuid);
        return;
      }
    }
    notice.value = '没查到这个玩家';
  } catch (e: unknown) {
    notice.value = describeFailure(e);
  } finally {
    searching.value = false;
  }
}

/** 换人之后回到列表顶部 —— 刚才点的那行可能在很下面。 */
function scrollToTop(): void {
  const el = document.querySelector('.main');
  if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 把当前查的人写进地址栏 —— 刷新页面还在,也能直接分享。 */
async function applyRoute(summonerId: number, puuid: string): Promise<void> {
  const key = `${summonerId}:${puuid}`;
  loadedKey = key;
  await router.replace({
    path: '/players',
    query: { sid: String(summonerId), puuid }
  });
}

async function loadFromRoute(): Promise<void> {
  const sid = Number(route.query.sid ?? 0);
  const routePuuid = String(route.query.puuid ?? '');
  if (!sid && !routePuuid) return;

  const key = `${sid}:${routePuuid}`;
  if (key === loadedKey) return;
  loadedKey = key;

  notice.value = '';
  if (sid > 0) {
    searching.value = true;
    try {
      const result = await window.api.lookupPlayer(String(sid));
      if (!result.found) {
        profile.value = null;
        games.value = [];
        notice.value = result.error ?? '没查到这个玩家';
        return;
      }
      profile.value = result;
      keyword.value = result.riotId || keyword.value;
    } finally {
      searching.value = false;
    }
  }

  const puuid = routePuuid || profile.value?.puuid || '';
  if (puuid) await loadGames(puuid, 0, false);
}

async function loadGames(puuid: string, startIndex: number, append: boolean): Promise<void> {
  if (!puuid) return;
  activePuuid.value = puuid;
  if (append) loadingMore.value = true;
  else gamesLoading.value = true;
  gamesError.value = null;
  try {
    const summary = await window.api.fetchPlayerGames(puuid, startIndex, PAGE_SIZE);
    games.value = append ? [...games.value, ...summary.games] : summary.games;
  } catch (e: unknown) {
    gamesError.value = describeFailure(e);
    if (!append) games.value = [];
  } finally {
    gamesLoading.value = false;
    loadingMore.value = false;
  }
}

function loadMore(): void {
  if (!currentPuuid.value) return;
  void loadGames(currentPuuid.value, games.value.length, true);
}

function reloadGames(): void {
  void loadGames(currentPuuid.value, 0, false);
}

async function backToMe(): Promise<void> {
  try {
    const state = await window.api.getMatchState();
    const sid = state.summoner?.summonerId ?? 0;
    if (!sid) {
      ElNotification({ type: 'warning', message: '没拿到自己的游戏 ID —— 游戏客户端可能没开' });
      return;
    }
    keyword.value = '';
    await router.replace({ path: '/players', query: { sid: String(sid) } });
  } catch (e: unknown) {
    notice.value = describeFailure(e);
  }
}

async function copyId(): Promise<void> {
  const text = profile.value?.riotId || profile.value?.puuid || '';
  if (!text) return;
  await window.api.copyText(text);
  ElNotification({ type: 'success', message: `已复制 ${text}`, duration: 2000 });
}

function describeFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|超时/.test(message)) {
    return '连不上游戏客户端 —— 先把客户端开到主界面';
  }
  return message;
}

watch(() => route.query, () => void loadFromRoute(), { immediate: true });

onMounted(async () => {
  try {
    const state = await window.api.getMatchState();
    selfSummonerId.value = state.summoner?.summonerId ?? 0;
  } catch {
    // 拿不到自己的 ID 只影响「回到我」按钮,不影响别的
  }
});
</script>

<style scoped>
.players-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 28px;
  max-width: 1080px;
  margin: 0 auto;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  background: var(--hx-bg);
  border-bottom: 1px solid var(--hx-line);
}
.search {
  width: 320px;
}
.spacer {
  flex: 1;
}
.notice {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--hx-danger);
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.3);
}
.hint {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--hx-gold);
  background: rgba(200, 170, 110, 0.08);
  border: 1px solid var(--hx-line);
}
.placeholder {
  padding: 40px 24px;
  text-align: center;
  color: var(--hx-text-dim);
  font-size: 13px;
  line-height: 1.9;
}
.placeholder-title {
  font-size: 15px;
  color: var(--hx-gold);
  letter-spacing: 0.16em;
}
.placeholder strong {
  color: var(--hx-text);
}
.placeholder-hint {
  color: var(--hx-text-faint);
}
</style>
