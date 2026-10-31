<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">
        <span class="hx-diamond" />
        <span class="brand-text">LOL 皮肤助手</span>
      </span>
      <span class="spacer" />
      <nav v-if="route.path !== '/login'" class="tabs">
        <router-link to="/sync" class="tab">皮肤同步</router-link>
        <router-link to="/match" class="tab">对局助手</router-link>
      </nav>
      <span class="spacer" />
      <span v-if="loggedIn" class="auth-info">已登录</span>
      <el-button
        v-if="loggedIn"
        size="small"
        text
        class="hx-gold"
        @click="onLogout"
      >
        退出登录
      </el-button>
      <el-button v-else size="small" text class="hx-gold" @click="goLogin">登录</el-button>
    </header>

    <main class="main">
      <router-view />
    </main>

    <DevPanel />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import DevPanel from './components/DevPanel.vue';
import { useAuthStore } from './stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);

function goLogin(): void {
  void router.push('/login');
}

async function onLogout(): Promise<void> {
  try {
    await auth.logout();
  } catch (e) {
    // still navigate away even on failure
    console.warn('logout failed', e);
  } finally {
    void router.push('/login');
  }
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
  padding: 10px 18px;
  background: linear-gradient(180deg, rgba(13, 26, 38, 0.92), rgba(5, 7, 10, 0.92));
  border-bottom: 1px solid var(--hx-line);
  gap: 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.brand-text {
  color: var(--hx-gold);
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}
.spacer {
  flex: 1;
}
.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  padding: 5px 14px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--hx-text-faint);
  text-decoration: none;
  border: 1px solid transparent;
}
.tab:hover {
  color: var(--hx-gold);
}
.tab.router-link-active {
  color: var(--hx-blue);
  border-color: var(--hx-line-strong);
  background: rgba(53, 184, 232, 0.08);
}
.auth-info {
  color: var(--hx-text-faint);
  font-size: 11px;
  font-family: monospace;
}
.main {
  flex: 1;
  overflow-y: auto;
}
</style>
