import { defineStore } from 'pinia';
import { ref } from 'vue';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
}

const MAX_LINES = 200;

/**
 * 运行记录。普通界面不展示,只出现在开发者面板里。
 */
export const useLogStore = defineStore('log', () => {
  const lines = ref<LogLine[]>([]);

  function push(level: LogLevel, msg: string): void {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    lines.value.push({ ts, level, msg });
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  }

  function clear(): void {
    lines.value = [];
  }

  return { lines, push, clear };
});
