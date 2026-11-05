<template>
  <section v-if="visible" class="dev-console">
    <header class="dc-head">
      <span class="hx-diamond hx-diamond--blue" />
      <span class="dc-title hx-label">开发日志</span>
      <span class="dc-count mono">{{ shown.length }} / {{ lines.length }}</span>

      <span class="dc-filters">
        <button
          v-for="f in FILTERS"
          :key="f.level"
          class="dc-filter"
          :class="[f.level.toLowerCase(), { off: !active[f.level] }]"
          @click="toggle(f.level)"
        >
          {{ f.label }}
        </button>
      </span>

      <span class="dc-spacer" />

      <label class="dc-auto">
        <input v-model="autoScroll" type="checkbox" />
        <span>自动滚动</span>
      </label>
      <el-button size="small" text class="hx-gold" @click="onClear">清空</el-button>
      <el-button size="small" text class="hx-gold" @click="onCopy">复制</el-button>
      <el-button size="small" text class="hx-gold" @click="onClose">关闭</el-button>
    </header>

    <div ref="bodyEl" class="dc-body">
      <div v-if="shown.length === 0" class="dc-empty">暂无输出</div>
      <div
        v-for="(line, i) in shown"
        :key="`${line.ts}-${i}`"
        class="dc-line"
        :class="'lv-' + line.level"
      >
        <span class="dc-ts mono">{{ clock(line.ts) }}</span>
        <span class="dc-src mono">{{ line.src === 'main' ? 'MAIN' : 'UI' }}</span>
        <span class="dc-level mono">{{ line.level }}</span>
        <pre class="dc-msg">{{ line.msg }}</pre>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import { useConsoleStore } from '../stores/console';
import { useDevStore } from '../stores/dev';
import { attachConsole, detachConsole } from '../composables/useConsoleCapture';
import type { DevLogLevel } from '../../../shared/dev';

const store = useConsoleStore();
const dev = useDevStore();
const { lines } = storeToRefs(store);

const visible = computed({
  get: () => dev.consoleVisible,
  set: (v: boolean) => {
    dev.consoleVisible = v;
  }
});

const FILTERS: { level: DevLogLevel; label: string }[] = [
  { level: 'ERROR', label: '错误' },
  { level: 'WARN', label: '警告' },
  { level: 'INFO', label: '信息' }
];

const active = ref<Record<string, boolean>>({ ERROR: true, WARN: true, INFO: true });
const autoScroll = ref(true);
const bodyEl = ref<HTMLElement | null>(null);

const shown = computed(() => lines.value.filter((l) => active.value[l.level] === true));

function toggle(level: DevLogLevel): void {
  active.value = { ...active.value, [level]: !active.value[level] };
}

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function scrollBottom(): void {
  const el = bodyEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  visible,
  async (v) => {
    if (v) {
      await attachConsole();
      await nextTick();
      scrollBottom();
    } else {
      await detachConsole();
    }
  }
);

watch(shown, async () => {
  if (!autoScroll.value) return;
  await nextTick();
  scrollBottom();
});

async function onClear(): Promise<void> {
  store.clear();
  await nextTick();
  scrollBottom();
}

async function onCopy(): Promise<void> {
  const text = shown.value
    .map((l) => `${clock(l.ts)} [${l.src === 'main' ? 'MAIN' : 'UI'}] [${l.level}] ${l.msg}`)
    .join('\n');
  await window.api.copyText(text);
  ElMessage.success(`已复制 ${shown.value.length} 行日志`);
}

function onClose(): void {
  dev.closeConsole();
}
</script>

<style scoped>
.dev-console {
  flex-shrink: 0;
  height: 38vh;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  background: #04070a;
  border-top: 1px solid var(--hx-line-strong);
}
.dc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--hx-line);
  background: var(--hx-panel-2);
  flex-shrink: 0;
}
.dc-title {
  color: var(--hx-gold);
}
.dc-count {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.dc-filters {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}
.dc-filter {
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 0.12em;
  background: transparent;
  border: 1px solid var(--hx-line);
  color: var(--hx-text-dim);
  cursor: pointer;
}
.dc-filter:hover {
  border-color: var(--hx-line-strong);
}
.dc-filter.error {
  color: var(--hx-danger);
}
.dc-filter.warn {
  color: var(--hx-gold-bright);
}
.dc-filter.info {
  color: var(--hx-blue);
}
/* 关掉的档位:留个位置但压暗,一眼看得出被滤掉了 */
.dc-filter.off {
  opacity: 0.35;
}
.dc-spacer {
  flex: 1;
}
.dc-auto {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--hx-text-dim);
  cursor: pointer;
}
.dc-auto input {
  cursor: pointer;
}
.dc-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}
.dc-empty {
  color: var(--hx-text-faint);
  font-style: italic;
}
.dc-line {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 1px 0;
}
.dc-ts {
  color: #4a5668;
  flex-shrink: 0;
}
.dc-src {
  flex-shrink: 0;
  width: 42px;
  color: var(--hx-text-faint);
}
.dc-level {
  flex-shrink: 0;
  width: 44px;
}
.lv-INFO .dc-level {
  color: var(--hx-blue);
}
.lv-WARN .dc-level {
  color: var(--hx-gold-bright);
}
.lv-ERROR .dc-level {
  color: var(--hx-danger);
}
.dc-msg {
  margin: 0;
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--hx-text);
}
.lv-ERROR .dc-msg {
  color: #ffb3b3;
}
.lv-WARN .dc-msg {
  color: #e8d29a;
}
</style>
