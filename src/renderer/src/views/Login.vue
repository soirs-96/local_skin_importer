<template>
  <el-card class="login-card" shadow="hover">
    <template #header>
      <div class="login-header">
        <h2>Login</h2>
        <span v-if="loggedIn" class="logged-in-tag">
          Logged in as {{ tokenPreview }}
        </span>
      </div>
    </template>

    <el-form v-if="!loggedIn" class="login-form" @submit.prevent="onSubmit">
      <el-form-item label="6 位同步码">
        <el-input
          v-model="code"
          placeholder="从小程序获取的 6 位数字"
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
        <p class="hint">在微信小程序"个人中心 → 获取桌面同步码"获取</p>
      </el-form-item>
    </el-form>

    <div v-else class="logged-in-actions">
      <p>You are already logged in.</p>
      <el-button type="danger" @click="onLogout">Logout</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { loggedIn, tokenPreview } = storeToRefs(auth);
const router = useRouter();

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
}
.login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.login-header h2 {
  margin: 0;
}
.logged-in-tag {
  color: var(--el-color-success);
  font-size: 12px;
  font-family: monospace;
}
.login-form {
  display: flex;
  flex-direction: column;
}
.logged-in-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
</style>
