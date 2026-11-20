#!/usr/bin/env node
/**
 * 游戏本体(不是客户端)的日志里，能不能捞到「本局用了哪款皮肤」。
 *
 * 背景：LCU 的 gameflow 只给 `lastSelectedSkinIndex`(皮肤序号)，腾讯 ledge 的
 * 对局明细里一个 skin 字段都没有。游戏本体加载资源时会把皮肤写进日志，
 * 这是第三条路 —— 而且不需要在对局进行中，打完就能查。
 *
 * 用法：
 *   node scripts\probe-game-log.mjs
 *   node scripts\probe-game-log.mjs E:\wegameapps\英雄联盟
 *
 * 找不到游戏目录时会自己扫几个常见位置。日志可能几十 MB，只读尾部。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = path.join(HERE, 'lcu-dump');

/** 只看日志尾部 —— r3dlog.txt 能到几十 MB，全读会卡住。 */
const TAIL_BYTES = 4 * 1024 * 1024;
/** 每个文件最多打印多少条命中行 */
const MAX_HITS = 40;

const CANDIDATE_ROOTS = [
  'E:\\wegameapps\\英雄联盟',
  'D:\\wegameapps\\英雄联盟',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends',
  'C:\\Riot Games\\League of Legends'
];

/** 递归找日志目录，最多下几层 */
function findLogsDirs(root, depth) {
  const out = [];
  if (depth < 0) return out;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    const lower = e.name.toLowerCase();
    if (lower === 'logs') {
      // 国服是 Game\Logs\GameLogs\ —— Logs 里面还套一层，得再钻一次
      out.push(full);
      out.push(...findLogsDirs(full, depth - 1));
      continue;
    }
    if (lower === 'gamelogs') {
      out.push(full);
      continue;
    }
    // 只往 Game 这类目录里钻，别满盘扫
    if (lower === 'game' || lower === 'league of legends' || lower === 'lol') {
      out.push(...findLogsDirs(full, depth - 1));
    }
  }
  return out;
}

/** 二进制/资源文件扫了也没意义，直接排除 */
const SKIP_EXT = new Set([
  '.exe', '.dll', '.pak', '.bin', '.dat', '.idx', '.db', '.jpg', '.jpeg',
  '.png', '.gif', '.bmp', '.tga', '.dds', '.mp3', '.mp4', '.avi', '.wav',
  '.torrent', '.sbom', '.log.gz', '.nupkg', '.manifest'
]);

/** 递归列出目录下的所有文件 */
function listFiles(dir, depth, out) {
  if (depth < 0) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listFiles(full, depth - 1, out);
      continue;
    }
    if (!e.isFile()) continue;
    try {
      const st = fs.statSync(full);
      out.push({ path: full, name: e.name, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* 读不到就跳过 */
    }
  }
  return out;
}

/** 收集候选日志文件，按修改时间倒序 */
function collectLogFiles(dirs) {
  const all = [];
  for (const dir of dirs) listFiles(dir, 3, all);
  all.sort((a, b) => b.mtime - a.mtime);
  return all;
}

/** 读文件尾部 */
function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fd.statSync().size;
    // 皮肤信息写在开局时(资源加载)，不一定在尾部 —— 64MB 以内整读，再大只读尾部
    const length = size <= 64 * 1024 * 1024 ? size : TAIL_BYTES;
    const buf = Buffer.alloc(length);
    fd.read(buf, 0, length, size - length);
    return buf.toString('utf8');
  } finally {
    fd.close();
  }
}

/** 皮肤/英雄相关的行 */
const PATTERNS = [
  { tag: 'SKIN', re: /skin/i },
  { tag: 'CHAMP', re: /champion/i }
];

function scan(text) {
  const hits = { SKIN: [], CHAMP: [] };
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    for (const p of PATTERNS) {
      if (p.re.test(line) && hits[p.tag].length < MAX_HITS) {
        hits[p.tag].push(line.trim());
      }
    }
  }
  return hits;
}

function resolveRoot(arg) {
  if (arg && fs.existsSync(arg)) return arg;
  for (const c of CANDIDATE_ROOTS) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function main() {
  const arg = process.argv[2];
  const root = resolveRoot(arg);
  if (!root) {
    console.log('could not find the game install dir; pass it as an argument');
    console.log('tried:');
    for (const c of CANDIDATE_ROOTS) console.log('  ' + c);
    return;
  }
  console.log('game root: ' + root);

  const dirs = findLogsDirs(root, 4);
  console.log('log dirs: ' + (dirs.length ? dirs.join(', ') : '(none)'));
  if (dirs.length === 0) return;

  const all = collectLogFiles(dirs);
  console.log(`\nfound ${all.length} files under log dirs; newest 40:`);
  for (const f of all.slice(0, 40)) {
    console.log(
      `  ${new Date(f.mtime).toISOString()}  ${String(f.size).padStart(10)}  ${f.path}`
    );
  }
  if (all.length === 0) {
    console.log('\nno files found at all under those dirs');
    return;
  }

  // 只扫看起来像文本的：排除二进制扩展名，且体积别太大
  const scannable = all.filter((f) => {
    if (f.size === 0) return false;
    const ext = path.extname(f.name).toLowerCase();
    if (SKIP_EXT.has(ext)) return false;
    return f.size < 256 * 1024 * 1024;
  });
  const files = scannable.slice(0, 6);
  console.log(`\nscanning ${files.length} text-like files`);
  if (files.length === 0) {
    console.log('nothing text-like to scan');
    return;
  }

  const report = [];
  for (const f of files) {
    const when = new Date(f.mtime).toISOString();
    console.log(
      `\n===== ${f.path}\n  size=${f.size} mtime=${when}\n`
    );
    let text = '';
    try {
      text = readTail(f.path);
    } catch (e) {
      console.log('  read failed: ' + (e && e.message ? e.message : String(e)));
      continue;
    }
    const hits = scan(text);
    console.log(`  skin lines: ${hits.SKIN.length}, champion lines: ${hits.CHAMP.length}`);
    for (const tag of ['SKIN', 'CHAMP']) {
      if (hits[tag].length === 0) continue;
      console.log(`  --- ${tag} ---`);
      for (const line of hits[tag]) console.log('    ' + line.slice(0, 300));
    }
    report.push({ file: f.path, size: f.size, mtime: when, skin: hits.SKIN, champion: hits.CHAMP });
  }

  try {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const target = path.join(DUMP_DIR, 'game-log-hits.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nwrote ${target}`);
  } catch (e) {
    console.log('could not write dump: ' + (e && e.message ? e.message : String(e)));
  }
}

main();
