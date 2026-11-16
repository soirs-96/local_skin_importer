/**
 * 自动接受对局 —— 主进程和界面共用的类型与判定逻辑。
 *
 * 「现在该不该点接受」是纯判定:给它阶段和选人名单,它给一个动作。
 * 放在 shared 里是为了能直接单测 —— 不必起一个真的客户端。
 *
 * 判定口径(**宁可不做,也不乱做**):
 *   - 匹配成功后的「接受对局」弹窗 = ready check,阶段是 `ReadyCheck`;
 *   - 选人阶段的「确认」= champ select,阶段是 `ChampSelect`,
 *     但**必须先锁定自己的英雄** —— 没锁定就点,客户端不会认。
 */

/** 界面上显示的状态。 */
export type AutoAcceptStatus = 'off' | 'waiting' | 'acting' | 'accepted' | 'error';

export interface AutoAcceptState {
  /** 总开关。关掉就什么都不做。 */
  enabled: boolean;
  status: AutoAcceptStatus;
  /** 本次运行已经接受的次数。 */
  acceptedCount: number;
  /** 最近一次接受的时刻(epoch ms);null = 还没接受过。 */
  lastAcceptedAt: number | null;
  /** 最近一次失败的原因 —— 给用户看,不是给开发者看。 */
  lastError: string | null;
  /** 客户端当前阶段(原始值,比如 ChampSelect)。 */
  phase: string;
  /** 实际用通的端点 —— 知道了就不用每次挨个试。 */
  endpoint: string | null;
  /** 客户端连上了没。 */
  clientConnected: boolean;
}

/** 现在要做什么。 */
export type AcceptAction = 'none' | 'ready-check' | 'champ-select';

/** 选人名单里的一个人(只取认人需要的字段)。 */
export interface AcceptProbeMember {
  cellId: number;
  puuid: string;
  championId: number;
}

export interface AcceptProbe {
  /** gameflow 的阶段。 */
  phase: string;
  /** 选人会话里的本地玩家格位(-1 = 客户端没给)。 */
  localPlayerCellId: number;
  /** 我自己的 puuid —— 格位缺失时用它认人。 */
  myPuuid: string;
  /** 我方名单。 */
  myTeam: AcceptProbeMember[];
}

/**
 * 名单里哪个人是我。
 *
 * 两个认法:格位(localPlayerCellId,最准)和 puuid(唯一,老客户端不给格位时用)。
 * 两个都认不出就返回 null —— **宁可不做也不认错人**。
 */
export function findMyMember(probe: AcceptProbe): AcceptProbeMember | null {
  const cellId = probe.localPlayerCellId;
  if (cellId >= 0) {
    const byCell = probe.myTeam.find((m) => m.cellId === cellId);
    if (byCell) return byCell;
  }
  if (probe.myPuuid) {
    const byPuuid = probe.myTeam.find((m) => Boolean(m.puuid) && m.puuid === probe.myPuuid);
    if (byPuuid) return byPuuid;
  }
  return null;
}

/**
 * 该不该现在去点「接受」。
 *
 * `none` 有好几种含义(不在对局里 / 没锁定英雄 / 认不出自己),
 * 上层只关心「现在不动」。
 */
export function decideAccept(probe: AcceptProbe): AcceptAction {
  if (probe.phase === 'ReadyCheck') return 'ready-check';
  if (probe.phase !== 'ChampSelect') return 'none';

  const me = findMyMember(probe);
  if (!me) return 'none';
  // 没锁定英雄 —— 客户端的确认按钮是灰的,点了也没用。
  if (me.championId <= 0) return 'none';
  return 'champ-select';
}

/** 界面上的状态文案。 */
export function statusLabel(status: AutoAcceptStatus): string {
  switch (status) {
    case 'off':
      return '未开启';
    case 'waiting':
      return '等待对局';
    case 'acting':
      return '正在接受';
    case 'accepted':
      return '已接受';
    case 'error':
      return '出错了';
    default:
      return '未开启';
  }
}

/** 阶段的中文名(客户端给的是英文)。 */
export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'None':
      return '未进入';
    case 'Lobby':
      return '大厅';
    case 'Matchmaking':
      return '匹配中';
    case 'ReadyCheck':
      return '等待接受';
    case 'ChampSelect':
      return '英雄选择';
    case 'GameStart':
      return '游戏即将开始';
    case 'InProgress':
      return '对局进行中';
    case 'WaitingForStats':
      return '结算中';
    case 'PreEndOfGame':
      return '结算中';
    case 'EndOfGame':
      return '已结束';
    default:
      return phase || '未进入';
  }
}
