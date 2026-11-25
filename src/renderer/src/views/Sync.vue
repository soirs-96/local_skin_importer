<template>
  <div class="sync-view">
    <el-card class="status-card" shadow="never">
      <div class="status-row">
        <div class="status-left">
          <StatusDot :state="lcuState" :label="lcuTooltip" />
          <span class="hx-diamond" />
          <span class="status-label hx-label">游戏客户端</span>
        </div>
        <div class="status-actions">
          <el-button
            class="hx-gold"
            :loading="lcuChecking"
            @click="onCheckLcu(true)"
          >
            检测客户端
          </el-button>
        </div>
      </div>
      <div v-if="lcuStatus.running" class="summoner-row">
        <div class="summoner-field">
          <span class="field-label hx-label">当前账号</span>
          <span class="field-value">{{ lcuStatus.summoner?.displayName ?? '—' }}</span>
        </div>
      </div>
    </el-card>

    <el-card class="skins-card" shadow="never">
      <div class="skins-row">
        <div class="skins-info">
          <span class="skins-label hx-label">已拥有皮肤</span>
          <span class="skins-count">{{ skinCount }}</span>
          <span
            v-if="ownedSourceLabel"
            class="skins-source"
            :class="ownedSource === 'inventory' ? 'is-live' : 'is-degraded'"
          >{{ ownedSourceLabel }}</span>
        </div>
        <el-button
          type="primary"
          :loading="fetchingSkins"
          :disabled="!lcuStatus.running"
          @click="onFetchSkins"
        >
          读取我的皮肤
        </el-button>
      </div>
    </el-card>

    <el-card class="overview-card" shadow="never">
      <div class="overview-row">
        <div class="overview-info">
          <span class="overview-label hx-label">皮肤图鉴</span>
          <span class="overview-meta">浏览全部皮肤,已拥有的会高亮显示</span>
        </div>
        <div class="overview-actions">
          <el-button class="hx-gold" @click="openOverview">浏览图鉴</el-button>
        </div>
      </div>
    </el-card>

    <el-card v-if="loggedIn" class="sync-card" shadow="never">
      <div class="sync-row">
        <div class="sync-info">
          <span class="sync-label hx-label">同步到小程序</span>
          <span class="sync-meta">把已拥有的皮肤同步到微信小程序的收藏册</span>
        </div>
        <div class="sync-actions">
          <el-button
            type="primary"
            :loading="syncing"
            :disabled="!canSync"
            @click="onSync()"
          >
            立即同步
          </el-button>
        </div>
      </div>
      <div class="binding-row">
        <span class="field-label hx-label">当前绑定</span>
        <span class="field-value">{{ bindingLabel }}</span>
        <el-button
          class="hx-gold"
          size="small"
          :loading="rebinding"
          :disabled="!canRebind"
          @click="onRebind()"
        >
          更换绑定账号
        </el-button>
      </div>
      <div v-if="accountMismatch" class="binding-hint">
        游戏客户端现在是「{{ localAccountId }}」,跟绑着的不是同一个 —— 直接同步会被后端拒,点「更换绑定账号」改绑。
      </div>
      <div v-if="lastSyncResult" class="sync-result">
        上次同步:新增 {{ lastSyncResult.added }} 款 · 更新 {{ lastSyncResult.updated }} 款 ·
        当前共 {{ lastSyncResult.totalOwned }} 款
      </div>
      <div v-if="topChampionsLabel" class="sync-result">
        本命英雄 {{ topChampions.length }} 个({{ topChampionsLabel }})—— 收藏册按熟练度把它们排在前面
      </div>
      <div v-if="matchProfileLabel" class="sync-result">
        {{ matchProfileLabel }} —— 找搭子时按这个匹配
      </div>
    </el-card>

    <button type="button" class="version-entry" @click="openDevPanel">{{ APP_VERSION }}</button>

    <SkinOverviewDialog ref="overviewRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { ElMessageBox, ElNotification } from 'element-plus';
