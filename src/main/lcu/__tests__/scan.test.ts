import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanForLockfiles, scanForLockfilesPermissive } from '../scan';

const VALID_LOCKFILE = 'LeagueClientUx:12345:9999:secret-token:https';

function makeTree(root: string, relDir: string, withLockfile: boolean): string {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  if (withLockfile) {
    fs.writeFileSync(path.join(dir, 'lockfile'), VALID_LOCKFILE, 'utf8');
  }
  return dir;
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-scan-'));
}

describe('scanForLockfiles', () => {
  it('在目标目录里找到合法的 lockfile', async () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', true);
    const result = await scanForLockfiles([root]);
    expect(result.timedOut).toBe(false);
    expect(result.paths.length).toBe(1);
    // 返回的是 lockfile **文件**路径,不是目录 —— 下游要直接拿它去读文件。
    expect(result.paths[0]).toBe(path.join(root, '英雄联盟', 'lockfile'));
  });

  it('目标目录里没有 lockfile 时不算命中', async () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', false);
    const result = await scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('lockfile 内容不合法(段数不对)不算命中', async () => {
    const root = tmpRoot();
    const dir = makeTree(root, '英雄联盟', false);
    fs.writeFileSync(path.join(dir, 'lockfile'), 'garbage', 'utf8');
    const result = await scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('白名单外的目录不进', async () => {
    const root = tmpRoot();
    makeTree(root, path.join('随便什么目录', '英雄联盟'), true);
    const result = await scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('容器目录会往下走', async () => {
    const root = tmpRoot();
    makeTree(root, path.join('Program Files', 'Riot Games', 'League of Legends'), true);
    const result = await scanForLockfiles([root]);
    expect(result.paths.length).toBe(1);
  });

  it('容器目录下的白名单目录也能命中', async () => {
    const root = tmpRoot();
    makeTree(root, path.join('Program Files', 'Riot Games', 'LeagueClient'), true);
    const result = await scanForLockfiles([root]);
    expect(result.paths.length).toBe(1);
  });

  it('深度超限就不再往下找', async () => {
    const root = tmpRoot();
    // 每一层都得是白名单里的目录名,否则是「名字不认识」被挡掉,
    // 那样就测不到深度上限了。目标目录在第 7 层,超过 MAX_DEPTH = 6。
    const deep = path.join(
      'Program Files',
      'games',
      'app',
      'soft',
      '腾讯游戏',
      'Riot Games',
      '英雄联盟'
    );
    makeTree(root, deep, true);
    const result = await scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('预算耗尽时标记 timedOut', async () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', true);
    const result = await scanForLockfiles([root], 0);
    expect(result.timedOut).toBe(true);
  });

  it('根目录不存在时不炸', async () => {
    const result = await scanForLockfiles([path.join(tmpRoot(), '不存在的目录')]);
    expect(result.paths).toEqual([]);
    expect(result.timedOut).toBe(false);
  });
});

describe('scanForLockfilesPermissive', () => {
  it('白名单外的路径也能找到 —— 用户就是这么装游戏的', async () => {
    const root = tmpRoot();
    // D:\game\LOL\英雄联盟 —— 中间的 game / LOL 两个目录名白名单都不认。
    makeTree(root, path.join('game', 'LOL', '英雄联盟'), true);
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([path.join(root, 'game', 'LOL', '英雄联盟', 'lockfile')]);
  });

  it('目录名叫什么都能找到 —— lockfile 在哪就在哪', async () => {
    const root = tmpRoot();
    makeTree(root, path.join('whatever', 'stuff'), true);
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([path.join(root, 'whatever', 'stuff', 'lockfile')]);
  });

  it('内容不合法的 lockfile 不算命中', async () => {
    const root = tmpRoot();
    const dir = makeTree(root, '随便', false);
    fs.writeFileSync(path.join(dir, 'lockfile'), 'garbage', 'utf8');
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([]);
  });

  it('系统目录不进 —— 不然根本扫不完', async () => {
    const root = tmpRoot();
    makeTree(root, path.join('Windows', 'System32', '英雄联盟'), true);
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([]);
  });

  it('深度超限就不再往下找', async () => {
    const root = tmpRoot();
    const deep = path.join('a', 'b', 'c', 'd', 'e', '英雄联盟');
    makeTree(root, deep, true);
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([]);
  });

  it('appdata 子树不进 —— 它是整棵树上最吵的子树', async () => {
    // 不跳它的话,每个用户目录下的 AppData 都能塞满几千个目录,
    // 预算会在走到 D 盘之前就烧光 —— 而用户的客户端就在 D 盘。
    const root = tmpRoot();
    makeTree(root, path.join('Users', 'Bob', 'AppData', 'Local', 'Riot Games'), true);
    const result = await scanForLockfilesPermissive([root]);
    expect(result.paths).toEqual([]);
  });
});
