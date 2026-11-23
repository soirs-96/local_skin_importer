/**
 * 「同区开黑搭子」的数据形状和纯展示逻辑。
 *
 * <p>类型和纯函数放 shared —— 主进程拿来发请求,渲染进程拿来渲染,
 * 两边对同一份数据的理解不能分叉。
 */

import type { PositionCode } from './matchProfile';

/** 一条排位段位。 */
export interface RankProfile {
  queueType: string;
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  /** 后端折算的可比数值分 */
  score: number;
  /** 「黄金 III」这种展示串 */
  label: string;
}

/** 同区的一个召唤师。 */
export interface RegionUser {
  /** 站内用户 id */
  id: number;
  /** 昵称(召唤师名) */
  nickname: string;
  /** 游戏ID(召唤师ID)—— 加好友用这个 */
  gameId: string;
  /** 头像地址 */
  avatarUrl: string;
  /** 站内已同步的皮肤数 */
  skinCount: number;
  /** 他的段位;null = 没同步过段位 */
  rank: RankProfile | null;
  /** 他跟我的段位分差;null = 我或他没段位 */
  rankScoreDiff: number | null;
  /** 他的站内收藏分(稀有度加权) */
  collectionScore: number | null;
  /** 他跟我的收藏分差 */
  collectionDiff: number | null;
  /** 他的主玩位置代码 */
  positions: PositionCode[];
  /** 他的主玩位置中文名 */
  positionLabels: string[];
  /** 他是不是 VIP */
  vip: boolean;
}

/** 同区用户列表的完整响应。 */
export interface RegionUsersResult {
  /** 我的大区名;null = 认不出来 */
  myZone: string | null;
  /** 我的大区名是不是标准大区 */
  myZoneKnown: boolean;
  /** 本区总人数(含我) */
  totalInZone: number;
  /** 本次返回的人数 */
  userCount: number;
  /** 我的段位;null = 还没同步过段位 */
  myRank: RankProfile | null;
  /** 我的站内收藏分 */
  myCollectionScore: number | null;
  /** 我的主玩位置代码 */
  myPositions: PositionCode[];
  /** 我的主玩位置中文名 */
  myPositionLabels: string[];
  /** 我是不是 VIP */
  myVip: boolean;
  /** VIP 到期时间;null = 非 VIP */
  myVipUntil: string | null;
  /** 同区用户;按「分数差不多」排 */
  users: RegionUser[];
}

/** 拉同区用户时的筛选条件 —— 全可选,空 = 后端默认。 */
export interface RegionUsersQuery {
  /** 我要一起打的位置 */
  positions?: PositionCode[];
  /** 段位窗口:允许跨几个大段位(0 = 只同段位) */
  tierGap?: number;
  /**
   * 只看比自己分高的人 —— VIP 专属。
   *
   * 打开后段位窗口变成单边的:往上看几个大段位由 {@link RegionUsersQuery.higherTierGap} 决定。
   */
  includeHigher?: boolean;
  /** VIP 模式下往上看几个大段位(0 = 只同段位但分数更高) */
  higherTierGap?: number;
  /** 收藏分的相对差上限(0..1) */
  collectionGap?: number;
  /** 没有段位数据的人要不要带上 */
  includeUnknown?: boolean;
}

/** 一次拉多少个人 —— 三十个够一屏。 */
export const REGION_USERS_LIMIT = 30;

/**
 * 一句话说清楚「我在哪个区、这个区有多少人」。
 *
 * 认不出大区时要说清楚下一步该干什么,而不是干巴巴一句「无数据」。
 */
export function describeRegion(result: RegionUsersResult | null): string {
  if (!result) return '';
  if (!result.myZone) {
    return '还没认出你在哪个区 —— 先同步一次皮肤,或者开着游戏客户端再试';
  }
  if (result.totalInZone <= 1) {
    return '你在 ' + result.myZone + ' 区 · 这个区目前就你一个人';
  }
  return '你在 ' + result.myZone + ' 区 · 同区 ' + result.totalInZone + ' 人';
}

/** 列表里一行显示的名字:昵称优先,没昵称就退回游戏ID。 */
export function displayName(user: RegionUser): string {
  return user.nickname || user.gameId || '无名召唤师';
}

/** 空列表时的一句话 —— 说清楚是「这个区还没别人」还是「区里有人但没留下游戏ID」。 */
export function emptyRegionText(result: RegionUsersResult | null): string {
  if (!result) return '';
  if (!result.myZone) return '先认出大区才能拉同区的人';
  if (result.totalInZone <= 1) return '你这个区还没别人入驻 —— 换个区,或者先同步一次皮肤';
  return '这个区的人都没留下游戏ID —— 没法邀请,等他们同步一次就好';
}
