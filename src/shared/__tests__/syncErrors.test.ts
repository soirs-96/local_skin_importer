import { describe, it, expect } from 'vitest';
import { parseSyncError, PUID_MISMATCH_MARKER } from '../syncErrors';

describe('parseSyncError', () => {
  it('strips the Electron IPC wrapper and the error name', () => {
    const raw = {
      message:
        "Error invoking remote method 'backend:sync': BackendError: 登录已过期,请用同步码重新登录"
    };

    const parsed = parseSyncError(raw);

    expect(parsed.puidMismatch).toBe(false);
    expect(parsed.message).toBe('登录已过期,请用同步码重新登录');
  });

  it('flags the puid mismatch marker', () => {
    const raw = {
      message:
        "Error invoking remote method 'backend:sync': " +
        `${PUID_MISMATCH_MARKER} 账号已绑定其他 LOL 账号,请在桌面端改绑后重新同步`
    };

    const parsed = parseSyncError(raw);

    expect(parsed.puidMismatch).toBe(true);
    expect(parsed.message).toBe('账号已绑定其他 LOL 账号,请在桌面端改绑后重新同步');
  });

  it('accepts a bare string', () => {
    const parsed = parseSyncError('网络错误');

    expect(parsed.puidMismatch).toBe(false);
    expect(parsed.message).toBe('网络错误');
  });

  it('falls back to String(raw) for a non-error value', () => {
    const parsed = parseSyncError(null);

    expect(parsed.puidMismatch).toBe(false);
    expect(parsed.message).toBe('');
  });

  it('does not treat an unrelated 4xx as a puid mismatch', () => {
    const raw = {
      message: "Error invoking remote method 'backend:sync': BackendError: 桌面客户端无权访问该接口"
    };

    expect(parseSyncError(raw).puidMismatch).toBe(false);
  });
});
