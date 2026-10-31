import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AxiosInstance } from 'axios';
import { execSync } from 'node:child_process';
import {
  parseLockfile,
  findLockfilePath,
  readLockfile,
  readLcuAuth,
  readLcuAuthFromProcess,
  createLcuClient,
  getCurrentSummoner,
  getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds,
  LcuNotRunningError
} from '../lcu';

vi.mock('node:child_process', () => ({
  execSync: vi.fn()
}));

const VALID_LOCKFILE = 'LeagueClientUx:12345:9999:secret-token-here:https';

/** Minimal stand-in for an axios instance; only `get` is exercised. */
function stubClient(): AxiosInstance {
  return { get: vi.fn() } as unknown as AxiosInstance;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOL_LOCKFILE_PATH;
});

describe('parseLockfile', () => {
  it('returns the port and password from the 5-field format', () => {
    expect(parseLockfile(VALID_LOCKFILE)).toEqual({ port: 9999, token: 'secret-token-here' });
  });

  it('tolerates a trailing newline', () => {
    expect(parseLockfile(`${VALID_LOCKFILE}\n`)).toEqual({
      port: 9999,
      token: 'secret-token-here'
    });
  });

  it('throws when the field count is wrong', () => {
    expect(() => parseLockfile('12345:9999:token')).toThrow(/expected 5 colon-separated fields/);
  });

  it('throws when the port is not numeric', () => {
    expect(() => parseLockfile('LeagueClientUx:12345:notaport:tok:https')).toThrow(/invalid port/);
  });

  it('throws when the token is empty', () => {
    expect(() => parseLockfile('LeagueClientUx:12345:9999::https')).toThrow(/empty token/);
  });
});

describe('findLockfilePath', () => {
  it('prefers the LOL_LOCKFILE_PATH override', () => {
    process.env.LOL_LOCKFILE_PATH = '/tmp/custom/lockfile';
    expect(findLockfilePath()).toBe('/tmp/custom/lockfile');
  });

  it('falls back to the Riot Games directory under LocalAppData', () => {
    delete process.env.LOL_LOCKFILE_PATH;
    const expected = path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'Riot Games',
      'League of Legends',
      'lockfile'
    );
    expect(findLockfilePath()).toBe(expected);
  });
});

describe('readLockfile', () => {
  // fs is a real ESM namespace here and cannot be spied on, so these use temp files.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads and parses the lockfile at the given path', () => {
    const lockfile = path.join(tmpDir, 'lockfile');
    fs.writeFileSync(lockfile, VALID_LOCKFILE, 'utf8');

    expect(readLockfile(lockfile)).toEqual({ port: 9999, token: 'secret-token-here' });
  });

  it('defaults to findLockfilePath() when no path is given', () => {
    const lockfile = path.join(tmpDir, 'lockfile');
    fs.writeFileSync(lockfile, VALID_LOCKFILE, 'utf8');
    process.env.LOL_LOCKFILE_PATH = lockfile;

    expect(readLockfile()).toEqual({ port: 9999, token: 'secret-token-here' });
  });

  it('throws LcuNotRunningError when the file does not exist', () => {
    expect(() => readLockfile(path.join(tmpDir, 'absent'))).toThrow(LcuNotRunningError);
  });

  it('propagates non-ENOENT filesystem errors unchanged', () => {
    // Reading a directory yields EISDIR/EPERM — not ENOENT, so it must not be masked.
    expect(() => readLockfile(tmpDir)).toThrow();
    expect(() => readLockfile(tmpDir)).not.toThrow(LcuNotRunningError);
  });

  it('throws a parse error when the lockfile is malformed', () => {
    const lockfile = path.join(tmpDir, 'lockfile');
    fs.writeFileSync(lockfile, 'garbage', 'utf8');

    expect(() => readLockfile(lockfile)).toThrow(/expected 5 colon-separated fields/);
  });
});

describe('readLcuAuthFromProcess', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('extracts port and token from a WeGame-style command line', () => {
    vi.mocked(execSync).mockReturnValue(
      [
        'e:/wegameapps/英雄联盟/LeagueClient/LeagueClientUx.exe ',
        '"--riotclient-auth-token=Uk9_XmZf6hNKS3WH5gTLww" ',
        '"--riotclient-app-port=56063" ',
        '"--remoting-auth-token=JzjQHtV7o9hUwQZXDykoqw" ',
        '"--app-port=51077"',
        '"--region=TENCENT"'
      ].join('')
    );

    expect(readLcuAuthFromProcess()).toEqual({
      port: 51077,
      token: 'JzjQHtV7o9hUwQZXDykoqw'
    });
  });

  it('extracts port and token from a standard Riot command line', () => {
    vi.mocked(execSync).mockReturnValue(
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" ' +
        '"--riotclient-auth-token=abc123def" ' +
        '"--riotclient-app-port=12345"'
    );

    expect(readLcuAuthFromProcess()).toEqual({ port: 12345, token: 'abc123def' });
  });

  it('prefers WeGame pair over standard pair when both are present', () => {
    vi.mocked(execSync).mockReturnValue(
      'LeagueClientUx.exe ' +
        '"--riotclient-auth-token=wrongToken" ' +
        '"--riotclient-app-port=11111" ' +
        '"--remoting-auth-token=rightToken" ' +
        '"--app-port=22222"'
    );

    expect(readLcuAuthFromProcess()).toEqual({ port: 22222, token: 'rightToken' });
  });

  it('throws LcuNotRunningError when PowerShell query fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('powershell not found');
    });
    expect(() => readLcuAuthFromProcess()).toThrow(LcuNotRunningError);
  });

  it('throws when no recognizable port/token pair is present', () => {
    vi.mocked(execSync).mockReturnValue('LeagueClientUx.exe "--some-other-arg=value"');
    expect(() => readLcuAuthFromProcess()).toThrow(/did not expose recognizable LCU port/);
  });

  it('throws when only one half of a pair is present', () => {
    vi.mocked(execSync).mockReturnValue('LeagueClientUx.exe "--app-port=1234"');
    expect(() => readLcuAuthFromProcess()).toThrow(LcuNotRunningError);
  });
});

