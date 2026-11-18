/**
 * 对局地图 / 队列 / 定位的中文标签。
 *
 * 腾讯的对局接口给的是 `mapId` + `queueId` + `lane` + `role`,
 * 界面上要显示中文名 —— 这里放一份映射,主进程和渲染进程共用一份,
 * 免得同一局在两个页面上显示成两个名字。
 *
 * 除了同目录的纯映射模块(rankLabels.ts)之外不许 import 别的 ——
 * 免得把主进程的东西拖进渲染进程。
 */

import { queueLabel } from './rankLabels';

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

/** 大乱斗(嚎哭深渊)的地图编号。 */
export const HOWLING_ABYSS_MAP_ID = 12;

/** 大乱斗的队列编号 —— 版本之间会变,只能当第二判据。 */
export const ARAM_QUEUE_ID = 450;

/**
 * 召唤师峡谷上的排位队列号 —— 用来在没有地图号时反推地图。
 *
 * **不含 2400(普通匹配)** —— 腾讯把大乱斗的普通匹配也编成 2400(实测样本:
 * mapId 12 + queueId 2400),拿它反推会把大乱斗说成召唤师峡谷。
 */
const SUMMONERS_RIFT_QUEUE_IDS = new Set([400, 420, 440, 490]);

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
  // 440 = 灵活排位(国服叫灵活组排)—— 实测确认过:国服客户端的战绩里
  // 440 的局是灵活组排,420 才是单双排。写反过一次,把灵活组排说成了单双排。
  440: '灵活排位',
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

/**
 * 只认这几个队列串 —— 普通匹配(`CLASSIC`)之类没有信息量,不写出来。
 */
const RANKED_QUEUE_TYPES = new Set([
  'RANKED_SOLO_5X5',
  'RANKED_TEAM_5X5',
  'RANKED_FLEX_SR',
  'RANKED_FLEX_5X5',
  'RANKED_URF'
]);

/**
 * 队列名 —— **先认队列串,认不出才退回队列号**。
 *
 * 队列串(`RANKED_FLEX_SR` 之类)是权威的:队列号在国服和国际服不是一套
 * 编号,光按号猜会把一局灵活组排说成单双排(实测踩过)。
 */
