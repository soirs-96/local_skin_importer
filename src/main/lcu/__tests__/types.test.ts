import { describe, expect, it } from 'vitest';
import { FAILURE_CODES, FAILURE_SUMMARIES } from '../types';
import type { LcuFailureCode } from '../types';

describe('失败分类词汇表', () => {
  it('每个分类码都有对应文案', () => {
    for (const code of FAILURE_CODES) {
      expect(FAILURE_SUMMARIES[code], `分类 ${code} 缺文案`).toBeTruthy();
    }
  });

  it('文案键集合与分类码集合一致', () => {
    expect(Object.keys(FAILURE_SUMMARIES).sort()).toEqual([...FAILURE_CODES].sort());
  });

  it('文案互不重复 —— 界面上要能一眼分清', () => {
    const texts = FAILURE_CODES.map((c) => FAILURE_SUMMARIES[c]);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('每条文案都是中文且以句号结尾', () => {
    for (const code of FAILURE_CODES) {
      const text = FAILURE_SUMMARIES[code];
      expect(text, code).toMatch(/[一-龥]/);
      expect(text, code).toMatch(/[。！？]$/);
    }
  });

  it('分类码是联合类型里声明的那十个', () => {
    const expected: LcuFailureCode[] = [
      'client-not-running',
      'client-query-failed',
      'client-starting',
      'client-not-ready',
      'client-credentials-unavailable',
      'stale-credentials',
      'not-cn-client',
      'not-a-lcu',
      'scan-timeout',
      'unknown'
    ];
    expect([...FAILURE_CODES].sort()).toEqual([...expected].sort());
  });

  it('「没查到进程」和「没查成」是两回事,文案必须不同', () => {
    // 混在一起的话,用户明明开着客户端也会被告知「没检测到客户端」。
    expect(FAILURE_SUMMARIES['client-not-running']).not.toBe(
      FAILURE_SUMMARIES['client-query-failed']
    );
    expect(FAILURE_SUMMARIES['client-query-failed']).toMatch(/拦截|策略/);
  });
});
