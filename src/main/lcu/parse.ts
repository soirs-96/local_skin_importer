/**
 * 纯解析层:字符串 → 结构化数据。
 *
 * 这里**不碰文件系统、不碰网络、不 spawn 任何进程** —— 所以可以随便造输入测。
 * 分隔符统一用 ASCII 单元分隔符(String.fromCharCode(31)):exe 路径和命令行里
 * 都不会出现这个字符。
 */
import type { LcuAuth, LcuAuthOrigin, LcuProtocol } from './types';

/** LCU 监听在本机回环地址上。 */
export const DEFAULT_HOST = '127.0.0.1';

/**
 * 要查询的客户端相关进程名。
 *
 * 查的不止 `LeagueClientUx.exe` 一个 —— 国服 WeGame 和国际服的进程组合不一样,
 * 只认一个名字的话,进程名对不上就等于「没装客户端」。
 *
 * `LeagueClient.exe` 是游戏客户端本体,它才是真正持有 LCU 端口的那个进程;
 * `RiotClientUx.exe` / `RiotClientServices.exe` 是 Riot 客户端那一层。
 */
export const LCU_PROCESS_NAMES: readonly string[] = [
  'LeagueClientUx.exe',
  'LeagueClient.exe',
  'RiotClientUx.exe',
  'RiotClientServices.exe'
];

/**
 * 游戏客户端的进程名 —— **只有这些算「游戏客户端在跑」**。
 *
 * Riot 客户端那层进程在游戏没开的时候也在跑,把它算成「客户端在跑」的话,
 * 用户明明没开游戏也会被告知「找到了客户端但它还没准备好」。
 */
export const GAME_CLIENT_PROCESS_NAMES: readonly string[] = [
  'LeagueClientUx.exe',
  'LeagueClient.exe'
];

/** exe 路径与命令行之间的分隔符。用 fromCharCode 写,避免转义被工具吞掉。 */
export const FIELD_SEPARATOR = String.fromCharCode(31);

/** 一条进程记录:exe 路径 + 命令行。 */
export interface LcuProcessInfo {
  executablePath: string;
  commandLine: string;
}

/** 从命令行里抠出来的一份凭据。 */
export interface CommandLineCandidate {
  origin: LcuAuthOrigin;
  port: number;
  token: string;
  protocol: LcuProtocol;
  host: string;
}

