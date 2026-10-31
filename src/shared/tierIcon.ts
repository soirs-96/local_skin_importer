/**
 * 段位徽章:自己画一段 SVG,不依赖外部图床。
 *
 * 段位徽章的 CDN 路径随时会变,第三方图床在国内还经常连不上 ——
 * 自己画一张几百字节的 SVG,零网络延迟,也不会出现「图标在两个状态之间闪烁」。
 *
 * 主进程和渲染进程都要用,所以放在 shared 里。base64 用 `btoa` 而不是
 * Buffer:渲染进程没有 Buffer,而 `btoa` 在浏览器和 Node 16+ 上都有。
 */

/** 段位配色:底色渐变 + 前景字母。跟游戏内段位色系对齐。 */
const TIER_PALETTE: Record<string, { dark: string; bright: string; initial: string }> = {
  IRON: { dark: '#3a2a1c', bright: '#8a6e4b', initial: 'I' },
  BRONZE: { dark: '#5a3a1c', bright: '#b08d57', initial: 'B' },
  SILVER: { dark: '#3a4a55', bright: '#b9c3cc', initial: 'S' },
  GOLD: { dark: '#6a4a14', bright: '#f0c75e', initial: 'G' },
  PLATINUM: { dark: '#1c5a4a', bright: '#5cc7a3', initial: 'P' },
  EMERALD: { dark: '#0e5a4a', bright: '#2dc3a4', initial: 'E' },
  DIAMOND: { dark: '#1a3a7a', bright: '#7aa2f7', initial: 'D' },
  MASTER: { dark: '#3a1a5a', bright: '#c97af7', initial: 'M' },
  GRANDMASTER: { dark: '#5a1a1a', bright: '#f76a6a', initial: 'G' },
  CHALLENGER: { dark: '#5a4a14', bright: '#f7c75e', initial: 'C' }
};

const ROMAN_DIVISIONS = ['IV', 'III', 'II', 'I'];

/** base64 编码。SVG 全是 ASCII,但仍然走一遍 UTF-8 转义免得以后加中文标签翻车。 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function tierIconDataUrl(tier: string, division = ''): string | null {
  const palette = TIER_PALETTE[tier.toUpperCase()];
  if (!palette) return null;
  const { dark, bright, initial } = palette;

  const div = division.toUpperCase().trim();
  const divLabel = ROMAN_DIVISIONS.includes(div)
    ? `<text x="50" y="68" text-anchor="middle" font-family="Georgia, serif" ` +
      `font-weight="700" font-size="14" fill="${bright}">${div}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${bright}"/><stop offset="100%" stop-color="${dark}"/>` +
    `</linearGradient></defs>` +
    `<path d="M50 4 L92 18 L92 56 Q92 80 50 96 Q8 80 8 56 L8 18 Z" ` +
    `fill="url(#g)" stroke="${bright}" stroke-width="2"/>` +
    `<text x="50" y="48" text-anchor="middle" font-family="Georgia, serif" ` +
    `font-weight="800" font-size="32" fill="#1a1206">${initial}</text>` +
    `${divLabel}</svg>`;

  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}
