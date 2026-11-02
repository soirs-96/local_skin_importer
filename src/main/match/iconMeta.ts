/**
 * 图标代理用到的 Data Dragon 元数据。
 *
 * 客户端自带的图标是首选,但万一拿不到(客户端版本换了资源路径),图标代理
 * 会退到 Data Dragon。这时候需要两样静态数据里才有的东西:
 *
 *   - **版本号** —— Data Dragon 的图片路径是 `cdn/{版本}/img/...`;
 *   - **英雄的图片文件名** —— 英雄图标按英文名命名(`Aatrox.png`),
 *     而客户端给的是数字 id,两者对不上。
 *
 * 静态数据加载完之后登记一份在这儿(图标代理来取),两边不直接互相引用,
 * 免得静态数据模块把 Electron 的依赖拖进来。
 */

export interface IconMeta {
  /** Data Dragon 版本号;null = 没拿到 */
  version: string | null;
  /** 英雄 id → Data Dragon 上的图片文件名(Aatrox.png) */
  championFiles: Map<number, string>;
}

const EMPTY: IconMeta = { version: null, championFiles: new Map() };

let current: IconMeta = EMPTY;

export function setIconMeta(meta: IconMeta): void {
  current = meta;
}

export function getIconMeta(): IconMeta {
  return current;
}
