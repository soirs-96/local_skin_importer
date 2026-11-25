/**
 * 「绑错了 LOL 账号」的标记。
 *
 * <p>Electron 的 IPC 报错只会把 message 传过去,error 上的自定义属性(status 之类)
 * 全丢 —— 渲染进程认不出 409。所以主进程在这个错误上打个标记,
 * 渲染进程凭标记判断「这是绑错了,要不要改绑」。
 */
export const PUID_MISMATCH_MARKER = '[PUID_MISMATCH]';

/** Electron 包在 IPC 报错外面的那层壳。 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/;

/** 错误名前缀(Error: / BackendError: / AxiosError: …)。 */
const ERROR_NAME_PREFIX = /^[A-Za-z]*Error:\s*/;

export interface ParsedSyncError {
  /** 是不是「绑错了账号」这种该引导改绑的错误。 */
  puidMismatch: boolean;
  /** 去掉包装之后、给用户看的干净文案。 */
  message: string;
}

/**
 * 把 IPC 传过来的原始报错拆成「要不要引导改绑」+「给用户看的话」。
 *
 * <p>用户看到的是这句话,不是 "Error invoking remote method 'backend:sync':
 * AxiosError: 账号已绑定其他 LOL 账号 (HTTP 403)" 这种裹了三层的原始串。
 */
export function parseSyncError(raw: unknown): ParsedSyncError {
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw && typeof raw === 'object') {
    const message = (raw as { message?: unknown }).message;
    text = typeof message === 'string' ? message : String(raw);
  } else {
    text = String(raw ?? '');
  }

  text = text.replace(IPC_PREFIX, '');
  const puidMismatch = text.includes(PUID_MISMATCH_MARKER);
  text = text.split(PUID_MISMATCH_MARKER).join('');
  text = text.replace(ERROR_NAME_PREFIX, '');

  return { puidMismatch, message: text.trim() };
}
