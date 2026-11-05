import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  parseCommandLineCandidates,
  parseLockfileText,
  parseProcessOutput,
  executableDirOf
} from '../parse';

const SEP = String.fromCharCode(31);

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

describe('parseLockfileText', () => {
  it('解析标准的五段 lockfile', () => {
    const raw = 'LeagueClientUx:12345:9999:secret-token:https';
    expect(parseLockfileText(raw)).toEqual({
      port: 9999,
      token: 'secret-token',
      protocol: 'https',
      host: DEFAULT_HOST
    });
  });

  it('协议段是 http 时保留 http', () => {
    const raw = 'LeagueClientUx:12345:9999:tok:http';
    expect(parseLockfileText(raw)?.protocol).toBe('http');
  });

  it('结尾多个换行不影响解析', () => {
    const raw = 'LeagueClientUx:12345:9999:tok:https\n\n';
    expect(parseLockfileText(raw)?.port).toBe(9999);
  });

  it('段数不对返回 null', () => {
    expect(parseLockfileText('12345:9999:token')).toBeNull();
    expect(parseLockfileText('a:b:c:d:e:f')).toBeNull();
  });

  it('端口非法返回 null', () => {
    expect(parseLockfileText('LeagueClientUx:12345:notaport:tok:https')).toBeNull();
    expect(parseLockfileText('LeagueClientUx:12345:0:tok:https')).toBeNull();
    expect(parseLockfileText('LeagueClientUx:12345:70000:tok:https')).toBeNull();
  });

  it('token 为空返回 null', () => {
    expect(parseLockfileText('LeagueClientUx:12345:9999::https')).toBeNull();
  });

  it('协议不认识时按 https 处理', () => {
    expect(parseLockfileText('LeagueClientUx:1:9999:tok:ftp')?.protocol).toBe('https');
  });
});

describe('parseCommandLineCandidates', () => {
  it('国服参数优先,产出 cn 候选', () => {
    const cmd =
      'LeagueClientUx.exe "--riotclient-app-port=1111" "--riotclient-auth-token=riotTok" ' +
      '"--app-port=2222" "--remoting-auth-token=cnTok"';
    const out = parseCommandLineCandidates(cmd);
    expect(out[0]).toEqual({
      origin: 'cn',
      port: 2222,
      token: 'cnTok',
      protocol: 'https',
      host: DEFAULT_HOST
    });
  });

  it('只有国际服参数时产出 riot 候选', () => {
    const cmd =
      'LeagueClientUx.exe "--riotclient-app-port=1111" "--riotclient-auth-token=riotTok"';
    const out = parseCommandLineCandidates(cmd);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      origin: 'riot',
      port: 1111,
      token: 'riotTok',
      protocol: 'https',
      host: DEFAULT_HOST
    });
  });

  it('两对参数都有时产出两条候选,cn 在前', () => {
    const cmd =
      'LeagueClientUx.exe "--app-port=2222" "--remoting-auth-token=cnTok" ' +
      '"--riotclient-app-port=1111" "--riotclient-auth-token=riotTok"';
    const out = parseCommandLineCandidates(cmd);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.origin)).toEqual(['cn', 'riot']);
  });

  it('端口和 token 必须成对出现,缺一个就不产出', () => {
    expect(parseCommandLineCandidates('LeagueClientUx.exe "--app-port=2222"')).toHaveLength(0);
    const tokenOnly = 'LeagueClientUx.exe "--remoting-auth-token=tok"';
    expect(parseCommandLineCandidates(tokenOnly)).toHaveLength(0);
  });

  it('识别 --remoting-host 指定的 host', () => {
    const cmd =
      'LeagueClientUx.exe "--app-port=2222" "--remoting-auth-token=cnTok" "--remoting-host=192.168.1.5"';
    const out = parseCommandLineCandidates(cmd);
    expect(out[0].host).toBe('192.168.1.5');
  });

  it('没有任何可识别参数时返回空数组', () => {
    expect(parseCommandLineCandidates('LeagueClientUx.exe "--some-other-arg=value"')).toEqual([]);
  });
});

describe('parseProcessOutput', () => {
  it('解析 base64 编码的 exe 路径 + 命令行', () => {
    const line = b64(
      'E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe' + SEP + 'LeagueClientUx.exe --app-port=1'
    );
    const out = parseProcessOutput(line);
    expect(out).toHaveLength(1);
    expect(out[0].executablePath).toBe('E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe');
    expect(out[0].commandLine).toContain('--app-port=1');
  });

  it('多个进程按行解析', () => {
    const out = parseProcessOutput(
      [
        b64('C:\\a.exe' + SEP + 'a.exe --app-port=1'),
        b64('C:\\b.exe' + SEP + 'b.exe --app-port=2')
      ].join('\n')
    );
    expect(out).toHaveLength(2);
  });

  it('exe 路径为空(权限不足)时仍能拿到命令行', () => {
    const out = parseProcessOutput(b64(SEP + 'LeagueClientUx.exe --app-port=1'));
    expect(out).toHaveLength(1);
    expect(out[0].executablePath).toBe('');
    expect(out[0].commandLine).toContain('--app-port=1');
  });

  it('不是 base64 的行被丢掉', () => {
    expect(parseProcessOutput('这不是 base64 !!!')).toEqual([]);
  });

  it('base64 合法但解出来是控制字符的行被丢掉', () => {
    // 'AAAA' 解出来是三个 0x00 —— 不是进程记录,不能混进候选池。
    expect(parseProcessOutput('AAAA')).toEqual([]);
  });

  it('空输入返回空数组', () => {
    expect(parseProcessOutput('')).toEqual([]);
  });

  it('BOM 不会污染第一条记录', () => {
    // BOM 用 fromCharCode 写 —— 某些编辑器会把文件头的 BOM 字符弄丢。
    const bom = String.fromCharCode(0xfeff);
    const out = parseProcessOutput(bom + b64('C:\\a.exe' + SEP + 'a.exe --app-port=1'));
    expect(out[0].executablePath).toBe('C:\\a.exe');
  });
});

describe('executableDirOf', () => {
  it('优先用进程记录的 exe 路径', () => {
    const dir = executableDirOf({
      executablePath: 'E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe',
      commandLine: 'LeagueClientUx.exe --app-port=1'
    });
    expect(dir).toBe('E:\\wegameapps\\英雄联盟');
  });

  it('exe 路径缺失时从命令行的第一个 token 推', () => {
    const dir = executableDirOf({
      executablePath: '',
      commandLine: '"E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe" --app-port=1'
    });
    expect(dir).toBe('E:\\wegameapps\\英雄联盟');
  });

  it('推不出来时返回 null', () => {
    expect(executableDirOf({ executablePath: '', commandLine: '' })).toBeNull();
  });
});
