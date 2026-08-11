<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">LOL Skin Importer</span>
      <span class="spacer" />
      <span class="version">v0.1.0 — scaffold</span>
    </header>

    <main class="main">
      <el-card class="card" shadow="never">
        <h2>Hello, {{ greeting }}!</h2>
        <p class="muted">
          This is the scaffold build. Real UI lands in Task 16.
        </p>
        <el-button type="primary" @click="onClick">Ping Element Plus</el-button>
        <p v-if="lastPing" class="muted">Last ping: {{ lastPing }}</p>
      </el-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const greeting = 'summoner';
const lastPing = ref<string | null>(null);

function onClick() {
  lastPing.value = new Date().toLocaleTimeString();
}
</script>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-border-color);
  gap: 8px;
}
.brand {
  font-weight: 600;
  color: var(--el-color-primary);
}
.spacer {
  flex: 1;
}
.version {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}
.card {
  max-width: 520px;
  margin: 0 auto;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
h2 {
  margin-top: 0;
}
</style>
