<template>
  <el-card class="rec-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="hx-diamond hx-diamond--blue" />
        <span class="hx-label">AI 阵容推荐</span>
        <!-- 右边一组:时间戳和按钮一起靠右,没有时间戳时按钮也贴右边 -->
        <div class="card-head-right">
          <span v-if="state?.generatedAt" class="generated-at">{{ generatedAtText }}</span>
          <el-button type="primary" :loading="busy" :disabled="!available" @click="onRecommend">
            生成推荐
          </el-button>
        </div>
      </div>
    </template>

    <div v-if="!available || state?.usedFallback" class="action-row">
      <span v-if="!available" class="hint-text">进入英雄选择阶段后可用</span>
      <span v-else-if="state?.usedFallback" class="hint-text hint-text--warn">
        这次是降级内容(AI 响应不完整)
      </span>
    </div>

    <div v-if="state?.error" class="error-row">{{ state.error }}</div>

    <template v-if="parsed">
      <p v-if="preamble" class="preamble">{{ preamble }}</p>

      <div v-if="panels.length > 0" class="rec-grid">
        <section
          v-for="panel in panels"
          :key="panel.key"
          class="panel"
          :class="{ 'panel--wide': panel.wide, 'panel--primary': panel.primary }"
        >
          <h3 class="panel-title hx-label">{{ panel.title }}</h3>

          <!-- 英雄段:认得出来的才带头像,认不出来就是纯文字 -->
          <div v-if="panel.isChampions" class="champ-row">
            <div v-for="(champ, index) in panel.champions" :key="index" class="champ">
              <img
                v-if="champ.iconUrl && !isBroken(champ.iconUrl)"
                class="champ-icon"
                :src="champ.iconUrl"
                :alt="champ.text"
                @error="markBroken(champ.iconUrl)"
              />
              <span v-else class="champ-icon champ-icon--empty">—</span>
              <span class="champ-name">{{ champ.text }}</span>
              <span v-if="champ.note" class="champ-note">{{ champ.note }}</span>
            </div>
          </div>

          <ul v-else-if="panel.items.length > 0" class="item-list">
            <li v-for="(item, index) in panel.items" :key="index">{{ item }}</li>
          </ul>

          <!-- 正文(渲染的是 renderMarkdown 的产物,输入已做 HTML 转义) -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="panel.text" class="md-body" v-html="panel.text" />
        </section>
      </div>

      <div v-else class="empty-text">这次没解析出内容 —— 可以再生成一次。</div>
    </template>

    <div v-else-if="!busy" class="empty-text">
      还没有生成过推荐。选人阶段点「生成推荐」,AI 会给出主推英雄、备选、天赋与出装。
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { RecommendationState } from '../../../../shared/match';
import {
  buildChampionIndex,
  matchChampion,
  parseRecommendation,
  type ChampionIndex
} from '../../../../shared/recommendation';
import { lcuIconUrl } from '../../../../shared/icons';
import { renderMarkdown } from '../../utils/markdown';
import { useBrokenIcons } from '../../composables/useBrokenIcons';

defineProps<{ available: boolean }>();

/** 一个英雄条目 —— 名字认出来了才带头像。 */
interface ChampionItem {
  text: string;
  note: string;
  iconUrl: string | null;
}

/** 一个面板 —— 一段推荐。 */
interface Panel {
  key: string;
  title: string;
  /** 是不是英雄段(英雄段带头像) */
  isChampions: boolean;
  /** 英雄条目;不是英雄段就是空数组 */
  champions: ChampionItem[];
  /** 清单段的条目 */
  items: string[];
  /** 正文(HTML) */
  text: string;
  /** 正文段占满整行 */
  wide: boolean;
  /** 主推英雄 —— 整份推荐里最该看的那一段 */
  primary: boolean;
}

const state = ref<RecommendationState | null>(null);
const busy = ref<boolean>(false);
const championIndex = ref<ChampionIndex>(new Map());
const { isBroken, markBroken } = useBrokenIcons();

const parsed = computed(() =>
  state.value?.markdown ? parseRecommendation(state.value.markdown) : null
);

const preamble = computed<string>(() => parsed.value?.preamble ?? '');

/**
 * 把推荐拆成一块块的面板。
 *
 * AI 的输出被约束成五个固定的小节,拆开来各占一格 —— 一眼扫得完,
 * 不用顺着一条长流往下拉。
 */
