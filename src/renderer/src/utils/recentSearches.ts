/**
 * 最近查询记录的纯逻辑 —— 不碰 localStorage,好测。
 */

/** 存最近查询的 localStorage 键。 */
export const RECENT_SEARCHES_STORAGE_KEY = 'hx-recent-searches';

/** 最多留几条 —— 留着的都是最近用过的,再多就成历史了。 */
export const RECENT_SEARCHES_LIMIT = 5;

/** 把存下来的值解析成列表;认不出来就当没有 —— 存坏了不该让应用起不来。 */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== ''
    );
  } catch {
    return [];
  }
}

/**
 * 加一条查询记录。
 *
 * - 同样的查询串**移到最前面** —— 刚查过的东西应该排最前;
 * - 空串不算;
 * - 超过上限的砍掉。
 */
export function pushRecentSearch(
  list: string[],
  query: string,
  limit = RECENT_SEARCHES_LIMIT
): string[] {
  const value = query.trim();
  if (!value) return list;
  const rest = list.filter((item) => item !== value);
  return [value, ...rest].slice(0, limit);
}
