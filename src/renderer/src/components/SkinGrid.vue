<template>
  <div ref="viewportRef" class="skin-grid-viewport" @scroll="onScroll">
    <div class="skin-grid-spacer" :style="{ height: `${totalHeight}px` }">
      <div
        class="skin-grid-slice"
        :style="{
          gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`,
          gridAutoRows: `${CARD_H}px`,
          transform: `translateY(${offsetY}px)`
        }"
      >
        <SkinCard
          v-for="item in visibleItems"
          :key="item.key"
          :skin="item.skin"
          :owned="item.owned"
          :visible="true"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SkinCard from './SkinCard.vue';
import type { CatalogSkin } from '../../../preload/index';
import { computeVisibleRange } from '../composables/skinCatalogLogic';

const CARD_W = 132;
const CARD_H = 176;
const GAP = 12;
// 行距必须等于 CSS 里 grid-auto-rows 定死的高度 + gap,
// 否则虚拟滚动的 offsetY 和实际像素位置对不上,滚远了切片会偏。
const ROW_H = CARD_H + GAP;

const props = defineProps<{
  skins: CatalogSkin[];
  ownedIds: Set<number>;
}>();

const emit = defineEmits<{
  (e: 'select', skin: CatalogSkin): void;
}>();

const viewportRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const containerWidth = ref(0);

const cols = computed(() =>
  Math.max(1, Math.floor((containerWidth.value + GAP) / (CARD_W + GAP)))
);
const totalHeight = computed(() => Math.ceil(props.skins.length / cols.value) * ROW_H);
const range = computed(() =>
  computeVisibleRange(scrollTop.value, viewportHeight.value, ROW_H, cols.value, props.skins.length)
);
// startIndex 恒为 cols 的整数倍,所以切片的第一张卡落在第 0 列
const offsetY = computed(() => Math.floor(range.value.startIndex / cols.value) * ROW_H);

const visibleItems = computed(() =>
  props.skins.slice(range.value.startIndex, range.value.endIndex).map((skin) => ({
    key: `${skin.id}-${skin.skinId ?? 'x'}`,
    skin,
    owned: skin.skinId != null && props.ownedIds.has(skin.skinId)
  }))
);

function onScroll(e: Event): void {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}

function onSelect(skin: CatalogSkin): void {
  emit('select', skin);
}

// 筛选后条目数变了 = 换了筛选条件,回到顶部,否则滚动区会停在旧位置留下空白。
// 只看长度不看数组引用:后台静默刷新目录也会换引用,但长度不变,不该把用户拽回顶部。
watch(
  () => props.skins.length,
  () => {
    const el = viewportRef.value;
    if (!el) return;
    const maxScroll = Math.max(0, totalHeight.value - el.clientHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = 0;
    }
    scrollTop.value = el.scrollTop;
  }
);

let resizeObserver: ResizeObserver | null = null;

function measure(): void {
  const el = viewportRef.value;
  if (!el) return;
  containerWidth.value = el.clientWidth;
  viewportHeight.value = el.clientHeight;
}

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(() => measure());
  if (viewportRef.value) resizeObserver.observe(viewportRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.skin-grid-viewport {
  height: 100%;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}
.skin-grid-spacer {
  position: relative;
  width: 100%;
}
.skin-grid-slice {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  /* 列模板由内联 style 提供:repeat() 的计数参数不接受 var(),
     写成 repeat(var(--cols), 132px) 会让整条声明失效、网格塌成一列 */
  gap: 12px;
  justify-content: start;
}
</style>
