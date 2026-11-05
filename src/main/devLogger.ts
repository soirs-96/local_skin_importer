/**
 * 主进程的日志转发。
 *
 * 主进程里最值钱的报错都在这边(LCU 检测、axios 请求、轮询器)——
 * 界面上看不到 console.log,用户报障时手里只有一句「检测不到客户端」。
 * 这里把它们收集起来,渲染进程的控制台按需拉取。
 */
import { BrowserWindow } from 'electron';
import {
  DEV_LOG_CHANNEL,
  formatConsoleArgs,
  type DevLogLevel,
  type DevLogLine
} from '../shared/dev';

/** 主进程保留多少条历史。 */
const BACKLOG_LIMIT = 500;

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

let seq = 0;
const backlog: DevLogLine[] = [];
/** 有渲染进程在听的时候才往 IPC 推 —— 普通用户不该为调试功能付这份开销。 */
let attached = 0;

function levelOf(method: ConsoleMethod): DevLogLevel {
  if (method === 'warn') return 'WARN';
  if (method === 'error') return 'ERROR';
  return 'INFO';
}

function record(level: DevLogLevel, msg: string): void {
  const line: DevLogLine = { seq: ++seq, ts: Date.now(), level, src: 'main', msg };
  backlog.push(line);
  if (backlog.length > BACKLOG_LIMIT) backlog.splice(0, backlog.length - BACKLOG_LIMIT);
  if (attached === 0) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(DEV_LOG_CHANNEL, line);
  }
}

/**
 * 接管主进程的 console。
 *
 * 原实现照旧调用 —— 终端里照样能看见,只是多留一份给界面看。
 */
export function installMainConsoleBridge(): void {
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const methods: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];
  for (const method of methods) {
    const original = target[method].bind(console);
    target[method] = (...args: unknown[]): void => {
      original(...args);
      record(levelOf(method), formatConsoleArgs(args));
    };
  }
}

/** 渲染进程来要历史日志 —— 只给比它已经知道的更新的那些。 */
export function takeConsoleBacklog(afterSeq: number): DevLogLine[] {
  return backlog.filter((l) => l.seq !== undefined && l.seq > afterSeq);
}

/** 有渲染进程开始听实时日志。 */
export function attachConsole(): void {
  attached += 1;
}

/** 渲染进程不听了。 */
export function detachConsole(): void {
  attached = Math.max(0, attached - 1);
}
