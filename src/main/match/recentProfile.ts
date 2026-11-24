/**
 * 近 10 场**排位** —— 大厅列表和悬浮卡片的那份数据。
 *
 * <p>别人的对局历史在别人的电脑上,后端拿不到。所以每个人在同步时把
 * 自己最近 10 场排位报上去,大厅才能显示「近 10 场主玩位置」和「近期评分」。
 *
 * <p>口径:
 * <ul>
 *   <li><b>只算排位</b>(单双排 / 灵活排)—— 大乱斗没有上下路,算进去位置就废了。</li>
 *   <li><b>只取 10 场</b> —— 「近 10 场」就是近 10 场,不是近 20 场。</li>
 *   <li><b>认不出位置的那场</b>照样留,只是位置记空串 —— 它对评分还是有贡献的
 *       (KDA、补刀、胜负都是真的),只是不参与位置统计。</li>
 * </ul>
 */

import { resolvePosition } from '../../shared/gameLabels';
import {
  isRankedQueueType,
  normalizeQueueType,
  scoreRecentMatch,
  toPositionCode
} from '../../shared/matchProfile';
import type { RecentMatch } from '../../shared/match';
import type { RecentMatchReport } from '../../shared/matchProfile';
import { parseMatchEntry } from './recentMatches';
import type { StaticData } from './staticData';

/** 近 10 场 —— 桌面端一次只报这么多。 */
export const RECENT_MATCH_LIMIT = 10;

/**
 * 对局原始数据 → 近 10 场排位。
 *
 * <p>纯函数,不碰 IO —— 好测。
 */
export function buildRecentReports(
  games: unknown[],
  staticData: StaticData,
  puuid = ''
): RecentMatchReport[] {
  const matches: RecentMatch[] = [];
  for (const raw of games) {
    const match = parseMatchEntry(raw, staticData, puuid);
    if (!match) continue;
    if (!isRankedQueueType(match.queueType)) continue;
    matches.push(match);
  }
  // 新的在前 —— 客户端给的顺序不一定可靠,自己排一遍
  matches.sort((a, b) => b.timestampMs - a.timestampMs);

  const out: RecentMatchReport[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (out.length >= RECENT_MATCH_LIMIT) break;
    const gameId = String(match.gameId);
    // gameId 读不出来的那场没法跟后端对上(唯一键是 user_id + game_id),丢掉
    if (!gameId || gameId === '0') continue;
    if (seen.has(gameId)) continue;
    seen.add(gameId);

    const position = toPositionCode(
      resolvePosition(
        match.mapId,
        match.lane,
        match.role,
        match.roleBoundItemName ?? '',
        {
          kills: match.kills,
          assists: match.assists,
          deaths: match.deaths,
          minionKills: match.minionKills,
          gameMaxMinionKills: match.gameMaxMinionKills
        }
      )
    );

    out.push({
      gameId,
      championId: match.championId,
      championName: match.championName,
      position: position ?? '',
      queueType: normalizeQueueType(match.queueType),
      kills: match.kills,
      deaths: match.deaths,
      assists: match.assists,
      minionKills: match.minionKills,
      durationS: match.durationS,
      win: match.win,
      score: scoreRecentMatch({
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        minionKills: match.minionKills,
        durationS: match.durationS,
        win: match.win,
        position: position ?? ''
      }),
      playedAtMs: match.timestampMs
    });
  }
  return out;
}
