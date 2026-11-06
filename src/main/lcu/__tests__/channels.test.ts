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
  explainQueryError,
  readEnvironment,
  scanLockfileCandidates,
  pickGameClient,
  PERMISSION_MARKER,
  PS_FALLBACK_SCRIPT,
  PS_QUERY_SCRIPT
} from '../channels';

describe('PS_QUERY_SCRIPT', () => {
  it('输出走 base64 —— 中文安装路径不能直接走管道', () => {
    expect(PS_QUERY_SCRIPT).toContain('ToBase64String');
  });

  it('一次查询捞出全部客户端相关进程名', () => {
    // 只认 LeagueClientUx.exe 的话,持有端口的是 LeagueClient.exe 的机器就查不到。
    for (const name of [
      'LeagueClientUx.exe',
      'LeagueClient.exe',
      'RiotClientUx.exe',
      'RiotClientServices.exe'
    ]) {
      expect(PS_QUERY_SCRIPT).toContain(`Name='${name}'`);
    }
  });

  it('进程名用 OR 连在同一个 WMI 过滤器里', () => {
    expect(PS_QUERY_SCRIPT).toContain(' OR ');
  });

  it('用分隔符把 exe 路径和命令行拼在一起', () => {
    expect(PS_QUERY_SCRIPT).toContain('[char]31');
  });

  it('把查询错误收集起来 —— 静默失败会被当成「客户端没开」', () => {
    // WMI 被拦时 Get-CimInstance 什么都不吐,只看退出码就分不清
    // 「没查成」和「客户端没开」,用户会被误导。
    expect(PS_QUERY_SCRIPT).toContain('-ErrorVariable');
    expect(PS_QUERY_SCRIPT).toContain('exit 1');
  });

  it('「一个都没匹配到」不算查询失败', () => {
    // Get-CimInstance -Filter 找不到东西时自己会报 No matching ——
    // 那不是失败,是客户端确实没开。
    expect(PS_QUERY_SCRIPT).toContain('No matching');
  });

  it('兜底查询走 Get-Process,绕开 WMI', () => {
    expect(PS_FALLBACK_SCRIPT).toContain('Get-Process');
    expect(PS_FALLBACK_SCRIPT).not.toContain('Get-CimInstance');
    // 兜底只拿得到 exe 路径,拿不到命令行 —— 但路径够推出 lockfile。
    expect(PS_FALLBACK_SCRIPT).toContain('GetBytes');
  });

  it('「看到了进程但读不到详情」要报成失败,不能当成「客户端没开」', () => {
    // 客户端以管理员身份运行时,WMI 的 ExecutablePath / CommandLine 是空的。
    // 旧代码把这种记录过滤掉,结果就是「进程明明在跑,却说没检测到客户端」。
    expect(PS_QUERY_SCRIPT).toContain('LCU_QUERY_ERROR: PERMISSION');
    expect(PS_QUERY_SCRIPT).toContain('$gameReadable -eq 0');
    expect(PS_FALLBACK_SCRIPT).toContain('LCU_QUERY_ERROR: PERMISSION');
    expect(PS_FALLBACK_SCRIPT).toContain('$gameReadable -eq 0');
  });

  it('权限判断只看游戏客户端那两个进程', () => {
    // Riot 的系统级服务进程对普通用户也读不到路径 —— 拿它判定的话,
    // 「客户端确实没开」会被误报成「权限不足」。
    expect(PS_QUERY_SCRIPT).toContain("$p.Name -eq 'LeagueClientUx.exe'");
    expect(PS_QUERY_SCRIPT).toContain("$p.Name -eq 'LeagueClient.exe'");
    expect(PS_QUERY_SCRIPT).not.toContain("$p.Name -eq 'RiotClientServices.exe'");
    expect(PS_FALLBACK_SCRIPT).toContain("$p.ProcessName -eq 'LeagueClientUx'");
    expect(PS_FALLBACK_SCRIPT).not.toContain("$p.ProcessName -eq 'RiotClientServices'");
  });

  it('脚本里不写中文 —— stdin 的编码跟着控制台代码页走,会被读成乱码', () => {
    // 中文结论由 TS 层翻译(PERMISSION_MARKER),不靠脚本里的常量。
    expect(/[一-鿿]/.test(PS_QUERY_SCRIPT)).toBe(false);
    expect(/[一-鿿]/.test(PS_FALLBACK_SCRIPT)).toBe(false);
  });
});

describe('explainQueryError', () => {
  it('权限不足要给出用户侧解法,而不是泛泛的「查询失败」', () => {
    const out = explainQueryError('PowerShell exited with 1: ' + PERMISSION_MARKER);
    expect(out).toContain('权限不足');
    expect(out).toContain('管理员');
  });

  it('其它报错原样透出', () => {
    expect(explainQueryError('PowerShell query timed out.')).toBe(
      'PowerShell query timed out.'
    );
  });
});

describe('pickGameClient', () => {
  it('只有游戏客户端进程才算客户端在跑', () => {
    const r = pickGameClient([
      {
        executablePath: 'C:\\Riot\\LeagueClientUx.exe',
        commandLine: 'LeagueClientUx.exe --app-port=1'
      }
    ]);
    expect(r.liveProcess).toBe(true);
    expect(r.gameProcesses).toHaveLength(1);
    expect(r.detail).toContain('游戏客户端进程');
  });

  it('Riot 客户端那层进程不算客户端在跑', () => {
    // 游戏没开时它们也在跑 —— 算进去用户会被误告知「客户端还没准备好」。
    const r = pickGameClient([
      {
        executablePath: 'C:\\Riot\\RiotClientUx.exe',
        commandLine: 'RiotClientUx.exe --riotclient-app-port=1'
      },
      {
        executablePath: 'C:\\Riot\\RiotClientServices.exe',
        commandLine: 'RiotClientServices.exe'
      }
    ]);
    expect(r.liveProcess).toBe(false);
    expect(r.gameProcesses).toHaveLength(0);
    expect(r.detail).toContain('Riot 客户端进程');
  });

  it('lockfile 目录只从游戏客户端进程推', () => {
    const r = pickGameClient([
      {
        executablePath: 'C:\\Riot\\RiotClientUx.exe',
        commandLine: 'RiotClientUx.exe'
      },
      {
        executablePath: 'E:\\wegameapps\\英雄联盟\\LeagueClient.exe',
        commandLine: 'LeagueClient.exe --app-port=1'
      }
    ]);
    expect(r.exeDirs).toEqual(['E:\\wegameapps\\英雄联盟']);
  });

  it('一个进程都没查到时是「没查到」而不是「只有 Riot 进程」', () => {
    const r = pickGameClient([]);
    expect(r.liveProcess).toBe(false);
    expect(r.exeDirs).toEqual([]);
    expect(r.detail).toBe('没查到客户端进程');
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

  it('非标准安装路径也能扫到 —— 白名单挡不住用户装哪', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-chan-'));
    const dir = path.join(root, 'game', 'LOL', '英雄联盟');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'lockfile'),
      'LeagueClientUx:12345:9999:secret-token:https',
      'utf8'
    );

    const result = await scanLockfileCandidates([root]);

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].port).toBe(9999);
    expect(result.candidates[0].origin).toBe('cn');
  });
});
