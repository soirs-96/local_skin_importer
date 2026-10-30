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
  border-radius: 6px;
  overflow: hidden;
  background: #2b2b31;
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
  background: #2b2b31;
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
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}
.meta {
  padding-top: 4px;
}
.name {
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
