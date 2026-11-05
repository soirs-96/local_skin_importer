import { describe, expect, it } from 'vitest';
import { formatConsoleArgs } from '../dev';

describe('formatConsoleArgs', () => {
  it('字符串原样输出', () => {
    expect(formatConsoleArgs(['客户端检测失败'])).toBe('客户端检测失败');
  });

  it('多个参数用空格隔开', () => {
    expect(formatConsoleArgs(['端口', 55102])).toBe('端口 55102');
  });

  it('Error 要带堆栈 —— 排查时没堆栈等于没日志', () => {
    const err = new Error('连不上客户端');
    const out = formatConsoleArgs([err]);
    expect(out).toContain('连不上客户端');
    expect(out).toContain('at ');
  });

  it('null / undefined 不丢', () => {
    expect(formatConsoleArgs([null, undefined])).toBe('null undefined');
  });

  it('对象转成 JSON', () => {
    expect(formatConsoleArgs([{ port: 55102 }])).toBe('{"port":55102}');
  });

  it('循环引用不会炸', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = formatConsoleArgs([a]);
    expect(out).toContain('Circular');
  });

  it('函数标出来,不打印源码', () => {
    expect(formatConsoleArgs([function myFn() {}])).toBe('[Function myFn]');
  });
});
