import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../auth';

interface MockApi {
  getAuthStatus: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  checkLcu: ReturnType<typeof vi.fn>;
  fetchSkins: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
}

const mockApi: MockApi = {
  getAuthStatus: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  checkLcu: vi.fn(),
  fetchSkins: vi.fn(),
  sync: vi.fn()
};

beforeEach(() => {
  setActivePinia(createPinia());
  (globalThis as unknown as { window: { api: MockApi } }).window = {
    api: mockApi
  };
  mockApi.getAuthStatus.mockReset();
  mockApi.login.mockReset();
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

  it('login() calls window.api.login and updates state', async () => {
    mockApi.login.mockResolvedValue({ loggedIn: true, tokenPreview: 'jwt-new...' });
    const store = useAuthStore();
    await store.login('alice', 'pw');
    expect(mockApi.login).toHaveBeenCalledWith('alice', 'pw');
    expect(store.loggedIn).toBe(true);
    expect(store.tokenPreview).toBe('jwt-new...');
  });

  it('login() does not mutate state when backend reports failure', async () => {
    mockApi.login.mockResolvedValue({ loggedIn: false, tokenPreview: null });
    const store = useAuthStore();
    await store.login('alice', 'wrong');
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
