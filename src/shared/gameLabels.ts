/**
 * 对局地图 / 队列 / 定位的中文标签。
 *
 * 腾讯的对局接口给的是 `mapId` + `queueId` + `lane` + `role`,
 * 界面上要显示中文名 —— 这里放一份映射,主进程和渲染进程共用一份,
 * 免得同一局在两个页面上显示成两个名字。
 *
 * 这个文件不许 import 任何东西(理由同 rankLabels.ts)。
 */

/**
 * 地图编号 → 地图名。
 *
 * **只认 mapId,不认 gameMode** —— 腾讯这批数据里 `gameMode` 恒是 `KIWI`,
 * 大乱斗和召唤师峡谷都给它,拿它当模式判据必然标错。mapId 才是那张图。
 */
export const MAP_ID_LABELS: Record<number, string> = {
  11: '召唤师峡谷',
  12: '大乱斗'
};

/** 召唤师峡谷的地图编号 —— 只有这张地图有「上下路」的概念。 */
export const SUMMONERS_RIFT_MAP_ID = 11;

/**
 * 数字队列号 → 队列名。
 *
 * 只收有把握的 —— 认不出来的队列宁可不显示,也不给一个可能错的名字。
 *
 * 2400 故意不收:它是召唤师峡谷的普通匹配(腾讯的 tags 里也标着 `normal`),
 * 显示出来等于在每一行都写一句「普通匹配」,没有信息量。
 *
 * 450 / 490 也不收:那两个队列(大乱斗、极限闪击)的地图名已经由 mapId 给了,
 * 再写一遍就是「大乱斗 · 嚎哭深渊」这种废话。
 */
export const QUEUE_ID_LABELS: Record<number, string> = {
  400: '灵活排位',
  420: '单双排',
  440: '单双排',
  1001: '云顶之弈',
  1002: '云顶之弈',
  1003: '云顶之弈',
  1004: '云顶之弈',
  1005: '云顶之弈',
  1006: '云顶之弈'
};

/**
 * 定位(Riot 的 role 字段)→ 中文。
 *
 * 大乱斗没有上下路,能说明白「这人打的什么位置」的只有这个字段。
 */
export const ROLE_LABELS: Record<string, string> = {
  SOLO: '独食',
  DUO: '双人组',
  CARRY: 'C 位',
  SUPPORT: '辅助'
};

/** 分路 → 中文。只在召唤师峡谷有意义。 */
export const LANE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手'
};

export function mapIdLabel(mapId: number): string {
  return MAP_ID_LABELS[mapId] ?? '';
}

export function queueIdLabel(queueId: number): string {
  return QUEUE_ID_LABELS[queueId] ?? '';
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role.toUpperCase()] ?? '';
}

export function laneLabel(lane: string): string {
  return LANE_LABELS[lane.toUpperCase()] ?? '';
}

/**
 * 一局的「地图 · 队列」标题。
 *
 * 排位显示成「召唤师峡谷 · 单双排」;大乱斗只有一个名字,显示一次就够。
 */
export function gameTitle(mapId: number, queueId: number): string {
  const map = mapIdLabel(mapId);
  const queue = queueIdLabel(queueId);
  if (!map) return queue;
  if (!queue || queue === map) return map;
  return `${map} · ${queue}`;
}

/**
 * 这一局该显示什么位置。
 *
 * - 召唤师峡谷:看分路(上单/打野/中单/射手)。
 * - 别的地图(大乱斗没有上下路):看定位,分路是载入时的站位,没有意义。
 * - 定位是辅助的一律显示「辅助」—— 射手位置上打辅助的人到处都是,
 *   按分路写会把辅助写成射手。
 */
export function positionLabel(mapId: number, lane: string, role: string): string {
  if (role.toUpperCase() === 'SUPPORT') return ROLE_LABELS.SUPPORT;
  if (mapId === SUMMONERS_RIFT_MAP_ID) return laneLabel(lane);
  return roleLabel(role);
}
