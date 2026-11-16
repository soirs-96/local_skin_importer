<template>
  <div class="auto-accept">
    <div class="auto-accept-head">
      <span class="hx-label">自动接受对局</span>
      <el-switch
        class="auto-accept-switch"
        size="small"
        :model-value="enabled"
        @change="onChange"
      />
    </div>
    <span class="auto-accept-status" :class="{ 'is-hot': countdownActive }">{{ statusLine }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAutoAccept } from '../composables/useAutoAccept';

const { enabled, statusText, countdownText, countdownActive, toggle } = useAutoAccept();

/** 倒计时走的时候直接把秒数顶上来 —— 那是用户等着改主意的窗口。 */
const statusLine = computed<string>(() =>
  countdownActive.value ? `即将接受 · ${countdownText.value}` : statusText.value
);

function onChange(value: string | number | boolean): void {
  void toggle(value === true);
}
</script>

<style scoped>
.auto-accept {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.auto-accept-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.auto-accept-switch {
  margin-left: 0;
}
.auto-accept-status {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.auto-accept-status.is-hot {
  color: var(--hx-gold);
}
</style>
