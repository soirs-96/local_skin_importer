import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  REQUIRED_HEADERS,
  buildFallback,
  buildSystemPrompt,
  buildUserPrompt,
  emptyRecommendation,
  recommend,
  validateMarkdown
} from '../recommender';
import { complete, LlmError } from '../../llm';
import type { ChampSelectSession } from '../../../shared/match';

vi.mock('../../llm', () => {
  class LlmError extends Error {
    readonly statusCode: number | null;
    constructor(message: string, statusCode: number | null = null) {
      super(message);
      this.name = 'LlmError';
      this.statusCode = statusCode;
    }
  }
  return {
    complete: vi.fn(),
    LlmError
  };
});

const completeMock = vi.mocked(complete);

const session: ChampSelectSession = {
  myTeam: [
    {
      championId: 64,
      championName: '李青',
      championIconUrl: null,
      assignedPosition: 'JUNGLE',
      cellId: 4,
      summonerId: 222
    }
  ],
  theirTeam: [],
  myRole: 'JUNGLE',
  myChampionId: 64,
  myCellId: 4,
  bannedChampions: [{ championId: 1, championName: '安妮', championIconUrl: null }]
};

beforeEach(() => {
  completeMock.mockReset();
});

describe('buildSystemPrompt', () => {
  it('把位置写进提示词,并要求五个固定标题', () => {
    const prompt = buildSystemPrompt('JUNGLE');
    expect(prompt).toContain('JUNGLE');
    for (const header of REQUIRED_HEADERS) {
      expect(prompt).toContain(header);
    }
  });
});

describe('buildUserPrompt', () => {
  it('输出的是合法 JSON,里面带着双方阵容和禁用英雄', () => {
    const payload = JSON.parse(buildUserPrompt(session)) as {
      myTeam: { champion: string }[];
      bannedChampions: string[];
    };
    expect(payload.myTeam[0].champion).toBe('李青');
    expect(payload.bannedChampions).toEqual(['安妮']);
  });
});

describe('validateMarkdown', () => {
  it('五个标题齐全才算通过', () => {
    const full = REQUIRED_HEADERS.map((h) => `${h}\n内容`).join('\n');
    expect(validateMarkdown(full)).toBe(true);
    expect(validateMarkdown('## 主推英雄\n只有一段')).toBe(false);
  });
});

describe('buildFallback', () => {
  it('降级内容至少把双方阵容列出来', () => {
    const text = buildFallback(session, 'LLM 挂了');
    expect(text).toContain('李青');
    expect(text).toContain('LLM 挂了');
  });
});

describe('emptyRecommendation', () => {
  it('初始状态什么也没有', () => {
    expect(emptyRecommendation()).toEqual({
      markdown: null,
      usedFallback: false,
      error: null,
      inflight: false,
      generatedAt: null
    });
  });
});

describe('recommend', () => {
  it('响应合规时原样返回 markdown', async () => {
    const full = REQUIRED_HEADERS.map((h) => `${h}\n内容`).join('\n');
    completeMock.mockResolvedValue(full);
    const state = await recommend(session, 'JUNGLE');
    expect(state.markdown).toBe(full);
    expect(state.usedFallback).toBe(false);
    expect(state.error).toBeNull();
  });

  it('响应不合规时降级,并记下错误', async () => {
    completeMock.mockResolvedValue('随便写点东西');
    const state = await recommend(session, 'JUNGLE');
    expect(state.usedFallback).toBe(true);
    expect(state.error).toBe('响应未通过模板校验');
    expect(state.markdown).toContain('李青');
  });

  it('没选位置时直接失败,不发请求', async () => {
    const state = await recommend(session, '');
    expect(completeMock).not.toHaveBeenCalled();
    expect(state.error).toBe('尚未选择位置,无法生成推荐');
  });

  it('LLM 报错时把错误透出来', async () => {
    completeMock.mockRejectedValue(new LlmError('未配置 LLM API Key'));
    const state = await recommend(session, 'JUNGLE');
    expect(state.error).toBe('未配置 LLM API Key');
    expect(state.markdown).toBeNull();
  });
});
