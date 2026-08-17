import { defineStore } from 'pinia';
import { ref } from 'vue';

interface AuthStatus {
  loggedIn: boolean;
  tokenPreview: string | null;
}

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref<boolean>(false);
  const tokenPreview = ref<string | null>(null);
  const initialized = ref<boolean>(false);

  async function refresh(): Promise<void> {
    const status: AuthStatus = await window.api.getAuthStatus();
    loggedIn.value = status.loggedIn;
    tokenPreview.value = status.tokenPreview;
    initialized.value = true;
  }

  async function redeemCode(code: string): Promise<void> {
    const status: AuthStatus = await window.api.redeemCode(code);
    loggedIn.value = status.loggedIn;
    tokenPreview.value = status.tokenPreview;
    initialized.value = true;
  }

  async function logout(): Promise<void> {
    await window.api.logout();
    loggedIn.value = false;
    tokenPreview.value = null;
  }

  return { loggedIn, tokenPreview, initialized, refresh, redeemCode, logout };
});
