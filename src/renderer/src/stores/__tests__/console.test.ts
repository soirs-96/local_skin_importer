import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useConsoleStore } from '../console';
import type { DevLogLine } from '../../../../shared/dev';

function mainLine(seq: number, msg: string, ts = seq): DevLogLine {
  return { seq, ts, level: 'INFO', src: 'main', msg };
}

function uiLine(msg: string, ts = 0): DevLogLine {
  return { ts, level: 'ERROR', src: 'renderer', msg };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('console store', () => {
  it('追加的日志进列表', () => {
    const store = useConsoleStore();
    store.push(uiLine('出错了'));
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0].msg).toBe('出错了');
  });

  it('主进程日志按序号去重 —— 历史回放和实时推送会撞车', () => {
    const store = useConsoleStore();
    store.push(mainLine(1, '第一条'));
    store.push(mainLine(1, '第一条'));
    store.push(mainLine(2, '第二条'));
    expect(store.lines.map((l) => l.msg)).toEqual(['第一条', '第二条']);
  });

  it('合并历史时不重复收已经收过的', () => {
    const store = useConsoleStore();
    store.push(mainLine(1, '第一条'));
    store.mergeBacklog([mainLine(1, '第一条'), mainLine(2, '第二条')]);
    expect(store.lines.map((l) => l.msg)).toEqual(['第一条', '第二条']);
  });

  it('合并历史后按时间重新排序', () => {
    const store = useConsoleStore();
    store.push(uiLine('界面上的', 500));
    store.mergeBacklog([mainLine(1, '主进程早的', 100)]);
    expect(store.lines.map((l) => l.msg)).toEqual(['主进程早的', '界面上的']);
  });

  it('渲染进程的日志不参与序号去重', () => {
    const store = useConsoleStore();
    store.push(uiLine('一'));
    store.push(uiLine('二'));
    expect(store.lines).toHaveLength(2);
  });

  it('超过上限就丢最老的', () => {
    const store = useConsoleStore();
    for (let i = 0; i < 2100; i += 1) {
      store.push(uiLine(`第 ${i} 行`, i));
    }
    expect(store.lines).toHaveLength(2000);
    expect(store.lines[0].msg).toBe('第 100 行');
  });

  it('清空', () => {
    const store = useConsoleStore();
    store.push(uiLine('一'));
    store.clear();
    expect(store.lines).toHaveLength(0);
  });
});
