/**
 * 开发者模式的口令与版本号。
 *
 * 口令是明文写死的 —— 这个客户端是自用工具,不追求安全,只追求「普通用户不会误进」。
 * 想换口令只改这一行,全仓库只有这里存着它。
 */
import pkg from '../../../../package.json';

export const DEV_PASSWORD = 'soirs541320';

/**
 * 开发日志控制台的口令。
 *
 * 跟开发者面板的口令分开设 —— 控制台会持续采集并转发主进程日志,
 * 门槛不该跟「看诊断信息」混为一谈。
 */
export const CONSOLE_PASSWORD = '701107';

/**
 * 登录页底部显示的版本号,同时是开发者模式的入口。
 *
 * **从 package.json 读,不在这里写死** —— 写死过一次,结果打包升了版本、
 * 界面还显示旧版本号,没法判断用户手上到底是哪个包。
 * 以后改版本只改 package.json 一处。
 */
export const APP_VERSION = `v${pkg.version}`;
