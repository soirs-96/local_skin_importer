import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { areaIdFromCookieList, fetchAreaId, parseAreaId } from '../gameZone';

describe('parseAreaId', () => {
  it('finds the area id in a cookie string', () => {
    expect(parseAreaId('skey=abc; lol_areaId=5; uin=123')).toBe(5);
  });

  it('is case-insensitive about the cookie name', () => {
    expect(parseAreaId('LOL_AREAID=12')).toBe(12);
  });

  it('returns null when the cookie is not there', () => {
    expect(parseAreaId('skey=abc; uin=123')).toBeNull();
  });

  it('returns null for a non-positive id', () => {
    expect(parseAreaId('lol_areaId=0')).toBeNull();
  });

  it('returns null for a value that is not a number', () => {
    expect(parseAreaId('lol_areaId=abc')).toBeNull();
  });
});

describe('areaIdFromCookieList', () => {
  it('picks the area cookie out of the jar', () => {
    const cookies = [
      { name: 'skey', value: 'abc', domain: '.lol.qq.com' },
      { name: 'lol_areaId', value: '8', domain: '.lol.qq.com' }
    ];
    expect(areaIdFromCookieList(cookies)).toBe(8);
  });

  it('matches the cookie name case-insensitively', () => {
    expect(areaIdFromCookieList([{ name: 'LOL_AREAID', value: '8' }])).toBe(8);
  });

  it('returns null when the jar does not hold the area cookie', () => {
    expect(areaIdFromCookieList([{ name: 'skey', value: 'abc' }])).toBeNull();
  });

  it('returns null for a jar that is not a list', () => {
    expect(areaIdFromCookieList(null)).toBeNull();
    expect(areaIdFromCookieList({ name: 'lol_areaId', value: '8' })).toBeNull();
  });
});

describe('fetchAreaId', () => {
  function clientWith(get: (url: string) => Promise<{ data: unknown }>): AxiosInstance {
    return { get: vi.fn((url: string) => get(url)) } as unknown as AxiosInstance;
  }

  it('reads the area id from the diagnostic cookie channel', async () => {
    const client = clientWith(async (url) => {
      if (url.includes('get-cookie')) return { data: 'skey=abc; lol_areaId=6' };
      throw new Error('not reached');
    });

    await expect(fetchAreaId(client)).resolves.toBe(6);
  });

  it('falls back to the cookie jar when the first channel fails', async () => {
    const client = clientWith(async (url) => {
      if (url.includes('get-cookie')) throw new Error('channel missing');
      return { data: [{ name: 'lol_areaId', value: '9' }] };
    });

    await expect(fetchAreaId(client)).resolves.toBe(9);
  });

  it('returns null when neither channel knows the area', async () => {
    const client = clientWith(async () => {
      throw new Error('no client');
    });

    await expect(fetchAreaId(client)).resolves.toBeNull();
  });

  it('does not invent an area id from a jar without the cookie', async () => {
    const client = clientWith(async (url) => {
      if (url.includes('get-cookie')) throw new Error('channel missing');
      return { data: [{ name: 'skey', value: 'abc' }] };
    });

    await expect(fetchAreaId(client)).resolves.toBeNull();
  });
});
