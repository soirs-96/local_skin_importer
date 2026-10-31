<template>
  <el-dialog
    v-model="visible"
    title="开发者面板"
    width="760px"
    top="6vh"
    class="dev-panel"
    @open="onOpen"
  >
    <div class="dev-body">
      <section class="dev-section">
        <h3 class="hx-label">账号与内部标识</h3>
        <div class="dev-rows">
          <div class="dev-row">
            <span class="dev-key">游戏账号</span>
            <span class="dev-val">{{ summonerName }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">PUUID</span>
            <span class="dev-val mono">{{ puuid }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">客户端端口</span>
            <span class="dev-val mono">{{ port ?? '—' }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">登录凭证预览</span>
            <span class="dev-val mono">{{ tokenPreview ?? '未登录' }}</span>
          </div>
        </div>
      </section>

      <section class="dev-section">
        <h3 class="hx-label">数据诊断</h3>
        <div class="dev-rows">
          <div class="dev-row">
            <span class="dev-key">图鉴条数</span>
            <span class="dev-val mono">{{ catalogSize }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">已拥有(匹配)</span>
            <span class="dev-val mono">{{ stats.ownedMatched }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">拥有数据来源</span>
            <span class="dev-val mono">{{ ownedSource }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">皮肤 ID 覆盖率</span>
            <span class="dev-val mono">{{ coverageText }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">皮肤 ID 字段</span>
            <span class="dev-val mono">{{ skinIdFieldPresent ? '后端已升级' : '后端未升级' }}</span>
          </div>
          <div class="dev-row">
            <span class="dev-key">上次同步</span>
            <span class="dev-val mono">{{ lastSyncText }}</span>
          </div>
        </div>
        <div class="dev-actions">
          <el-button size="small" class="hx-gold" :loading="loading" @click="onReload">
            刷新图鉴
          </el-button>
          <el-button size="small" class="hx-gold" @click="onCopy">复制诊断信息</el-button>
        </div>
      </section>

      <section class="dev-section">
        <h3 class="hx-label">运行记录</h3>
        <div class="dev-log">
          <div v-if="logs.length === 0" class="dev-log-empty">暂无记录</div>
          <div
            v-for="(line, i) in logs"
            :key="`${line.ts}-${i}`"
            class="dev-log-line"
            :class="`level-${line.level}`"
          >
            <span class="dev-log-ts">{{ line.ts }}</span>
            <span class="dev-log-level">{{ line.level }}</span>
            <span class="dev-log-msg">{{ line.msg }}</span>
          </div>
        </div>
      </section>

      <section class="dev-section">
        <h3 class="hx-label">快捷操作</h3>
        <div class="dev-actions">
          <el-button size="small" class="hx-gold" @click="onOpenDevTools">打开开发者工具</el-button>
          <el-button size="small" class="hx-gold" @click="onLogout">清除本机登录状态</el-button>
          <el-button size="small" class="hx-gold" @click="onLock">退出开发者模式</el-button>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { useDevStore } from '../stores/dev';
import { useLogStore } from '../stores/log';
import { parseServerTime } from '../composables/skinCatalogLogic';
import { useSkinCatalog } from '../composables/useSkinCatalog';
import type { LcuStatus } from '../../../preload/index';

const dev = useDevStore();
const log = useLogStore();
const auth = useAuthStore();
const { lines: logs } = storeToRefs(log);
const { tokenPreview } = storeToRefs(auth);

const visible = computed({
  get: () => dev.panelVisible,
  set: (v: boolean) => {
    dev.panelVisible = v;
  }
});

const {
  loading,
  skins,
  ownedSource,
  ownedLastSyncAt,
  skinIdFieldPresent,
  catalogSize,
  stats,
  load
} = useSkinCatalog();

const lcu = ref<LcuStatus>({ running: false });

const summonerName = computed(() => lcu.value.summoner?.displayName ?? '—');
const puuid = computed(() => lcu.value.summoner?.puuid ?? '—');
const port = computed(() => lcu.value.port);

const coverageText = computed(
  () => `${Math.round(stats.value.skinIdCoverage * 1000) / 10}%`
);

const lastSyncText = computed(() => {
  const t = parseServerTime(ownedLastSyncAt.value);
  if (t === null) return '从未同步';
  return new Date(t).toLocaleString();
});

async function onOpen(): Promise<void> {
  await Promise.all([refreshLcu(), load()]);
}

async function refreshLcu(): Promise<void> {
  try {
    lcu.value = await window.api.checkLcu();
  } catch (e: unknown) {
    lcu.value = { running: false, error: (e as { message?: string }).message };
  }
}

async function onReload(): Promise<void> {
  await load({ force: true });
  await refreshLcu();
  ElMessage.success('已重新拉取图鉴');
}

async function onCopy(): Promise<void> {
  const text = [
    '[LOL 皮肤助手 · 诊断信息]',
    `时间: ${new Date().toLocaleString()}`,
    `游戏客户端: ${lcu.value.running ? `运行中(端口 ${port.value ?? '—'})` : '未检测到'}`,
    `游戏账号: ${summonerName.value}`,
    `PUUID: ${puuid.value}`,
    `图鉴条数: ${catalogSize.value}`,
    `已拥有(匹配): ${stats.value.ownedMatched}`,
    `拥有数据来源: ${ownedSource.value}`,
    `皮肤 ID 覆盖率: ${coverageText.value}`,
    `皮肤 ID 字段: ${skinIdFieldPresent.value ? '后端已升级' : '后端未升级'}`,
    `上次同步: ${lastSyncText.value}`,
    `图鉴原始记录数: ${skins.value.length}`
  ].join('\n');
  await window.api.copyText(text);
  ElMessage.success('诊断信息已复制到剪贴板');
}

async function onOpenDevTools(): Promise<void> {
  await window.api.openDevTools();
}

async function onLogout(): Promise<void> {
  await auth.logout();
  ElMessage.success('已清除本机登录状态');
}

function onLock(): void {
  dev.lock();
}
</script>

<style scoped>
.dev-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 70vh;
  overflow-y: auto;
}
.dev-section {
  border: 1px solid var(--hx-line);
  border-radius: 0;
  padding: 12px 14px;
  background: var(--hx-panel-2);
}
.dev-section h3 {
  margin: 0 0 10px;
}
.dev-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dev-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.dev-key {
  width: 120px;
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hx-text-dim);
}
.dev-val {
  font-size: 13px;
  color: var(--hx-text);
  word-break: break-all;
}
.dev-val.mono {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: var(--hx-gold);
}
.dev-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.dev-log {
  background: #04070a;
  border: 1px solid var(--hx-line);
  border-radius: 0;
  padding: 10px;
  height: 200px;
  overflow-y: auto;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
.dev-log-empty {
  color: var(--hx-text-faint);
  font-style: italic;
}
.dev-log-line {
  display: flex;
  gap: 8px;
  line-height: 1.5;
  word-break: break-all;
}
.dev-log-ts {
  color: #4a5668;
}
.dev-log-level {
  width: 50px;
  flex-shrink: 0;
}
.level-INFO .dev-log-level {
  color: var(--hx-blue);
}
.level-WARN .dev-log-level {
  color: var(--hx-gold);
}
.level-ERROR .dev-log-level {
  color: var(--hx-danger);
}
</style>