describe('readLcuAuth', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('prefers the process command line when available', () => {
    vi.mocked(execSync).mockReturnValue(
      'LeagueClientUx.exe "--riotclient-auth-token=fromProcess" "--riotclient-app-port=11111"'
    );

    expect(readLcuAuth()).toEqual({ port: 11111, token: 'fromProcess' });
  });

  it('falls back to the lockfile when the process query fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('wmic not available');
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-fallback-'));
    const lockfile = path.join(tmpDir, 'lockfile');
    fs.writeFileSync(lockfile, VALID_LOCKFILE, 'utf8');
    process.env.LOL_LOCKFILE_PATH = lockfile;

    try {
      expect(readLcuAuth()).toEqual({ port: 9999, token: 'secret-token-here' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('createLcuClient', () => {
  it('sets the baseURL and riot Basic Auth header', () => {
    const client = createLcuClient(9999, 'tok');
    const expected = `Basic ${Buffer.from('riot:tok', 'latin1').toString('base64')}`;

    expect(client.defaults.baseURL).toBe('https://127.0.0.1:9999');
    expect(client.defaults.headers.Authorization).toBe(expected);
    expect(client.defaults.timeout).toBe(5000);
  });

  it('uses an https agent with rejectUnauthorized false', () => {
    const client = createLcuClient(9999, 'tok');
    expect(client.defaults.httpsAgent?.options?.rejectUnauthorized).toBe(false);
  });
});

describe('getCurrentSummoner', () => {
  it('maps displayName and puuid from the current-summoner endpoint', async () => {
    const client = stubClient();
    vi.spyOn(client, 'get').mockResolvedValue({
      data: { displayName: 'Foo', puuid: 'abc', summonerId: 42 }
    });

    await expect(getCurrentSummoner(client)).resolves.toEqual({
      displayName: 'Foo',
      puuid: 'abc'
    });
    expect(client.get).toHaveBeenCalledWith('/lol-summoner/v1/current-summoner');
  });

  it('rejects when the client cannot connect', async () => {
    const client = stubClient();
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    vi.spyOn(client, 'get').mockRejectedValue(refused);

    await expect(getCurrentSummoner(client)).rejects.toThrow(refused);
  });
});

describe('getStoreOwnedSkinIds', () => {
  /** Each endpoint answers with its own payload; unlisted endpoints answer with an empty object. */
  function routedClient(routes: Record<string, unknown>): AxiosInstance {
    const get = vi.fn(async (url: string) => ({ data: url in routes ? routes[url] : {} }));
    return { get } as unknown as AxiosInstance;
  }

  it('keeps only CHAMPION_SKIN entries with owned=true and returns numeric itemIds', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': {
        catalog: [
          { itemId: 161013, inventoryType: 'CHAMPION_SKIN', owned: true },
          { itemId: 1002, inventoryType: 'CHAMPION_SKIN', owned: false },
          { itemId: 2005, inventoryType: 'CHAMPION_SKIN', owned: true },
          { itemId: 57, inventoryType: 'CHAMPION', owned: true },
          { itemId: 13003, inventoryType: 'CHAMPION_SKIN' }
        ],
        groupOrder: [],
        itemGroups: {},
        player: {}
      }
    });

    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([161013, 2005]);
    expect(client.get).toHaveBeenCalledWith('/lol-store/v1/skins');
  });

  it('drops chromas — they are CHAMPION_SKIN + owned but the site catalog has none', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': {
        catalog: [
          { itemId: 161013, inventoryType: 'CHAMPION_SKIN', owned: true, subInventoryType: null },
          { itemId: 10011, inventoryType: 'CHAMPION_SKIN', owned: true, subInventoryType: 'RECOLOR' },
          { itemId: 10012, inventoryType: 'CHAMPION_SKIN', owned: true, subInventoryType: 'recolor' },
          { itemId: 10013, inventoryType: 'CHAMPION_SKIN', owned: true, tags: ['RECOLOR'] },
          { itemId: 2005, inventoryType: 'CHAMPION_SKIN', owned: true }
        ]
      }
    });

    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([161013, 2005]);
  });

  it('drops skin variants — they carry a skin_variant tag and have no splash art', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': {
        catalog: [
          { itemId: 157001, inventoryType: 'CHAMPION_SKIN', owned: true, tags: ['champions_157'] },
          {
            itemId: 157054,
            inventoryType: 'CHAMPION_SKIN',
            owned: true,
            tags: ['champions_157', 'skin_variant', 'skin_variant_skin_157055']
          }
        ]
      }
    });

    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([157001]);
  });

  it('merges owned skins from bundles and featured — retired skins the catalog dropped', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': {
        catalog: [{ itemId: 161013, inventoryType: 'CHAMPION_SKIN', owned: true }]
      },
      '/lol-store/v1/bundles': [
        { items: [{ itemId: 89001, inventoryType: 'CHAMPION_SKIN', owned: true }] }
      ],
      '/lol-store/v1/featured': [
        { items: [{ itemId: 267003, inventoryType: 'CHAMPION_SKIN', owned: true }] }
      ]
    });

    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([161013, 89001, 267003]);
  });

  it('keeps the catalog result when a supplement endpoint fails', async () => {
    const get = vi.fn(async (url: string) => {
      if (url === '/lol-store/v1/skins') {
        return {
          data: { catalog: [{ itemId: 161013, inventoryType: 'CHAMPION_SKIN', owned: true }] }
        };
      }
      throw new Error('supplement unavailable');
    });
    const client = { get } as unknown as AxiosInstance;

    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([161013]);
  });

  it('returns an empty array when the catalog is empty', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': { catalog: [], groupOrder: [], itemGroups: {}, player: {} }
    });
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([]);
  });

  it('returns an empty array when the envelope has no catalog array', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': { message: 'unauthorized' }
    });
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([]);
  });

  it('returns an empty array when the payload is not an object', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': 'oops'
    });
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([]);
  });

  it('skips malformed entries in catalog', async () => {
    const client = routedClient({
      '/lol-store/v1/skins': {
        catalog: [
          { itemId: 1001 },
          null,
          { itemId: 2005, inventoryType: 'CHAMPION_SKIN', owned: true }
        ]
      }
    });
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([2005]);
  });

  it('rejects when the client cannot connect', async () => {
    const client = stubClient();
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    vi.spyOn(client, 'get').mockRejectedValue(refused);

    await expect(getStoreOwnedSkinIds(client)).rejects.toThrow(refused);
  });
});

