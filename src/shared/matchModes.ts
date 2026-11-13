/**
 * 战绩的模式分组 —— 给「战绩筛选」的下拉用。
 *
 * 跟 `gameLabels.ts` 分开放:那边管的是**一行对局旁边显示什么**
 * (认不出来的宁可空着),这边管的是**下拉框里能选什么** —— 得能选全,
 * 所以每个队列号都得有归属。
 */

import { SUMMONERS_RIFT_MAP_ID } from './gameLabels';

/** 判定一局属于什么模式要用的字段。 */
export interface MatchModeGame {
  mapId: number;
  queueId: number;
}

/** 大乱斗的地图编号 —— 嚎哭深渊。 */
const HOWLING_ABYSS_MAP_ID = 12;

/** 普通匹配的队列号 —— 召唤师峡谷的非排位对局。 */
const NORMAL_QUEUE_ID = 2400;

export interface MatchModeGroup {
  key: string;
  label: string;
  /** 这一组收哪些局 */
  matches: (game: MatchModeGame) => boolean;
}

/**
 * 模式分组。
 *
 * **大乱斗按地图认,不按队列号** —— 那边的队列号版本之间会变,认地图才稳。
 * 极限闪击跑在召唤师峡谷上,只能靠队列号认。
 *
 * 顺序就是下拉框里的顺序:先常见的在前。
 */
export const MATCH_MODE_GROUPS: MatchModeGroup[] = [
  {
    key: 'normal',
    label: '匹配模式',
    matches: (game) =>
      game.mapId === SUMMONERS_RIFT_MAP_ID && game.queueId === NORMAL_QUEUE_ID
  },
  {
    key: 'aram',
    label: '极限大乱斗',
    matches: (game) => game.mapId === HOWLING_ABYSS_MAP_ID
  },
  {
    key: 'solo',
    label: '单双排',
    matches: (game) =>
      game.mapId === SUMMONERS_RIFT_MAP_ID && (game.queueId === 420 || game.queueId === 440)
  },
  {
    key: 'flex',
    label: '灵活排位',
    matches: (game) => game.mapId === SUMMONERS_RIFT_MAP_ID && game.queueId === 400
  },
  {
    key: 'urf',
    label: '极限闪击',
    matches: (game) => game.mapId === SUMMONERS_RIFT_MAP_ID && game.queueId === 490
  }
];

/** 「全部模式」这个选项的 key。 */
export const ALL_MODES = 'all';

/** 已知模式的排序用 —— 未知模式排最后。 */
const GROUP_ORDER = new Map(MATCH_MODE_GROUPS.map((group, index) => [group.key, index]));

/**
 * 这一局属于哪个模式。
 *
 * 认不出来的队列号**不猜** —— 归到 `queue:<队列号>`,
 * 至少不同的未知模式还分得开。
 */
export function matchModeKey(game: MatchModeGame): string {
  const group = MATCH_MODE_GROUPS.find((item) => item.matches(game));
  return group ? group.key : `queue:${game.queueId}`;
}

/** 这一局属于哪个模式的中文名。 */
export function matchModeLabel(game: MatchModeGame): string {
  const group = MATCH_MODE_GROUPS.find((item) => item.matches(game));
  return group ? group.label : `其他模式 #${game.queueId}`;
}

/** 下拉选项 —— 一个模式一项。 */
export interface MatchModeOption {
  key: string;
  label: string;
  /** 已加载的对局里有多少局是这个模式 */
  count: number;
}

/**
 * 下拉框该有哪些选项。
 *
 * **只列已加载的对局里真实存在的模式** —— 列出没有数据的模式,
 * 点进去是个空列表,反而让人以为坏了。
 */
export function matchModeOptions(games: MatchModeGame[]): MatchModeOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const game of games) {
    const key = matchModeKey(game);
    const entry = counts.get(key) ?? { label: matchModeLabel(game), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  return [...counts.entries()]
    .map(([key, entry]) => ({ key, label: entry.label, count: entry.count }))
    .sort((a, b) => {
      const diff = (GROUP_ORDER.get(a.key) ?? 99) - (GROUP_ORDER.get(b.key) ?? 99);
      return diff !== 0 ? diff : b.count - a.count;
    });
}

/** 按模式过滤对局。`ALL_MODES` 表示不过滤。 */
export function filterByMatchMode<T extends MatchModeGame>(games: T[], key: string): T[] {
  if (key === ALL_MODES) return games;
  return games.filter((game) => matchModeKey(game) === key);
}
