import { defineStore } from 'pinia';
import { ref } from 'vue';

interface AuthStatus {
  loggedIn: boolean;
  tokenPreview: string | null;
}

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref<boolean>(false);
  const tokenPreview = ref<string | null>(null);

  async function refresh(): Promise<void> {
    const status: AuthStatus = await window.api.getAuthStatus();
    loggedIn.value = status.loggedIn;
    tokenPreview.value = status.tokenPreview;
  }

  async function login(username: string, password: string): Promise<void> {
    const status: AuthStatus = await window.api.login(username, password);
    loggedIn.value = status.loggedIn;
    tokenPreview.value = status.tokenPreview;
  }

  async function logout(): Promise<void> {
    await window.api.logout();
    loggedIn.value = false;
    tokenPreview.value = null;
  }

  return { loggedIn, tokenPreview, refresh, login, logout };
});