const panels = computed<Panel[]>(() => {
  const doc = parsed.value;
  if (!doc) return [];
  return doc.sections.map((section, index) => {
    // 「主推英雄」段没给名字却给了正文 —— 当正文段处理,别留个空壳。
    const isChampions = section.kind === 'champions' && section.items.length > 0;
    const champions = isChampions
      ? section.items
          // AI 常把几个英雄写在一行 —— 「千珏、佛耶戈」,拆成两个。
          .flatMap((raw) =>
            raw
              .split(/[、,，]/)
              .map((part) => part.trim())
              .filter(Boolean)
          )
          .map((raw) => {
            const hit = matchChampion(raw, championIndex.value);
            return {
              text: hit ? hit.name : raw,
              note: hit ? hit.note : '',
              iconUrl: hit ? lcuIconUrl('champion', hit.id) : null
            };
          })
      : [];

    return {
      key: `${section.title}-${index}`,
      title: section.title,
      isChampions,
      champions,
      items: isChampions ? [] : section.items,
      text: section.text ? renderMarkdown(section.text) : '',
      wide: section.kind === 'text' || (section.kind === 'champions' && !isChampions),
      primary: section.title.includes('主推英雄')
    };
  });
});

const generatedAtText = computed<string>(() => {
  if (!state.value?.generatedAt) return '';
  const d = new Date(state.value.generatedAt);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

async function onRecommend(): Promise<void> {
  busy.value = true;
  try {
    state.value = await window.api.requestRecommendation();
    if (state.value.error) {
      ElMessage.error(state.value.error);
    }
  } catch (e: unknown) {
    const msg = (e as { message?: string }).message ?? '生成失败';
    ElMessage.error(msg);
    state.value = { ...(state.value ?? emptyState()), error: msg };
  } finally {
    busy.value = false;
  }
}

function emptyState(): RecommendationState {
  return {
    markdown: null,
    usedFallback: false,
    error: null,
    inflight: false,
    generatedAt: null
  };
}

onMounted(async () => {
  try {
    state.value = await window.api.getRecommendation();
  } catch {
    state.value = emptyState();
  }
  // 英雄名对照表 —— 界面靠它把 AI 给的名字配上头像,拉不到就纯文字。
  try {
    championIndex.value = buildChampionIndex(await window.api.getChampionIndex());
  } catch {
    championIndex.value = new Map();
  }
});
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.generated-at {
  font-family: monospace;
  font-size: 11px;
  color: var(--hx-text-faint);
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.hint-text {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.hint-text--warn {
  color: var(--hx-gold);
}
.error-row {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-left: 2px solid var(--hx-danger);
  background: var(--hx-tint-danger-soft);
  color: var(--hx-danger);
  font-size: 12px;
}
.preamble {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--hx-text-faint);
}
.empty-text {
  font-size: 13px;
  color: var(--hx-text-faint);
  line-height: 1.6;
}

/* 一段推荐一块面板 —— 两列排,正文那类占满整行 */
.rec-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.panel {
  min-width: 0;
  padding: 10px 12px 12px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.panel--wide {
  grid-column: 1 / -1;
}
/* 主推英雄是这份推荐的重点 —— 用蓝标出来 */
.panel--primary {
  background: var(--hx-panel-3);
  border-color: var(--hx-line-strong);
}
.panel-title {
  margin: 0 0 8px;
  padding-left: 8px;
  border-left: 2px solid var(--hx-gold-deep);
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--hx-gold);
}
.panel--primary .panel-title {
  border-left-color: var(--hx-blue);
  color: var(--hx-blue-bright);
}

/* 英雄条目 */
.champ-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.champ {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 4px;
  background: var(--hx-panel);
  border: 1px solid var(--hx-line-soft);
}
.champ-icon {
  width: 26px;
  height: 26px;
  object-fit: contain;
  flex-shrink: 0;
}
.champ-icon--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--hx-text-faint);
}
.champ-name {
  font-size: 12px;
  color: var(--hx-text);
}
.champ-note {
  font-size: 10px;
  color: var(--hx-text-faint);
}

/* 清单段 */
.item-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--hx-text-regular);
}

/* 正文段 */
.md-body {
  font-size: 12px;
  line-height: 1.7;
  color: var(--hx-text-dim);
}
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5) {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--hx-gold);
}
.md-body :deep(p) {
  margin: 4px 0;
}
.md-body :deep(ul) {
  margin: 4px 0;
  padding-left: 18px;
}
.md-body :deep(strong) {
  color: var(--hx-blue);
}
.md-body :deep(code) {
  padding: 1px 5px;
  background: var(--hx-panel-3);
  color: var(--hx-gold-bright);
  font-family: monospace;
}

@media (max-width: 640px) {
  .rec-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
