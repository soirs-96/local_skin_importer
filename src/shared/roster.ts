/**
 * 「对局双方」这张卡上的一行人。
 *
 * 数据有两个来源,拼成同一种行 —— 界面就不用管这人是从哪儿来的:
 *
 * - **对局里的两队人**(gameflow):开局之后才有,对面也有;
 * - **选人阶段的我方**(选人会话):一进选人就有,但**对面给不出来**。
 *
 * 所以选人阶段只列我方:对面在选人界面就是几个英雄图标,身份客户端本来就不给,
 * 去硬凑是白费功夫。
 */

import { lcuIconUrl } from './icons';
import type { ChampSelectMember, ChampSelectSession, Opponent } from './match';

/** 卡片上的一行 —— 一队里的人。 */
export interface RosterPlayer {
  /** 列表 key;同一个人在不同来源下不能撞 */
  key: string;
  side: 'ally' | 'enemy';
  isSelf: boolean;
  /** 昵称;空串 = 没查到 */
  name: string;
  championName: string;
  championIconUrl: string | null;
  /** 召唤师头像 URL;null = 没有头像编号 */
  avatarUrl: string | null;
  /** 段位显示串;空串 = 没有段位 */
  rankText: string;
  /** 召唤师等级;0 = 没查到 */
  level: number;
  summonerId: number;
  puuid: string;
}

/** 对局里的一行(gameflow 来的)。 */
export function rosterFromOpponent(opponent: Opponent): RosterPlayer {
  return {
    key: `${opponent.side}-${opponent.puuid || opponent.summonerId}`,
    side: opponent.side,
    isSelf: opponent.isSelf,
    name: opponent.summonerName,
    championName: opponent.championName,
    championIconUrl: opponent.championIconUrl,
    avatarUrl: opponent.profileIconId > 0 ? lcuIconUrl('profile', opponent.profileIconId) : null,
    // gameflow 不给段位和等级 —— 那要一个个去查,不值当。
    rankText: '',
    level: 0,
    summonerId: opponent.summonerId,
    puuid: opponent.puuid
  };
}

/** 选人阶段的一行(选人会话来的)。 */
export function rosterFromMember(
  member: ChampSelectMember,
  side: 'ally' | 'enemy',
  isSelf: boolean
): RosterPlayer {
  return {
    key: `${side}-cell-${member.cellId}`,
    side,
    isSelf,
    name: member.displayName,
    championName: member.championName,
    championIconUrl: member.championIconUrl,
    avatarUrl: member.profileIconId > 0 ? lcuIconUrl('profile', member.profileIconId) : null,
    rankText: member.rankedDisplay,
    level: member.summonerLevel,
    summonerId: member.summonerId,
    puuid: member.puuid
  };
}

/**
 * 拼出这张卡该显示的人。
 *
 * **有选人会话就只列我方** —— 选人阶段对面拿不到身份,不给。
 * 没有选人会话(大厅 / 局内 / 局末)才用 gameflow 的两队人。
 */
export function buildRoster(
  opponents: Opponent[],
  champSelect: ChampSelectSession | null
): RosterPlayer[] {
  if (champSelect) {
    const myCellId = champSelect.myCellId;
    return champSelect.myTeam.map((member) =>
      rosterFromMember(member, 'ally', myCellId >= 0 && member.cellId === myCellId)
    );
  }
  return opponents.map(rosterFromOpponent);
}
