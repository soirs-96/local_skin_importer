import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  userDataDir: ''
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mocks.userDataDir;
      return process.cwd();
    }
  }
}));

import {
  exeDerivedLockfilePaths,
  staticLockfilePaths,
  readPathCache,
  writePathCache,
  readMemoryAuth,
  writeMemoryAuth,
  clearMemoryAuth,
  readEnvironment,
  scanLockfileCandidates,
  PS_QUERY_SCRIPT
} from '../channels';

describe('PS_QUERY_SCRIPT', () => {
  it('输出走 base64 —— 中文安装路径不能直接走管道', () => {
    expect(PS_QUERY_SCRIPT).toContain('ToBase64String');
  });

  it('按名字过滤 LeagueClientUx.exe', () => {
    expect(PS_QUERY_SCRIPT).toContain('LeagueClientUx.exe');
  });

  it('用分隔符把 exe 路径和命令行拼在一起', () => {
    expect(PS_QUERY_SCRIPT).toContain('[char]31');
  });
});

describe('exeDerivedLockfilePaths', () => {
  it('从 exe 目录推三层候选路径', () => {
    const out = exeDerivedLockfilePaths(['E:\\wegameapps\\英雄联盟\\LeagueClient']);
    expect(out).toContain(path.join('E:\\wegameapps\\英雄联盟\\LeagueClient', 'lockfile'));
    expect(out).toContain(path.join('E:\\wegameapps\\英雄联盟', 'lockfile'));
    expect(out).toContain(path.join('E:\\wegameapps', 'lockfile'));
  });

  it('多个 exe 目录的结果去重', () => {
    const out = exeDerivedLockfilePaths(['C:\\a', 'C:\\a']);
    expect(new Set(out).size).toBe(out.length);
  });

  it('空输入返回空数组', () => {
    expect(exeDerivedLockfilePaths([])).toEqual([]);
  });
});

describe('staticLockfilePaths', () => {
  it('国服 WeGame 的路径排在最前面', () => {
    const out = staticLockfilePaths(['D:\\'], 'C:\\Users\\x\\AppData\\Local', 'C:\\Program Files');
    expect(out[0].toLowerCase()).toContain('wegameapps');
  });

  it('包含 %LOCALAPPDATA% 下的国际服位置', () => {
    const out = staticLockfilePaths([], 'C:\\Users\\x\\AppData\\Local', null);
    expect(out.some((p) => p.includes('Riot Games'))).toBe(true);
  });

  it('包含 %ProgramFiles% 下的国际服位置', () => {
    const out = staticLockfilePaths([], null, 'C:\\Program Files');
    expect(out.some((p) => p.includes('Program Files'))).toBe(true);
  });

  it('环境变量为空时也能返回国服盘符路径', () => {
    const out = staticLockfilePaths(['E:\\'], null, null);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('路径缓存', () => {
  beforeEach(() => {
    mocks.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-cache-'));
  });

  it('写入后能读回来', async () => {
    await writePathCache(['E:\\wegameapps\\英雄联盟\\lockfile']);
    await expect(readPathCache()).resolves.toEqual(['E:\\wegameapps\\英雄联盟\\lockfile']);
  });

  it('缓存文件里只有路径,没有 token', async () => {
    await writePathCache(['E:\\a\\lockfile']);
    const raw = fs.readFileSync(path.join(mocks.userDataDir, 'lcu-paths.json'), 'utf8');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('password');
  });

  it('缓存文件不存在时返回空数组', async () => {
    mocks.userDataDir = path.join(os.tmpdir(), 'lcu-cache-not-exist-' + Date.now());
    await expect(readPathCache()).resolves.toEqual([]);
  });

  it('缓存文件被写坏时返回空数组而不是抛错', async () => {
    fs.writeFileSync(path.join(mocks.userDataDir, 'lcu-paths.json'), '{ broken', 'utf8');
    await expect(readPathCache()).resolves.toEqual([]);
  });
});

describe('内存凭据缓存', () => {
  beforeEach(() => {
    mocks.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-mem-'));
  });

  it('写入后能读回来', () => {
    const auth = { port: 1234, token: 'tok', protocol: 'https' as const, host: '127.0.0.1' };
    writeMemoryAuth(auth, 'cn');
    const got = readMemoryAuth();
    expect(got?.auth).toEqual(auth);
    expect(got?.origin).toBe('cn');
  });

  it('清理后读不到', () => {
    writeMemoryAuth({ port: 1, token: 't', protocol: 'https', host: '127.0.0.1' }, 'cn');
    clearMemoryAuth();
    expect(readMemoryAuth()).toBeNull();
  });

  it('凭据不落盘', () => {
    writeMemoryAuth(
      { port: 1234, token: 'secret-tok', protocol: 'https', host: '127.0.0.1' },
      'cn'
    );
    const files = fs.existsSync(mocks.userDataDir)
      ? fs.readdirSync(mocks.userDataDir)
      : [];
    for (const f of files) {
      const raw = fs.readFileSync(path.join(mocks.userDataDir, f), 'utf8');
      expect(raw).not.toContain('secret-tok');
    }
  });
});

describe('readEnvironment', () => {
  it('报代理变量的名字但不报值', () => {
    const previous = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://user:pass@proxy.local:8080';
    const env = readEnvironment();
    if (previous === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous;
    expect(env.proxyVars).toContain('HTTPS_PROXY');
    expect(JSON.stringify(env)).not.toContain('pass');
  });

  it('没有代理变量时是空数组', () => {
    const saved = { ...process.env };
    for (const k of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'ALL_PROXY',
      'all_proxy'
    ]) {
      delete process.env[k];
    }
    const env = readEnvironment();
    process.env = saved;
    expect(env.proxyVars).toEqual([]);
  });

  it('带上了 node 版本', () => {
    expect(readEnvironment().node).toBeTruthy();
  });
});

describe('scanLockfileCandidates', () => {
  it('扫到的 lockfile 能读出凭据 —— 扫盘通道必须真的吐出候选', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-chan-'));
    const dir = path.join(root, '英雄联盟');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'lockfile'),
      'LeagueClientUx:12345:9999:secret-token:https',
      'utf8'
    );

    const result = await scanLockfileCandidates([root]);

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].port).toBe(9999);
    expect(result.candidates[0].token).toBe('secret-token');
    expect(result.candidates[0].origin).toBe('cn');
    expect(result.candidates[0].source).toBe('lockfile');
  });

  it('扫不到东西时给空候选而不是抛错', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-chan-'));
    const result = await scanLockfileCandidates([root]);
    expect(result.candidates).toEqual([]);
  });
});
