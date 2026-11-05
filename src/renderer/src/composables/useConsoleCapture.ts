import type { Pinia } from 'pinia';
import { useConsoleStore } from '../stores/console';
import { formatConsoleArgs, type DevLogLevel } from '../../../shared/dev';

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

function levelOf(method: ConsoleMethod): DevLogLevel {
  if (method === 'warn') return 'WARN';
  if (method === 'error') return 'ERROR';
  return 'INFO';
}

/**
 * 接管渲染进程的 console,顺带收未捕获的异常。
 *
 * **应用一启动就装上** —— 用户往往是先撞了错、过一会儿才想起来打开控制台。
 * 早装一秒就多留一秒的现场。
 */
export function installConsoleCapture(pinia: Pinia): void {
  const store = useConsoleStore(pinia);

  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const methods: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];
  for (const method of methods) {
    const original = target[method].bind(console);
    target[method] = (...args: unknown[]): void => {
      original(...args);
      store.push({
        ts: Date.now(),
        level: levelOf(method),
        src: 'renderer',
        msg: formatConsoleArgs(args)
      });
    };
  }

  window.addEventListener('error', (e: ErrorEvent) => {
    const detail = e.error instanceof Error ? e.error.stack : '';
    store.push({
      ts: Date.now(),
      level: 'ERROR',
      src: 'renderer',
      msg: detail ? e.message + '\n' + detail : e.message
    });
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    store.push({
      ts: Date.now(),
      level: 'ERROR',
      src: 'renderer',
      msg: '未处理的 Promise 拒绝: ' + formatConsoleArgs([e.reason])
    });
  });

  window.api.onDevLog((line) => {
    store.push(line);
  });
}

/** 控制台打开:挂上主进程的实时日志,并把之前的历史捞回来。 */
export async function attachConsole(): Promise<void> {
  const store = useConsoleStore();
  const backlog = await window.api.attachConsole(store.lastMainSeq);
  store.mergeBacklog(backlog);
}

/** 控制台关闭:主进程不用再往这边推了。 */
export async function detachConsole(): Promise<void> {
  await window.api.detachConsole();
}
