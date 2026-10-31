<template>
  <div
    class="skin-card"
    :class="owned ? 'is-owned' : 'is-locked'"
    role="button"
    tabindex="0"
    @click="emit('select', skin)"
  >
    <div class="thumb">
      <img
        v-if="visible && iconSrc && !imgFailed"
        :src="iconSrc"
        alt=""
        @error="imgFailed = true"
      />
      <div v-else class="thumb-placeholder" />
      <div v-if="!owned" class="mask" />
      <span v-if="!owned" class="lock-badge">未拥有</span>
    </div>
    <div class="meta">
      <div class="name" :title="skin.name ?? ''">{{ skin.name ?? '—' }}</div>
      <div class="sub">{{ skin.heroName ?? '未知英雄' }} · {{ skin.rarity ?? '—' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CatalogSkin } from '../../../preload/index';

const props = defineProps<{
  skin: CatalogSkin;
  owned: boolean;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', skin: CatalogSkin): void;
}>();

// 收敛成 string,模板里就不用再处理 null
const iconSrc = computed(() => props.skin.iconUrl ?? '');

const imgFailed = ref(false);

watch(
  () => props.skin.iconUrl,
  () => {
    imgFailed.value = false;
  }
);
</script>

<style scoped>
.skin-card {
  width: 132px;
  cursor: pointer;
  user-select: none;
}
.thumb {
  position: relative;
  width: 132px;
  height: 132px;
  box-sizing: border-box;
  border-radius: 0;
  overflow: hidden;
  background: #0a1017;
  border: 1px solid var(--hx-line);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.skin-card:hover .thumb {
  border-color: var(--hx-blue);
  box-shadow: 0 0 12px var(--hx-blue-glow);
}
.is-owned .thumb {
  border-color: var(--hx-line-strong);
}
.is-locked .thumb {
  border-color: rgba(139, 147, 167, 0.14);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-placeholder {
  width: 100%;
  height: 100%;
  background: #0a1017;
}
.is-locked .thumb img {
  filter: grayscale(1) brightness(0.55);
}
.mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}
.lock-badge {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 0 6px;
  border-radius: 0;
  border-top: 1px solid var(--hx-line-strong);
  border-left: 1px solid var(--hx-line-strong);
  font-size: 10px;
  line-height: 18px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hx-gold);
  background: rgba(5, 7, 10, 0.85);
}
.meta {
  padding-top: 6px;
}
.name {
  font-size: 12px;
  line-height: 16px;
  color: var(--hx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.is-owned .name {
  color: var(--hx-gold);
}
.sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--hx-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
