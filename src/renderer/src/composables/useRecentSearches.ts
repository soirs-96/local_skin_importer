import { ref } from 'vue';
import {
  parseRecentSearches,
  pushRecentSearch,
  RECENT_SEARCHES_STORAGE_KEY
} from '../utils/recentSearches';

/**
 * 最近查过谁。
 *
 * 存在 localStorage —— 这是这台机器上这个应用的浏览痕迹,不上传、不出网。
 */

/** 读出来。存坏了就当没有。 */
function read(): string[] {
  try {
    return parseRecentSearches(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** 存回去。存不了就算了 —— 本次运行照样能看。 */
function save(list: string[]): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 存不了就算了
  }
}

const items = ref<string[]>(read());

export function useRecentSearches(): {
  items: typeof items;
  remember: (query: string) => void;
  clear: () => void;
} {
  /** 记一条(查到了才记 —— 没查到的不算)。 */
  function remember(query: string): void {
    const next = pushRecentSearch(items.value, query);
    if (next.length === items.value.length && next[0] === items.value[0]) return;
    items.value = next;
    save(next);
  }

  function clear(): void {
    items.value = [];
    save([]);
  }

  return { items, remember, clear };
}
