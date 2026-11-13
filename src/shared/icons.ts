/**
 * 对局助手用的图标 URL 约定。
 *
 * 图标一律走 **`lcuicon://` 自定义协议**,不直接指向外网 CDN:
 *
 *   - 外网 CDN(之前是 Data Dragon)在国服网络里经常拉不动,表现就是
 *     「英雄名有、头像和装备全是空的」;
 *   - 自定义协议由主进程代理,取图顺序是**英雄走客户端、物品走
 *     Data Dragon**(客户端只有英雄头像,物品图标它根本不提供),
 *     鉴权头和磁盘缓存都在主进程里处理,渲染进程只管
 *     `<img src="lcuicon://champion/266.png">`。
 *
 * 这个文件不许 import 任何东西 —— 渲染进程也要用它拼 URL。
 */

export const ICON_SCHEME = 'lcuicon';

export type IconKind = 'champion' | 'item' | 'profile';

const ICON_KINDS: IconKind[] = ['champion', 'item', 'profile'];

/**
 * 客户端资源里的文件后缀。
 *
 * 召唤师头像是 **.jpg**(实测 `/lol-game-data/assets/v1/profile-icons/{id}.jpg`
 * 回 200 image/jpeg,同名的 .png 回 400);英雄和物品是 .png。
 */
const ICON_EXTENSIONS: Record<IconKind, string> = {
  champion: 'png',
  item: 'png',
  profile: 'jpg'
};

export interface IconRef {
  kind: IconKind;
  id: number;
}

/** 渲染进程拼图标 URL 用。 */
export function lcuIconUrl(kind: IconKind, id: number): string {
  return `${ICON_SCHEME}://${kind}/${id}.${iconExtension(kind)}`;
}

/** 某类图标的文件后缀 —— 磁盘缓存的命名也要用。 */
export function iconExtension(kind: IconKind): string {
  return ICON_EXTENSIONS[kind] ?? 'png';
}

/** 反解 `lcuicon://champion/266.png`;不是图标 URL 就返回 null。 */
export function parseLcuIconUrl(raw: string): IconRef | null {
  const pattern = new RegExp(
    `^${ICON_SCHEME}://(${ICON_KINDS.join('|')})/(\\d+)\\.(png|jpg)(?:\\?.*)?$`
  );
  const matched = pattern.exec(raw);
  if (!matched) return null;

  const id = Number(matched[2]);
  if (!Number.isInteger(id) || id <= 0) return null;

  return { kind: matched[1] as IconKind, id };
}
