/**
 * 对局助手用的图标 URL 约定。
 *
 * 图标一律走 **`lcuicon://` 自定义协议**,不直接指向外网 CDN:
 *
 *   - 外网 CDN(之前是 Data Dragon)在国服网络里经常拉不动,表现就是
 *     「英雄名有、头像和装备全是空的」;
 *   - 客户端自己就带全套图标(`/lol-game-data/assets/v1/...`),走本机回环
 *     一定通,还省掉外网往返;
 *   - 自定义协议由主进程代理,鉴权头和磁盘缓存都在主进程里处理,
 *     渲染进程只管 `<img src="lcuicon://champion/266.png">`。
 *
 * 这个文件不许 import 任何东西 —— 渲染进程也要用它拼 URL。
 */

export const ICON_SCHEME = 'lcuicon';

export type IconKind = 'champion' | 'item';

export interface IconRef {
  kind: IconKind;
  id: number;
}

/** 渲染进程拼图标 URL 用。 */
export function lcuIconUrl(kind: IconKind, id: number): string {
  return `${ICON_SCHEME}://${kind}/${id}.png`;
}

/** 反解 `lcuicon://champion/266.png`;不是图标 URL 就返回 null。 */
export function parseLcuIconUrl(raw: string): IconRef | null {
  const matched = /^lcuicon:\/\/(champion|item)\/(\d+)\.png(?:\?.*)?$/.exec(raw);
  if (!matched) return null;

  const id = Number(matched[2]);
  if (!Number.isInteger(id) || id <= 0) return null;

  return { kind: matched[1] as IconKind, id };
}
