/**
 * 对局模式 / 队列 / 分路的中文标签。
 *
 * 腾讯的对局接口给的是模式代号(CLASSIC / ARAM / KIWI)和数字队列号,
 * 界面上要显示中文名 —— 这里放一份映射,主进程和渲染进程共用一份,
 * 免得同一局在两个页面上显示成两个名字。
 *
 * 这个文件不许 import 任何东西(理由同 rankLabels.ts)。
 */

/** 模式代号 → 中文模式名。 */
export const GAME_MODE_LABELS: Record<string, string> = {
  CLASSIC: '召唤师峡谷',
  ARAM: '嚎哭深渊',
  URF: '极限闪击',
  TFT: '云顶之弈',
  KIWI: '排位赛',
  ONEFORALL: '斗魂竞技场',
  NEXUS: '斗魂竞技场',
  DISRUPTION: '斗魂竞技场',
  TUTORIAL: '新手教程',
  PRACTICE: '训练模式',
  ASSASSINATE: '刺客信条',
  PROJECT: '斗魂竞技场',
  FIRSTBLOOD: '第一滴血',
  SIEGE: '枢纽',
  RIFTS: '无限乱斗'
};

/**
 * 数字队列号 → 队列名。
 *
 * 只收有把握的 —— 认不出来的队列宁可不显示,也不给一个可能错的名字。
 */
export const QUEUE_ID_LABELS: Record<number, string> = {
  400: '灵活排位',
  420: '单双排',
  440: '单双排',
  450: '嚎哭深渊',
  490: '极限闪击',
  1001: '云顶之弈',
  1002: '云顶之弈',
  1003: '云顶之弈',
  1004: '云顶之弈',
  1005: '云顶之弈',
  1006: '云顶之弈',
  2400: '召唤师峡谷'
};

/** 分路 → 中文。 */
export const LANE_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '射手',
  NONE: ''
};

export function gameModeLabel(gameMode: string): string {
  return GAME_MODE_LABELS[gameMode.toUpperCase()] ?? '';
}

export function queueIdLabel(queueId: number): string {
  return QUEUE_ID_LABELS[queueId] ?? '';
}

export function laneLabel(lane: string): string {
  return LANE_LABELS[lane.toUpperCase()] ?? '';
}

/**
 * 一局的「模式 · 队列」标题。
 *
 * 排位赛要显示成「排位赛 · 单双排」;大乱斗只有一个名字,显示一次就够。
 */
export function gameTitle(gameMode: string, queueId: number): string {
  const mode = gameModeLabel(gameMode);
  const queue = queueIdLabel(queueId);
  if (!mode) return queue;
  if (!queue || queue === mode) return mode;
  return `${mode} · ${queue}`;
}

/**
 * 有排位段的队列号。
 *
 * 只有这几个是真的排位(单双排 / 灵活排位 / 组队单双排),
 * 大乱斗、极限闪击这些正常匹配没有段位。
 */
const RANKED_QUEUE_IDS = new Set([400, 420, 440]);

/**
 * 这一局算不算排位。
 *
 * 两个依据取并:模式代号是 KIWI 的就是排位;队列号在排位集合里的也是。
 * 腾讯这两个字段的口径不完全一致,只看一个会漏。
 */
export function isRankedGame(gameMode: string, queueId: number): boolean {
  if (gameMode.toUpperCase() === 'KIWI') return true;
  return RANKED_QUEUE_IDS.has(queueId);
}
