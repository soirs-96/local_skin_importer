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
      <el-form-item label="Username">
        <el-input
          v-model="username"
          placeholder="Enter your username"
          autocomplete="username"
          :disabled="submitting"
        />
      </el-form-item>

      <el-form-item label="Password">
        <el-input
          v-model="password"
          type="password"
          placeholder="Enter your password"
          autocomplete="current-password"
          show-password
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
          Sign in
        </el-button>
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
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { loggedIn, tokenPreview } = storeToRefs(auth);

const username = ref<string>('');
const password = ref<string>('');
const submitting = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = null;

  const u = username.value.trim();
  if (!u || !password.value) {
    errorMessage.value = 'Username and password are required.';
    return;
  }

  submitting.value = true;
  try {
    await auth.login(u, password.value);
    username.value = '';
    password.value = '';
  } catch (e: unknown) {
    const err = e as { message?: string };
    errorMessage.value = err.message ?? 'Login failed.';
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
