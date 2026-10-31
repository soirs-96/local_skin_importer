import type { ChampSelectSession, RecommendationState } from '../../shared/match';
import { emptyRecommendation, recommend } from './recommender';

/**
 * 推荐面板的状态放在主进程。
 *
 * 渲染进程切页、刷新都会丢状态,把它留在主进程里,页面重新进来时能立刻
 * 拿到上一份结果,不用重新花一次 LLM 的钱。
 */

let state: RecommendationState = emptyRecommendation();
let inflight = false;

export function getRecommendationState(): RecommendationState {
  return state;
}

export async function requestRecommendation(
  session: ChampSelectSession,
  myRole: string
): Promise<RecommendationState> {
  // 并发保护:连点两下「生成推荐」不该发两次请求。
  if (inflight) return state;
  inflight = true;
  state = { ...state, inflight: true, error: null };

  try {
    const result = await recommend(session, myRole);
    state = result;
    return result;
  } catch (e: unknown) {
    // recommend 内部已经兜过大部分错误,这里只是防止状态卡在 inflight。
    state = {
      ...state,
      inflight: false,
      error: e instanceof Error ? e.message : String(e)
    };
    return state;
  } finally {
    inflight = false;
  }
}
