/**
 * 主进程往终端写日志时的编码。
 *
 * Node 往 stdout 写的是 **UTF-8 字节**,而 Windows 控制台是按**代码页**解的 ——
 * 代码页是 GBK(936) 时,中文就成了「鍚姩」那样的乱码。
 *
 * 所以反过来做:**按控制台的代码页编码**。
 *   - 控制台代码页(`chcp`):最准;
 *   - 系统 ANSI 代码页(注册表 ACP):控制台读不到时的退路。
 * stdout 不是终端(重定向到文件)时按 UTF-8 写 —— 读的那头一般按 UTF-8 解。
 *
 * `LOL_CONSOLE_ENCODING=utf8|gbk` 可以强制指定。
 */
import { execFileSync } from 'node:child_process';
import { encode } from 'iconv-lite';

export type ConsoleEncoding = 'utf8' | 'gbk';

/** GBK 和它的超集 GB18030。 */
const GBK_CODE_PAGES = new Set([936, 54936]);

export interface ConsoleEncodingInfo {
  encoding: ConsoleEncoding;
  /** 应用看得到的控制台代码页;读不到是 null。 */
  codePage: number | null;
  /** 系统 ANSI 代码页;读不到是 null。 */
  ansiCodePage: number | null;
  /** stdout 是不是终端。被重定向到文件/管道时按 UTF-8 写。 */
  isTty: boolean;
}

/**
 * 控制台代码页(`chcp`)。
 *
 * 打包后没有控制台 —— 读不到是正常的。
 */
export function detectConsoleCodePage(): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('chcp.com', {
      // 输出是中文的,用 latin1 逐字节取 —— 我们只要末尾那个数字。
      encoding: 'latin1',
      windowsHide: true,
      timeout: 3000
    });
    const match = /(\d+)\s*$/.exec(out.trim());
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * 系统 ANSI 代码页。
 *
 * 控制台代码页读不到时的退路 —— 同一台机器上这两个值通常一致。
 */
export function detectAnsiCodePage(): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg.exe',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'],
      { encoding: 'latin1', windowsHide: true, timeout: 3000 }
    );
    const match = /ACP\s+REG_SZ\s+(\d+)/.exec(out);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * 把一个流的 write 换掉 —— 字符串先按目标编码转成字节再写出去。
 *
 * 只在 stdout / stderr 上动刀,不影响别的地方。
 */
function patchStream(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream) as (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
    callback?: (err?: Error) => void
  ) => boolean;
  const patched = (
    chunk: string | Uint8Array,
    encodingOrCallback?: unknown,
    callback?: unknown
  ): boolean => {
    if (typeof chunk !== 'string') {
      return original(
        chunk,
        encodingOrCallback as BufferEncoding,
        callback as ((err?: Error) => void) | undefined
      );
    }
    const cb =
      typeof encodingOrCallback === 'function'
        ? (encodingOrCallback as (err?: Error) => void)
        : (callback as ((err?: Error) => void) | undefined);
    const enc =
      typeof encodingOrCallback === 'string'
        ? (encodingOrCallback as BufferEncoding)
        : undefined;
    return original(encode(chunk, 'gbk'), enc, cb);
  };
  stream.write = patched as unknown as typeof stream.write;
}

/**
 * 装上终端编码。
 *
 * 必须在**第一条日志之前**调用 —— 启动横幅也是中文的。
 *
 * `LOL_CONSOLE_ENCODING=utf8|gbk` 可以强制指定(终端实在认不出来时用)。
 */
export function installConsoleEncoding(): ConsoleEncodingInfo {
  const codePage = detectConsoleCodePage();
  const ansiCodePage = detectAnsiCodePage();
  // stdout 是终端,才有「控制台按代码页解字节」这回事;
  // 重定向到文件/管道时读的那头一般按 UTF-8 解,照 UTF-8 写。
  const isTty = Boolean(process.stdout.isTTY);

  const override = (process.env.LOL_CONSOLE_ENCODING ?? '').trim().toLowerCase();
  let encoding: ConsoleEncoding;
  if (override === 'utf8' || override === 'utf-8') {
    encoding = 'utf8';
  } else if (override === 'gbk' || override === 'gb18030') {
    encoding = 'gbk';
  } else if (!isTty) {
    encoding = 'utf8';
  } else {
    // 控制台代码页最准;读不到才退到系统 ANSI 代码页。
    const effective = codePage ?? ansiCodePage;
    encoding = effective !== null && GBK_CODE_PAGES.has(effective) ? 'gbk' : 'utf8';
  }

  if (encoding === 'gbk') {
    patchStream(process.stdout);
    patchStream(process.stderr);
  }
  return { encoding, codePage, ansiCodePage, isTty };
}
