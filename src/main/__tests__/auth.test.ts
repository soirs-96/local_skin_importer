import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redeemSyncCode, saveToken, getStoredToken, clearStoredToken, getAuthStatus } from '../auth';
import { app } from 'electron';

vi.mock('axios');

// Inline mock objects inside the factory to avoid hoisting TDZ issues.
// The factory is hoisted to the top of the file before the module-level
// `mockSafeStorage` const would be initialized, so we recreate the shape
// per-factory and re-export handles via a side-channel on globalThis.
const mockSafeStorage = {
  encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
  decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
  isEncryptionAvailable: vi.fn(() => true)
};

vi.mock('electron', () => {
  const storage = {
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
    isEncryptionAvailable: vi.fn(() => true)
  };
  // Expose the storage object on globalThis so the test file can reach it
  // after hoisting completes.
  (globalThis as any).__mockSafeStorage = storage;
  return {
    app: { getPath: vi.fn() },
    safeStorage: storage
  };
});

const mockGetPath = vi.mocked(app.getPath);
const safeStorageMock = (globalThis as any).__mockSafeStorage as typeof mockSafeStorage;

let tmpDir: string;
let tokenPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
  tokenPath = join(tmpDir, 'auth.bin');
  mockGetPath.mockReturnValue(tmpDir);
  vi.mocked(axios.post).mockReset();
  safeStorageMock.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  safeStorageMock.decryptString.mockImplementation((buf: Buffer) => buf.toString().replace(/^enc:/, ''));
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('redeemSyncCode posts the 6-digit code and returns the JWT', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { token: 'jwt-xyz', userId: 1, nickname: 'Soirs' }, message: 'ok' }
    });
    const token = await redeemSyncCode('482931');
    expect(token).toBe('jwt-xyz');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/sync-code/redeem'),
      { code: '482931' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' })
      })
    );
  });

  it('saveToken encrypts and writes to userData/auth.bin', () => {
    saveToken('jwt-abc');
    expect(safeStorageMock.encryptString).toHaveBeenCalledWith('jwt-abc');
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath).toString()).toBe('enc:jwt-abc');
  });

  it('getStoredToken returns null when file does not exist', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('getStoredToken decrypts and returns the JWT', () => {
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abc'));
    expect(getStoredToken()).toBe('jwt-abc');
  });

  it('clearStoredToken removes the file', () => {
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abc'));
    clearStoredToken();
    expect(existsSync(tokenPath)).toBe(false);
  });

  it('getAuthStatus returns truncated preview when logged in', () => {
    // Plan prose says "first 12 chars + ...". substring(0, 12) of the decrypted
    // token "jwt-abcdefghij1234567" is "jwt-abcdefgh" (12 chars, 0..11).
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abcdefghij1234567'));
    expect(getAuthStatus()).toEqual({
      loggedIn: true,
      tokenPreview: 'jwt-abcdefgh...'
    });
  });

  it('getAuthStatus returns loggedIn=false when no token', () => {
    expect(getAuthStatus()).toEqual({ loggedIn: false, tokenPreview: null });
  });
});
