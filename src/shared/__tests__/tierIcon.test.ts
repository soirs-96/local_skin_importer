import { describe, expect, it } from 'vitest';
import { tierIconDataUrl } from '../tierIcon';

describe('tierIconDataUrl', () => {
  it('已知段位给出 data URI', () => {
    const url = tierIconDataUrl('GOLD', 'II');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('不同段位画出来的图不一样', () => {
    expect(tierIconDataUrl('GOLD')).not.toBe(tierIconDataUrl('DIAMOND'));
  });

  it('未知段位返回 null', () => {
    expect(tierIconDataUrl('NOT_A_TIER')).toBeNull();
  });

  it('小分区只认罗马数字', () => {
    expect(tierIconDataUrl('GOLD', 'IV')).not.toBe(tierIconDataUrl('GOLD', 'X'));
  });
});
