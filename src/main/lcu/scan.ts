/**
 * 磁盘扫描:在盘符根上找 lockfile。
 *
 * 只在「其它通道都没命中」且用户主动要深度检测时才跑。所以它可以慢一点,
 * 但必须有硬上限 —— 时间预算 + 深度上限 + 目录名白名单,三重剪枝。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLockfileText } from './parse';

/** 目录名命中这些 → 检查它下面有没有 lockfile。 */
export const TARGET_DIR_NAMES: ReadonlySet<string> = new Set([
  '英雄联盟',
  'LeagueClient',
  'League of Legends',
  'WeGameApps',
  'wegameapps',
  'rail_apps'
]);

/** 目录名命中这些 → 往下走一层(但只找白名单里的目录名)。 */
export const CONTAINER_DIR_NAMES: ReadonlySet<string> = new Set([
  'Program Files',
  'Program Files (x86)',
  'Users',
  'ProgramData',
  'games',
  'Games',
  'app',
  'soft',
  '腾讯游戏',
  'Riot Games'
]);

/** 单个盘最多扫多久。 */
export const PER_DRIVE_BUDGET_MS = 15_000;

/** 所有盘加起来最多扫多久。 */
export const TOTAL_BUDGET_MS = 20_000;

/**
 * 白名单那一趟的预算。
 *
 * 它只 readdir 白名单里的目录,天生就快 —— 预算给小了也不会误伤。
 */
export const FAST_SCAN_BUDGET_MS = 5_000;

/**
 * 宽松那一趟的预算。
 *
 * 加上白名单那一趟,总耗时仍然卡在 20 秒上下。
 */
export const PERMISSIVE_SCAN_BUDGET_MS = 15_000;

/** 最多往下走几层。国服 WeGame 的 `wegameapps\英雄联盟\LeagueClient` 是 3 层。 */
export const MAX_DEPTH = 6;

/**
 * 宽松扫描时跳过的目录 —— 系统目录和工具目录,不可能装游戏客户端。
 *
 * 白名单那一趟靠「目录名认得」来剪枝,宽松那趟没有这层保护,
 * 只能靠排除法。这几个是最大的噪声源,跳掉它们能把耗时压下来一大截。
 *
 * `appdata` 在列:它是整棵树上最吵的子树(每个用户目录下都有一份)。
 * 跳掉它不损失什么 —— 国际服客户端装在 `%LOCALAPPDATA%\Riot Games\` 下,
 * 那个位置在 4 层深度之外,宽松扫描本来也走不到;而 `staticLockfilePaths`
 * 会直接按环境变量把它列进候选,不需要靠扫盘找。
 */
export const NOISE_DIR_NAMES: ReadonlySet<string> = new Set([
  '$recycle.bin',
  'system volume information',
  'recovery',
  '$winreagent',
  '$sysreset',
  'windows',
  'perflogs',
  'node_modules',
  '.git',
  '.svn',
  'intel',
  'nvidia',
  'amd',
  'appdata'
]);

/**
 * 宽松扫描最多往下走几层。
 *
 * `D:\game\LOL\英雄联盟` 是第三层,`D:\game\LOL\英雄联盟\LeagueClient` 是第四层 ——
 * 4 层够用,再深就慢得没意义了。
 */
export const PERMISSIVE_MAX_DEPTH = 4;

export interface ScanResult {
  /**
   * 找到的 **lockfile 文件路径**(不是所在目录)。
   *
   * 必须是文件路径 —— 下游 `readLockfileCandidates` 直接拿它去 readFile,
   * 而路径缓存里存的也必须是文件路径,否则下一次检测读的是目录,必然读不到。
   */
  paths: string[];
  /** 预算耗尽时为 true —— 此时结果不完整,不能断言「没装」。 */
  timedOut: boolean;
}

/** 列出存在的盘符根。 */
export function listDriveRoots(): string[] {
  const roots: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = letter + ':\\';
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // 权限不足 / 盘不存在 —— 跳过,不影响其它盘
    }
  }
  return roots;
}