export function queueNameLabel(game: GameModeRef): string {
  const type = game.queueType ? game.queueType.trim().toUpperCase() : '';
  if (RANKED_QUEUE_TYPES.has(type)) return queueLabel(type);
  return queueIdLabel(game.queueId);
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
export function gameTitle(mapId: number, queueId: number, queueType = ''): string {
  const map = mapIdLabel(mapId);
  const queue = queueNameLabel({ mapId, queueId, queueType, gameMode: '' });
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
 * 角色任务道具 → 位置。
 *
 * 客户端会给每个玩家派一个「角色任务」(打野任务 / 辅助任务 / 上路任务 …),
 * **任务道具的名字里就写着位置** —— 这是唯一不会骗人的位置来源。
 *
 * `lane` 和 `role` 两个字段都会错(实测踩到的三种错法:打野那局 lane 是空的、
 * role 写成 SUPPORT;射手那局 lane 写成 TOP、role 写成 DUO;上单那局 lane 写成
 * JUNGLE),只有任务道具是对的。
 *
 * 认不出来就 `UNKNOWN` —— 不猜。
 */
const ROLE_QUEST_POSITIONS: Array<{ position: PositionKey; keywords: string[] }> = [
  { position: 'JUNGLE', keywords: ['打野', 'jungle'] },
  { position: 'TOP', keywords: ['上路', 'top'] },
  { position: 'MID', keywords: ['中路', 'mid'] },
  { position: 'ADC', keywords: ['下路', 'bot', 'bottom'] },
  { position: 'SUPPORT', keywords: ['辅助', 'support'] }
];

/**
 * 是不是角色任务道具 —— 中文「……任务」,英文「…… Role Quest」。
 *
 * 认得出来才算数:普通的装备名(鞋子 / 控制守卫)不是任务道具,
 * 不能拿它当位置判据。
 */
export function isRoleQuestItem(name: string): boolean {
  return name.includes('任务') || /quest/i.test(name);
}

/**
 * 从角色任务道具的名字认出位置。
 *
 * 不是任务道具(或名字里认不出位置)就 `UNKNOWN`。
 */
export function positionFromRoleQuest(itemName: string): PositionKey {
  const name = itemName.trim();
  if (!name || !isRoleQuestItem(name)) return 'UNKNOWN';
  const lower = name.toLowerCase();
  for (const entry of ROLE_QUEST_POSITIONS) {
    if (entry.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return entry.position;
    }
  }
  return 'UNKNOWN';
}

/**
 * 判位置时能用的「这一局的数据」。
 *
 * **只用来在射手和辅助之间分** —— 上中下野四个位置各占一条路,只有下路站着
 * 两个人(射手 + 辅助)。而任务道具给的「下路任务」说的是**分路**不是位置,
 * lane 给的也是 BOTTOM —— 这两个都分不出谁是辅助。只剩数据能分:
 * 辅助助攻多、补刀少。
 */
export interface PositionEvidence {
  kills: number;
  assists: number;
  deaths: number;
  /** 补刀数;0 = 数据里没有这一项 */
  minionKills: number;
  /** 这一局十个人里最多的补刀;0 = 数据里没有这一项 */
  gameMaxMinionKills: number;
}

/** 助攻到这个数才谈得上「辅助型」。 */
const SUPPORT_ASSIST_FLOOR = 8;

/** 补刀不到全场最高这个比例,才算「不farm」—— 辅助不补刀,射手要补。 */
const SUPPORT_CS_RATIO = 0.35;

/** 没有补刀数据时的门槛 —— 只看 KDA 就得挑严得多。 */
const SUPPORT_ASSIST_FLOOR_NO_CS = 20;

/** 补刀到全场最高这个比例以上,就算「明显在吃线」—— 辅助吃不了这么多线。 */
const FARMING_CS_RATIO = 0.65;

/**
 * 这局的数据像不像辅助。
 *
 * 两条都成立才算:
 *
 *   - **助攻压过击杀** —— 辅助的活儿是给队友创造击杀,自己拿人头是少数;
 *   - **补刀少** —— 辅助基本不farm,射手要吃线。
 *
 * 没有补刀数据时只能拿 KDA 硬扛,门槛抬高到「助攻 20+」——
 * 射手崩了也能有二十个助攻,但那种局补刀不会少,两边一起看才稳。
 */
export function looksLikeSupport(evidence: PositionEvidence): boolean {
  const { kills, assists, deaths, minionKills, gameMaxMinionKills } = evidence;
  if (assists < SUPPORT_ASSIST_FLOOR) return false;
  if (assists < kills * 2) return false;

  if (gameMaxMinionKills > 0 && minionKills > 0) {
    return minionKills <= gameMaxMinionKills * SUPPORT_CS_RATIO;
  }

  // 没有补刀数据:要求助攻同时压过击杀和死亡。
  return assists >= SUPPORT_ASSIST_FLOOR_NO_CS && assists >= kills * 3 && assists >= deaths * 2;
}

/**
 * 这局的数据像不像在吃线(也就是射手)。
 *
 * 补刀到全场最高的 65% 以上 —— 辅助吃不了这么多线。
 */
export function looksLikeFarming(evidence: PositionEvidence): boolean {
  const { minionKills, gameMaxMinionKills } = evidence;
  if (gameMaxMinionKills <= 0 || minionKills <= 0) return false;
  return minionKills >= gameMaxMinionKills * FARMING_CS_RATIO;
}

/**
 * 下路那两个人 —— 这个是辅助还是射手。
 *
 * **数据比定位准**:定位字段实测会写错(打野那局就写成了 SUPPORT),
 * 而补刀骗不了人 —— 辅助不farm,射手要吃线。
 * 两者都没有就听定位,再没有就当射手(任务道具说的是「下路」)。
 */
function resolveBottomRole(role: string, evidence?: PositionEvidence): 'ADC' | 'SUPPORT' {
  if (evidence) {
    if (looksLikeSupport(evidence)) return 'SUPPORT';
    if (looksLikeFarming(evidence)) return 'ADC';
  }
  if (role === 'SUPPORT') return 'SUPPORT';
  return 'ADC';
}

/**
 * 定这个人在打什么位置。
 *
 * 三个来源,按可靠程度排:
 *
 * 1. **角色任务道具**(最优先)—— 客户端派的那个任务,名字里写着位置,不会错。
 * 2. **定位(role)** —— SUPPORT = 辅助,CARRY / DUO = 射手。定位比分路准:
 *    实测射手那局 `lane` 写的是 TOP、`role` 写的是 DUO,按 lane 判就错了。
 * 3. **分路(lane)** —— 认得出来就用它。
 * 4. 都认不出来 —— `UNKNOWN`。**不猜。**
 *
 * 大乱斗一律 `UNKNOWN` —— 那边的 `lane` 和 `role` 都是乱的。
 *
 * **唯一的例外是下路**:「下路任务」说的是分路,下路站着射手和辅助两个人,
 * 所以它给出 ADC 之后还要再分一次 —— 先看数据(补刀少、助攻多的是辅助),
 * 再看定位(实测踩到过:辅助那局被判成了射手)。
 */
export function resolvePosition(
  mapId: number,
  lane: string,
  role: string,
  roleBoundItemName = '',
  evidence?: PositionEvidence
): PositionKey {
  if (mapId !== SUMMONERS_RIFT_MAP_ID) return 'UNKNOWN';

  const quest = positionFromRoleQuest(roleBoundItemName);
  const r = role.toUpperCase();

  if (quest !== 'UNKNOWN') {
    // 下路任务 = 分路,不是位置 —— 射手和辅助都在下路,得再分一次。
    if (quest !== 'ADC') return quest;
    return resolveBottomRole(r, evidence);
  }

  if (r === 'SUPPORT') return 'SUPPORT';
  if (r === 'CARRY' || r === 'DUO') return resolveBottomRole(r, evidence);

  const l = lane.toUpperCase();
  if (l === 'JUNGLE') return 'JUNGLE';
  if (l === 'MIDDLE' || l === 'MID') return 'MID';
  if (l === 'TOP') return 'TOP';
  if (l === 'BOTTOM' || l === 'BOT') return resolveBottomRole(r, evidence);
  if (r === 'SOLO') return 'MID';
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
export function positionLabel(
  mapId: number,
  lane: string,
  role: string,
  roleBoundItemName = '',
  evidence?: PositionEvidence
): string {
  if (mapId !== SUMMONERS_RIFT_MAP_ID) return '';
  const position = resolvePosition(mapId, lane, role, roleBoundItemName, evidence);
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

/** 判定一局是什么模式要用的字段。 */
export interface GameModeRef {
  /** 地图编号;0 = 没给 */
  mapId: number;
  /** 队列编号;0 = 没给 */
  queueId: number;
  /** 模式串(腾讯这批数据里恒是 KIWI,别拿它当判据) */
  gameMode: string;
  /** 队列名(有的数据源只给这个) */
  queueType?: string;
}

/**
 * 这一局是不是大乱斗。
 *
 * **认地图,不认 gameMode** —— 腾讯这批数据里 gameMode 恒是 KIWI,大乱斗和
 * 召唤师峡谷都给它。队列号 450 是大乱斗的老队列号,版本之间会变,
 * 所以它排在地图后面当第二判据。
 */
export function isAramGame(game: GameModeRef): boolean {
  // 地图号最可靠:给了召唤师峡谷就一定不是大乱斗,哪怕队列号写着 450。
  if (game.mapId === SUMMONERS_RIFT_MAP_ID) return false;
  if (game.mapId === HOWLING_ABYSS_MAP_ID) return true;
  if (game.queueId === ARAM_QUEUE_ID) return true;
  if (/ARAM/i.test(game.gameMode)) return true;
  if (game.queueType && /ARAM/i.test(game.queueType)) return true;
  return false;
}

/**
 * 这一局在哪张图上 —— 认不出来就是 0。
 *
 * 判据按可靠程度排:地图号 → 大乱斗特征 → 召唤师峡谷的队列号。
 * 都认不出来就返回 0,**不猜** —— 猜错就是给大乱斗标上一个位置。
 */
export function gameMapId(game: GameModeRef): number {
  // 有地图号就信地图号 —— 哪怕是张没收录的图,也比反推准。
  if (game.mapId > 0) return game.mapId;
  if (isAramGame(game)) return HOWLING_ABYSS_MAP_ID;
  if (SUMMONERS_RIFT_QUEUE_IDS.has(game.queueId)) return SUMMONERS_RIFT_MAP_ID;
  if (game.gameMode.toUpperCase() === 'CLASSIC') return SUMMONERS_RIFT_MAP_ID;
  return 0;
}

/**
 * 这一局显示什么模式名。
 *
 * 认不出来就空着 —— 宁可少写一个词,也不写一个可能错的。
 */
export function gameModeName(game: GameModeRef): string {
  const mapId = gameMapId(game);
  if (mapId === SUMMONERS_RIFT_MAP_ID) return gameTitle(mapId, game.queueId, game.queueType);
  if (mapId === HOWLING_ABYSS_MAP_ID) return '大乱斗';
  return '';
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
