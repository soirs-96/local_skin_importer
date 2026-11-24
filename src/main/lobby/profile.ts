/**
 * 大厅悬浮卡片的那份档案 —— 数据来自「最近战绩」。
 *
 * <p>口径跟「战绩查询」页**完全一样**(`shared/scoring.ts`):表现分 0~10,
 * 参团率 / 经济份额 / 伤害份额 / KDA 四项各跟**该位置的基准值**比,
 * 折成子分等权平均。只看排位表现,跟皮肤评分没关系。
 *
 * <p>为什么能查别人的:国服客户端把战绩路由裁到只剩「我自己」那一条,
 * 但腾讯的 ledge 网关没裁 —— 拿到对方的 puuid 就能拉到他的对局
 * (见 tencentLedge.ts)。
 */

import {
  isRankedGame,
  scoreGame,
  summarizePlayerScores,
  summarizeRosterScore,
  targetOf
} from '../../shared/scoring';
import type { PlayerGame, PlayerGamesSummary, PlayerLookup } from '../../shared/match';
import type { LobbyPlayerProfile, LobbyProfileMatch } from '../../shared/lobby';

/** 档案里算几场 —— 「近 10 场」就是近 10 场。 */
export const PROFILE_MATCH_LIMIT = 10;

/**
 * 拉多少局回来挑。
 *
 * 腾讯的列表接口不按队列筛,只能多拉一点再自己挑排位那几场。
 */
export const PROFILE_FETCH_COUNT = 20;

/** 常用英雄最多列几个。 */
const MAX_CHAMPIONS = 5;

/**
 * 拉档案要用到的两个能力。
 *
 * <p>结构化类型(不是具体的 poller 类)—— 测试能塞个假实现进去。
 */
export interface LobbyProfileSource {
  /** 按「名字#标签」查资料;查不到时返回 `found: false`,不抛异常。 */
  lookupPlayer(query: string): Promise<PlayerLookup>;
  /** 拉某个 puuid 的对局(腾讯的对局服务)。 */
  fetchPlayerGames(puuid: string, startIndex?: number, count?: number): Promise<PlayerGamesSummary>;
}

/**
 * 把腾讯那边的对局汇总成一张档案。
 *
 * <p>纯函数,不碰 IO —— 好测。
 *
 * <p>只留**排位**(召唤师峡谷 + 排位队列),按时间新的在前,取前 10 场。
 */
export function buildLobbyProfile(games: PlayerGame[]): LobbyPlayerProfile {
  const ranked = games
    .filter(isRankedGame)
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, PROFILE_MATCH_LIMIT);

  // 只有「能打分的局」才进成绩单 —— 队伍人数不齐 / 峡谷不是排位的,
  // 分数和胜场必须出自同一批局,不然会出现「10 场 · 11 胜」。
  const scored: { game: PlayerGame; positionLabel: string; score: number }[] = [];
  for (const game of ranked) {
    const result = scoreGame(game);
    if (!result) continue;
    const detail = targetOf(result);
    if (!detail) continue;
    scored.push({ game, positionLabel: detail.positionLabel, score: detail.score });
  }

  // 两份汇总出自同一批局 —— 分数、场次、胜场必须对齐。
  const summary = summarizePlayerScores(ranked);
  const roster = summarizeRosterScore(ranked);

  const champions = new Map<number, { championId: number; championName: string; count: number }>();
  for (const { game } of scored) {
    if (game.championId <= 0) continue;
    const entry = champions.get(game.championId);
    if (entry) {
      entry.count += 1;
      continue;
    }
    champions.set(game.championId, {
      championId: game.championId,
      championName: game.championName,
      count: 1
    });
  }

  const matches: LobbyProfileMatch[] = scored.map(({ game, positionLabel, score }) => ({
    gameId: game.gameId,
    championId: game.championId,
    championName: game.championName,
    positionLabel,
    kills: game.kills,
    deaths: game.deaths,
    assists: game.assists,
    minionKills: game.minionKills,
    score,
    win: game.win,
    playedAtMs: game.timestampMs
  }));

  return {
    score: scored.length > 0 ? summary.score : null,
    games: roster.games,
    wins: roster.wins,
    vsAverage: summary.vsAverage,
    metrics: { ...summary.metrics },
    breakdown: { ...summary.breakdown },
    positionLabel: summary.byPosition[0]?.label ?? '',
    byPosition: summary.byPosition.map((row) => ({
      label: row.label,
      score: row.score,
      games: row.games
    })),
    champions: [...champions.values()]
      .sort((a, b) => b.count - a.count || a.championId - b.championId)
      .slice(0, MAX_CHAMPIONS),
    matches
  };
}

/**
 * 查一个人的近 10 场排位档案。
 *
 * @param query.nickname 对方昵称(游戏里的名字)
 * @param query.gameId   对方的游戏ID —— 存的是 Riot ID 的标签(数字标签)
 */
export async function fetchLobbyPlayerProfile(
  source: LobbyProfileSource,
  query: { nickname: string; gameId: string }
): Promise<LobbyPlayerProfile> {
  const nickname = query.nickname.trim();
  const tag = query.gameId.trim();
  if (!nickname || !tag) {
    throw new Error('这个人没有昵称或游戏ID —— 拼不出「名字#标签」,查不了战绩');
  }

  // 搜人只认「名字#标签」这一种格式(跟「拉人进房间」那套一样)。
  const lookup = await source.lookupPlayer(`${nickname}#${tag}`);
  if (!lookup.found) {
    throw new Error(lookup.error ?? '查不到这个人');
  }
  if (!lookup.puuid) {
    throw new Error('查不到这个人的召唤师ID —— 拿不到战绩');
  }

  const summary = await source.fetchPlayerGames(lookup.puuid, 0, PROFILE_FETCH_COUNT);
  return buildLobbyProfile(summary.games);
}
