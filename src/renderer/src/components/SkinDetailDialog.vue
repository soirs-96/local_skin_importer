<template>
  <el-dialog
    :model-value="modelValue"
    title="皮肤详情"
    width="520px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="skin" class="skin-detail">
      <div class="detail-art">
        <img :src="artUrl" alt="" class="art-img" :class="{ 'is-locked': !owned }" />
        <div v-if="!owned" class="art-mask" />
      </div>
      <div class="detail-meta">
        <div class="detail-name">{{ skin.name ?? '—' }}</div>
        <div class="detail-en">{{ skin.nameEn ?? '—' }}</div>
        <div class="detail-row">
          <span class="detail-label">英雄</span>
          <span>{{ skin.heroName ?? '未知英雄' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">稀有度</span>
          <span>{{ skin.rarity ?? '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">价格</span>
          <span>{{ skin.priceRp != null ? `${skin.priceRp} RP` : '—' }}</span>
        </div>
        <el-tag :type="owned ? 'success' : 'info'" class="detail-tag">
          {{ owned ? '已拥有' : '未拥有' }}
        </el-tag>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogSkin } from '../../../preload/index';

const props = defineProps<{
  modelValue: boolean;
  skin: CatalogSkin | null;
  owned: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const artUrl = computed(() => props.skin?.splashUrl ?? props.skin?.iconUrl ?? '');
</script>

<style scoped>
.skin-detail {
  display: flex;
  gap: 16px;
}
.detail-art {
  position: relative;
  width: 240px;
  height: 320px;
  border-radius: 6px;
  overflow: hidden;
  background: #2b2b31;
  flex-shrink: 0;
}
.art-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.art-img.is-locked {
  filter: grayscale(1) brightness(0.55);
}
.art-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}
.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
}
.detail-en {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.detail-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
}
.detail-label {
  width: 40px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.detail-tag {
  align-self: flex-start;
  margin-top: 8px;
}
</style>
