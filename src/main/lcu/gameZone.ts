/**
 * 大区(腾讯的「老大区」)的识别 —— **尽力而为,认不出就算了**。
 *
 * <p>腾讯在 lol.qq.com 上用 `lol_areaId` cookie 记当前账号所在的大区编号。
 * 游戏客户端登录后拿到的是同一套 cookie,所以从客户端的 cookie 通道里找它。
 *
 * <p>两条来源都读不到就返回 null —— 上报 null,后端就不写大区,
 * 用户自己在小程序里选。**不猜大区**:认不出来的编号宁可不上报。
 */
import type { AxiosInstance } from 'axios';

/** cookie 串里的大区编号。 */
const AREA_ID_RE = /lol_areaid\s*=\s*(\d+)/i;

/** cookie jar 里大区 cookie 的名字(全小写比对)。 */
const AREA_COOKIE_NAME = 'lol_areaid';

/** cookie 通道很快,3 秒够了 —— 读不到也不该拖慢同步。 */
const COOKIE_TIMEOUT_MS = 3000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 从 cookie 串里抠大区编号。
 *
 * <p>串的形状各种各样(`k=v; k=v`、JSON 里的字符串),所以直接全文找。
 */
export function parseAreaId(text: string): number | null {
  const match = text.match(AREA_ID_RE);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 从 cookie jar 列表里找大区 cookie。
 *
 * <p>jar 的条目形状是 `{ name, value, domain }`。
 */
export function areaIdFromCookieList(cookies: unknown): number | null {
  if (!Array.isArray(cookies)) return null;
  for (const entry of cookies) {
    if (!isRecord(entry)) continue;
    if (str(entry.name).toLowerCase() !== AREA_COOKIE_NAME) continue;
    const id = Number(str(entry.value));
    if (Number.isInteger(id) && id > 0) return id;
  }
  return null;
}

/** 响应体不一定是字符串 —— 对象就整个序列化出来再找。 */
function toText(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data) ?? '';
  } catch {
    return '';
  }
}

/**
 * 读当前账号所在的大区编号。
 *
 * <p>读不到返回 null —— 调用方把它当「没有大区」处理,不猜。
 */
export async function fetchAreaId(client: AxiosInstance): Promise<number | null> {
  // 来源一:诊断助手的 cookie 通道(带 QQ cookie 转发能力的那条路)
  try {
    const { data } = await client.get('/lol-tencent-diagnostic-assistant/v1/get-cookie', {
      timeout: COOKIE_TIMEOUT_MS
    });
    const id = parseAreaId(toText(data));
    if (id !== null) return id;
  } catch {
    // 通道不存在 / 没登录 —— 换下一条
  }

  // 来源二:cookie jar
  try {
    const { data } = await client.get('/cookie-jar/v1/cookies', { timeout: COOKIE_TIMEOUT_MS });
    const id = areaIdFromCookieList(data);
    if (id !== null) return id;
  } catch {
    // 取不到就算了 —— 大区不是同步的必需项
  }

  return null;
}
