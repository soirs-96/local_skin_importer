import { describe, expect, it } from 'vitest';
import {
  parseRecentSearches,
  pushRecentSearch,
  RECENT_SEARCHES_LIMIT
} from '../recentSearches';

describe('parseRecentSearches', () => {
  it('解析存下来的列表', () => {
    expect(parseRecentSearches('["甲#CN1","乙#CN2"]')).toEqual(['甲#CN1', '乙#CN2']);
  });

  it('存坏了就当没有 —— 不能让应用起不来', () => {
    expect(parseRecentSearches('not json')).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches(undefined)).toEqual([]);
  });

  it('不是字符串的丢掉', () => {
    expect(parseRecentSearches('["甲",1,null,""]')).toEqual(['甲']);
  });
});

describe('pushRecentSearch', () => {
  it('新记录排最前', () => {
    expect(pushRecentSearch(['甲#CN1'], '乙#CN2')).toEqual(['乙#CN2', '甲#CN1']);
  });

  it('查过的人移到最前,不去重成两条', () => {
    expect(pushRecentSearch(['甲#CN1', '乙#CN2'], '甲#CN1')).toEqual(['甲#CN1', '乙#CN2']);
  });

  it('最多留五条', () => {
    let list: string[] = [];
    for (let i = 1; i <= 8; i += 1) list = pushRecentSearch(list, `人${i}`);

    expect(list).toHaveLength(RECENT_SEARCHES_LIMIT);
    expect(list[0]).toBe('人8');
    expect(list).not.toContain('人1');
  });

  it('空串不算', () => {
    expect(pushRecentSearch(['甲#CN1'], '   ')).toEqual(['甲#CN1']);
  });
});
