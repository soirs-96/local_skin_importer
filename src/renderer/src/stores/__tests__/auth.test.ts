import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../auth';

interface MockApi {
  getAuthStatus: ReturnType<typeof vi.fn>;
  redeemCode: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}

const mockApi: MockApi = {
  getAuthStatus: vi.fn(),
  redeemCode: vi.fn(),
  logout: vi.fn()
};

beforeEach(() => {
  setActivePinia(createPinia());
  (globalThis as unknown as { window: { api: MockApi } }).window = {
    api: mockApi
  };
  mockApi.getAuthStatus.mockReset();
  mockApi.redeemCode.mockReset();
  mockApi.logout.mockReset();
});

describe('auth store', () => {
  it('initial state loads from getAuthStatus', async () => {
    mockApi.getAuthStatus.mockResolvedValue({
      loggedIn: true,
      tokenPreview: 'jwt-abc...'
    });
    const store = useAuthStore();
    await store.refresh();
    expect(store.loggedIn).toBe(true);
    expect(store.tokenPreview).toBe('jwt-abc...');
    expect(mockApi.getAuthStatus).toHaveBeenCalledOnce();
  });

  it('initial state reflects logged-out when no token stored', async () => {
    mockApi.getAuthStatus.mockResolvedValue({ loggedIn: false, tokenPreview: null });
    const store = useAuthStore();
    await store.refresh();
    expect(store.loggedIn).toBe(false);
    expect(store.tokenPreview).toBeNull();
  });

  it('redeemCode() calls window.api.redeemCode and updates state', async () => {
    mockApi.redeemCode.mockResolvedValue({ loggedIn: true, tokenPreview: 'jwt-new...' });
    const store = useAuthStore();
    await store.redeemCode('482931');
    expect(mockApi.redeemCode).toHaveBeenCalledWith('482931');
    expect(store.loggedIn).toBe(true);
    expect(store.tokenPreview).toBe('jwt-new...');
  });

  it('redeemCode() does not mutate state when backend reports failure', async () => {
    mockApi.redeemCode.mockResolvedValue({ loggedIn: false, tokenPreview: null });
    const store = useAuthStore();
    await store.redeemCode('000000');
    expect(store.loggedIn).toBe(false);
    expect(store.tokenPreview).toBeNull();
  });

  it('logout() calls window.api.logout and clears state', async () => {
    mockApi.getAuthStatus.mockResolvedValue({ loggedIn: true, tokenPreview: 'jwt-x...' });
    mockApi.logout.mockResolvedValue({ ok: true });

    const store = useAuthStore();
    await store.refresh();
    expect(store.loggedIn).toBe(true);

    await store.logout();
    expect(mockApi.logout).toHaveBeenCalledOnce();
    expect(store.loggedIn).toBe(false);
    expect(store.tokenPreview).toBeNull();
  });
});
