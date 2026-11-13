/**
 * 主题模式的纯逻辑 —— 不碰 DOM,好测。
 */

export type ThemeMode = 'light' | 'dark';

/** 用户上次手动选的模式存在哪儿。 */
export const THEME_STORAGE_KEY = 'hx-theme';

/** 把存下来的值解析成模式;认不出来就返回 null(那就听系统的)。 */
export function parseThemeMode(raw: string | null | undefined): ThemeMode | null {
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

/**
 * 定下当前该用哪个模式。
 *
 * 用户手动选过就听用户的 —— 用户明确表达过的偏好,别用系统设置覆盖它。
 * 没选过就听系统的。
 */
export function resolveThemeMode(
  saved: string | null | undefined,
  prefersDark: boolean
): ThemeMode {
  return parseThemeMode(saved) ?? (prefersDark ? 'dark' : 'light');
}
