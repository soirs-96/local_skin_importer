import axios from 'axios';
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmStatus } from '../shared/match';

/**
 * DeepSeek(OpenAI 兼容)客户端 + API Key 的本地存储。
 *
 * Key 用 Electron 的 safeStorage 加密后落盘,跟登录 JWT 同一套机制 ——
 * 明文写进 userData 目录等于把密钥摊开给任何能读用户目录的进程。
 * 万一系统没有可用的 OS 加密,退化成「只存在内存里」,功能照常可用,
 * 只是每次重启都要重新填 —— 宁可这样也不落明文。
 */

const KEY_FILENAME = 'llm-key.bin';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';
const LLM_TIMEOUT_MS = 30_000;

/** 只在内存里兜着,系统加密不可用时用。 */
let memoryApiKey: string | null = null;

export class LlmError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.statusCode = statusCode;
  }
}

function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILENAME);
}

export function saveLlmApiKey(key: string): void {
  const trimmed = (key ?? '').trim();
  if (!trimmed) {
    clearLlmApiKey();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    memoryApiKey = trimmed;
    return;
  }
  const enc = safeStorage.encryptString(trimmed);
  fs.writeFileSync(keyFilePath(), enc);
  memoryApiKey = trimmed;
}

export function getLlmApiKey(): string | null {
  if (memoryApiKey) return memoryApiKey;
  const p = keyFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    const key = safeStorage.decryptString(buf);
    memoryApiKey = key;
    return key;
  } catch {
    return null;
  }
}

export function clearLlmApiKey(): void {
  memoryApiKey = null;
  const p = keyFilePath();
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      // 删不掉就算了,下次读的时候解不开就当没配
    }
  }
}

export function getLlmStatus(): LlmStatus {
  return {
    configured: getLlmApiKey() !== null,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    persisted: safeStorage.isEncryptionAvailable()
  };
}

interface ChatCompletionEnvelope {
  choices?: { message?: { content?: string } }[];
}

/**
 * 调一次对话补全,返回正文。
 *
 * 错误统一成 {@link LlmError}:HTTP 错误带上状态码,网络错误带上原因 ——
 * 但**不把服务端原始 body 甩给用户**,里面可能有内部信息。
 */
export async function complete(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = getLlmApiKey();
  if (!apiKey) throw new LlmError('未配置 LLM API Key');

  const url = `${DEFAULT_BASE_URL}/v1/chat/completions`;
  let response;
  try {
    response = await axios.post<ChatCompletionEnvelope>(
      url,
      {
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: LLM_TIMEOUT_MS,
        validateStatus: () => true
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new LlmError(`LLM 请求失败:${message}`);
  }

  if (response.status >= 400) {
    let detail = '';
    const body = response.data as { error?: { message?: string } } | undefined;
    if (body && typeof body.error?.message === 'string') {
      detail = body.error.message;
    }
    throw new LlmError(
      detail ? `LLM 返回 ${response.status}:${detail}` : `LLM 返回 ${response.status}`,
      response.status
    );
  }

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('LLM 响应格式不符合预期', response.status);
  }
  return content;
}
