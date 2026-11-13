import { ref, watch } from 'vue';
import { parseThemeMode, resolveThemeMode, THEME_STORAGE_KEY } from '../utils/theme';
import type { ThemeMode } from '../utils/theme';

/**
 * 日间 / 夜间主题。
 *
 * - 首次跟着系统走(`prefers-color-scheme`),用户手动切过一次之后就记住他的选择。
 * - 主题是**类名**在 `<html>` 上:Element Plus 自带的暗色主题认 `html.dark`,
 *   我们自己的配色变量认 `html.dark` / `html.light`。
 */

/** 存主题 —— 存不了也不能让应用起不来。 */
function readSaved(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 存不了就算了 —— 本次运行照样能切
  }
}

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** 用户手动选过的模式;null = 还没选过,听系统的。 */
const override = ref<ThemeMode | null>(parseThemeMode(readSaved()));

/** 当前生效的模式。 */
const mode = ref<ThemeMode>(resolveThemeMode(override.value, media.matches));

function apply(next: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', next === 'dark');
  root.classList.toggle('light', next === 'light');
}

apply(mode.value);

// 系统换了也跟着换 —— 但用户手动选过就别再自作主张。
media.addEventListener('change', (event) => {
  if (override.value) return;
  mode.value = event.matches ? 'dark' : 'light';
});

watch(mode, apply);

/** 切到另一个模式 —— 切过之后就记住,不再跟系统。 */
function toggleTheme(): void {
  const next: ThemeMode = mode.value === 'dark' ? 'light' : 'dark';
  override.value = next;
  mode.value = next;
  saveTheme(next);
}

export function useTheme(): { mode: typeof mode; toggleTheme: () => void } {
  return { mode, toggleTheme };
}
