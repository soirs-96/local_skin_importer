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
          <el-button class="hx-gold" :loading="lcuChecking" @click="onCheckLcu">检测客户端</el-button>
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
      <div v-if="lastSyncResult" class="sync-result">
        上次同步:新增 {{ lastSyncResult.added }} 款 · 更新 {{ lastSyncResult.updated }} 款 ·
        当前共 {{ lastSyncResult.totalOwned }} 款
      </div>
    </el-card>

    <button type="button" class="version-entry" @click="openDevPanel">{{ APP_VERSION }}</button>

    <SkinOverviewDialog ref="overviewRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { ElNotification } from 'element-plus';
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
  OwnedDataSource,
  SyncOutcome,
  SyncResult
} from '../../../preload/index';

type LcuState = 'disconnected' | 'running' | 'error';

const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);
const log = useLogStore();
const { openDevPanel } = useDevEntry();

const lcuStatus = ref<LcuStatus>({ running: false });
const lcuChecking = ref<boolean>(false);
const fetchingSkins = ref<boolean>(false);
const syncing = ref<boolean>(false);

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
  return '未检测到游戏客户端';
});

const canSync = computed<boolean>(
  () => loggedIn.value && lcuStatus.value.running === true && skinCount.value > 0 && !syncing.value
);

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

async function onCheckLcu(): Promise<void> {
  lcuChecking.value = true;
  lastFetchError.value = null;
  try {
    const s = await window.api.checkLcu();
    lcuStatus.value = s;
    pushLog('INFO', `LCU check: running=${s.running}${s.error ? ` error=${s.error}` : ''}`);
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
    const { summoner, ownedSkinIds } = lastFetchedSkins.value;
    const outcome: SyncOutcome = await window.api.sync({
      puuid: summoner.puuid,
      summonerName: summoner.displayName,
      ownedSkinIds,
      mode: isAuto ? 'auto' : 'manual'
    });

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
  } catch (e: unknown) {
    const msg = describeError(e);
    pushLog('ERROR', `Sync failed: ${msg}`);
    // 自动同步是静默的:用户没主动要求,失败不弹窗打扰他
    if (!isAuto) {
      notifyError('同步失败', msg);
    }
  } finally {
    syncing.value = false;
  }
}

onMounted(async () => {
  await auth.refresh();
  await onCheckLcu();
  if (lcuStatus.value.running) {
    await onFetchSkins();
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