import { storeToRefs } from 'pinia';
import StatusDot from '../components/StatusDot.vue';
import SkinOverviewDialog from '../components/SkinOverviewDialog.vue';
import { APP_VERSION } from '../config/dev';
import { useDevEntry } from '../composables/useDevEntry';
import { useAuthStore } from '../stores/auth';
import { useLogStore, type LogLevel } from '../stores/log';
import type {
  FetchSkinsResult,
  LcuStatus,
  MatchProfile,
  OwnedDataSource,
  SyncOutcome,
  SyncPayload,
  SyncResult,
  TopChampion
} from '../../../preload/index';
import type { BindingInfo } from '../../../shared/binding';
import { parseSyncError } from '../../../shared/syncErrors';
import { positionCodeLabel } from '../../../shared/matchProfile';
import { formatRankDisplay } from '../../../shared/rankLabels';

type LcuState = 'disconnected' | 'running' | 'error';

const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);
const log = useLogStore();
const { openDevPanel } = useDevEntry();

const lcuStatus = ref<LcuStatus>({ running: false });
const lcuChecking = ref<boolean>(false);
const fetchingSkins = ref<boolean>(false);
const syncing = ref<boolean>(false);
const rebinding = ref<boolean>(false);

/**
 * 当前绑的是哪个 LOL 账号。
 *
 * shallowRef: 这个对象整个来自 IPC,深度 reactive 的代理对象结构化克隆不了。
 */
const binding = shallowRef<BindingInfo | null>(null);

const skinCount = ref<number>(0);
const lastFetchError = ref<Error | null>(null);
// shallowRef: we hand this object straight to IPC. Vue's deep `reactive()` proxy
// is not always structured-cloneable and produces "An object could not be cloned"
// when the array is forwarded to the main process.
const lastFetchedSkins = shallowRef<FetchSkinsResult | null>(null);

const lastSyncResult = ref<SyncResult | null>(null);
/** 已拥有集合的数据来源:库存端点(权威)还是商城目录(降级) */
const ownedSource = ref<OwnedDataSource | null>(null);
const catalogFiltered = ref<boolean>(true);
/**
 * 本命英雄(熟练度前 15)—— 同步时一起传给后端,收藏册按它排序。
 *
 * shallowRef: 这个数组要整个丢进 IPC,深度 `reactive()` 的代理对象
 * 结构化克隆不了,会报 "An object could not be cloned"。
 */
const topChampions = shallowRef<TopChampion[]>([]);
/**
 * 排位段位 + 主玩位置 —— 同步时一起报给后端,后端靠这两样筛同区搭子。
 *
 * shallowRef: 跟本命英雄同理,这份对象要整个丢进 IPC。
 */
const matchProfile = shallowRef<MatchProfile>({ ranked: [], positions: [] });

const ownedSourceLabel = computed<string>(() => {
  if (ownedSource.value === 'inventory') return '实时读取自游戏客户端';
  if (ownedSource.value === 'store') {
    return catalogFiltered.value ? '备用来源(降级)' : '备用来源(未与图鉴比对)';
  }
  return '';
});

// 皮肤总览弹窗自己管 visible,通过 ref 调 open()
const overviewRef = ref<InstanceType<typeof SkinOverviewDialog> | null>(null);

function openOverview(): void {
  overviewRef.value?.open();
}

const lcuState = computed<LcuState>(() => {
  if (lastFetchError.value) return 'error';
  if (lcuStatus.value.running) return 'running';
  return 'disconnected';
});

const lcuTooltip = computed<string>(() => {
  if (lcuState.value === 'error') {
    return lastFetchError.value?.message ?? '游戏客户端连接失败';
  }
  if (lcuState.value === 'running') {
    return '游戏客户端已连接';
  }
  // 灰色只说明「没检测到」,后端给的是一句能照着做的中文结论。
  return lcuStatus.value.summary ?? lcuStatus.value.error ?? '未检测到游戏客户端';
});

const canSync = computed<boolean>(
  () => loggedIn.value && lcuStatus.value.running === true && skinCount.value > 0 && !syncing.value
);

/** 「当前绑定」那一行显示什么。 */
const bindingLabel = computed<string>(() => {
  const b = binding.value;
  if (!b) return '—';
  if (!b.bound) return '未绑定';
  return b.boundAccount ?? '已绑定';
});

/** 本机客户端这个账号的 Riot ID(名字#标签)。 */
const localAccountId = computed<string>(() => {
  const summoner = lastFetchedSkins.value?.summoner;
  if (!summoner) return '';
  const tag = summoner.tagLine ? `#${summoner.tagLine}` : '';
  return `${summoner.displayName}${tag}`;
});

