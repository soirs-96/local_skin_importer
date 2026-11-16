import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  countdownRemaining,
  phaseLabel,
  statusLabel
} from '../../../shared/autoAccept';
import type { AutoAcceptState } from '../../../shared/autoAccept';

/**
 * 自动接受对局的状态。
 *
 * 「实用功能」页和「对局助手」页都要用它 —— 状态只有一份(在主进程),
 * 这里只管怎么取、怎么显示、怎么改。
 */

/** 状态是后台轮询的 —— 每 2 秒取一次。 */
const REFRESH_INTERVAL_MS = 2000;
/**
 * 本地时钟的间隔。
 *
 * 倒计时不能跟着 2 秒的轮询走 —— 那会一跳一跳的。自己走一下,
 * 剩余秒数按起算时刻现算。
 */
const CLOCK_INTERVAL_MS = 500;

export function useAutoAccept() {
  const state = ref<AutoAcceptState | null>(null);
  const now = ref(Date.now());

  let timer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  async function load(): Promise<void> {
    try {
      state.value = await window.api.getAutoAccept();
    } catch (e: unknown) {
      console.warn('get auto accept state failed', e);
    }
  }

  /** 开关。返回的 state 是主进程给的最新状态。 */
  async function toggle(enabled: boolean): Promise<void> {
    try {
      state.value = await window.api.setAutoAccept(enabled);
      ElMessage.success(enabled ? '自动接受已开启' : '自动接受已关闭');
    } catch (e: unknown) {
      ElMessage.error((e as { message?: string }).message ?? '设置失败');
      await load();
    }
  }

  /** 改「接受延时」。 */
  async function setDelay(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds)) return;
    try {
      state.value = await window.api.setAutoAcceptDelay(seconds);
    } catch (e: unknown) {
      ElMessage.error((e as { message?: string }).message ?? '设置失败');
      await load();
    }
  }

  const enabled = computed<boolean>(() => state.value?.enabled ?? false);

  const statusText = computed<string>(() => {
    const s = state.value;
    if (!s) return '读取中';
    if (!s.enabled) return '未开启';
    if (!s.clientConnected) return '客户端未运行';
    return statusLabel(s.status);
  });

  const phaseText = computed<string>(() => {
    const s = state.value;
    if (!s || !s.phase) return '—';
    return phaseLabel(s.phase);
  });

  /** 还在倒计时就显示秒数,不在就显示「—」。 */
  const countdownText = computed<string>(() => {
    const s = state.value;
    if (!s) return '—';
    const left = countdownRemaining(s.pendingAt, s.delaySeconds, now.value);
    return left > 0 ? left + ' 秒' : '—';
  });

  const countdownActive = computed<boolean>(() => countdownText.value !== '—');

  const lastAcceptedText = computed<string>(() => {
    const at = state.value?.lastAcceptedAt;
    if (!at) return '—';
    const d = new Date(at);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  });

  onMounted(() => {
    void load();
    timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    clockTimer = setInterval(() => {
      now.value = Date.now();
    }, CLOCK_INTERVAL_MS);
  });

  onUnmounted(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  });

  return {
    state,
    enabled,
    statusText,
    phaseText,
    countdownText,
    countdownActive,
    lastAcceptedText,
    load,
    toggle,
    setDelay
  };
}
