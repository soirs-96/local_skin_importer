/*
 * 主题要在第一帧之前定下来 —— 不然会先闪一下默认配色再切过去。
 *
 * 这个文件不进打包器(public/ 原样拷过去),index.html 里同步加载它。
 * 逻辑跟 src/renderer/src/utils/theme.ts 一样,改的时候两处一起改。
 */
(function () {
  var KEY = 'hx-theme';
  var saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  var mode =
    saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  var root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
})();
