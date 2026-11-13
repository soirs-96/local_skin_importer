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
 * 位置(机器键)。
 *
 * `UNKNOWN` 不是「没位置」,是「**认不出来**」—— 腾讯那批数据偶尔分路是空的。
 * 认不出来的时候要说认不出来,不能瞎猜一个。
 */
export type PositionKey = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT' | 'UNKNOWN';

export const POSITION_LABELS: Record<PositionKey, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MID: '中单',
  ADC: '射手',
  SUPPORT: '辅助',
  UNKNOWN: '位置未识别'
};

/**
 * 定这个人在打什么位置。
 *
 * 腾讯的每个 participant 带两个字段:`lane`(载入时的分路)和 `role`(定位)。
 * 两个都会用,但优先级不一样:
 *
 * - **辅助最优先** —— 辅助玩家爱抢中路,`lane` 常写成 MIDDLE,但他确实是辅助。
 * - 分路说了算 —— lane 认得出来就直接用它定位置。
 * - 分路是空的 —— 退到定位(SOLO = 中单,CARRY = 射手)。
 * - 都认不出来 —— `UNKNOWN`。**不猜。**
 *
 * 大乱斗一律 `UNKNOWN` —— 那边的 `lane` 和 `role` 都是乱的。
 */
export function resolvePosition(mapId: number, lane: string, role: string): PositionKey {
  if (mapId !== SUMMONERS_RIFT_MAP_ID) return 'UNKNOWN';
  const r = role.toUpperCase();
  const l = lane.toUpperCase();
  if (r === 'SUPPORT') return 'SUPPORT';
  if (l === 'JUNGLE') return 'JUNGLE';
  if (l === 'MIDDLE' || l === 'MID') return 'MID';
  if (l === 'TOP') return 'TOP';
  if (l === 'BOTTOM' || l === 'BOT') return 'ADC';
  if (r === 'SOLO') return 'MID';
  if (r === 'CARRY') return 'ADC';
  return 'UNKNOWN';
}

/**
 * 这一局该显示什么位置。
 *
 * **只有召唤师峡谷才显示位置。** 大乱斗没有上下路,腾讯给的 `lane` 是载入时的
 * 站位、`role` 也是乱的,写出来只会误导人 —— 大乱斗一律不显示。
 *
 * 位置认不出来就**不显示** —— 界面上挂个「位置未识别」比写错位置强,
 * 但打标签的地方留空更干净(真要说明去看评分卡)。
 */
export function positionLabel(mapId: number, lane: string, role: string): string {
  if (mapId !== SUMMONERS_RIFT_MAP_ID) return '';
  const position = resolvePosition(mapId, lane, role);
  if (position === 'UNKNOWN') return '';
  return POSITION_LABELS[position];
}

/**
 * 客户端自己给的对局模式串(Riot 的 gameMode)。
 *
 * 只认两个认得出来的:'CLASSIC' = 召唤师峡谷,'ARAM' = 大乱斗。
 */
export const LCU_GAME_MODE_LABELS: Record<string, string> = {
  CLASSIC: '召唤师峡谷',
  ARAM: '大乱斗'
};

export function lcuGameModeLabel(gameMode: string): string {
  return LCU_GAME_MODE_LABELS[gameMode.toUpperCase()] ?? '';
}

/** 大乱斗 —— 没有上下路,位置那一栏就不该出现。 */
export function isAramMode(gameMode: string): boolean {
  return gameMode.toUpperCase() === 'ARAM';
}

/**
 * 客户端 gameflow 的阶段 → 中文。
 *
 * 只收认得出来的;认不出就空着 —— 不给一个可能错的状态名。
 */
export const LCU_PHASE_LABELS: Record<string, string> = {
  None: '空闲',
  Lobby: '大厅',
  ChampSelect: '选人',
  InProgress: '对局中',
  WaitingForStats: '等待结算',
  PreEndOfGame: '对局结束',
  EndOfGame: '对局结束',
  PostGame: '对局结束'
};

export function lcuPhaseLabel(phase: string): string {
  return LCU_PHASE_LABELS[phase] ?? '';
}
