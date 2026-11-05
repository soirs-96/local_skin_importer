import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { DevLogLine } from '../../../shared/dev';

/** 控制台保留多少行。 */
const MAX_LINES = 2000;

/**
 * 开发日志控制台的数据。
 *
 * 跟业务运行记录(`stores/log`)是分开的两份 —— 那份记的是「同步到第几条」,
 * 这份记的是「报了什么」,混在一起两边都不好读。
 */
export const useConsoleStore = defineStore('devConsole', () => {
  // shallowRef:行对象不会被改,只增不换 —— 深响应式在这里纯属浪费。
  const lines = shallowRef<DevLogLine[]>([]);
  /** 主进程已经收到的最大序号,用来给「历史回放 / 实时推送」去重。 */
  const lastMainSeq = ref(0);

  function append(list: DevLogLine[]): void {
    if (list.length === 0) return;
    let next = lines.value.concat(list);
    if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
    lines.value = next;
  }

  /** 追加一条实时日志。 */
  function push(line: DevLogLine): void {
    if (line.src === 'main') {
      if (line.seq === undefined || line.seq <= lastMainSeq.value) return;
      lastMainSeq.value = line.seq;
    }
    append([line]);
  }

  /**
   * 合并主进程的历史日志。
   *
   * 历史是按时间排的,渲染进程自己那部分也是 —— 合并完得重新按时间排一次,
   * 不然时间线会乱。
   */
  function mergeBacklog(backlog: DevLogLine[]): void {
    const fresh: DevLogLine[] = [];
    for (const line of backlog) {
      if (line.seq === undefined || line.seq <= lastMainSeq.value) continue;
      fresh.push(line);
      lastMainSeq.value = line.seq;
    }
    if (fresh.length === 0) return;
    append(fresh);
    lines.value = [...lines.value].sort((a, b) => a.ts - b.ts);
  }

  function clear(): void {
    lines.value = [];
  }

  return { lines, lastMainSeq, push, mergeBacklog, clear };
});
