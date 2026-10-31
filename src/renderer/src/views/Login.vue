<template>
  <el-card class="login-card" shadow="hover">
    <template #header>
      <div class="login-header">
        <h2 class="login-title">
          <span class="hx-diamond" />
          登录桌面端
        </h2>
        <span v-if="loggedIn" class="logged-in-tag">已登录</span>
      </div>
    </template>

    <el-form v-if="!loggedIn" class="login-form" @submit.prevent="onSubmit">
      <el-form-item label="同步码">
        <el-input
          v-model="code"
          placeholder="请输入小程序上的 6 位数字"
          autocomplete="off"
          inputmode="numeric"
          pattern="[0-9]{6}"
          maxlength="6"
          :disabled="submitting"
          @keyup.enter="onSubmit"
        />
      </el-form-item>

      <el-form-item v-if="errorMessage">
        <el-alert :title="errorMessage" type="error" :closable="false" show-icon />
      </el-form-item>

      <el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="submitting"
          @click="onSubmit"
        >
          登录
        </el-button>
      </el-form-item>

      <el-form-item>
        <p class="hint">在微信小程序「我的 → 桌面同步码」获取</p>
      </el-form-item>
    </el-form>

    <div v-else class="logged-in-actions">
      <p>已登录,可以在同步页查看和同步你的皮肤。</p>
      <el-button class="hx-gold" @click="onLogout">退出登录</el-button>
    </div>

    <button type="button" class="version-entry" @click="openDevPanel">{{ APP_VERSION }}</button>
  </el-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { APP_VERSION } from '../config/dev';
import { useDevEntry } from '../composables/useDevEntry';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);
const router = useRouter();
const { openDevPanel } = useDevEntry();

const code = ref<string>('');
const submitting = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = null;

  const c = code.value.trim();
  if (!/^\d{6}$/.test(c)) {
    errorMessage.value = '请输入 6 位数字同步码';
    return;
  }

  submitting.value = true;
  try {
    await auth.redeemCode(c);
    code.value = '';
    if (auth.loggedIn) {
      void router.push('/sync');
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    errorMessage.value = err.message ?? '兑换失败';
  } finally {
    submitting.value = false;
  }
}

async function onLogout(): Promise<void> {
  await auth.logout();
}
</script>

<style scoped>
.login-card {
  max-width: 420px;
  margin: 60px auto;
  border-color: var(--hx-line-strong);
}
.login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.login-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--hx-gold);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}
.logged-in-tag {
  color: var(--hx-blue);
  font-size: 11px;
  font-family: monospace;
  letter-spacing: 0.08em;
}
.login-form {
  display: flex;
  flex-direction: column;
}
.hint {
  margin: 0;
  color: var(--hx-text-faint);
  font-size: 12px;
}
.logged-in-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  color: var(--hx-text-dim);
}
/* 版本号:平时几乎看不见,点它可以进开发者模式 */
.version-entry {
  display: block;
  margin: 18px auto 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--hx-text-faint);
  font-size: 10px;
  letter-spacing: 0.18em;
  font-family: monospace;
  opacity: 0.45;
}
.version-entry:hover {
  color: var(--hx-gold);
  opacity: 0.9;
}
</style>
