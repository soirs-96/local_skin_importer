import type { AxiosInstance } from 'axios';

/**
 * 当前游戏版本号。
 *
 * **不能用 Data Dragon 的 `api/versions.json`** —— 国服网络上那个接口
 * 经常拉不到,拉到了也不一定是客户端正在跑的那个版本,拿它拼出来的图片
 * 地址全是 404。客户端自己知道当前版本:LCU 的几个端点里带着版本串。
 *
 * 腾讯客户端返回的是 `16.18.8165012+branch.releases-16-18.code...`,
 * 原样丢给 CDN 每个请求都会 403 —— 所以要归一化成 `X.Y.1`
 * (Data Dragon 每个小版本只发布一个 `.1`)。
 */

/** 探不到版本时用的兜底版本(一个确实存在的补丁号)。 */
export const FALLBACK_PATCH = '14.10.1';

const PATCH_PROBES: {
  path: string;
  extract: (raw: unknown) => string | null;
}[] = [
  {
    path: '/lol-patch/v1/game-version',
    extract: (raw) => (typeof raw === 'string' ? raw : null)
  },
  {
    path: '/lol-game-data/environments/v1/environment',
    extract: (raw) => readString(raw, 'clientVersion')
  },
  {
    path: '/lol-game-data/environments/v1/environments',
    extract: (raw) => readString(raw, 'clientVersion')
  },
  {
    path: '/lol-game-data/assets/v1/league-recognized-games.json',
    extract: (raw) => readString(raw, 'patch') ?? readString(raw, 'gameVersion')
  }
];

function readString(raw: unknown, key: string): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * 把客户端的版本串归一化成 Data Dragon 的补丁号。
 *
 * `16.18.8165012+branch.releases-...` → `16.18.1`
 */
export function normalizePatch(raw: string | null | undefined): string {
  if (!raw) return FALLBACK_PATCH;
  const cleaned = raw.split('+', 1)[0].trim();
  const parts = cleaned.split('.');
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${parts[0]}.${parts[1]}.1`;
  }
  return FALLBACK_PATCH;
}

/**
 * 从 LCU 探当前版本,探不到就用兜底版本。
 *
 * `client` 可以不传 —— 那就只剩兜底版本。
 */
export async function resolvePatchVersion(client?: AxiosInstance): Promise<string> {
  if (!client) return FALLBACK_PATCH;

  for (const probe of PATCH_PROBES) {
    try {
      const { data } = await client.get(probe.path, { timeout: 2_000 });
      const raw = probe.extract(data);
      if (raw) return normalizePatch(raw);
    } catch {
      // 这个端点不存在,试下一个
    }
  }
  return FALLBACK_PATCH;
}

/**
 * 拉 Data Dragon 数据文件时值得试的版本号,新的在前。
 *
 * 客户端报的是当前补丁,但 CDN 上有时还没传完 —— 退回上一个小版本,
 * 再退到兜底版本。
 */
export async function patchCandidates(client?: AxiosInstance): Promise<string[]> {
  const current = await resolvePatchVersion(client);
  const out = [current];

  // 连兜底版本都是猜的,就别再往下退的了
  if (current === FALLBACK_PATCH) return out;

  const parts = current.split('.');
  if (parts.length >= 2) {
    const minor = Number(parts[1]);
    if (Number.isInteger(minor) && minor > 1) {
      out.push(`${parts[0]}.${minor - 1}.1`);
    }
  }
  out.push(FALLBACK_PATCH);

  return out;
}
