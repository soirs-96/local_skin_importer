import { ElMessage, ElMessageBox } from 'element-plus';
import { useDevStore } from '../stores/dev';

/**
 * 顶栏「开发日志」按钮的入口。
 *
 * 口令对就打开控制台,不对就一句话打发走。
 * 已经解锁过就不用再输 —— 一次运行内记着。
 */
export function useConsoleEntry() {
  const dev = useDevStore();

  async function openConsole(): Promise<void> {
    if (dev.consoleUnlocked) {
      dev.consoleVisible = true;
      return;
    }
    try {
      const { value } = await ElMessageBox.prompt('请输入开发日志口令', '开发日志模式', {
        confirmButtonText: '开启',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '口令',
        inputValidator: (v: string) => (v.trim() ? true : '请输入口令')
      });
      if (dev.unlockConsole(String(value ?? ''))) return;
      ElMessage.error('口令不正确');
    } catch {
      // 用户点了取消,什么都不用做
    }
  }

  return { openConsole };
}
