import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { RosterPlayer } from '../../../shared/roster';
import { summarizeRosterScore, type RosterScore } from '../../../shared/scoring';

/**
 * 「对局双方」卡上每个人的评分。
 *
 * 分数来自**腾讯的对局服务**(客户端那层只给得出自己的战绩),所以每个人
 * 都要单独拉一次 —— 这张卡要是不做缓存,轮询器每 2 秒推一次快照就会
 * 把腾讯那边打一遍。
 *
 * 三道闸:
 *
 *   - **缓存**:同一个 puuid 十分钟内不重拉(缓存是模块级的,页面来回切也留着);
 *   - **并发**:同时最多三个请求 —— 一次甩十个过去,腾讯会限流;
 *   - **失败退避**:拉失败不立刻重试,一分钟后再试 —— 令牌失效那种情况
 *     重试再快也没用。连着失败三次就放弃,等人点「刷新」。
 */

/** 每人拉多少局来算分。10 局 —— 载荷小一半,选人阶段等得起。 */
const GAME_COUNT = 10;

/** 同时发几个请求。 */
const CONCURRENCY = 3;

/** 同一个人的分多久之内不重拉。 */
const CACHE_TTL_MS = 10 * 60_000;

/** 拉失败之后等多久再试。 */
const FAIL_RETRY_MS = 60_000;

/** 连着失败几次就放弃 —— 客户端没开的时候一直重试是白费劲。 */
const MAX_FAILURES = 3;

/** puuid → 评分。模块级 —— 组件重挂载不用重拉。 */
const cache = new Map<string, { score: RosterScore; fetchedAt: number }>();

/** 拉失败的情况 —— 用来做退避和放弃。 */
interface Failure {
  /** 连续失败了几次 */
  count: number;
  /** 最后一次失败的时刻 */
  at: number;
}

const failures = new Map<string, Failure>();

/** 清缓存(测试用,页面上的「刷新」也走这里)。 */
export function clearRosterScoreCache(): void {
  cache.clear();
  failures.clear();
}

/**
 * 多久检查一次。
 *
 * 名单不变的时候没人会重新触发 —— 得自己定期看一眼,不然:
 *   - 失败退避到期了没人重试,那个人永远停在「—」;
 *   - 缓存十分钟后过期了,但没人重新去拉。
 */
const TICK_MS = 30_000;

function without(record: Record<string, boolean>, key: string): Record<string, boolean> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export interface RosterScores {
  /** puuid → 评分 */
  scores: Ref<Record<string, RosterScore>>;
  /** 正在算分的人 */
  loading: Ref<Record<string, boolean>>;
  /** 拉失败的人 */
  failed: Ref<Record<string, boolean>>;
  /** 把缓存清掉重算一遍 */
  refresh: () => void;
}

/** 评分那一列的显示态。 */
export type RosterScoreState =
  /** 还在算 */
  | 'loading'
  /** 有排位数据 */
  | 'value'
  /** 这个人最近没有排位 */
  | 'none'
  /** 拉不到 —— 没 puuid,或者腾讯那边报错了 */
  | 'unknown';

export interface RosterScoreDisplay {
  state: RosterScoreState;
  /** 分数,一位小数;只有 value 态有值 */
  value: string;
  /** 「10 场 · 6 胜」这样的副行 */
  meta: string;
  /** 悬浮提示:说清楚这个分是怎么来的 */
  title: string;
}

/**
 * 算出评分那一列要显示什么。
 *
 * **不给假分数** —— 拉不到就是拉不到,显示一个横杠。
 */
export function describeRosterScore(
  puuid: string,
  scores: Record<string, RosterScore>,
  loading: Record<string, boolean>
): RosterScoreDisplay {
  const blank: RosterScoreDisplay = { state: 'unknown', value: '', meta: '', title: '' };
  if (!puuid) return blank;
  if (loading[puuid]) return { ...blank, state: 'loading' };

  const score = scores[puuid];
  if (!score) return blank;
  if (score.games === 0) {
    return { ...blank, state: 'none', title: '最近 10 局里没有排位' };
  }
  const position = score.positionLabel ? ` · 主要位置 ${score.positionLabel}` : '';
  return {
    state: 'value',
    value: score.score.toFixed(1),
    meta: `${score.games} 场 · ${score.wins} 胜`,
    title: `最近 ${score.games} 场排位的评分${position}`
  };
}

export function useRosterScores(players: () => RosterPlayer[]): RosterScores {
  const scores = ref<Record<string, RosterScore>>({});
  const loading = ref<Record<string, boolean>>({});
  const failed = ref<Record<string, boolean>>({});

  const queue: string[] = [];
  const queued = new Set<string>();
  let running = 0;

  async function load(puuid: string): Promise<void> {
    loading.value = { ...loading.value, [puuid]: true };
    try {
      const summary = await window.api.fetchPlayerGames(puuid, 0, GAME_COUNT);
      const score = summarizeRosterScore(summary.games);
      cache.set(puuid, { score, fetchedAt: Date.now() });
      failures.delete(puuid);
      scores.value = { ...scores.value, [puuid]: score };
      failed.value = without(failed.value, puuid);
    } catch {
      // 拉不到就当没有 —— 界面上留个「—」,不显示一个假分数。
      const previous = failures.get(puuid);
      failures.set(puuid, { count: (previous?.count ?? 0) + 1, at: Date.now() });
      failed.value = { ...failed.value, [puuid]: true };
    } finally {
      loading.value = without(loading.value, puuid);
    }
  }

  function pump(): void {
    while (running < CONCURRENCY && queue.length > 0) {
      const puuid = queue.shift()!;
      queued.delete(puuid);
      running += 1;
      void load(puuid).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  function enqueue(puuid: string): void {
    if (queued.has(puuid) || loading.value[puuid]) return;
    queued.add(puuid);
    queue.push(puuid);
    pump();
  }

  function ensure(puuid: string): void {
    if (!puuid) return;

    const hit = cache.get(puuid);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      const current = scores.value[puuid];
      // 同样的分就别再塞一遍 —— 名单每 2 秒动一次,值没变却改引用会让界面空转。
      if (!current || current.score !== hit.score.score || current.games !== hit.score.games) {
        scores.value = { ...scores.value, [puuid]: hit.score };
      }
      return;
    }

    const failure = failures.get(puuid);
    if (failure) {
      // 连着失败太多次就放弃 —— 等用户点「刷新」。
      if (failure.count >= MAX_FAILURES) return;
      // 退避没到期就再等等 —— 令牌失效那种情况,重试再快也没用。
      if (Date.now() - failure.at < FAIL_RETRY_MS) return;
    }

    enqueue(puuid);
  }

  // 名单变了才动 —— 快照每 2 秒推一次,人没换就别重拉。
  watch(
    () => players().map((player) => player.puuid).join('|'),
    () => {
      for (const player of players()) ensure(player.puuid);
    },
    { immediate: true }
  );

  // 定期检查 —— 退避到期了要重试,缓存过期了要重拉。
  // 名单不变的时候没有别的东西会触发这两件事。
  const ticker = setInterval(() => {
    for (const player of players()) ensure(player.puuid);
  }, TICK_MS);

  // 组件没了就别再转了。
  onScopeDispose(() => clearInterval(ticker));

  function refresh(): void {
    // 清缓存也会清失败次数 —— 用户点了「刷新」就是想让一切重来。
    clearRosterScoreCache();
    scores.value = {};
    failed.value = {};
    for (const player of players()) ensure(player.puuid);
  }

  return { scores, loading, failed, refresh };
}
