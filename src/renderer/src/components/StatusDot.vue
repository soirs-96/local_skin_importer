<template>
  <el-tooltip :content="tooltipText" placement="top">
    <span class="status-dot" :class="`status-dot--${state}`" role="status" :aria-label="label ?? state" />
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type State = 'disconnected' | 'running' | 'error';

const props = defineProps<{
  state: State;
  label?: string;
}>();

const tooltipText = computed<string>(() => {
  if (props.label) return props.label;
  switch (props.state) {
    case 'running':
      return 'Running';
    case 'error':
      return 'Error';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
});
</script>

<style scoped>
.status-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  vertical-align: middle;
  flex-shrink: 0;
}
.status-dot--disconnected {
  background: var(--hx-text-faint);
  box-shadow: 0 0 0 1px var(--hx-ring);
}
.status-dot--running {
  background: var(--hx-blue);
  box-shadow: 0 0 8px var(--hx-blue-glow);
}
.status-dot--error {
  background: var(--hx-danger);
  box-shadow: 0 0 8px var(--hx-danger-glow);
}
</style>
