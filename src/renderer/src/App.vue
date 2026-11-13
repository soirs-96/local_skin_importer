<template>
  <div class="app">
    <!-- 登录页没有左边栏,只留一条顶栏放品牌和开发日志 -->
    <header v-if="isLogin" class="login-bar">
      <span class="brand">
        <span class="hx-diamond" />
        <span class="brand-text">LOL 皮肤助手</span>
      </span>
      <span class="spacer" />
      <el-button size="small" text class="hx-gold" :title="themeTitle" @click="toggleTheme">
        <span class="hx-diamond" />
        <span>{{ mode === 'dark' ? '日间' : '夜间' }}</span>
      </el-button>
      <el-button size="small" text class="hx-gold" @click="openConsole">开发日志</el-button>
    </header>

    <aside v-else class="rail">
      <div class="rail-brand">
        <span class="rail-logo">
          <span class="hx-diamond" />
        </span>
        <span class="brand-text">LOL 皮肤助手</span>
      </div>

      <nav class="rail-nav">
        <router-link v-for="item in NAV_ITEMS" :key="item.path" :to="item.path" class="rail-item">
          <span class="rail-index">{{ item.index }}</span>
          <span class="rail-label">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="rail-foot">
        <div class="foot-row">
          <span class="foot-dot" :class="lcuDotClass" />
          <span class="foot-text">{{ lcuText }}</span>
        </div>

        <div class="foot-row">
          <span class="hx-diamond hx-diamond--blue" />
          <span class="foot-text">{{ loggedIn ? '账号已登录' : '账号未登录' }}</span>
        </div>

        <div class="foot-version">{{ APP_VERSION }}</div>

        <div class="foot-actions">
          <el-button size="small" text class="hx-gold" :title="themeTitle" @click="toggleTheme">
            <span class="hx-diamond" />
            <span>{{ mode === 'dark' ? '日间' : '夜间' }}</span>
          </el-button>
          <el-button size="small" text class="hx-gold" @click="openConsole">开发日志</el-button>
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
        </div>
      </div>
    </aside>

    <main class="main">
      <router-view />
    </main>

    <DevConsole />
    <DevPanel />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import DevConsole from './components/DevConsole.vue';
import DevPanel from './components/DevPanel.vue';
import { useAuthStore } from './stores/auth';
import { useConsoleEntry } from './composables/useConsoleEntry';
import { useTheme } from './composables/useTheme';
import { APP_VERSION } from './config/dev';
import type { LcuStatus } from '../../preload/index';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);
const { openConsole } = useConsoleEntry();
const { mode, toggleTheme } = useTheme();

/** 主题按钮上的提示 —— 说清楚点了会切到哪一边。 */
const themeTitle = computed<string>(() =>
  mode.value === 'dark' ? '切换到日间模式' : '切换到夜间模式'
);

/** 左边栏的栏目 —— 编号跟参考工具一样,一眼能数到第几项。 */
const NAV_ITEMS = [
  { index: '01', label: '皮肤同步', path: '/sync' },
  { index: '02', label: '对局助手', path: '/match' },
  { index: '03', label: '战绩查询', path: '/players' }
];

const isLogin = computed<boolean>(() => route.path === '/login');

const lcu = ref<LcuStatus | null>(null);

/** 客户端状态只做浅检测 —— 挂在界面上顺手查一下,不扫盘。 */
async function refreshLcu(): Promise<void> {
  if (isLogin.value) return;
  try {
    lcu.value = await window.api.checkLcu();
  } catch (e: unknown) {
    console.warn('check lcu failed', e);
    lcu.value = null;
  }
}

const lcuText = computed<string>(() => {
  if (!lcu.value) return '客户端未运行';
  return lcu.value.running ? '客户端运行中' : '客户端未运行';
});

const lcuDotClass = computed<string>(() => (lcu.value?.running ? 'is-on' : 'is-off'));

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
  await refreshLcu();
});

// 换页面就顺手刷新一次客户端状态 —— 玩家常常是打完游戏才切过来的。
watch(
  () => route.path,
  () => {
    void refreshLcu();
  }
);
</script>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: row;
}
.login-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: linear-gradient(180deg, var(--hx-shell-top), var(--hx-shell-bottom));
  border-bottom: 1px solid var(--hx-line);
}

/* ============================ 左边栏 ============================ */
.rail {
  width: 212px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--hx-shell-top), var(--hx-shell-bottom));
  border-right: 1px solid var(--hx-line);
}
.rail-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--hx-line);
}
.rail-logo {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hx-line-strong);
  background: var(--hx-panel-2);
  flex-shrink: 0;
}
.brand-text {
  color: var(--hx-gold);
  font-size: 12px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  white-space: nowrap;
}
.foot-version {
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--hx-text-faint);
  opacity: 0.75;
}
.rail-nav {
  display: flex;
  flex-direction: column;
  padding: 12px 0;
}
.rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-left: 2px solid transparent;
  color: var(--hx-text-dim);
  text-decoration: none;
  font-size: 13px;
  transition:
    color 0.12s,
    background 0.12s;
}
.rail-item:hover {
  color: var(--hx-gold);
  background: var(--hx-tint-gold-faint);
}
.rail-index {
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--hx-gold);
  opacity: 0.5;
}
.rail-item.router-link-active {
  color: var(--hx-blue);
  border-left-color: var(--hx-blue);
  background: var(--hx-tint-blue-faint);
}
.rail-item.router-link-active .rail-index {
  opacity: 1;
}
.rail-foot {
  margin-top: auto;
  padding: 14px 16px;
  border-top: 1px solid var(--hx-line);
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.foot-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.foot-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.foot-dot.is-on {
  background: var(--hx-blue);
  box-shadow: 0 0 8px var(--hx-blue-glow);
}
.foot-dot.is-off {
  background: var(--hx-text-faint);
}
.foot-text {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--hx-text-dim);
}
.foot-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  margin-top: 2px;
}
/*
 * Element Plus 给按钮留了 11px 横向内边距,相邻按钮之间还有 12px 左边距 ——
 * 侧边栏只有 212px,三个按钮按默认样式必然撑出去。改成紧凑样式,
 * 放不下就换行,不许溢出到主区域上。
 */
.foot-actions :deep(.el-button) {
  margin-left: 0;
  padding: 3px 6px;
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.main {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
</style>
