import { ElMessage, ElMessageBox } from 'element-plus';
import { useDevStore } from '../stores/dev';

/**
 * 开发者模式的入口。
 *
 * 入口藏在版本号上,平时看不出来;点一下才问口令。
 * 已经解锁过就不用再输 —— 一次运行内记着。
 */
export function useDevEntry() {
  const dev = useDevStore();

  async function openDevPanel(): Promise<void> {
    if (dev.unlocked) {
      dev.panelVisible = true;
      return;
    }
    try {
      const { value } = await ElMessageBox.prompt('请输入开发者口令', '开发者模式', {
        confirmButtonText: '进入',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '口令',
        inputValidator: (v: string) => (v.trim() ? true : '请输入口令')
      });
      if (dev.unlock(String(value ?? ''))) return;
      ElMessage.error('口令不正确');
    } catch {
      // 用户点了取消,什么都不用做
    }
  }

  return { openDevPanel };
}
