import { describe, expect, it } from 'vitest';
import { parseThemeMode, resolveThemeMode } from '../theme';

describe('parseThemeMode', () => {
  it('认得两种合法值', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
  });

  it('认不出来的值一律当没存过', () => {
    expect(parseThemeMode(null)).toBeNull();
    expect(parseThemeMode(undefined)).toBeNull();
    expect(parseThemeMode('')).toBeNull();
    expect(parseThemeMode('Dark')).toBeNull();
    expect(parseThemeMode('solarized')).toBeNull();
  });
});

describe('resolveThemeMode', () => {
  it('用户手动选过就听用户的,不看系统', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('没选过就跟着系统', () => {
    expect(resolveThemeMode(null, true)).toBe('dark');
    expect(resolveThemeMode(null, false)).toBe('light');
    expect(resolveThemeMode(undefined, true)).toBe('dark');
  });

  it('存了看不懂的值也退回听系统的', () => {
    expect(resolveThemeMode('乱写的', true)).toBe('dark');
    expect(resolveThemeMode('乱写的', false)).toBe('light');
  });
});
