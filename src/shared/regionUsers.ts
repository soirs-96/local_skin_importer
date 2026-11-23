/**
 * 「同区开黑搭子」的数据形状和纯展示逻辑。
 *
 * <p>类型和纯函数放 shared —— 主进程拿来发请求,渲染进程拿来渲染,
 * 两边对同一份数据的理解不能分叉。
 */

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
  /** 同区用户;按站内皮肤数从多到少 */
  users: RegionUser[];
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
