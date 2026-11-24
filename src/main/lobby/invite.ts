/**
 * 拉人进房间。
 *
 * <p>**完全在本机做** —— 本机 LCU + 本机游戏客户端,后端不参与,
 * 所以不需要什么 invite-ticket。
 *
 * <p>⚠️ 建房 / 邀请的路由国服**还没实测** —— 所以这里挨个撞:
 * 撞到 405(路由存在但方法不对)或 2xx 都算这个路由能用;
 * 全部撞不到就降级成「复制游戏ID」。
 */

import { clipboard } from 'electron';
import * as lcu from '../lcu';
import type { LobbyInviteResult } from '../../shared/lobby';

export interface InviteCandidate {
  path: string;
  method: 'POST' | 'PUT';
  /** 请求体;null = 不带 body */
  body: unknown;
}

/**
 * 拉人要用到的 LCU 客户端能力。
 *
 * <p>结构化类型(不是 `AxiosInstance`)—— 测试能塞个假实现进去,
 * 不用起真的 LCU 回环。
 */
export interface LcuInviteClient {
  get(path: string, config?: unknown): Promise<{ data: unknown }>;
  post(path: string, data?: unknown, config?: unknown): Promise<unknown>;
}

/**
 * 挨个撞的候选路由。
 *
 * <p>顺序 = 优先级。Task B9 的探测脚本用同样的顺序实测,
 * 撞出真正能用的那条之后,把其它几条删掉、把真的那条提到最前。
 */
export function buildInviteCandidates(summonerId?: string): InviteCandidate[] {
  const id = summonerId ?? '';
  return [
    { path: '/lol-lobby/v2/lobby/invitations', method: 'POST', body: { summonerIds: [id] } },
    { path: '/lol-lobby/v2/lobby/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v2/party/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v1/lobby/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v2/lobby/invite', method: 'POST', body: { summonerId: id } }
  ];
}

/** 建自定义房间的候选路由。 */
export function buildLobbyCandidates(): InviteCandidate[] {
  return [
    { path: '/lol-lobby/v2/lobby', method: 'POST', body: null },
    { path: '/lol-lobby/v1/lobby', method: 'POST', body: null }
  ];
}

/** 昵称#标签 → 召唤师ID。搜人只认这个格式。 */
async function resolveSummonerId(
  client: LcuInviteClient,
  nickname: string,
  gameId: string
): Promise<string> {
  const name = gameId ? `${nickname}#${gameId}` : nickname;
  const res = await client.get(`/lol-summoner/v1/summoners?name=${encodeURIComponent(name)}`);
  const body = res.data as { summonerId?: number; summoner?: { summonerId?: number } } | undefined;
  const id = body?.summonerId ?? body?.summoner?.summonerId;
  return id === undefined || id === null ? '' : String(id);
}

/**
 * 拉一个人进房间。
 *
 * @param nickname    对方昵称
 * @param gameId      对方的召唤师ID(数字标签)
 * @param resolveClient 造 LCU 客户端的口子,测试用假实现顶掉
 */
export async function invitePlayer(
  nickname: string,
  gameId: string,
  resolveClient?: () => Promise<LcuInviteClient>
): Promise<LobbyInviteResult> {
  // 没有召唤师ID → 邀不了,只能复制
  if (!gameId) {
    return {
      ok: true,
      mode: 'copied',
      message: '这个人没有游戏ID,邀不了 —— 让他在聊天里报一下'
    };
  }

  let client: LcuInviteClient;
  try {
    // AxiosInstance 跟 LcuInviteClient 的方法签名不完全一样(axios 的
    // config 是 AxiosRequestConfig,这里是 unknown)—— 这里只用到
    // get/post 两个方法,转一下省得跟 axios 的泛型较劲。
    client = resolveClient
      ? await resolveClient()
      : (lcu.createLcuClient(await lcu.resolveLcuAuth()) as unknown as LcuInviteClient);
  } catch (e: unknown) {
    // 客户端没开 —— 降级
    copyToClipboard(gameId);
    return {
      ok: true,
      mode: 'copied',
      message: `游戏客户端没开,复制了 ${gameId} —— 到客户端里加好友`
    };
  }

  try {
    const summonerId = await resolveSummonerId(client, nickname, gameId);
    if (!summonerId) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `在客户端里搜不到 ${nickname},复制了 ${gameId}`
      };
    }

    // 先建房,再邀请 —— 顺序反了客户端会拒
    const created = await tryCandidates(client, buildLobbyCandidates());
    if (!created) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `建房间的接口没撞到,复制了 ${gameId} —— 到客户端里加好友`
      };
    }

    const invited = await tryCandidates(client, buildInviteCandidates(summonerId));
    if (!invited) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `邀请的接口没撞到,复制了 ${gameId} —— 到客户端里加好友`
      };
    }

    return { ok: true, mode: 'invited', message: `已把 ${nickname} 拉进房间` };
  } catch (e: unknown) {
    copyToClipboard(gameId);
    return {
      ok: true,
      mode: 'copied',
      message: `邀请没成功,复制了 ${gameId} —— 到客户端里加好友`
    };
  }
}

/** 挨个撞候选路由 —— 有一个成了就算。 */
async function tryCandidates(
  client: LcuInviteClient,
  candidates: InviteCandidate[]
): Promise<boolean> {
  for (const candidate of candidates) {
    try {
      const config: Record<string, unknown> = {
        method: candidate.method,
        headers: { 'Content-Type': 'application/json' }
      };
      // body 直接走 axios 的第二个参数 —— 塞进 config.data 也能用,
      // 但那样得依赖 axios 的合并细节,没必要。
      await client.post(candidate.path, candidate.body ?? undefined, config);
      return true;
    } catch (e: unknown) {
      // 这个路由不对 —— 接着撞下一个
      console.warn('[lobby] 邀请路由没撞到', candidate.path, e);
    }
  }
  return false;
}

function copyToClipboard(text: string): void {
  try {
    clipboard.writeText(text);
  } catch {
    // 剪贴板不可用(无头环境)—— 不影响降级流程
  }
}
