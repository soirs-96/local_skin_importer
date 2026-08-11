<template>
  <div class="sync-view">
    <el-card class="status-card" shadow="never">
      <div class="status-row">
        <div class="status-left">
          <StatusDot :state="lcuState" :label="lcuTooltip" />
          <span class="status-label">League Client</span>
        </div>
        <div class="status-actions">
          <el-button :loading="lcuChecking" @click="onCheckLcu">Check LCU</el-button>
        </div>
      </div>
      <div v-if="lcuStatus.running" class="summoner-row">
        <div class="summoner-field">
          <span class="field-label">Summoner</span>
          <span class="field-value">{{ lcuStatus.summoner?.displayName ?? '—' }}</span>
        </div>
        <div class="summoner-field">
          <span class="field-label">PUUID</span>
          <span class="field-value mono">{{ lcuStatus.summoner?.puuid ?? '—' }}</span>
        </div>
      </div>
    </el-card>

    <el-card class="skins-card" shadow="never">
      <div class="skins-row">
        <div class="skins-info">
          <span class="skins-label">Owned skins</span>
          <span class="skins-count">{{ skinCount }}</span>
        </div>
        <el-button :loading="fetchingSkins" :disabled="!lcuStatus.running" @click="onFetchSkins">
          Fetch skins
        </el-button>
      </div>
    </el-card>

    <el-card v-if="loggedIn" class="sync-card" shadow="never">
      <div class="sync-row">
        <div class="sync-info">
          <span class="sync-label">Sync to backend</span>
          <span class="sync-meta">added / updated / total</span>
        </div>
        <div class="sync-actions">
          <el-button
            type="primary"
            :loading="syncing"
            :disabled="!canSync"
            @click="onSync"
          >
            Sync now
          </el-button>
        </div>
      </div>
      <div v-if="lastSyncResult" class="sync-result">
        Last sync: added={{ lastSyncResult.added }},
        updated={{ lastSyncResult.updated }},
        totalOwned={{ lastSyncResult.totalOwned }}
      </div>
    </el-card>

    <el-card class="log-card" shadow="never">
      <template #header>
        <span class="log-title">Console</span>
      </template>
      <div class="log-panel">
        <div v-if="logs.length === 0" class="log-empty">No events yet.</div>
        <div
          v-for="(line, i) in logs"
          :key="`${line.ts}-${i}`"
          class="log-line"
          :class="`log-level-${line.level}`"
        >
          <span class="log-ts">{{ line.ts }}</span>
          <span class="log-level">{{ line.level }}</span>
          <span class="log-msg">{{ line.msg }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElNotification } from 'element-plus';
import { storeToRefs } from 'pinia';
import StatusDot from '../components/StatusDot.vue';
import { useAuthStore } from '../stores/auth';
import type { FetchSkinsResult, LcuStatus, SyncResult } from '../../../preload/index';

type LcuState = 'disconnected' | 'running' | 'error';
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
}

const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);

const lcuStatus = ref<LcuStatus>({ running: false });
const lcuChecking = ref<boolean>(false);
const fetchingSkins = ref<boolean>(false);
const syncing = ref<boolean>(false);

const skinCount = ref<number>(0);
const lastFetchError = ref<Error | null>(null);
const lastFetchedSkins = ref<FetchSkinsResult | null>(null);

const lastSyncResult = ref<SyncResult | null>(null);
const logs = ref<LogLine[]>([]);

const lcuState = computed<LcuState>(() => {
  if (lastFetchError.value) return 'error';
  if (lcuStatus.value.running) return 'running';
  return 'disconnected';
});

const lcuTooltip = computed<string>(() => {
  if (lcuState.value === 'error') {
    return lastFetchError.value?.message ?? 'LCU error';
  }
  if (lcuState.value === 'running') {
    return 'League client running';
  }
  return 'League client not detected';
});

const canSync = computed<boolean>(
  () => loggedIn.value && lcuStatus.value.running === true && skinCount.value > 0 && !syncing.value
);

function pushLog(level: LogLevel, msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  logs.value.push({ ts, level, msg });
  if (logs.value.length > 200) {
    logs.value.splice(0, logs.value.length - 200);
  }
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
  return err.message ?? 'Unknown error';
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
    notifyError('LCU check failed', msg);
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
    lastFetchedSkins.value = result;
    pushLog('INFO', `Fetched ${skinCount.value} owned skins for ${result.summoner.displayName}`);
  } catch (e: unknown) {
    const msg = describeError(e);
    pushLog('ERROR', `Fetch skins failed: ${msg}`);
    notifyError('Fetch skins failed', msg);
  } finally {
    fetchingSkins.value = false;
  }
}

async function onSync(): Promise<void> {
  if (!lastFetchedSkins.value) {
    ElNotification({
      title: 'Cannot sync',
      message: '请先获取皮肤列表',
      type: 'warning',
      duration: 4000
    });
    return;
  }
  syncing.value = true;
  try {
    const { summoner, ownedSkinIds } = lastFetchedSkins.value;
    const r: SyncResult = await window.api.sync({
      puuid: summoner.puuid,
      summonerName: summoner.displayName,
      ownedSkinIds
    });
    lastSyncResult.value = r;
    skinCount.value = r.totalOwned;
    pushLog(
      'INFO',
      `Sync OK: added=${r.added} updated=${r.updated} totalOwned=${r.totalOwned}`
    );
  } catch (e: unknown) {
    const msg = describeError(e);
    pushLog('ERROR', `Sync failed: ${msg}`);
    notifyError('Sync failed', msg);
  } finally {
    syncing.value = false;
  }
}

onMounted(async () => {
  await auth.refresh();
  await onCheckLcu();
  if (lcuStatus.value.running) {
    await onFetchSkins();
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
.sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.status-left {
  display: flex;
  align-items: center;
  gap: 8px;
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
.field-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.field-value {
  font-size: 14px;
}
.field-value.mono {
  font-family: monospace;
  font-size: 12px;
}
.skins-info,
.sync-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skins-label,
.sync-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.skins-count {
  font-size: 28px;
  font-weight: 600;
}
.sync-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.sync-result {
  margin-top: 12px;
  font-family: monospace;
  font-size: 12px;
  color: var(--el-color-success);
}
.log-title {
  font-weight: 500;
}
.log-panel {
  background: #000;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px;
  height: 220px;
  overflow-y: auto;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: #cbd5e1;
}
.log-empty {
  color: var(--el-text-color-secondary);
  font-style: italic;
}
.log-line {
  display: flex;
  gap: 8px;
  line-height: 1.5;
  word-break: break-all;
}
.log-ts {
  color: #64748b;
}
.log-level {
  width: 50px;
  flex-shrink: 0;
}
.log-level-INFO .log-level {
  color: #94a3b8;
}
.log-level-WARN .log-level {
  color: #facc15;
}
.log-level-ERROR .log-level {
  color: #f87171;
}
</style>
