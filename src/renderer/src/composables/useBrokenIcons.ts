import { reactive } from 'vue';

/**
 * 记下加载失败的图标。
 *
 * 英雄/装备图标走 `lcuicon://` 自定义协议,主进程代理不到的时候 <img>
 * 会显示一个裂图标 —— 比没有图标还难看。加载失败的换成占位符。
 */
export function useBrokenIcons(): {
  isBroken: (url: string | null | undefined) => boolean;
  markBroken: (url: string | null | undefined) => void;
} {
  const broken = reactive(new Set<string>());

  function isBroken(url: string | null | undefined): boolean {
    return !!url && broken.has(url);
  }

  function markBroken(url: string | null | undefined): void {
    if (url) broken.add(url);
  }

  return { isBroken, markBroken };
}
