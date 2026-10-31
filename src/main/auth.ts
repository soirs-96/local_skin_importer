import axios from 'axios';
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const TOKEN_FILENAME = 'auth.bin';

interface RedeemEnvelope { code: number; data?: { token?: string }; message?: string }

const TOKEN_PREVIEW_LENGTH = 12;
const SYNC_CODE_PATTERN = /^\d{6}$/;

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILENAME);
}

export async function redeemSyncCode(code: string): Promise<string> {
  if (!SYNC_CODE_PATTERN.test(code)) {
    throw new Error('码格式无效');
  }
  const { data } = await axios.post<RedeemEnvelope>(
    `${BACKEND_BASE_URL}/api/sync-code/redeem-desktop`,
    { code },
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (data.code !== 200 || !data.data?.token) {
    throw new Error(data.message ?? '兑换失败');
  }
  return data.data.token;
}

export function saveToken(jwt: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable; refusing to persist token in plaintext');
  }
  const enc = safeStorage.encryptString(jwt);
  fs.writeFileSync(tokenFilePath(), enc);
}

export function getStoredToken(): string | null {
  const p = tokenFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function clearStoredToken(): void {
  const p = tokenFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * 读 JWT 里的 exp(秒级时间戳)。
 *
 * 拿不到就返回 null —— 解析不了不代表过期,别把好 token 误杀。
 */
function readTokenExpiry(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getAuthStatus(): { loggedIn: boolean; tokenPreview: string | null } {
  const t = getStoredToken();
  if (!t) return { loggedIn: false, tokenPreview: null };
  // token 过期了却还显示「已登录」,同步就会一直 401,数据静默停更。
  // 与其让用户对着一个假的登录状态干瞪眼,不如直接清掉让他重新兑换。
  const exp = readTokenExpiry(t);
  if (exp !== null && exp <= Date.now()) {
    clearStoredToken();
    return { loggedIn: false, tokenPreview: null };
  }
  return {
    loggedIn: true,
    tokenPreview: `${t.substring(0, TOKEN_PREVIEW_LENGTH)}...`
  };
}