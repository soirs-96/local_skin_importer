/**
 * 给 electron-builder 打一个补丁:NSIS 第二趟编译打不开刚生成的卸载器时,能自愈。
 *
 * **为什么需要它**
 *
 * electron-builder 打 NSIS 包要跑两趟 makensis:
 *   1. 第一趟编出一个只会「写出卸载器」的空壳安装包(189KB),
 *      然后**原生运行**这个空壳,靠它的 .onInit 里的 WriteUninstaller
 *      真正生成 `__uninstaller.exe`;
 *   2. 第二趟把 `__uninstaller.exe` 用 `File` 命令塞进真正的安装包。
 *
 * 第二趟会在第 1 行报错:
 *
 *   File: failed opening file "...\LOL Skin Importer-<版本>-x64.__uninstaller.exe"
 *   Error in macro installApplicationFiles on macroline 91
 *
 * 文件本身是好的(存在、171KB、PE 头正常、单独拿 NSIS 嵌一次也成功),
 * 失败的是**读的时机**:
 *
 * - 卸载器是刚写出来的新 exe,杀毒软件的按访问扫描会盯着它;
 * - NSIS 打开源文件用的是 GENERIC_READ + FILE_SHARE_READ(只读独占),
 *   扫描进程一旦独占它,NSIS 就 sharing violation;
 * - 第二趟要先拷完 100MB 的 7z 包才撞上那行 `File`,中间隔了好几秒,
 *   足够杀软完成接管。
 *
 * electron-builder 自己知道这个坑 —— 它对**安装包 exe** 就用了
 * `ensureNotBusy` 等文件释放(注释里直接写着 "caused by virus scanners"),
 * 但**漏了卸载器**。这个补丁把同样的处理补到卸载器上,分三步:
 *
 *   1. **自己完整读一遍卸载器**。按访问扫描是「读的时候才扫」,
 *      先自己读一遍,杀软当场扫完并缓存结论,NSIS 再读就是命中缓存。
 *   2. **等它稳定空闲**。连续 stableMs 都能以读写方式打开才算数,
 *      期间任何一次被抢占都重新计时。只探一次是不够的 ——
 *      写出来的那一瞬间还没人抢,真正被抢是稍后的事。
 *   3. **第二趟失败就重试**。前两步万一没赶上(比如杀软换了策略),
 *      退到重试:等 5 秒再来一次,最多 5 次。
 *
 * 幂等:打过一次就不会再打。electron-builder 升级导致锚点对不上时,
 * 安静跳过,不影响构建。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(
  projectRoot,
  'node_modules',
  'app-builder-lib',
  'out',
  'targets',
  'nsis',
  'NsisTarget.js'
);

const ANCHOR_CLASS = 'class NsisTarget extends core_1.Target {';
const ANCHOR_CALL = '        await packager.signIf(uninstallerPath);';
const INJECTED_CALL = '        await __lsiWaitFileStable(uninstallerPath, 60000, 3000);';
const PASS2_ANCHOR =
  '            await this.executeMakensis(defines, commands, sharedHeader + (await this.computeFinalScript(rawScript, true, archs)), { skipSizeVerification: isPortable || isCustomScript });';
const PASS2_INJECTED =
  '            await __lsiExecuteMakensisWithRetry(this, defines, commands, sharedHeader + (await this.computeFinalScript(rawScript, true, archs)), { skipSizeVerification: isPortable || isCustomScript }, defines.UNINSTALLER_OUT_FILE);';

/** 补丁标记:文件里已经有它就说明打过补丁了。 */
const MARKER = '__lsiWaitFileStable';

/**
 * 注入到 electron-builder 文件里的辅助函数。
 * 缩进用 4 空格,跟编译产物保持一致。
 */