const CN_PORT_RE = /--app-port=(\d+)/;
const CN_TOKEN_RE = /--remoting-auth-token=([\w-]+)/;
const RIOT_PORT_RE = /--riotclient-app-port=(\d+)/;
const RIOT_TOKEN_RE = /--riotclient-auth-token=([\w-]+)/;
const HOST_RE = /--remoting-host=([^\s"]+)/;

/**
 * 解析 lockfile 文本。
 *
 * 格式是五段:`LeagueClientUx:<pid>:<port>:<password>:<protocol>`。
 * 端口是第 3 段、密码是第 4 段(0 起数)。格式不对返回 null 而不是抛错 ——
 * 磁盘上残留的旧 lockfile 内容可能是任意形状,不能让它把整轮检测带崩。
 */
export function parseLockfileText(contents: string): LcuAuth | null {
  const fields = contents.trim().split(':');
  if (fields.length !== 5) return null;

  const port = Number(fields[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const token = fields[3];
  if (!token) return null;

  const protocol: LcuProtocol = fields[4].trim().toLowerCase() === 'http' ? 'http' : 'https';

  return { port, token, protocol, host: DEFAULT_HOST };
}

/** 从命令行里抠 host。老客户端没有这个参数,默认回环。 */
export function parseRemotingHost(commandLine: string): string {
  const m = commandLine.match(HOST_RE);
  return m ? m[1] : DEFAULT_HOST;
}

/**
 * 从命令行里抠出所有可能的凭据。
 *
 * 国服 WeGame 的 LeagueClientUx.exe **同时**带两对参数:
 *   --app-port + --remoting-auth-token      → 游戏 LCU API(我们要的)
 *   --riotclient-app-port + --riotclient-auth-token → Riot Client API(游戏端点 404)
 * 两对都吐出来、国服在前 —— 后面由裁决层实测决定谁是真的。
 * 少吐一条 = 少一条能自愈的路,所以宁可多列。
 */
export function parseCommandLineCandidates(commandLine: string): CommandLineCandidate[] {
  const out: CommandLineCandidate[] = [];
  const host = parseRemotingHost(commandLine);

  const cnPort = commandLine.match(CN_PORT_RE);
  const cnToken = commandLine.match(CN_TOKEN_RE);
  if (cnPort && cnToken) {
    out.push({
      origin: 'cn',
      port: Number(cnPort[1]),
      token: cnToken[1],
      protocol: 'https',
      host
    });
  }

  const riotPort = commandLine.match(RIOT_PORT_RE);
  const riotToken = commandLine.match(RIOT_TOKEN_RE);
  if (riotPort && riotToken) {
    out.push({
      origin: 'riot',
      port: Number(riotPort[1]),
      token: riotToken[1],
      protocol: 'https',
      host
    });
  }

  return out;
}

/**
 * base64 → UTF-8 字符串。解不出来返回 null。
 *
 * 这里必须比 `Buffer.from(line, 'base64')` 严格:Node 的 base64 解码器是**宽容**的,
 * 非法字符会被静悄悄丢掉而不是报错 —— 一行乱码能解出「看起来还行」的字节,
 * 然后被当成一条进程记录,污染整个候选池。所以要过三道关:
 *   1. 正则确认这行确实是 base64;
 *   2. 解出来的字节必须是合法 UTF-8(往返编码比对);
 *   3. 解出来的文本里不能有控制字符(分隔符除外)。
 */
function decodeBase64Utf8(line: string): string | null {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(line)) return null;

    const buf = Buffer.from(line, 'base64');
    if (buf.length === 0) return null;

    const text = buf.toString('utf8');
    // UTF-8 解码也是宽容的:非法字节会被换成 U+FFFD。重新编码一遍,
    // 字节对不上就说明原文不是合法 UTF-8。
    if (!Buffer.from(text, 'utf8').equals(buf)) return null;

    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code === 31) continue; // 字段分隔符
      if (code < 32 || code === 127) return null;
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * 解析 PowerShell 的输出,一行一个进程。
 *
 * 每行是 base64,解开是 `exe 路径<分隔符>命令行`。走 base64 是因为安装路径
 * 可能是中文(`E:\wegameapps\英雄联盟\`),直接走管道会被控制台代码页毁掉。
 */
export function parseProcessOutput(out: string): LcuProcessInfo[] {
  const text = out.charCodeAt(0) === 0xfeff ? out.slice(1) : out;
  const result: LcuProcessInfo[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const decoded = decodeBase64Utf8(line);
    if (decoded === null) continue;

    const idx = decoded.indexOf(FIELD_SEPARATOR);
    if (idx >= 0) {
      result.push({
        executablePath: decoded.slice(0, idx).trim(),
        commandLine: decoded.slice(idx + 1).trim()
      });
    } else {
      result.push({ executablePath: '', commandLine: decoded.trim() });
    }
  }

  // exe 路径和命令行都没拿到(权限不足等)的记录没有信息量,丢掉它,
  // 别让它顶掉「压根没有这个进程」这个更准确的结论。
  return result.filter((info) => info.executablePath !== '' || info.commandLine !== '');
}

/** 命令行的第一个 token —— 通常就是 exe 路径(带引号就取引号里的)。 */
function firstToken(commandLine: string): string {
  const trimmed = commandLine.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end > 1 ? trimmed.slice(1, end) : '';
  }
  const space = trimmed.search(/\s/);
  return space > 0 ? trimmed.slice(0, space) : trimmed;
}

/** exe 所在目录 —— lockfile 就在那儿。取不到就返回 null。 */
export function executableDirOf(info: LcuProcessInfo): string | null {
  const exe = info.executablePath || firstToken(info.commandLine);
  if (!exe) return null;
  const dir = exe.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
  return dir ? dir : null;
}

/** 进程名(不含目录)。取不到就是空串。 */
export function processNameOf(info: LcuProcessInfo): string {
  const exe = info.executablePath || firstToken(info.commandLine);
  const idx = Math.max(exe.lastIndexOf('\\'), exe.lastIndexOf('/'));
  return idx >= 0 ? exe.slice(idx + 1) : exe;
}

/**
 * 这个进程是不是游戏客户端本体。
 *
 * 判据是进程名 —— 命令行参数不能用来判:国际服和国际服之外的各种启动方式
 * 带的参数组合太多,按参数判会把「Riot 客户端在跑」误当成「游戏客户端在跑」。
 */
export function isGameClientProcess(info: LcuProcessInfo): boolean {
  const name = processNameOf(info).toLowerCase();
  return GAME_CLIENT_PROCESS_NAMES.some((n) => n.toLowerCase() === name);
}
