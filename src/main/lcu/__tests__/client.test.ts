import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  createLcuClient,
  getCurrentSummoner,
  getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds,
  isPortAlive
} from '../client';
import type { LcuAuth } from '../types';

const AUTH: LcuAuth = {
  port: 9999,
  token: 'tok',
  protocol: 'https',
  host: '127.0.0.1'
};

describe('createLcuClient', () => {
  it('baseURL 按 protocol + host + port 组装', () => {
    const client = createLcuClient(AUTH);
    expect(client.defaults.baseURL).toBe('https://127.0.0.1:9999');
  });

  it('protocol 为 http 时用 http', () => {
    const client = createLcuClient({ ...AUTH, protocol: 'http' });
    expect(client.defaults.baseURL).toBe('http://127.0.0.1:9999');
  });

  it('host 不是回环时按给的 host 来', () => {
    const client = createLcuClient({ ...AUTH, host: '192.168.1.5' });
    expect(client.defaults.baseURL).toBe('https://192.168.1.5:9999');
  });

  it('带上 riot:token 的 Basic 认证头', () => {
    const client = createLcuClient(AUTH);
    const expected = 'Basic ' + Buffer.from('riot:tok', 'latin1').toString('base64');
    const headers = client.defaults.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe(expected);
  });

  it('关掉代理继承 —— 否则装了代理软件的机器全都连不上', () => {
    const client = createLcuClient(AUTH);
    expect(client.defaults.proxy).toBe(false);
  });

  it('自签证书不校验(仅限这个实例)', () => {
    const client = createLcuClient(AUTH);
    const agent = client.defaults.httpsAgent as { options: { rejectUnauthorized: boolean } };
    expect(agent.options.rejectUnauthorized).toBe(false);
  });
});

describe('isPortAlive', () => {
  it('没人监听的端口返回 false', async () => {
    const server = (await import('node:net')).createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(isPortAlive('127.0.0.1', port)).resolves.toBe(false);
  });
});

function fakeClient(data: unknown): AxiosInstance {
  return { get: vi.fn(async () => ({ data })) } as unknown as AxiosInstance;
}

describe('getCurrentSummoner', () => {
  it('抽出显示名和 puuid', async () => {
    const client = fakeClient({ displayName: 'Tester', puuid: 'p-1' });
    await expect(getCurrentSummoner(client)).resolves.toEqual({
      displayName: 'Tester',
      puuid: 'p-1'
    });
  });

  it('响应不是对象时抛错', async () => {
    const client = fakeClient('nope');
    await expect(getCurrentSummoner(client)).rejects.toThrow(/Unexpected/);
  });

  it('国服客户端 displayName 是空的,真名在 gameName 里', async () => {
    const client = fakeClient({ displayName: '', gameName: '林俊杰', puuid: 'p-1' });
    await expect(getCurrentSummoner(client)).resolves.toEqual({
      displayName: '林俊杰',
      puuid: 'p-1'
    });
  });
});

describe('getInventoryOwnedSkinIds', () => {
  it('只收 owned 的皮肤 id', async () => {
    const client = fakeClient([
      { itemId: 1001, owned: true },
      { itemId: 1002, owned: false },
      { itemId: 1003, rental: true },
      { itemId: 1004, ownershipType: 'OWNED' }
    ]);
    await expect(getInventoryOwnedSkinIds(client)).resolves.toEqual([1001, 1004]);
  });

  it('响应不是数组时抛错', async () => {
    const client = fakeClient({});
    await expect(getInventoryOwnedSkinIds(client)).rejects.toThrow(/Unexpected/);
  });
});

describe('getStoreOwnedSkinIds', () => {
  it('收商城目录里 owned 的皮肤,炫彩不算', async () => {
    const client = fakeClient([
      { itemId: 2001, inventoryType: 'CHAMPION_SKIN', owned: true },
      { itemId: 2002, inventoryType: 'CHAMPION_SKIN', owned: true, subInventoryType: 'RECOLOR' },
      { itemId: 2003, inventoryType: 'CHAMPION_SKIN', owned: false }
    ]);
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([2001]);
  });

  it('补充源挂掉时不影响已拿到的目录数据', async () => {
    let call = 0;
    const client = {
      get: vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return { data: [{ itemId: 3001, inventoryType: 'CHAMPION_SKIN', owned: true }] };
        }
        throw new Error('boom');
      })
    } as unknown as AxiosInstance;
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([3001]);
  });
});