/** 客户端这个账号是不是就是现在绑着的那个 —— 是的话没必要再改绑。 */
const sameAsBound = computed<boolean>(() => {
  const b = binding.value;
  if (!b?.bound || !b.boundAccount) return false;
  return b.boundAccount === localAccountId.value;
});

/**
 * 客户端这个账号跟已绑定的不是一个 —— 同步会撞 409,先提醒一句。
 *
 * <p>绑定信息里没记账号名(老用户 / 没走过改绑)时不做判断,免得误报。
 */
const accountMismatch = computed<boolean>(() => {
  const b = binding.value;
  if (!b?.bound || !b.boundAccount) return false;
  if (!localAccountId.value) return false;
  return b.boundAccount !== localAccountId.value;
});

const canRebind = computed<boolean>(
  () => canSync.value && !rebinding.value && !sameAsBound.value
);

/** 本命英雄的前几个名字,给界面上一行提示用。 */
const topChampionsLabel = computed<string>(() =>
  topChampions.value
    .slice(0, 3)
    .map((item) => item.championName)
    .filter((name) => name !== '')
    .join('、')
);

/** 一行说清楚「我的段位 + 我主玩什么位」—— 找搭子时按这个匹配。 */
const matchProfileLabel = computed<string>(() => {
  const parts: string[] = [];
  const solo = matchProfile.value.ranked.find((r) => r.queueType === 'RANKED_SOLO_5x5');
  const flex = matchProfile.value.ranked.find((r) => r.queueType === 'RANKED_FLEX_5x5');
  const rank = solo ?? flex;
  if (rank) parts.push(`段位 ${formatRankDisplay(rank.tier, rank.division)}`);
  const positions = matchProfile.value.positions
    .map((p) => positionCodeLabel(p.position))
    .filter((label) => label !== '');
  if (positions.length > 0) parts.push(`主玩 ${positions.join('、')}`);
  return parts.join(' · ');
});

function pushLog(level: LogLevel, msg: string): void {
  log.push(level, msg);
}

function notifyError(title: string, message: string): void {
  ElNotification({
    title,
    message,
    type: 'error',
    duration: 6000
  });
}

function describeError(e: unknown): string {
  const err = e as { message?: string };
  return err.message ?? '未知错误';
}

async function onCheckLcu(deep = false): Promise<void> {
  lcuChecking.value = true;
  lastFetchError.value = null;
  try {
    const s = await window.api.checkLcu(deep);
    lcuStatus.value = s;
    pushLog(
      'INFO',
      `LCU check(deep=${deep}): running=${s.running}` +
        `${s.code ? ' code=' + s.code : ''}${s.summary ? ' summary=' + s.summary : ''}`
    );
    if (s.error) {
      lastFetchError.value = new Error(s.error);
    }
  } catch (e: unknown) {
    const msg = describeError(e);
    lastFetchError.value = new Error(msg);
    pushLog('ERROR', `LCU check failed: ${msg}`);
    notifyError('检测游戏客户端失败', msg);
  } finally {
    lcuChecking.value = false;
  }
}

async function onFetchSkins(): Promise<void> {
  fetchingSkins.value = true;
  try {
    const result = await window.api.fetchSkins();
    lcuStatus.value = {
      running: true,
      summoner: result.summoner
    };
    skinCount.value = result.ownedSkinIds.length;
    ownedSource.value = result.source;
    catalogFiltered.value = result.catalogFiltered;
    lastFetchedSkins.value = result;
    pushLog(
      'INFO',
      `Fetched ${skinCount.value} owned skins (${result.source}) for ${result.summoner.displayName}`
    );
  } catch (e: unknown) {
    const msg = describeError(e);
    pushLog('ERROR', `Fetch skins failed: ${msg}`);
    notifyError('读取皮肤失败', msg);
  } finally {
    fetchingSkins.value = false;
  }
}

/**
 * 取本命英雄(熟练度前 15)。
 *
 * 跟皮肤同步走同一个请求发到后端 —— 后端收藏册按这份名单把英雄排到前面。
 * 熟练度只在打完一局之后才变,所以启动时取一次就够了,不用每次同步都重取。
 */
