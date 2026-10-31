import type { ChampSelectSession, RecommendationState } from '../../shared/match';
import { complete, LlmError } from '../llm';

/**
 * 选人阶段的 AI 推荐(英雄 / 天赋 / 出装)。
 *
 * 提示词是固定模板:LLM 必须吐五个二级标题,顺序不变。校验不通过就退化成
 * 「阵容清单」—— 宁可给用户一份朴素但正确的信息,也不要给一份看着像结论、
 * 实则缺了关键段落的半成品。
 */

export const REQUIRED_HEADERS = [
  '## 主推英雄',
  '## 备选英雄',
  '## 核心天赋',
  '## 出装思路',
  '## 思路说明'
] as const;

export function buildSystemPrompt(myRole: string): string {
  return (
    '你是一位英雄联盟(League of Legends)教练。\n' +
    `玩家当前担任位置:${myRole}。\n` +
    '根据当前已选阵容,给出最合适的英雄选择、主推英雄、备选英雄、核心天赋以及出装思路。\n' +
    '你的输出必须是严格的 Markdown,使用以下5个二级标题(顺序固定):\n' +
    `${REQUIRED_HEADERS.join('\n')}\n` +
    '不要输出其它标题或前言。只给出英雄名、天赋名、装备名。不要解释每段为什么。'
  );
}

export function buildUserPrompt(session: ChampSelectSession): string {
  const members = (team: ChampSelectSession['myTeam'], side: string) =>
    team.map((m) => ({
      side,
      champion: m.championName,
      assignedPosition: m.assignedPosition,
      summonerId: m.summonerId
    }));

  const payload = {
    myTeam: members(session.myTeam, 'ally'),
    theirTeam: members(session.theirTeam, 'enemy'),
    bannedChampions: session.bannedChampions.map((c) => c.championName),
    fetchedAt: new Date().toISOString()
  };
  return JSON.stringify(payload, null, 2);
}

export function validateMarkdown(markdown: string): boolean {
  return REQUIRED_HEADERS.every((h) => markdown.includes(h));
}

/** LLM 不可用 / 响应不合规时的降级内容:把阵容老实列出来。 */
export function buildFallback(session: ChampSelectSession, reason: string): string {
  const lines = ['# 推荐(降级模式)', `⚠️ ${reason}`, ''];
  for (const [label, team] of [
    ['我方', session.myTeam],
    ['敌方', session.theirTeam]
  ] as const) {
    lines.push(`## ${label}`);
    for (const m of team) {
      lines.push(`- ${m.championName} (位置:${m.assignedPosition || '?'})`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function emptyRecommendation(): RecommendationState {
  return {
    markdown: null,
    usedFallback: false,
    error: null,
    inflight: false,
    generatedAt: null
  };
}

/**
 * 生成推荐。
 *
 * 「我还没选位置」直接失败 —— 没有位置的推荐没有意义,硬生成只会得到
 * 泛泛而谈的内容。
 */
export async function recommend(
  session: ChampSelectSession,
  myRole: string
): Promise<RecommendationState> {
  const role = (myRole ?? '').trim();
  if (!role) {
    return { ...emptyRecommendation(), error: '尚未选择位置,无法生成推荐' };
  }

  try {
    const markdown = await complete(buildSystemPrompt(role), buildUserPrompt(session));
    if (validateMarkdown(markdown)) {
      return {
        markdown,
        usedFallback: false,
        error: null,
        inflight: false,
        generatedAt: Date.now()
      };
    }
    return {
      markdown: buildFallback(session, 'LLM 响应不符合模板,已展示基础阵容信息'),
      usedFallback: true,
      error: '响应未通过模板校验',
      inflight: false,
      generatedAt: Date.now()
    };
  } catch (e: unknown) {
    if (e instanceof LlmError) {
      return { ...emptyRecommendation(), error: e.message };
    }
    return { ...emptyRecommendation(), error: e instanceof Error ? e.message : String(e) };
  }
}