const HELPER = [
  '// ---- local_skin_importer 补丁:NSIS 卸载器文件被杀毒软件独占 ----',
  'async function __lsiTryOpen(file) {',
  '    return new Promise((resolve) => {',
  '        fs.open(file, "r+", (error, fd) => {',
  '            if (error) {',
  '                resolve(false);',
  '                return;',
  '            }',
  '            fs.close(fd, () => resolve(true));',
  '        });',
  '    });',
  '}',
  'async function __lsiWaitFileStable(file, timeoutMs, stableMs) {',
  '    const deadline = Date.now() + timeoutMs;',
  '    let freeSince = 0;',
  '    let scanned = false;',
  '    for (;;) {',
  '        if (!scanned) {',
  '            // 自己完整读一遍,逼杀软当场扫描并缓存结论。',
  '            scanned = await new Promise((resolve) => {',
  '                fs.readFile(file, (error) => resolve(!error));',
  '            });',
  '            if (!scanned) {',
  '                if (Date.now() >= deadline) {',
  '                    console.warn("[patch] 卸载器文件读不出来,交给 NSIS 自己报错");',
  '                    return false;',
  '                }',
  '                await new Promise((resolve) => setTimeout(resolve, 500));',
  '                continue;',
  '            }',
  '        }',
  '        const free = await __lsiTryOpen(file);',
  '        if (free) {',
  '            if (freeSince === 0)',
  '                freeSince = Date.now();',
  '            if (Date.now() - freeSince >= stableMs)',
  '                return true;',
  '        }',
  '        else {',
  '            freeSince = 0;',
  '        }',
  '        if (Date.now() >= deadline) {',
  '            console.warn("[patch] 卸载器文件仍被占用,交给 NSIS 自己报错");',
  '            return false;',
  '        }',
  '        await new Promise((resolve) => setTimeout(resolve, 500));',
  '    }',
  '}',
  'async function __lsiExecuteMakensisWithRetry(target, defines, commands, script, opts, uninstallerPath) {',
  '    const maxAttempts = 5;',
  '    for (let attempt = 1; ; attempt++) {',
  '        try {',
  '            await target.executeMakensis(defines, commands, script, opts);',
  '            return;',
  '        }',
  '        catch (error) {',
  '            const message = error && error.message ? String(error.message) : String(error);',
  '            const hitUninstaller = uninstallerPath != null',
  '                && message.includes("failed opening file")',
  '                && message.includes(path.win32.basename(uninstallerPath));',
  '            if (!hitUninstaller || attempt >= maxAttempts)',
  '                throw error;',
  '            console.warn(`[patch] NSIS 打不开卸载器(第 ${attempt} 次),等杀软放行后重试`);',
  '            await __lsiWaitFileStable(uninstallerPath, 60000, 3000);',
  '            await new Promise((resolve) => setTimeout(resolve, 5000));',
  '        }',
  '    }',
  '}',
  ''
].join('\n');

function main() {
  if (!fs.existsSync(target)) {
    console.log('[patch] 找不到 ' + target + ' —— 跳过');
    return;
  }

  let src = fs.readFileSync(target, 'utf8');

  if (src.includes(MARKER)) {
    console.log('[patch] 已经打过补丁了,跳过');
    return;
  }

  // 清掉可能存在的旧版本补丁,避免叠加
  src = src.replace(
    /\/\/ ---- local_skin_importer 补丁[\s\S]*?(?=class NsisTarget extends core_1\.Target \{)/,
    ''
  );
  src = src
    .split('\n')
    .filter((line) => !line.includes('__lsiWaitFileReleased'))
    .join('\n');

  if (!src.includes(ANCHOR_CALL) || !src.includes(ANCHOR_CLASS) || !src.includes(PASS2_ANCHOR)) {
    console.log('[patch] 锚点对不上(electron-builder 升级了?)—— 跳过');
    return;
  }

  src = src.replace(ANCHOR_CALL, ANCHOR_CALL + '\n' + INJECTED_CALL);
  src = src.replace(PASS2_ANCHOR, PASS2_INJECTED);
  src = src.replace(ANCHOR_CLASS, HELPER + ANCHOR_CLASS);

  fs.writeFileSync(target, src, 'utf8');
  console.log('[patch] 已给 electron-builder 打上「NSIS 卸载器被杀软锁」的补丁');
}

try {
  main();
} catch (e) {
  // 补丁失败不能挡住 npm install
  console.log('[patch] 跳过:' + (e instanceof Error ? e.message : String(e)));
}