describe('getInventoryOwnedSkinIds', () => {
  function inventoryClient(payload: unknown): AxiosInstance {
    const get = vi.fn(async () => ({ data: payload }));
    return { get } as unknown as AxiosInstance;
  }

  it('returns every owned itemId from the inventory endpoint', async () => {
    const client = inventoryClient([
      { itemId: 161013, inventoryType: 'CHAMPION_SKIN', owned: true, ownershipType: 'OWNED' },
      { itemId: 2005, inventoryType: 'CHAMPION_SKIN', owned: true, ownershipType: 'OWNED' }
    ]);

    await expect(getInventoryOwnedSkinIds(client)).resolves.toEqual([161013, 2005]);
    expect(client.get).toHaveBeenCalledWith('/lol-inventory/v2/inventory/CHAMPION_SKIN', {
      timeout: 30000
    });
  });

  it('drops items that are not owned — rented, unowned or a different ownership type', async () => {
    const client = inventoryClient([
      { itemId: 1002, owned: true, ownershipType: 'OWNED' },
      { itemId: 1003, owned: false, ownershipType: 'OWNED' },
      { itemId: 1004, owned: true, ownershipType: 'RENTAL' },
      { itemId: 1005, owned: true, ownershipType: 'OWNED', rental: true },
      { itemId: 2005, owned: true, ownershipType: 'OWNED' }
    ]);

    await expect(getInventoryOwnedSkinIds(client)).resolves.toEqual([1002, 2005]);
  });

  it('dedupes repeated itemIds and skips malformed entries', async () => {
    const client = inventoryClient([
      { itemId: 161013, owned: true, ownershipType: 'OWNED' },
      { itemId: 161013, owned: true, ownershipType: 'OWNED' },
      null,
      { owned: true },
      { itemId: 0, owned: true },
      { itemId: 2005, owned: true, ownershipType: 'OWNED' }
    ]);

    await expect(getInventoryOwnedSkinIds(client)).resolves.toEqual([161013, 2005]);
  });

  it('rejects when the payload is not an array', async () => {
    const client = inventoryClient({ message: 'unauthorized' });

    await expect(getInventoryOwnedSkinIds(client)).rejects.toThrow(/Unexpected/);
  });

  it('rejects when the client cannot connect', async () => {
    const client = stubClient();
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    vi.spyOn(client, 'get').mockRejectedValue(refused);

    await expect(getInventoryOwnedSkinIds(client)).rejects.toThrow(refused);
  });
});
