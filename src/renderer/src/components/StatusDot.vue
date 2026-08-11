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
  background: #94a3b8;
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.3);
}
.status-dot--running {
  background: #4ade80;
  box-shadow: 0 0 6px #4ade80;
}
.status-dot--error {
  background: #f87171;
  box-shadow: 0 0 6px #f87171;
}
</style>
