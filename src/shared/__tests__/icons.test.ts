import { describe, expect, it } from 'vitest';
import { ICON_SCHEME, iconExtension, lcuIconUrl, parseLcuIconUrl } from '../icons';

describe('lcuIconUrl', () => {
  it('英雄和物品各拼一个自定义协议地址', () => {
    expect(lcuIconUrl('champion', 266)).toBe('lcuicon://champion/266.png');
    expect(lcuIconUrl('item', 1001)).toBe('lcuicon://item/1001.png');
  });

  it('召唤师头像是 jpg —— 客户端只给这一种', () => {
    expect(lcuIconUrl('profile', 12)).toBe('lcuicon://profile/12.jpg');
    expect(iconExtension('profile')).toBe('jpg');
    expect(iconExtension('champion')).toBe('png');
  });
});

describe('parseLcuIconUrl', () => {
  it('能反解出类型和 id', () => {
    expect(parseLcuIconUrl('lcuicon://champion/266.png')).toEqual({ kind: 'champion', id: 266 });
    expect(parseLcuIconUrl('lcuicon://item/1001.png')).toEqual({ kind: 'item', id: 1001 });
  });

  it('召唤师头像也能反解', () => {
    expect(parseLcuIconUrl('lcuicon://profile/12.jpg')).toEqual({ kind: 'profile', id: 12 });
  });

  it('不是图标 URL 就返回 null', () => {
    expect(parseLcuIconUrl('https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/Aatrox.png'))
      .toBeNull();
    expect(parseLcuIconUrl('lcuicon://champion/')).toBeNull();
    expect(parseLcuIconUrl('lcuicon://rune/8000.png')).toBeNull();
    expect(parseLcuIconUrl('')).toBeNull();
  });

  it('id 非法时返回 null', () => {
    expect(parseLcuIconUrl('lcuicon://champion/0.png')).toBeNull();
    expect(parseLcuIconUrl('lcuicon://champion/abc.png')).toBeNull();
  });

  it('协议名就是约定的那个', () => {
    expect(ICON_SCHEME).toBe('lcuicon');
  });
});