async function onFetchTopChampions(): Promise<void> {
  try {
    topChampions.value = await window.api.getTopChampions();
    pushLog('INFO', `本命英雄 ${topChampions.value.length} 个`);
  } catch (e: unknown) {
    // 取不到熟练度不影响皮肤同步 —— 只是收藏册不排序而已
    pushLog('WARN', `读取本命英雄失败: ${describeError(e)}`);
  }
}

/**
 * 取排位段位 + 主玩位置。
 *
 * 跟皮肤一起报给后端 —— 后端靠这两样筛「分数差不多、位置对得上」的搭子。
 * 取不到不影响同步:后端保持库里的旧值不动,匹配那边少一半条件而已。
 */
async function onFetchMatchProfile(): Promise<void> {
  try {
    matchProfile.value = await window.api.getMatchProfile();
    pushLog(
      'INFO',
      `段位 ${matchProfile.value.ranked.length} 条 · 主玩位置 ${matchProfile.value.positions.length} 个`
    );
  } catch (e: unknown) {
    pushLog('WARN', `读取段位/位置失败: ${describeError(e)}`);
  }
}

async function onSync(options: { auto?: boolean } = {}): Promise<void> {
  const isAuto = options.auto === true;
  if (!lastFetchedSkins.value) {
    // 自动模式下没有皮肤列表说明游戏客户端没开,静默跳过
    if (isAuto) {
      pushLog('WARN', 'Auto sync skipped: no skins fetched');
      return;
    }
    ElNotification({
      title: '还不能同步',
      message: '请先读取我的皮肤',
      type: 'warning',
      duration: 4000
    });
    return;
  }
  syncing.value = true;
  try {
    const outcome: SyncOutcome = await window.api.sync(
      buildSyncPayload(lastFetchedSkins.value, isAuto ? 'auto' : 'manual')
    );

    if (outcome.skipped) {
      pushLog('INFO', 'Sync skipped: 刚刚已同步过');
      if (!isAuto) {
        ElNotification({
          title: '跳过本次同步',
          message: '刚刚已经同步过一次,稍后再试',
          type: 'info',
          duration: 4000
        });
      }
      return;
    }

    lastSyncResult.value = outcome.result;
    if (outcome.result) {
      skinCount.value = outcome.result.totalOwned;
      pushLog(
        'INFO',
        `Sync OK: added=${outcome.result.added} updated=${outcome.result.updated} totalOwned=${outcome.result.totalOwned}`
      );
    }
    await refreshBinding();
  } catch (e: unknown) {
    const { puidMismatch, message } = parseSyncError(e);
    pushLog('ERROR', `Sync failed: ${message}`);
    // 自动同步是静默的:用户没主动要求,失败不弹窗打扰他
    if (!isAuto) {
      if (puidMismatch) {
        // 绑错了账号 —— 引导改绑,别只丢一句「请联系管理员」
        await onRebind();
        return;
      }
      notifyError('同步失败', message);
    }
  } finally {
    syncing.value = false;
  }
}

/** 同步 / 改绑的载荷 —— 两个接口一模一样。 */
function buildSyncPayload(source: FetchSkinsResult, mode: 'auto' | 'manual' = 'manual'): SyncPayload {
  const { summoner, ownedSkinIds, gameZone } = source;
  return {
    puuid: summoner.puuid,
    summonerName: summoner.displayName,
    ownedSkinIds,
    topChampions: topChampions.value,
    // 段位 + 主玩位置 —— 后端拿来筛同区搭子
    ranked: matchProfile.value.ranked,
    positions: matchProfile.value.positions,
    mode,
    // 昵称 / 召唤师ID / 大区一起上去 —— 后端顺手回填小程序,用户不用手填
    summonerTag: summoner.tagLine,
    gameZone
  };
}

/** 拉一次绑定信息 —— 「当前绑的是哪个 LOL 账号」。 */
async function refreshBinding(): Promise<void> {
  if (!loggedIn.value) {
    binding.value = null;
    return;
  }
  try {
    binding.value = await window.api.getBindingInfo();
  } catch (e: unknown) {
    // 拉不到不影响同步 —— 只是界面上看不到「当前绑定」
    pushLog('WARN', `读取绑定信息失败: ${parseSyncError(e).message}`);
  }
}

