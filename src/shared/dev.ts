/**
 * 开发日志(控制台)的共享契约。
 *
 * 主进程和渲染进程都要用:主进程把日志转发过来,渲染进程自己也采集。
 * 放在 shared 下是因为两边都要引,preload 也要引。
 */

export const DEV_LOG_CHANNEL = 'dev:log';

/** 日志级别 —— 三档够用,也好过滤。 */
export type DevLogLevel = 'INFO' | 'WARN' | 'ERROR';

/** 日志来自哪个进程。 */
export type DevLogSource = 'main' | 'renderer';

export interface DevLogLine {
  /** 产生日志的时刻(epoch ms)。 */
  ts: number;
  level: DevLogLevel;
  src: DevLogSource;
  msg: string;
  /**
   * 主进程日志的全局递增序号。
   *
   * 「历史回放」和「实时推送」会撞车 —— 同一行可能被送两遍。用序号去重。
   * 渲染进程自己产生的日志没有这个概念,不带这个字段。
   */
  seq?: number;
}

/**
 * 把 console.* 的参数拼成一段文本。
 *
 * Error 要带堆栈 —— 排查时没有堆栈等于没日志。
 */
export function formatConsoleArgs(args: unknown[]): string {
  return args.map((a) => formatValue(a)).join(' ');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'object') {
    if (value instanceof Error) {
      // V8 的 stack 开头就是 "Error: message",别再拼一遍。
      return value.stack || `${value.name}: ${value.message}`;
    }
    return stringify(value);
  }
  return String(value);
}

/** JSON 序列化,循环引用不会炸。 */
function stringify(value: object): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}
