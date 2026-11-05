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

/** 最多往下走几层。国服 WeGame 的 `wegameapps\英雄联盟\LeagueClient` 是 3 层。 */
export const MAX_DEPTH = 6;

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