/** 改绑前的确认 —— 清数据是不可逆的,得让用户看清楚。 */
async function confirmRebind(): Promise<boolean> {
  const bound = binding.value?.boundAccount ?? '另一个 LOL 账号';
  const current = localAccountId.value || '当前账号';
  try {
    await ElMessageBox.confirm(
      `你的收藏册当前绑的是「${bound}」,游戏客户端现在是「${current}」。` +
        `改绑会清空「${bound}」已同步的皮肤数据,并按「${current}」重新同步。`,
      '更换绑定的 LOL 账号',
      {
        type: 'warning',
        confirmButtonText: '确认改绑',
        cancelButtonText: '取消'
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 改绑 —— 绑错了 LOL 账号时换绑到另一个账号。
 *
 * <p>破坏性操作:旧账号的皮肤数据会被清掉,不可撤销。
 */
async function onRebind(): Promise<void> {
  const fetched = lastFetchedSkins.value;
  if (!fetched) {
    ElNotification({
      title: '还不能改绑',
      message: '请先读取我的皮肤',
      type: 'warning',
      duration: 4000
    });
    return;
  }
  if (sameAsBound.value) {
    ElNotification({
      title: '不用改绑',
      message: '当前绑的就是游戏客户端这个账号',
      type: 'info',
      duration: 4000
    });
    return;
  }
  if (!(await confirmRebind())) {
    pushLog('INFO', 'Rebind cancelled by user');
    return;
  }

  rebinding.value = true;
  try {
    const outcome: SyncOutcome = await window.api.rebind(buildSyncPayload(fetched));
    if (outcome.result) {
      lastSyncResult.value = outcome.result;
      skinCount.value = outcome.result.totalOwned;
    }
    await refreshBinding();
    pushLog('INFO', `Rebind OK: totalOwned=${outcome.result?.totalOwned ?? 0}`);
    ElNotification({
      title: '改绑完成',
      message: `已改绑到 ${fetched.summoner.displayName},收藏册已按新账号重建`,
      type: 'success',
      duration: 5000
    });
  } catch (e: unknown) {
    const { message } = parseSyncError(e);
    pushLog('ERROR', `Rebind failed: ${message}`);
    notifyError('改绑失败', message);
  } finally {
    rebinding.value = false;
  }
}

onMounted(async () => {
  await auth.refresh();
  await refreshBinding();
  // 挂载时的自动检查走浅检测 —— 每次开界面都扫全盘太重。
  // 用户手点按钮才是深检测。
  await onCheckLcu();
  if (lcuStatus.value.running) {
    await onFetchSkins();
    await onFetchTopChampions();
    await onFetchMatchProfile();
    if (loggedIn.value) {
      await onSync({ auto: true });
    }
  }
});
</script>

<style scoped>
.sync-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 720px;
  margin: 0 auto;
}
.status-row,
.skins-row,
.sync-row,
.overview-row {
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
.status-label {
  font-weight: 500;
}
.summoner-row {
  display: flex;
  gap: 24px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.summoner-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-value {
  font-size: 14px;
  color: var(--hx-text);
}
.skins-info,
.sync-info,
.overview-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skins-count {
  font-size: 28px;
  font-weight: 600;
  color: var(--hx-gold);
}

.skins-source {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--hx-text-dim);
}
/* 实时库存数据 = 魔法蓝;降级到商城目录 = 金色(提醒) */
.skins-source.is-live {
  color: var(--hx-blue);
}
.skins-source.is-degraded {
  color: var(--hx-gold);
}
.sync-meta {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--hx-text-faint);
}
.overview-meta {
  font-size: 13px;
  color: var(--hx-text-dim);
}
.sync-result {
  margin-top: 12px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--hx-gold);
}
.binding-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.binding-row .field-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 绑着的跟客户端不是一个账号 —— 提醒用户改绑,别等同步被拒 */
.binding-hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--hx-gold);
}
/* 版本号:平时几乎看不见,点它可以进开发者模式 */
.version-entry {
  align-self: center;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--hx-text-faint);
  font-size: 10px;
  letter-spacing: 0.18em;
  font-family: monospace;
  opacity: 0.45;
}
.version-entry:hover {
  color: var(--hx-gold);
  opacity: 0.9;
}
</style>
