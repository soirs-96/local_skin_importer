<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">LOL Skin Importer</span>
      <span class="spacer" />
      <span v-if="loggedIn" class="auth-info" data-testid="auth-info">
        {{ tokenPreview }}
      </span>
      <el-button
        v-if="loggedIn"
        size="small"
        text
        @click="onLogout"
      >
        Logout
      </el-button>
      <el-button v-else size="small" text @click="goLogin">Login</el-button>
    </header>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from './stores/auth';

const router = useRouter();
const auth = useAuthStore();
const { loggedIn, tokenPreview } = storeToRefs(auth);

function goLogin(): void {
  void router.push('/login');
}

async function onLogout(): Promise<void> {
  await auth.logout();
  void router.push('/login');
}

onMounted(async () => {
  await auth.refresh();
});
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
.auth-info {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-family: monospace;
}
.main {
  flex: 1;
  overflow-y: auto;
}
</style>
