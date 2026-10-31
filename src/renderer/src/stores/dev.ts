import { defineStore } from 'pinia';
import { ref } from 'vue';
import { DEV_PASSWORD } from '../config/dev';

export const useDevStore = defineStore('dev', () => {
  /** 口令是否已验证过(本次运行内有效) */
  const unlocked = ref(false);
  /** 面板是否打开 */
  const panelVisible = ref(false);

  /** 口令正确才解锁,并直接弹出面板。 */
  function unlock(password: string): boolean {
    if (password !== DEV_PASSWORD) return false;
    unlocked.value = true;
    panelVisible.value = true;
    return true;
  }

  function close(): void {
    panelVisible.value = false;
  }

  /** 退出开发者模式:下次再进要重新输口令。 */
  function lock(): void {
    unlocked.value = false;
    panelVisible.value = false;
  }

  return { unlocked, panelVisible, unlock, close, lock };
});
