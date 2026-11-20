import { ref, shallowRef } from 'vue';
import type { MySkinRating } from '../../../preload/index';

/**
 * 「我打过的评分」。
 *
 * 一次把全部拉回来,按**站内**皮肤 id(t_skin.id)建索引 —— 图鉴里上千款皮肤,
 * 逐个去查就是上千个请求。
 *
 * 浅拷贝 Map 换引用:shallowRef 里的 Map 不会被深度代理,
 * 改完要新建一个 Map 再赋值,否则界面不刷新。
 */
export function useSkinRatings() {
  const myRatings = shallowRef<Map<number, MySkinRating>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const list = await window.api.fetchMyRatings();
      const map = new Map<number, MySkinRating>();
      for (const item of list) {
        if (!item.skinId) continue;
        map.set(item.skinId, item);
      }
      myRatings.value = map;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function get(skinId: number): MySkinRating | null {
    return myRatings.value.get(skinId) ?? null;
  }

  function set(rating: MySkinRating): void {
    const map = new Map(myRatings.value);
    map.set(rating.skinId, rating);
    myRatings.value = map;
  }

  return { myRatings, loading, error, load, get, set };
}
