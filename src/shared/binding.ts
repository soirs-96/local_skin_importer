/**
 * 当前绑定信息 —— 桌面端显示「现在绑的是哪个 LOL 账号」。
 *
 * <p>后端 t_user.bound_account 是权威口径:只在绑定/改绑时写,
 * 不受用户在小程序里改昵称影响。
 */
export interface BindingInfo {
  /** 是否已经绑过 LOL 账号。 */
  bound: boolean;
  /** 绑定的账号(Riot ID「名字#标签」);没绑过或客户端没报名字时可能为空。 */
  boundAccount: string | null;
  /** 小程序上的昵称。 */
  nickname: string | null;
  /** 游戏ID(Riot ID 的标签部分)。 */
  gameId: string | null;
  /** 大区。 */
  gameZone: string | null;
  /** 已同步的皮肤数。 */
  skinCount: number;
  /** 最近一次同步时刻(ISO 字符串);没同步过是 null。 */
  lastSyncAt: string | null;
}