/** 这个目录下有没有一份**内容合法**的 lockfile。 */
async function hasValidLockfile(dir: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(path.join(dir, 'lockfile'), 'utf8');
    return parseLockfileText(raw) !== null;
  } catch {
    return false;
  }
}

/**
 * 扫盘找 lockfile。
 *
 * 剪枝规则:
 *   1. 目录名不在白名单里 → 不进(也不查它下面)
 *   2. 深度超过 MAX_DEPTH → 不进
 *   3. 超过 budgetMs → 停,并把 timedOut 置 true
 *
 * **全程走异步 fs** —— 同步扫盘会把 Electron 主进程卡住最长 20 秒,
 * 窗口直接「未响应」,用户只能看着它转圈。
 */
export async function scanForLockfiles(
  roots: string[],
  budgetMs = TOTAL_BUDGET_MS
): Promise<ScanResult> {
  const started = Date.now();
  const paths: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [];

  for (const root of roots) queue.push({ dir: root, depth: 0 });

  while (queue.length > 0) {
    // 用 >= 而不是 >:budgetMs = 0 时必须立刻超时,否则「预算耗尽」那条测试
    // 会因为「同一毫秒内 elapsed === 0」而随机地不超时。
    if (Date.now() - started >= budgetMs) {
      return { paths, timedOut: true };
    }

    const { dir, depth } = queue.shift() as { dir: string; depth: number };

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // 没有权限 / 不是目录 / 已被删除 —— 跳过
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const isTarget = TARGET_DIR_NAMES.has(name);
      const isContainer = CONTAINER_DIR_NAMES.has(name);
      if (!isTarget && !isContainer) continue;

      const full = path.join(dir, name);
      const childDepth = depth + 1;

      // 深度上限对「检查目标目录」和「继续下钻」一视同仁 ——
      // 只挡下钻、不挡检查的话,一个 7 层深的英雄联盟目录照样会被读到,
      // 深度上限形同虚设。
      if (childDepth > MAX_DEPTH) continue;

      if (isTarget && (await hasValidLockfile(full))) {
        // 存 **lockfile 文件路径**,不是目录 —— 下游要直接拿它去读文件。
        paths.push(path.join(full, 'lockfile'));
      }

      // 目标目录也要往下走:国服的 lockfile 在 `英雄联盟\LeagueClient` 里。
      queue.push({ dir: full, depth: childDepth });
    }
  }

  return { paths, timedOut: false };
}

/**
 * 宽松扫盘:不看目录名,见到 `lockfile` 就验一下内容。
 *
 * 白名单那一趟只认「目录名像游戏安装目录」,所以 `D:\game\LOL\英雄联盟`
 * 这种路径会被整个挡掉 —— 中间的 `game`、`LOL` 两个名字它都不认,
 * 连 `英雄联盟` 都走不到。用户就是这么装游戏的,我们拦不住。
 *
 * 代价是慢:没有白名单剪枝,得 readdir 大量目录。所以它只在白名单那趟
 * **空手而归**时才跑,而且有独立的预算。
 *
 * 找到的路径同样写进路径缓存(C4),下一次浅检测就不用再扫了。
 */
export async function scanForLockfilesPermissive(
  roots: string[],
  budgetMs = PERMISSIVE_SCAN_BUDGET_MS
): Promise<ScanResult> {
  const started = Date.now();
  const paths: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [];

  for (const root of roots) queue.push({ dir: root, depth: 0 });

  while (queue.length > 0) {
    if (Date.now() - started >= budgetMs) {
      return { paths, timedOut: true };
    }

    const { dir, depth } = queue.shift() as { dir: string; depth: number };

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // 没有权限 / 不是目录 / 已被删除 —— 跳过
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth + 1 > PERMISSIVE_MAX_DEPTH) continue;
        if (NOISE_DIR_NAMES.has(entry.name.toLowerCase())) continue;
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }

      // 只认文件名就叫 lockfile 的普通文件,内容还得合法。
      if (entry.name.toLowerCase() !== 'lockfile') continue;
      if (!(await hasValidLockfile(dir))) continue;
      paths.push(full);
    }
  }

  return { paths, timedOut: false };
}
