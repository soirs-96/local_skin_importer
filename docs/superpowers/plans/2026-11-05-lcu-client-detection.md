# LCU 客户端检测（候选池 + 实测裁决）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「读取已拥有皮肤」这条核心链路的客户端检测改成**候选池 + 实测裁决** —— 只认国服 WeGame 客户端，但能覆盖非默认盘、非 ASCII 安装路径、客户端刚启动、端口失效、代理软件等绝大多数设备状况，且失败时给出一句能照着做的中文结论。

**Architecture:** 发现层（C1 进程命令行 / C2 lockfile 候选集 / C3 磁盘扫描 / C4 路径缓存 / C5 内存凭据缓存）**只吐候选、不做裁决**；裁决层（`credentials.ts`）按固定优先级把候选去重 → TCP 探活 → `GET /lol-summoner/v1/current-summoner` 实测，第一个真正答得上的胜出，全挂则按固定顺序分类成 `client-not-running` / `client-starting` / `stale-credentials` / `not-cn-client` / `not-a-lcu` / `scan-timeout` / `unknown`。连接层（`client.ts`）按 `protocol` + `host` 选 http/https 并关掉 axios 的代理继承。旧 API（`resolveLcuAuth` / `resolveLcuAuthAsync` / `createLcuClient` / `LcuNotRunningError` / `LcuUnreachableError`）全部保留成兼容包装，既有调用点（`ipc.ts` / `match/poller.ts` / `match/iconAssets.ts`）控制流不动。

**Tech Stack:** Electron 39 + electron-vite 3 + Vue 3.5 + TypeScript 5.9 + axios 1.7 + vitest 3.2（node 环境）。只出 win x64，纯 Node + PowerShell，不引原生依赖。

**Spec:** `docs/superpowers/specs/2026-11-05-lcu-client-detection-design.md`

---

## 执行须知

- **仓库**：`D:\Code\Front_Project\all\local_skin_importer`，分支 `feature/origin_add`。
- **提交约定**：用户有「不要替我 commit」的既定偏好。每个任务末尾的 **Step: 提交** 只列出精确命令，**执行者（尤其是子代理）不要自动运行**，把改动留在工作区交给用户自己提交。
- **当前工作区已有未提交改动**（本次任务之前做的）：`src/main/lcu.ts`、`src/main/__tests__/lcu.test.ts`、`docs/superpowers/specs/2026-11-05-lcu-client-detection-design.md`。本计划会**整体重写** `src/main/lcu.ts` 和 `src/main/__tests__/lcu.test.ts` —— 这是预期的，不是误删。
- **本机没有装英雄联盟客户端**，所以「真机跑通」这一步没法在本机验证。Task 10 给了手工验收清单，需要用户在自己装了国服客户端的机器上跑。
- **Bash 安全分类器可能挡路**：如果 `npx vitest run` / `npm run typecheck` 被拒绝执行，把命令原样交给用户跑，不要试图绕过。
- **vitest 的 include 是 `src/**/__tests__/**/*.test.ts`**，所以新建的 `src/main/lcu/__tests__/*.test.ts` 会被自动收集，不用改 `vitest.config.ts`。
- **写文件时的坑**：某些编辑工具会吞掉反斜杠转义。**代码里表示 ASCII 单元分隔符的地方一律用 `String.fromCharCode(31)`**，不要写 `'\u001f'` 字面量。同理，测试里构造 lockfile 内容时用模板字符串而不是拼转义。

---

## 与 spec 的差异（有意为之）

1. **「200 + 结构符合预期」放宽成「响应体是 JSON 对象」。**
   LCU 在「没登录召唤师」时对 `/lol-summoner/v1/current-summoner` 返回 `200 {}`。按 spec 原文的严格结构校验，这属于「结构不符」→ 会被判成 `not-a-lcu`，但它其实是**完全有效的凭据**（只是没登录游戏账号）。放宽后 `{}` 也算成功，同时 `404` / `200` 但不是对象 仍然判 `not-a-lcu`。
2. **`lcu:check-status` 用可选 `deep` 参数，而不是新增一个 IPC channel。**
   spec 说 Sync.vue 的按钮走 `detectLcuDeep()`。但 `Sync.vue` 的 `onMounted` 也会调 `onCheckLcu()` —— 如果 `onCheckLcu` 永远是 deep 的，一开界面就全盘扫描，太重。改成：`lcu:check-status` 接受可选布尔参数，用户手点传 `true` 走深度检测，挂载时的自动检查走浅检测。IPC channel 总数保持 17 个不变。
3. **裁决层带可注入的 `LcuDetectionDeps`。**
   裁决逻辑（去重、探活顺序、失败分类）是这个功能的全部价值所在，必须能脱离真实的 PowerShell / 磁盘 / 网络单测。`detectLcu(deps?)` 的 `deps` 参数就是这个注入点，默认走真实实现。
4. **进程查询全面改用异步 `spawn`，不再用 `execSync`。**
   现有 `resolveLcuAuth()` 走 `execSync` 查进程命令行，会把 Electron 主进程**卡住最多 10 秒**（`src/main/lcu.ts:249`）。而 `lcu:check-status` 在界面挂载时就会被调 —— 挂载即卡 10 秒。改成 `spawn` 之后 `resolveLcuAuth` / `resolveLcuAuthAsync` 都变成纯异步包装，调用点控制流不动。
5. **`unknown` 在正常判定顺序下不可达，只在内部异常时出现。**
   spec §6.2 的 1~7 条判定覆盖了所有正常情况；`unknown` 只作为「裁决层内部抛异常」的兜底分类存在。测试里不会主动构造它，但类型里保留。
6. **顺手把 `iconAssets.ts` / `liveClient.ts` 里同类的代理坑一起填了（spec 没提）。**
   spec 只管「检测」这一条链路。但 `iconAssets.ts` 和 `liveClient.ts` 里还有三处裸 `axios.get` 打本机回环，同样会被 `HTTPS_PROXY` / `ALL_PROXY` 截走 —— 装代理软件的机器上「检测成功但图标全空 / 对局数据读不到」。既然这次已经把 `createLcuClient` 的签名改了，把这两处一并改成走同一个实例是顺手的，不额外增加风险。
   另外 `iconAssets.ts` 的 `lcuGetJson` 拿相对路径去 `axios.get`、那个调用又没有 `baseURL`，axios 在 Node 端会直接抛 `Invalid URL` —— 图标元数据**从来没加载成功过**。这次一并修掉。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/main/lcu/types.ts` | **纯类型 + 失败分类词汇表**。不 import 任何东西。所有跨模块的类型和 `FAILURE_SUMMARIES` 文案都在这儿。 |
| `src/main/lcu/parse.ts` | **纯解析层**。lockfile 文本 → 凭据、命令行 → 凭据、PowerShell 输出 → 进程列表。只做字符串处理，不碰文件系统、不碰网络。 |
| `src/main/lcu/client.ts` | **连接层**。`createLcuClient`（含 `proxy: false`）、端口探活、候选实测（`probeCandidate`）、以及搬过来的 `getCurrentSummoner` / `getInventoryOwnedSkinIds` / `getStoreOwnedSkinIds`。 |
| `src/main/lcu/scan.ts` | **磁盘扫描**。在盘符根上做带剪枝的 BFS，找 `lockfile`。 |
| `src/main/lcu/channels.ts` | **发现通道**。C1 进程查询、C2 lockfile 读、C3 扫描、C4 路径缓存、C5 内存凭据缓存，外加 `readEnvironment`。 |
| `src/main/lcu/credentials.ts` | **裁决层**。候选池 → 去重 → 探活 → 分类；`detectLcu` / `detectLcuDeep`；旧 API 的兼容包装与共享凭据缓存。 |
| `src/main/lcu.ts` | **barrel**。保留成 `export * from './lcu/xxx'` 的转发文件，不删（`ipc.ts` / `poller.ts` / `iconAssets.ts` / `owned.ts` 都 `import ... from './lcu'`）。 |
| `src/main/lcu/__tests__/*.test.ts` | 各层的单测。 |

### 模块依赖方向（只能从上往下）

```
types.ts      ← 无 import
   ↑
parse.ts      ← 只依赖 types
   ↑
client.ts     ← 依赖 types
   ↑
scan.ts       ← 依赖 parse
   ↑
channels.ts   ← 依赖 types / parse / scan
   ↑
credentials.ts← 依赖 types / parse / client / channels
   ↑
lcu.ts (barrel) ← 转发以上全部
```

**硬约束**：任何一个模块都**不能**反向 import 下面的模块。特别注意 `types.ts` 必须是零依赖 —— 它定义 `LcuAuth`，如果它反过来 import `client.ts` 就会绕成环。

---

### Task 1: 类型与失败分类词汇表

**Files:**
- Create: `src/main/lcu/types.ts`
- Test: `src/main/lcu/__tests__/types.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/types.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { FAILURE_CODES, FAILURE_SUMMARIES } from '../types';
import type { LcuFailureCode } from '../types';

describe('失败分类词汇表', () => {
  it('每个分类码都有对应文案', () => {
    for (const code of FAILURE_CODES) {
      expect(FAILURE_SUMMARIES[code], `分类 ${code} 缺文案`).toBeTruthy();
    }
  });

  it('文案键集合与分类码集合一致', () => {
    expect(Object.keys(FAILURE_SUMMARIES).sort()).toEqual([...FAILURE_CODES].sort());
  });

  it('文案互不重复 —— 界面上要能一眼分清', () => {
    const texts = FAILURE_CODES.map((c) => FAILURE_SUMMARIES[c]);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('每条文案都是中文且以句号结尾', () => {
    for (const code of FAILURE_CODES) {
      const text = FAILURE_SUMMARIES[code];
      expect(text, code).toMatch(/[一-龥]/);
      expect(text, code).toMatch(/[。！？]$/);
    }
  });

  it('分类码是联合类型里声明的那七个', () => {
    const expected: LcuFailureCode[] = [
      'client-not-running',
      'client-starting',
      'stale-credentials',
      'not-cn-client',
      'not-a-lcu',
      'scan-timeout',
      'unknown'
    ];
    expect([...FAILURE_CODES].sort()).toEqual([...expected].sort());
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/types.test.ts`
Expected: FAIL —— `Failed to resolve import "../types"`（文件还不存在）。

- [ ] **Step 3: 实现 `src/main/lcu/types.ts`**

```ts
/**
 * LCU 检测用的全部类型与文案词汇表。
 *
 * 这个文件**不 import 任何东西** —— 它是依赖图的底,其它模块都往上依赖它。
 * 加 import 就会绕成环。
 */

/** 客户端归属。国服 WeGame 是我们要支持的那一个。 */
export type LcuAuthOrigin = 'cn' | 'riot';

/** LCU 的传输协议。老客户端用 http,新客户端用 https(自签证书)。 */
export type LcuProtocol = 'http' | 'https';

/** 一份能连上 LCU 的凭据。 */
export interface LcuAuth {
  port: number;
  token: string;
  protocol: LcuProtocol;
  host: string;
}

/** 候选是从哪条通道来的。 */
export type LcuCandidateSource =
  | 'process'
  | 'lockfile'
  | 'disk-scan'
  | 'cache'
  | 'memory';

/** 一条候选凭据:凭据本身 + 归属 + 来源。 */
export interface LcuCandidate extends LcuAuth {
  origin: LcuAuthOrigin;
  source: LcuCandidateSource;
}

/** 一次实测的结论。 */
export type LcuProbeOutcome =
  | 'alive'
  | 'dead'
  | 'unauthorized'
  | 'not-lcu'
  | 'not-ready';

/** 检测失败的原因分类。界面上的一句话结论由它决定。 */
export type LcuFailureCode =
  | 'client-not-running'
  | 'client-starting'
  | 'stale-credentials'
  | 'not-cn-client'
  | 'not-a-lcu'
  | 'scan-timeout'
  | 'unknown';

/** 全部失败分类码,顺序即优先级。 */
export const FAILURE_CODES: readonly LcuFailureCode[] = [
  'client-not-running',
  'client-starting',
  'stale-credentials',
  'not-cn-client',
  'not-a-lcu',
  'scan-timeout',
  'unknown'
];

/**
 * 每个失败分类对应的一句话结论。
 *
 * 写给**用户**看 —— 目标是让人照着这句话就知道下一步该干什么,
 * 而不是让人看完再去猜。也写给开发者看 —— 截图发出来就能定位问题。
 */
export const FAILURE_SUMMARIES: Record<LcuFailureCode, string> = {
  'client-not-running': '没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。',
  'client-starting': '找到了客户端但它还没准备好 —— 等 5 秒再点检测。',
  'stale-credentials': '客户端重启过、凭据失效 —— 点检测重试。',
  'not-cn-client': '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
  'not-a-lcu': '连上的不是游戏客户端接口 —— 可能是端口被别的程序占用。',
  'scan-timeout': '没在常见位置找到客户端 —— 可能装在非标准位置。',
  'unknown': '检测失败 —— 打开开发者面板看详情。'
};

/** 当前召唤师。 */
export interface CurrentSummoner {
  displayName: string;
  puuid: string;
}

/** 一条候选的实测记录,诊断面板里逐条展示。 */
export interface LcuProbeRecord {
  port: number;
  origin: LcuAuthOrigin;
  probe: LcuProbeOutcome;
  /** 通道内部的补充说明(lockfile 路径、PowerShell 报错等)。 */
  detail?: string;
}

/** 单条发现通道的执行报告。 */
export interface LcuChannelReport {
  source: LcuCandidateSource;
  /** 这条通道是否成功产出了可用凭据。 */
  ok: boolean;
  /** 是否查到活的 LeagueClientUx.exe 进程。 */
  liveProcess: boolean;
  /** 这条通道的整体说明(失败原因 / 命中路径)。 */
  detail: string;
  candidates: LcuProbeRecord[];
  /** 磁盘扫描 / lockfile 通道用得上:试过哪些路径。 */
  paths?: string[];
}

/** 检测时的环境快照,诊断面板里展示,便于判断是不是代理/环境问题。 */
export interface LcuEnvironment {
  /** 生效中的代理环境变量名(不含值 —— 值是凭据类的敏感信息,不往外带)。 */
  proxyVars: string[];
  localAppData: string | null;
  electron: string;
  node: string;
}

/** 完整的失败诊断。 */
export interface LcuDiagnosis {
  code: LcuFailureCode;
  summary: string;
  channels: LcuChannelReport[];
  environment: LcuEnvironment;
  /** 内部异常时的原始错误信息。正常失败路径下不出现。 */
  error?: string;
}

/** 检测结果。成功给凭据,失败给分类 + 一句话结论 + 明细。 */
export type LcuDetectionResult =
  | { ok: true; auth: LcuAuth; summoner: CurrentSummoner }
  | { ok: false; code: LcuFailureCode; summary: string; diagnosis: LcuDiagnosis };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/types.test.ts`
Expected: PASS，5 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/types.ts src/main/lcu/__tests__/types.test.ts
git commit -m "feat(lcu): 新增 LCU 检测类型与失败分类词汇表"
```

---

### Task 2: 纯解析层 `parse.ts`

**Files:**
- Create: `src/main/lcu/parse.ts`
- Test: `src/main/lcu/__tests__/parse.test.ts`

**这一步要解决的坑**（都在测试里钉死）：

1. 国服 WeGame 的 `LeagueClientUx.exe` 命令行上**同时**有 `--app-port` / `--remoting-auth-token`（游戏 API）和 `--riotclient-app-port` / `--riotclient-auth-token`（Riot Client API）。两者都要吐出来，国服那条排前面。
2. 安装路径可能含中文（`E:\wegameapps\英雄联盟\`）。PowerShell 输出直接走管道会被控制台编码搞坏，所以**输出改成 base64**，Node 侧解 base64 —— base64 是纯 ASCII，不受控制台代码页影响。
3. PowerShell 的 `$_.ExecutablePath` 在权限不足时是 `$null`，拼出来会以分隔符开头。解析时要容错。

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/parse.test.ts`：

```ts
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
    expect(parseCommandLineCandidates('LeagueClientUx.exe "--remoting-auth-token=tok"')).toHaveLength(0);
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
    const line = b64('E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe' + SEP + 'LeagueClientUx.exe --app-port=1');
    const out = parseProcessOutput(line);
    expect(out).toHaveLength(1);
    expect(out[0].executablePath).toBe('E:\\wegameapps\\英雄联盟\\LeagueClientUx.exe');
    expect(out[0].commandLine).toContain('--app-port=1');
  });

  it('多个进程按行解析', () => {
    const out = parseProcessOutput(
      [b64('C:\\a.exe' + SEP + 'a.exe --app-port=1'), b64('C:\\b.exe' + SEP + 'b.exe --app-port=2')].join(
        '\n'
      )
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/parse.test.ts`
Expected: FAIL —— `Failed to resolve import "../parse"`。

- [ ] **Step 3: 实现 `src/main/lcu/parse.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/parse.test.ts`
Expected: PASS，23 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/parse.ts src/main/lcu/__tests__/parse.test.ts
git commit -m "feat(lcu): 新增纯解析层(lockfile/命令行/PowerShell 输出)"
```

---

### Task 3: 连接层 `client.ts`

**Files:**
- Create: `src/main/lcu/client.ts`
- Test: `src/main/lcu/__tests__/client.test.ts`

**这一步要解决的坑**：

1. **axios 会读 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` 环境变量**。用户电脑上装了个代理软件（Clash、v2rayN、加速器）时，`https://127.0.0.1:<port>` 会被丢给代理去，请求直接失败。必须 `proxy: false`。这是现有代码最大的隐性 bug。
2. 协议不一定全是 `https` —— 老客户端的 lockfile 第 5 段写的是 `http`。
3. LCU 用的是自签证书，`rejectUnauthorized: false`。

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/client.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createLcuClient, isPortAlive } from '../client';
import type { LcuAuth } from '../types';

const AUTH: LcuAuth = {
  port: 9999,
  token: 'tok',
  protocol: 'https',
  host: '127.0.0.1'
};

describe('createLcuClient', () => {
  it('baseURL 按 protocol + host + port 组装', () => {
    const client = createLcuClient(AUTH);
    expect(client.defaults.baseURL).toBe('https://127.0.0.1:9999');
  });

  it('protocol 为 http 时用 http', () => {
    const client = createLcuClient({ ...AUTH, protocol: 'http' });
    expect(client.defaults.baseURL).toBe('http://127.0.0.1:9999');
  });

  it('host 不是回环时按给的 host 来', () => {
    const client = createLcuClient({ ...AUTH, host: '192.168.1.5' });
    expect(client.defaults.baseURL).toBe('https://192.168.1.5:9999');
  });

  it('带上 riot:token 的 Basic 认证头', () => {
    const client = createLcuClient(AUTH);
    const expected = 'Basic ' + Buffer.from('riot:tok', 'latin1').toString('base64');
    const headers = client.defaults.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe(expected);
  });

  it('关掉代理继承 —— 否则装了代理软件的机器全都连不上', () => {
    const client = createLcuClient(AUTH);
    expect(client.defaults.proxy).toBe(false);
  });

  it('自签证书不校验(仅限这个实例)', () => {
    const client = createLcuClient(AUTH);
    const agent = client.defaults.httpsAgent as { options: { rejectUnauthorized: boolean } };
    expect(agent.options.rejectUnauthorized).toBe(false);
  });
});

describe('isPortAlive', () => {
  it('没人监听的端口返回 false', async () => {
    const server = (await import('node:net')).createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(isPortAlive('127.0.0.1', port)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/client.test.ts`
Expected: FAIL —— `Failed to resolve import "../client"`。

- [ ] **Step 3: 实现 `src/main/lcu/client.ts`**

```ts
/**
 * 连接层:跟 LCU 说上话。
 *
 * 关键点是 `proxy: false` —— axios 默认会继承 HTTPS_PROXY / ALL_PROXY 之类的
 * 环境变量,用户机器上装了代理软件时,连 127.0.0.1 的请求会被丢给代理,
 * 结果就是「客户端明明开着,工具却说连不上」。
 */
import axios, { AxiosInstance } from 'axios';
import * as https from 'node:https';
import * as net from 'node:net';
import type { CurrentSummoner, LcuAuth, LcuCandidate, LcuProbeOutcome } from './types';

/** 探测用的端点。挑它是因为它最轻、且在「没登录召唤师」时也返回 200。 */
export const SUMMONER_PATH = '/lol-summoner/v1/current-summoner';

/** 实测的超时。3 秒够本地回环,也不会卡住界面太久。 */
export const PROBE_TIMEOUT_MS = 3000;

/** 库存端点。类型名要写**枚举名**放在**路径段**里 —— 传 owned/skins/all 这类
 * 小写词会返回 200 但 body 是空数组,看起来像「这个接口没数据」。
 */
export const INVENTORY_PATH = '/lol-inventory/v2/inventory/CHAMPION_SKIN';

/** 库存响应约 1.1 MB,5 秒默认超时不够,单独放宽。 */
export const INVENTORY_TIMEOUT_MS = 30_000;

/**
 * Axios instance bound to the local LCU. Certificate verification is disabled because the
 * client serves a self-signed cert on 127.0.0.1 — this is scoped to this instance only.
 */
export function createLcuClient(auth: LcuAuth): AxiosInstance {
  const credentials = Buffer.from(`riot:${auth.token}`, 'latin1').toString('base64');
  return axios.create({
    baseURL: `${auth.protocol}://${auth.host}:${auth.port}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 5000,
    // 关键:不让 axios 继承 HTTPS_PROXY / ALL_PROXY。代理软件是本机 127.0.0.1
    // 的唯一通路,把请求交给代理等于必挂。
    proxy: false
  });
}

/**
 * 端口探活:host:port 上有没有人在听。
 *
 * 死端口会立刻回 ECONNREFUSED,所以这一步几乎不花时间。
 * 只判断「有没有人在听」,不判断对端是不是 LCU。
 */
export function isPortAlive(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/** 一次实测的结果。 */
export interface LcuProbeResult {
  outcome: LcuProbeOutcome;
  /** 200 时把响应体带回来(用来取召唤师信息)。 */
  body?: unknown;
}

/** 是「普通对象」而不是数组/null。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 实测一条候选:这个端口上真的是游戏客户端接口吗?
 *
 * 判定口径:
 *   - TCP 都连不上          → dead
 *   - 200 且 body 是 JSON 对象 → alive(注意:`{}` 也算 —— 那是「客户端在但没登录召唤师」)
 *   - 200 但 body 不是对象    → not-lcu
 *   - 401 / 403              → unauthorized(端口在、但凭据过期)
 *   - 404                    → not-lcu(国际服 Riot Client API 就是这样:游戏端点 404)
 *   - 超时 / 连接错 / 5xx    → not-ready(客户端起来了但还没就绪)
 */
export async function probeCandidate(candidate: LcuCandidate): Promise<LcuProbeResult> {
  const alive = await isPortAlive(candidate.host, candidate.port);
  if (!alive) return { outcome: 'dead' };

  const client = createLcuClient(candidate);
  try {
    const response = await client.get(SUMMONER_PATH, { timeout: PROBE_TIMEOUT_MS });
    if (isPlainObject(response.data)) {
      return { outcome: 'alive', body: response.data };
    }
    return { outcome: 'not-lcu' };
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) return { outcome: 'unauthorized' };
    if (status === 404) return { outcome: 'not-lcu' };
    return { outcome: 'not-ready' };
  }
}

/** 从 LCU 响应体里抽召唤师信息。 */
export function toSummoner(data: unknown): CurrentSummoner {
  if (!isPlainObject(data)) {
    throw new Error(`Unexpected ${SUMMONER_PATH} response.`);
  }
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    puuid: typeof data.puuid === 'string' ? data.puuid : ''
  };
}

export async function getCurrentSummoner(client: AxiosInstance): Promise<CurrentSummoner> {
  const { data } = await client.get(SUMMONER_PATH);
  return toSummoner(data);
}

/**
 * 库存里的「已拥有」判定。库存条目的拥有状态是**扁平**的:
 *   owned / ownershipType / rental / quantity 都在条目顶层,没有嵌套的 ownership.owned。
 */
function isOwnedInventoryItem(item: Record<string, unknown>): boolean {
  if (item.owned === false) return false;
  if (item.rental === true) return false;
  const ownershipType =
    typeof item.ownershipType === 'string' ? item.ownershipType.toUpperCase() : '';
  if (ownershipType && ownershipType !== 'OWNED') return false;
  return true;
}

/**
 * 从 LCU 库存端点读「已拥有的英雄皮肤卡」itemId。
 *
 * 这是权威的拥有数据源:商城目录的 `owned` 标记只覆盖当前在售的商品,
 * 已下架(绝版)的皮肤在商城里看不到,只能从库存拿到。
 */
export async function getInventoryOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get(INVENTORY_PATH, { timeout: INVENTORY_TIMEOUT_MS });
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected ${INVENTORY_PATH} response.`);
  }
  const ids = new Set<number>();
  for (const item of data) {
    if (!isPlainObject(item)) continue;
    if (!isOwnedInventoryItem(item)) continue;
    const id = Number(item.itemId);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * 商城目录口径的「已拥有皮肤」(降级兜底)。
 *
 * 只认当前在售 + bundles/featured 补充的条目,所以读不到已下架皮肤,
 * 也分不出炫彩/变体以外的东西。库存端点不可用时才走这条路。
 */
export async function getStoreOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const owned = new Set<number>();

  const { data } = await client.get('/lol-store/v1/skins');
  collectOwnedSkins(data, owned);

  // Supplement: retired skins the store catalog no longer lists. A failure here
  // must not lose the catalog data, so each source is best-effort.
  for (const url of ['/lol-store/v1/bundles', '/lol-store/v1/featured']) {
    try {
      const { data: supplement } = await client.get(url, { timeout: 20000 });
      collectOwnedSkins(supplement, owned);
    } catch {
      // ignore — the catalog data collected above still stands
    }
  }

  return [...owned];
}

/** Walks an arbitrary store payload and keeps every owned CHAMPION_SKIN itemId. */
function collectOwnedSkins(node: unknown, out: Set<number>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectOwnedSkins(item, out);
    return;
  }
  if (!isPlainObject(node)) return;

  if (isOwnedSkin(node)) {
    const id = Number(node.itemId);
    if (Number.isFinite(id)) out.add(id);
  }

  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') {
      collectOwnedSkins(value, out);
    }
  }
}

function isOwnedSkin(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  if (entry.inventoryType !== 'CHAMPION_SKIN' || entry.owned !== true) return false;
  return !isChroma(entry);
}

/** 炫彩与皮肤变体:商城条目里 inventoryType 也是 CHAMPION_SKIN,靠 subInventoryType 或 tags 区分。
 *  - subInventoryType === 'RECOLOR' 是标准炫彩
 *  - tags 里带 skin_variant 的是皮肤变体(如 神龙尊者 昼日真龙 亚索),同样没有原画 */
function isChroma(entry: Record<string, unknown>): boolean {
  if (String(entry.subInventoryType ?? '').toUpperCase() === 'RECOLOR') return true;
  const tags = entry.tags;
  if (Array.isArray(tags)) {
    return tags.some((tag) => {
      const t = String(tag).toLowerCase();
      return t === 'recolor' || t.startsWith('skin_variant');
    });
  }
  return false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/client.test.ts`
Expected: PASS，7 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/client.ts src/main/lcu/__tests__/client.test.ts
git commit -m "feat(lcu): 新增连接层,关掉 axios 代理继承"
```

### Task 4: 磁盘扫描 `scan.ts`

**Files:**
- Create: `src/main/lcu/scan.ts`
- Test: `src/main/lcu/__tests__/scan.test.ts`

**这一步要解决的坑**：客户端装在非标准位置时，前面的通道全落空，只能扫盘。但扫盘不能是「把所有目录遍历一遍」—— 那会跑到天荒地老。这里靠**三重剪枝**：目录名白名单（进不去就不进）、深度上限、时间预算。

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/scan.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanForLockfiles } from '../scan';

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
  it('在目标目录里找到合法的 lockfile', () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', true);
    const result = scanForLockfiles([root]);
    expect(result.timedOut).toBe(false);
    expect(result.paths.length).toBe(1);
    // 返回的是 lockfile **文件**路径,不是目录 —— 下游要直接拿它去读文件。
    expect(result.paths[0]).toBe(path.join(root, '英雄联盟', 'lockfile'));
  });

  it('目标目录里没有 lockfile 时不算命中', () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', false);
    const result = scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('lockfile 内容不合法(段数不对)不算命中', () => {
    const root = tmpRoot();
    const dir = makeTree(root, '英雄联盟', false);
    fs.writeFileSync(path.join(dir, 'lockfile'), 'garbage', 'utf8');
    const result = scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('白名单外的目录不进', () => {
    const root = tmpRoot();
    makeTree(root, path.join('随便什么目录', '英雄联盟'), true);
    const result = scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('容器目录会往下走', () => {
    const root = tmpRoot();
    makeTree(root, path.join('Program Files', 'Riot Games', 'League of Legends'), true);
    const result = scanForLockfiles([root]);
    expect(result.paths.length).toBe(1);
  });

  it('容器目录下的白名单目录也能命中', () => {
    const root = tmpRoot();
    makeTree(root, path.join('Program Files', 'Riot Games', 'LeagueClient'), true);
    const result = scanForLockfiles([root]);
    expect(result.paths.length).toBe(1);
  });

  it('深度超限就不再往下找', () => {
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
    const result = scanForLockfiles([root]);
    expect(result.paths).toEqual([]);
  });

  it('预算耗尽时标记 timedOut', () => {
    const root = tmpRoot();
    makeTree(root, '英雄联盟', true);
    const result = scanForLockfiles([root], 0);
    expect(result.timedOut).toBe(true);
  });

  it('根目录不存在时不炸', () => {
    const result = scanForLockfiles([path.join(tmpRoot(), '不存在的目录')]);
    expect(result.paths).toEqual([]);
    expect(result.timedOut).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/scan.test.ts`
Expected: FAIL —— `Failed to resolve import "../scan"`。

- [ ] **Step 3: 实现 `src/main/lcu/scan.ts`**

```ts
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
function hasValidLockfile(dir: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(dir, 'lockfile'), 'utf8');
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
 */
export function scanForLockfiles(roots: string[], budgetMs = TOTAL_BUDGET_MS): ScanResult {
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
      entries = fs.readdirSync(dir, { withFileTypes: true });
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

      if (isTarget && hasValidLockfile(full)) {
        // 存 **lockfile 文件路径**,不是目录 —— 下游要直接拿它去读文件。
        paths.push(path.join(full, 'lockfile'));
      }

      // 目标目录也要往下走:国服的 lockfile 在 `英雄联盟\LeagueClient` 里。
      queue.push({ dir: full, depth: childDepth });
    }
  }

  return { paths, timedOut: false };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/scan.test.ts`
Expected: PASS，9 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/scan.ts src/main/lcu/__tests__/scan.test.ts
git commit -m "feat(lcu): 新增带剪枝的磁盘扫描通道"
```

---

### Task 5: 发现通道 `channels.ts`

**Files:**
- Create: `src/main/lcu/channels.ts`
- Test: `src/main/lcu/__tests__/channels.test.ts`

**这一步要解决的坑**：

1. **中文安装路径**。`E:\wegameapps\英雄联盟\` 里的中文经 PowerShell 管道出来可能被控制台代码页毁掉。解法是**输出 base64** —— base64 是纯 ASCII，不受代码页影响。Node 侧解 base64（Task 2 已实现）。
2. **`execSync` 会卡死主进程 10 秒**。改成 `spawn` + stdin 喂脚本，全程不阻塞。
3. **token 绝不落盘**。路径缓存（C4）里只存路径；凭据只进内存缓存（C5）。

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/channels.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  userDataDir: '',
  spawnImpl: null as unknown
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mocks.userDataDir;
      return process.cwd();
    }
  }
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mocks.spawnImpl(...args),
  execSync: vi.fn()
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

const SEP = String.fromCharCode(31);

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
    writeMemoryAuth({ port: 1234, token: 'secret-tok', protocol: 'https', host: '127.0.0.1' }, 'cn');
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
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/channels.test.ts`
Expected: FAIL —— `Failed to resolve import "../channels"`。

- [ ] **Step 3: 实现 `src/main/lcu/channels.ts`**

```ts
/**
 * 发现通道:只负责**吐候选**,不做裁决。
 *
 * 裁决在 credentials.ts。这里每条通道失败都不抛错 —— 失败也是一种结论
 * (「查不到进程」和「查到了但连不上」要分开报),统一收进 detail。
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import {
  executableDirOf,
  parseLockfileText,
  parseProcessOutput,
  type LcuProcessInfo
} from './parse';
import { listDriveRoots, scanForLockfiles } from './scan';
import type { LcuAuth, LcuAuthOrigin, LcuCandidate, LcuEnvironment } from './types';

/**
 * 查 LeagueClientUx.exe 的命令行。
 *
 * 输出走 base64 —— 安装路径可能是中文(`E:\wegameapps\英雄联盟\`),
 * 直接走管道会被控制台代码页毁掉。base64 是纯 ASCII,不受影响。
 */
export const PS_QUERY_SCRIPT =
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
  "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | " +
  'ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(' +
  '($_.ExecutablePath + [char]31 + $_.CommandLine))) }';

/** PowerShell 查询超时。 */
export const PS_TIMEOUT_MS = 10_000;

/** lockfile 可能正在被写,读不到就重试几次。 */
export const LOCKFILE_RETRY_COUNT = 3;

/** 重试间隔。 */
export const LOCKFILE_RETRY_DELAY_MS = 200;

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 跑一段 PowerShell 脚本并拿回 stdout。
 *
 * 用 spawn 而不是 execSync:execSync 会把 Electron 主进程卡住最多 10 秒,
 * 界面会跟着一起卡。
 */
export function runPowerShell(script: string, timeoutMs = PS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let out = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('PowerShell query timed out.')));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (e: Error) => {
      clearTimeout(timer);
      finish(() => reject(new Error('PowerShell query failed: ' + e.message)));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        finish(() =>
          reject(new Error('PowerShell exited with ' + (code ?? 'null') + ': ' + stderr.trim()))
        );
        return;
      }
      finish(() => resolve(out));
    });

    child.stdin.on('error', () => {
      // PowerShell 已经退出了,stdin 写不进去 —— close 事件会给出真正的结论
    });
    child.stdin.end(script);
  });
}

/** C1 通道的结果。 */
export interface ProcessChannelResult {
  processes: LcuProcessInfo[];
  /** 从进程推出来的 exe 目录,lockfile 就在那儿。 */
  exeDirs: string[];
  /** 有没有查到活的 LeagueClientUx.exe 进程。 */
  liveProcess: boolean;
  detail: string;
}

/** 查一次进程,拿回 exe 路径和命令行。 */
export async function queryLcuProcesses(): Promise<ProcessChannelResult> {
  let out: string;
  try {
    out = await runPowerShell(PS_QUERY_SCRIPT);
  } catch (e: unknown) {
    return {
      processes: [],
      exeDirs: [],
      liveProcess: false,
      detail: 'PowerShell 查询失败:' + describeError(e)
    };
  }

  const processes = parseProcessOutput(out);
  const exeDirs: string[] = [];
  for (const info of processes) {
    const dir = executableDirOf(info);
    if (dir && !exeDirs.includes(dir)) exeDirs.push(dir);
  }

  return {
    processes,
    exeDirs,
    liveProcess: processes.length > 0,
    detail:
      processes.length > 0
        ? '找到 ' + processes.length + ' 个 LeagueClientUx.exe 进程'
        : 'LeagueClientUx.exe 没在运行'
  };
}

/** lockfile 读出来的结果。 */
export interface LockfileReadResult {
  candidates: LcuCandidate[];
  /** 试过哪些路径 —— 诊断面板里要给用户看。 */
  tried: string[];
}

/** 国服路径的关键词。lockfile 路径能看出它是哪一服装的。 */
const CN_PATH_HINTS = ['英雄联盟', 'wegameapps', 'rail_apps'];

/** 从 lockfile 路径判断是哪一服。认不出来就按国服算(国服优先)。 */
function originOfLockfilePath(lockfilePath: string): LcuAuthOrigin {
  const lower = lockfilePath.toLowerCase();
  if (lower.includes('riot games')) return 'riot';
  for (const hint of CN_PATH_HINTS) {
    if (lower.includes(hint)) return 'cn';
  }
  return 'cn';
}

/** 读一次 lockfile,读不到就重试 —— 客户端可能正在写它。 */
async function readLockfileWithRetry(lockfilePath: string): Promise<LcuAuth | null> {
  for (let attempt = 0; attempt < LOCKFILE_RETRY_COUNT; attempt++) {
    try {
      const raw = await fs.promises.readFile(lockfilePath, 'utf8');
      // 文件在但内容不合法 —— 重试也没用(它是上一次的残留)。
      return parseLockfileText(raw);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') return null;
    }
    if (attempt < LOCKFILE_RETRY_COUNT - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCKFILE_RETRY_DELAY_MS));
    }
  }
  return null;
}

/** 依次试候选路径,把所有读出来的都吐出来。 */
export async function readLockfileCandidates(paths: string[]): Promise<LockfileReadResult> {
  const candidates: LcuCandidate[] = [];
  const tried: string[] = [];

  for (const lockfilePath of paths) {
    if (tried.includes(lockfilePath)) continue;
    tried.push(lockfilePath);
    const auth = await readLockfileWithRetry(lockfilePath);
    if (!auth) continue;
    candidates.push({
      ...auth,
      origin: originOfLockfilePath(lockfilePath),
      source: 'lockfile'
    });
  }

  return { candidates, tried };
}

/**
 * 从 exe 所在目录推 lockfile 的候选路径。
 *
 * 跟着 exe 走就不用猜安装目录 —— 国服 WeGame 装在 `E:\wegameapps\英雄联盟\`、
 * 国际服装在 `%LOCALAPPDATA%\Riot Games\`,两条都能覆盖。
 */
export function exeDerivedLockfilePaths(exeDirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of exeDirs) {
    out.push(path.join(dir, 'lockfile'));
    out.push(path.join(dir, '..', 'lockfile'));
    out.push(path.join(dir, '..', '..', 'lockfile'));
  }
  return [...new Set(out)];
}

/**
 * 常见安装位置。国服 WeGame 的路径排在最前面。
 */
export function staticLockfilePaths(
  driveRoots: string[],
  localAppData: string | null,
  programFiles: string | null
): string[] {
  const out: string[] = [];

  for (const root of driveRoots) {
    out.push(path.join(root, 'WeGameApps', 'rail_apps', '英雄联盟', 'lockfile'));
    out.push(path.join(root, 'wegameapps', '英雄联盟', 'lockfile'));
    out.push(path.join(root, 'wegameapps', '英雄联盟', 'LeagueClient', 'lockfile'));
  }

  if (localAppData) {
    out.push(path.join(localAppData, 'Riot Games', 'League of Legends', 'lockfile'));
  }
  if (programFiles) {
    out.push(path.join(programFiles, 'Riot Games', 'League of Legends', 'lockfile'));
  }

  return [...new Set(out)];
}

/** C3 通道的结果。 */
export interface ScanChannelResult {
  candidates: LcuCandidate[];
  paths: string[];
  timedOut: boolean;
  detail: string;
}

/**
 * 扫盘找 lockfile,再把读出来的凭据吐出来。
 *
 * `roots` 只在测试里传 —— 生产环境扫的是所有存在的盘符。
 * 留这个口子是因为「扫盘 → 读 lockfile」这一段必须能单测:
 * `scanForLockfiles` 吐的是 **lockfile 文件路径**,不是目录 —— 两者混用的话,
 * `readFile` 会撞上 EISDIR,扫盘通道会静悄悄地一个候选都吐不出来。
 */
export async function scanLockfileCandidates(roots = listDriveRoots()): Promise<ScanChannelResult> {
  const scan = scanForLockfiles(roots);
  const { candidates, tried } = await readLockfileCandidates(scan.paths);

  return {
    candidates,
    paths: tried,
    timedOut: scan.timedOut,
    detail: scan.timedOut
      ? '磁盘扫描超时(找到 ' + tried.length + ' 个候选)'
      : '磁盘扫描完成(找到 ' + tried.length + ' 个候选)'
  };
}

/** C4 通道:上一次找到的 lockfile 路径。 */
export interface LcuPathCache {
  lockfilePaths: string[];
  updatedAt: number;
}

/** 缓存文件名。 */
export const PATH_CACHE_FILENAME = 'lcu-paths.json';

/**
 * 读路径缓存。
 *
 * **只存路径,不存 token** —— token 是凭据,落盘等于泄露。
 */
export async function readPathCache(): Promise<string[]> {
  try {
    const file = path.join(app.getPath('userData'), PATH_CACHE_FILENAME);
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LcuPathCache>;
    if (!parsed || !Array.isArray(parsed.lockfilePaths)) return [];
    return parsed.lockfilePaths.filter((p): p is string => typeof p === 'string');
  } catch {
    // 缓存不存在或坏了 —— 当没有缓存,不报错
    return [];
  }
}

/** 写路径缓存。同样只存路径。 */
export async function writePathCache(lockfilePaths: string[]): Promise<void> {
  try {
    const file = path.join(app.getPath('userData'), PATH_CACHE_FILENAME);
    const payload: LcuPathCache = { lockfilePaths, updatedAt: Date.now() };
    await fs.promises.writeFile(file, JSON.stringify(payload), 'utf8');
  } catch {
    // 缓存写不进去不影响主流程
  }
}

/** C5 通道:进程内缓存的凭据。 */
export interface MemoryAuth {
  auth: LcuAuth;
  origin: LcuAuthOrigin;
  at: number;
}

let memoryAuth: MemoryAuth | null = null;

/** 读内存凭据缓存。 */
export function readMemoryAuth(): MemoryAuth | null {
  return memoryAuth;
}

/** 写内存凭据缓存。只在内存里,不落盘。 */
export function writeMemoryAuth(auth: LcuAuth, origin: LcuAuthOrigin): void {
  memoryAuth = { auth, origin, at: Date.now() };
}

/** 清内存凭据缓存。 */
export function clearMemoryAuth(): void {
  memoryAuth = null;
}

/**
 * 环境快照,诊断面板里展示。
 *
 * **只报代理变量的名字,不报值** —— 值里通常带账号密码。
 */
export function readEnvironment(): LcuEnvironment {
  const proxyVars = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy'
  ].filter((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.length > 0;
  });

  return {
    proxyVars,
    localAppData: process.env.LOCALAPPDATA ?? null,
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/channels.test.ts`
Expected: PASS，22 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/channels.ts src/main/lcu/__tests__/channels.test.ts
git commit -m "feat(lcu): 新增发现通道(进程/lockfile/扫描/缓存/内存)"
```

### Task 6: 裁决层 `credentials.ts`

**Files:**
- Create: `src/main/lcu/credentials.ts`
- Test: `src/main/lcu/__tests__/credentials.test.ts`

**这一步是这个功能的价值所在**。发现层只吐候选，裁决层决定「哪个是真的」以及「全挂了为什么」。

裁决顺序（spec §6.1）：

```
C5 内存凭据缓存(60 秒内)
  → C1 进程命令行(国服)
  → C2 lockfile 候选集
  → C4 路径缓存
  → C5 内存凭据缓存(超期)
  → C1 进程命令行(国际服)
  → C3 磁盘扫描(只在深度检测、且没有活进程时)
```

失败分类顺序（spec §6.2）：

```
1. 有候选拿到 401/403   → stale-credentials
2. 国际服候选实测不是 LCU → not-cn-client
3. 国服候选实测不是 LCU   → not-a-lcu
4. 有活进程              → client-starting
5. 磁盘扫描超时          → scan-timeout
6. 其它                  → client-not-running
```

- [ ] **Step 1: 写失败测试**

创建 `src/main/lcu/__tests__/credentials.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  detectLcu,
  detectLcuDeep,
  LcuNotRunningError,
  LcuUnreachableError,
  resolveLcuAuth,
  type LcuDetectionDeps
} from '../credentials';
import { FAILURE_SUMMARIES } from '../types';
import type { LcuAuth, LcuCandidate, LcuProbeOutcome } from '../types';
import type { LcuProbeResult } from '../client';

// credentials.ts → channels.ts 会 import electron 的 app。这里给个假的,
// 免得依赖真 electron 包在 node 环境下的导出形状。
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() }
}));

const AUTH: LcuAuth = { port: 1234, token: 'tok', protocol: 'https', host: '127.0.0.1' };

const CN_CMD =
  'LeagueClientUx.exe --app-port=1111 --remoting-auth-token=cnTok';
const RIOT_CMD =
  'LeagueClientUx.exe --riotclient-app-port=2222 --riotclient-auth-token=riotTok';
const BOTH_CMD =
  'LeagueClientUx.exe --app-port=1111 --remoting-auth-token=cnTok ' +
  '--riotclient-app-port=2222 --riotclient-auth-token=riotTok';

function makeDeps(overrides: Partial<LcuDetectionDeps> = {}): LcuDetectionDeps {
  const base: LcuDetectionDeps = {
    queryProcesses: vi.fn(async () => ({
      processes: [],
      exeDirs: [],
      liveProcess: false,
      detail: 'no process'
    })),
    readLockfiles: vi.fn(async () => ({ candidates: [], tried: [] })),
    readCachedPaths: vi.fn(async () => []),
    writeCachedPaths: vi.fn(async () => undefined),
    readMemoryAuth: vi.fn(() => null),
    writeMemoryAuth: vi.fn(),
    scanForClients: vi.fn(async () => ({
      candidates: [],
      paths: [],
      timedOut: false,
      detail: 'scan done'
    })),
    probe: vi.fn(async (): Promise<LcuProbeResult> => ({ outcome: 'dead' })),
    readEnvironment: vi.fn(() => ({
      proxyVars: [],
      localAppData: null,
      electron: 'test',
      node: 'test'
    }))
  };
  return { ...base, ...overrides };
}

// 候选参数在这个桩里用不到，但签名要跟 deps.probe 对得上 —— 用 _ 前缀避免 eslint 报未使用参数。
function probeBy(outcome: LcuProbeOutcome): (_c: LcuCandidate) => Promise<LcuProbeResult> {
  return async (_c: LcuCandidate) => {
    if (outcome === 'alive') {
      return { outcome: 'alive', body: { displayName: 'Tester', puuid: 'p-1' } };
    }
    return { outcome };
  };
}

describe('detectLcu', () => {
  it('有候选实测通过就返回凭据', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.auth.port).toBe(1111);
    expect(result.auth.token).toBe('cnTok');
    expect(result.summoner.displayName).toBe('Tester');
  });

  it('内存缓存命中时不查进程', async () => {
    const deps = makeDeps({
      readMemoryAuth: vi.fn(() => ({ auth: AUTH, origin: 'cn' as const, at: Date.now() })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    expect(deps.queryProcesses).not.toHaveBeenCalled();
  });

  it('内存缓存超过 60 秒就不当新鲜凭据用', async () => {
    const deps = makeDeps({
      readMemoryAuth: vi.fn(() => ({ auth: AUTH, origin: 'cn' as const, at: Date.now() - 120_000 })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(true);
    expect(deps.queryProcesses).toHaveBeenCalled();
  });

  it('国服候选优先于国际服候选', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: BOTH_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcu(deps);

    if (!result.ok) throw new Error('expected ok');
    expect(result.auth.port).toBe(1111);
  });

  it('同一个凭据只实测一次', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      readLockfiles: vi.fn(async () => ({
        candidates: [
          {
            port: 1111,
            token: 'cnTok',
            protocol: 'https' as const,
            host: '127.0.0.1',
            origin: 'cn' as const,
            source: 'lockfile' as const
          }
        ],
        tried: ['E:\\a\\lockfile']
      })),
      probe: vi.fn(probeBy('dead'))
    });

    await detectLcu(deps);

    // 进程命令行和 lockfile 给出的是同一份凭据 —— 只该实测一次。
    const calls = vi.mocked(deps.probe).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].port).toBe(1111);
  });

  it('候选返回 401 时判为凭据失效', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('unauthorized'))
    });

    const result = await detectLcu(deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('stale-credentials');
    expect(result.summary).toBe(FAILURE_SUMMARIES['stale-credentials']);
  });

  it('国际服客户端判为 not-cn-client', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: RIOT_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not-cn-client');
  });

  it('国服端口连上的不是 LCU 时判为 not-a-lcu', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('not-lcu'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not-a-lcu');
  });

  it('有活进程但连不上判为 client-starting', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('dead'))
    });

    const result = await detectLcu(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-starting');
  });

  it('没有活进程也没有候选判为 client-not-running', async () => {
    const result = await detectLcu(makeDeps());

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('client-not-running');
  });

  it('浅检测不扫盘', async () => {
    const deps = makeDeps();
    await detectLcu(deps);
    expect(deps.scanForClients).not.toHaveBeenCalled();
  });

  it('深度检测才扫盘', async () => {
    const deps = makeDeps();
    await detectLcuDeep(deps);
    expect(deps.scanForClients).toHaveBeenCalled();
  });

  it('有活进程时不扫盘 —— 客户端在,只是没就绪', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      }))
    });
    await detectLcuDeep(deps);
    expect(deps.scanForClients).not.toHaveBeenCalled();
  });

  it('扫盘超时判为 scan-timeout', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [],
        paths: [],
        timedOut: true,
        detail: '磁盘扫描超时'
      }))
    });

    const result = await detectLcuDeep(deps);

    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('scan-timeout');
  });

  it('扫盘找到的路径写进路径缓存', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [],
        // 缓存里存的必须是 lockfile **文件**路径 —— 下次检测要拿它去 readFile。
        paths: ['E:\\wegameapps\\英雄联盟\\lockfile'],
        timedOut: false,
        detail: '磁盘扫描完成'
      }))
    });

    await detectLcuDeep(deps);

    expect(deps.writeCachedPaths).toHaveBeenCalledWith([
      'E:\\wegameapps\\英雄联盟\\lockfile'
    ]);
  });

  it('扫盘找到的凭据也能被裁决', async () => {
    const deps = makeDeps({
      scanForClients: vi.fn(async () => ({
        candidates: [
          { port: 3333, token: 'scanTok', protocol: 'https' as const, host: '127.0.0.1', origin: 'cn' as const, source: 'disk-scan' as const }
        ],
        paths: ['E:\\a'],
        timedOut: false,
        detail: '磁盘扫描完成'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    const result = await detectLcuDeep(deps);

    if (!result.ok) throw new Error('expected ok');
    expect(result.auth.port).toBe(3333);
  });

  it('成功时把凭据写进内存缓存', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    await detectLcu(deps);

    expect(deps.writeMemoryAuth).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1111, token: 'cnTok' }),
      'cn'
    );
  });

  it('失败结果里带诊断明细', async () => {
    const result = await detectLcu(makeDeps());

    if (result.ok) throw new Error('unreachable');
    expect(result.diagnosis.channels.length).toBeGreaterThan(0);
    expect(result.diagnosis.environment.node).toBe('test');
  });
});

describe('resolveLcuAuth(旧接口兼容)', () => {
  it('成功时返回凭据', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('alive'))
    });

    await expect(resolveLcuAuth(deps)).resolves.toEqual(
      expect.objectContaining({ port: 1111, token: 'cnTok' })
    );
  });

  it('压根没有客户端时抛 LcuNotRunningError', async () => {
    await expect(resolveLcuAuth(makeDeps())).rejects.toBeInstanceOf(LcuNotRunningError);
  });

  it('凭据失效时抛 LcuUnreachableError', async () => {
    const deps = makeDeps({
      queryProcesses: vi.fn(async () => ({
        processes: [{ executablePath: '', commandLine: CN_CMD }],
        exeDirs: [],
        liveProcess: true,
        detail: 'found'
      })),
      probe: vi.fn(probeBy('unauthorized'))
    });

    await expect(resolveLcuAuth(deps)).rejects.toBeInstanceOf(LcuUnreachableError);
  });

  it('抛出的错误带上失败分类和中文结论', async () => {
    const err = await resolveLcuAuth(makeDeps()).catch((e: unknown) => e);
    expect((err as LcuNotRunningError).code).toBe('client-not-running');
    expect((err as LcuNotRunningError).summary).toBe(FAILURE_SUMMARIES['client-not-running']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lcu/__tests__/credentials.test.ts`
Expected: FAIL —— `Failed to resolve import "../credentials"`。

- [ ] **Step 3: 实现 `src/main/lcu/credentials.ts`**

```ts
/**
 * 裁决层:候选池 → 实测 → 结论。
 *
 * 发现层(各通道)只负责吐候选,这里负责决定「哪个是真的」以及「全挂了为什么」。
 * 判定顺序是固定的 —— 顺序变了,用户看到的结论就会变。
 */
import {
  exeDerivedLockfilePaths,
  queryLcuProcesses,
  readEnvironment,
  readLockfileCandidates,
  readMemoryAuth,
  readPathCache,
  scanLockfileCandidates,
  staticLockfilePaths,
  writeMemoryAuth,
  writePathCache,
  type LockfileReadResult,
  type MemoryAuth,
  type ProcessChannelResult,
  type ScanChannelResult
} from './channels';
import { probeCandidate, toSummoner, type LcuProbeResult } from './client';
import { parseCommandLineCandidates } from './parse';
import { listDriveRoots } from './scan';
import { FAILURE_SUMMARIES } from './types';
import type {
  CurrentSummoner,
  LcuAuth,
  LcuAuthOrigin,
  LcuCandidate,
  LcuCandidateSource,
  LcuChannelReport,
  LcuDetectionResult,
  LcuDiagnosis,
  LcuEnvironment,
  LcuFailureCode,
  LcuProbeOutcome,
  LcuProbeRecord
} from './types';

/**
 * 没找到能用的客户端。
 *
 * `details` 里是各条通道各自失败的原因,`summary` 是给用户看的一句话。
 */
export class LcuNotRunningError extends Error {
  readonly details: string[];
  readonly code: LcuFailureCode;
  readonly summary: string;

  constructor(
    message = 'League client is not running.',
    details: string[] = [],
    code: LcuFailureCode = 'client-not-running',
    summary: string = message
  ) {
    super(message);
    this.name = 'LcuNotRunningError';
    this.details = details;
    this.code = code;
    this.summary = summary;
  }
}

/**
 * 找到了客户端,但连不上 —— 客户端重启过、换了端口,或者还没就绪。
 */
export class LcuUnreachableError extends Error {
  readonly code: LcuFailureCode;
  readonly summary: string;

  constructor(
    message = 'League client is not reachable.',
    code: LcuFailureCode = 'unknown',
    summary: string = message
  ) {
    super(message);
    this.name = 'LcuUnreachableError';
    this.code = code;
    this.summary = summary;
  }
}

/** 内存凭据缓存的有效期。 */
export const MEMORY_TTL_MS = 60_000;

/**
 * 裁决层依赖。全部可注入 —— 裁决逻辑是这个功能的价值所在,
 * 必须能脱离真实的 PowerShell / 磁盘 / 网络单测。
 */
export interface LcuDetectionDeps {
  queryProcesses(): Promise<ProcessChannelResult>;
  readLockfiles(paths: string[]): Promise<LockfileReadResult>;
  readCachedPaths(): Promise<string[]>;
  writeCachedPaths(paths: string[]): Promise<void>;
  readMemoryAuth(): MemoryAuth | null;
  writeMemoryAuth(auth: LcuAuth, origin: LcuAuthOrigin): void;
  scanForClients(): Promise<ScanChannelResult>;
  probe(candidate: LcuCandidate): Promise<LcuProbeResult>;
  readEnvironment(): LcuEnvironment;
}

/** 真实实现。 */
export const DEFAULT_DEPS: LcuDetectionDeps = {
  queryProcesses: queryLcuProcesses,
  readLockfiles: readLockfileCandidates,
  readCachedPaths: readPathCache,
  writeCachedPaths: writePathCache,
  readMemoryAuth,
  writeMemoryAuth,
  scanForClients: scanLockfileCandidates,
  probe: probeCandidate,
  readEnvironment
};

/** 一条候选的实测记录。 */
interface ProbeRecord {
  origin: LcuAuthOrigin;
  port: number;
  probe: LcuProbeOutcome;
  source: LcuCandidateSource;
}

/** 一个待裁决的候选批次。 */
interface CandidateStage {
  source: LcuCandidateSource;
  candidates: LcuCandidate[];
  detail: string;
  liveProcess: boolean;
  paths?: string[];
  timedOut?: boolean;
}

/**
 * 按优先级产出候选批次。
 *
 * 用生成器是因为「一个批次实测通过就该立刻停下来」—— 后面几条通道
 * 完全没必要跑(尤其是磁盘扫描)。
 */
async function* stageSequence(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): AsyncGenerator<CandidateStage> {
  const memory = deps.readMemoryAuth();
  const fresh = memory && Date.now() - memory.at < MEMORY_TTL_MS ? memory : null;
  const stale = memory && !fresh ? memory : null;

  // C5 内存凭据缓存(60 秒内)
  if (fresh) {
    yield {
      source: 'memory',
      candidates: [{ ...fresh.auth, origin: fresh.origin, source: 'memory' }],
      detail: '内存凭据缓存(60 秒内)',
      liveProcess: false
    };
  }

  // C1 进程命令行。国服和国际服分成两批,国服在前 —— 国际服的 Riot Client API
  // 对游戏端点一律 404,实测就能识破,但没必要让它抢在国服前面。
  const proc = await deps.queryProcesses();
  const cnCandidates: LcuCandidate[] = [];
  const riotCandidates: LcuCandidate[] = [];
  for (const info of proc.processes) {
    for (const parsed of parseCommandLineCandidates(info.commandLine)) {
      const candidate: LcuCandidate = { ...parsed, source: 'process' };
      if (parsed.origin === 'cn') cnCandidates.push(candidate);
      else riotCandidates.push(candidate);
    }
  }
  yield {
    source: 'process',
    candidates: cnCandidates,
    detail: proc.detail,
    liveProcess: proc.liveProcess
  };

  // C2 lockfile 候选集:exe 派生路径 + 常见安装位置
  const lockPaths = [
    ...exeDerivedLockfilePaths(proc.exeDirs),
    ...staticLockfilePaths(
      listDriveRoots(),
      process.env.LOCALAPPDATA ?? null,
      process.env.ProgramFiles ?? null
    )
  ];
  const lock = await deps.readLockfiles(lockPaths);
  yield {
    source: 'lockfile',
    candidates: lock.candidates,
    detail:
      lock.candidates.length > 0
        ? 'lockfile 读到 ' + lock.candidates.length + ' 份凭据'
        : '常见位置没找到 lockfile',
    liveProcess: proc.liveProcess,
    paths: lock.tried
  };

  // C4 上一次找到的路径
  const cachedPaths = await deps.readCachedPaths();
  if (cachedPaths.length > 0) {
    const cached = await deps.readLockfiles(cachedPaths);
    yield {
      source: 'cache',
      candidates: cached.candidates,
      detail:
        cached.candidates.length > 0 ? '路径缓存命中' : '路径缓存里的路径已失效',
      liveProcess: proc.liveProcess,
      paths: cached.tried
    };
  }

  // C5 内存凭据缓存(超期)。端口多半已经死了,但试一下也就一次 readFile 的成本。
  if (stale) {
    yield {
      source: 'memory',
      candidates: [{ ...stale.auth, origin: stale.origin, source: 'memory' }],
      detail: '内存凭据缓存(已超期)',
      liveProcess: false
    };
  }

  // C1 国际服命令行
  yield {
    source: 'process',
    candidates: riotCandidates,
    detail:
      riotCandidates.length > 0 ? '国际服命令行候选' : '没有国际服命令行候选',
    liveProcess: proc.liveProcess
  };

  // C3 磁盘扫描。只在深度检测里跑,而且只在没有活进程时跑 ——
  // 客户端进程在,说明它就是没就绪,扫盘没意义。
  //
  // 扫到的路径会写进路径缓存(C4),所以「用户手点一次深检测」之后,后面的
  // 浅检测(轮询器、图标代理)也能通过 C4 通道找到同一个客户端 —— 不需要每轮扫全盘。
  if (allowDiskScan && !proc.liveProcess) {
    const scan = await deps.scanForClients();
    yield {
      source: 'disk-scan',
      candidates: scan.candidates,
      detail: scan.detail,
      liveProcess: proc.liveProcess,
      paths: scan.paths,
      timedOut: scan.timedOut
    };
  }
}

/** 失败分类。顺序固定 —— 改了顺序,用户看到的结论就变了。 */
function classify(
  records: ProbeRecord[],
  liveProcess: boolean,
  scanTimedOut: boolean
): LcuFailureCode {
  if (records.some((r) => r.probe === 'unauthorized')) return 'stale-credentials';
  if (records.some((r) => r.origin === 'riot' && r.probe === 'not-lcu')) return 'not-cn-client';
  if (records.some((r) => r.origin === 'cn' && r.probe === 'not-lcu')) return 'not-a-lcu';
  if (liveProcess) return 'client-starting';
  if (scanTimedOut) return 'scan-timeout';
  return 'client-not-running';
}

/** LCU 在没登录召唤师时返回 `{}` —— 那也是有效凭据,只是没有召唤师信息。 */
function safeSummoner(body: unknown): CurrentSummoner {
  try {
    return toSummoner(body);
  } catch {
    return { displayName: '', puuid: '' };
  }
}

async function detectInner(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): Promise<LcuDetectionResult> {
  const records: ProbeRecord[] = [];
  const reports: LcuChannelReport[] = [];
  const probed = new Set<string>();
  let liveProcess = false;
  let scanTimedOut = false;

  for await (const stage of stageSequence(deps, allowDiskScan)) {
    if (stage.liveProcess) liveProcess = true;
    if (stage.timedOut) scanTimedOut = true;

    if (stage.source === 'disk-scan' && stage.paths && stage.paths.length > 0) {
      // 扫到的路径存下来,下次检测就不用再扫一遍。
      await deps.writeCachedPaths(stage.paths);
    }

    const probeRecords: LcuProbeRecord[] = [];

    for (const candidate of stage.candidates) {
      const key = candidate.host + ':' + candidate.port + ':' + candidate.token;
      if (probed.has(key)) continue;
      probed.add(key);

      const result = await deps.probe(candidate);
      records.push({
        origin: candidate.origin,
        port: candidate.port,
        probe: result.outcome,
        source: candidate.source
      });
      probeRecords.push({
        port: candidate.port,
        origin: candidate.origin,
        probe: result.outcome
      });

      if (result.outcome !== 'alive') continue;

      const auth: LcuAuth = {
        port: candidate.port,
        token: candidate.token,
        protocol: candidate.protocol,
        host: candidate.host
      };
      deps.writeMemoryAuth(auth, candidate.origin);
      reports.push({
        source: stage.source,
        ok: true,
        liveProcess: stage.liveProcess,
        detail: stage.detail,
        candidates: probeRecords,
        paths: stage.paths
      });
      return { ok: true, auth, summoner: safeSummoner(result.body) };
    }

    reports.push({
      source: stage.source,
      ok: false,
      liveProcess: stage.liveProcess,
      detail: stage.detail,
      candidates: probeRecords,
      paths: stage.paths
    });
  }

  const code = classify(records, liveProcess, scanTimedOut);
  const summary = FAILURE_SUMMARIES[code];
  const diagnosis: LcuDiagnosis = {
    code,
    summary,
    channels: reports,
    environment: deps.readEnvironment()
  };
  return { ok: false, code, summary, diagnosis };
}

async function runDetection(
  deps: LcuDetectionDeps,
  allowDiskScan: boolean
): Promise<LcuDetectionResult> {
  try {
    return await detectInner(deps, allowDiskScan);
  } catch (e: unknown) {
    const summary = FAILURE_SUMMARIES.unknown;
    const diagnosis: LcuDiagnosis = {
      code: 'unknown',
      summary,
      channels: [],
      environment: {
        proxyVars: [],
        localAppData: process.env.LOCALAPPDATA ?? null,
        electron: process.versions.electron ?? 'unknown',
        node: process.versions.node
      },
      error: e instanceof Error ? e.message : String(e)
    };
    return { ok: false, code: 'unknown', summary, diagnosis };
  }
}

/** 浅检测:不扫盘。用户点一下按钮的量级。 */
export async function detectLcu(deps: LcuDetectionDeps = DEFAULT_DEPS): Promise<LcuDetectionResult> {
  return runDetection(deps, false);
}

/** 深度检测:允许扫盘。客户端装在非标准位置时的兜底。 */
export async function detectLcuDeep(
  deps: LcuDetectionDeps = DEFAULT_DEPS
): Promise<LcuDetectionResult> {
  return runDetection(deps, true);
}

/** 把失败结果翻译成旧接口要的异常。 */
function toError(result: { code: LcuFailureCode; summary: string; diagnosis: LcuDiagnosis }): Error {
  const details = result.diagnosis.channels.map((c) => c.source + ': ' + c.detail);
  switch (result.code) {
    case 'client-not-running':
    case 'not-cn-client':
    case 'scan-timeout':
      return new LcuNotRunningError(result.summary, details, result.code, result.summary);
    default:
      return new LcuUnreachableError(result.summary, result.code, result.summary);
  }
}

/** 解析出能连上的凭据。失败时抛错 —— 旧接口的语义。 */
export async function resolveLcuAuth(deps: LcuDetectionDeps = DEFAULT_DEPS): Promise<LcuAuth> {
  const result = await detectLcu(deps);
  if (result.ok) return result.auth;
  throw toError(result);
}

/**
 * {@link resolveLcuAuth} 的异步别名。
 *
 * 旧代码里这两个是「同步 / 异步」之分(同步那个用 execSync 会卡主进程),
 * 现在两个都是异步的,控制流不用改。
 */
export async function resolveLcuAuthAsync(
  deps: LcuDetectionDeps = DEFAULT_DEPS
): Promise<LcuAuth> {
  return resolveLcuAuth(deps);
}

/**
 * 进程内共享的 LCU 凭据。
 *
 * 轮询器解析一次就会缓存住,别的模块(比如图标代理)直接取这份就行 ——
 * 不用各自去 spawn 一个 PowerShell 查进程命令行。
 */
let sharedAuth: LcuAuth | null = null;

export function setSharedLcuAuth(auth: LcuAuth | null): void {
  sharedAuth = auth;
}

export function getSharedLcuAuth(): LcuAuth | null {
  return sharedAuth;
}

export function invalidateSharedLcuAuth(): void {
  sharedAuth = null;
}
```

> **barrel 冲突注意**：`clearMemoryAuth` 只在 `channels.ts` 里导出。这里**不要**再
> `export { clearMemoryAuth }` —— barrel 会同时从 `channels.ts` 和 `credentials.ts`
> 导出同名成员,`tsc` 直接报 TS2308「has already exported a member named」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lcu/__tests__/credentials.test.ts`
Expected: PASS，22 个用例全绿。

- [ ] **Step 5: 提交（不自动执行）**

```bash
git add src/main/lcu/credentials.ts src/main/lcu/__tests__/credentials.test.ts
git commit -m "feat(lcu): 新增裁决层(候选池实测 + 失败分类)"
```

### Task 7: barrel 收口 + 迁移旧测试

**Files:**
- Modify (整体重写): `src/main/lcu.ts`
- Delete: `src/main/__tests__/lcu.test.ts`
- Modify: `src/main/lcu/__tests__/client.test.ts`（补进旧文件里仍然有效的用例）

**旧测试文件的用例去哪了**（14 个 describe 块）：

| 旧 describe | 新家 | 说明 |
| --- | --- | --- |
| `parseLockfile` | `lcu/__tests__/parse.test.ts` → `parseLockfileText` | 抛错改成返回 null |
| `findLockfilePath` | `lcu/__tests__/channels.test.ts` → `staticLockfilePaths` | 「唯一 lockfile 路径」这个概念没了,拆成候选集 |
| `readLockfile` | `parse.test.ts` + `channels.test.ts` → `readLockfileCandidates` | 解析归 parse,读文件归 channels |
| `parseLcuAuthFromCommandLine` | `parse.test.ts` → `parseCommandLineCandidates` | 从「返回一条」改成「返回国服+国际服两条」 |
| `parseLcuProcessInfo` | `parse.test.ts` → `parseProcessOutput` | 输出格式换成 base64 |
| `findLockfileCandidates` | `channels.test.ts` → `exeDerivedLockfilePaths` + `staticLockfilePaths` | 拆成两块 |
| `isPortAlive` | `lcu/__tests__/client.test.ts` | 签名加了 host |
| `collectLcuAuthCandidates` | `lcu/__tests__/credentials.test.ts` | 换成 `detectLcu` |
| `collectLcuAuthCandidatesDetailed` | `credentials.test.ts` | 换成 `detectLcu` 的 `diagnosis` |
| `resolveLcuAuth` | `credentials.test.ts` | 兼容包装,语义不变 |
| `createLcuClient` | `lcu/__tests__/client.test.ts` | 参数从 `(port, token)` 改成 `(auth)` |
| `getCurrentSummoner` | `client.test.ts` | 原样搬过去 |
| `getStoreOwnedSkinIds` | `client.test.ts` | 原样搬过去 |
| `getInventoryOwnedSkinIds` | `client.test.ts` | 原样搬过去 |

**一个有意丢弃的东西**：旧测试靠 `LOL_LOCKFILE_PATH` 环境变量隔离开发机上的真实 lockfile。新设计没有「单一 lockfile 路径」这个概念,隔离方式换成**临时目录 + 注入的 deps**。`LOL_LOCKFILE_PATH` 这个环境变量在新代码里不再被读取 —— 这是有意的,不是漏改。

- [ ] **Step 1: 重写 `src/main/lcu.ts` 成 barrel**

整个文件替换成：

```ts
/**
 * LCU 相关能力的统一出口。
 *
 * 保留成 barrel 是因为 `ipc.ts` / `match/poller.ts` / `match/iconAssets.ts` /
 * `owned.ts` 都是 `import * as lcu from './lcu'` —— 改 import 路径会波及四个文件。
 *
 * 注意:barrel 里 `export *` 的名字**不能重名**。加新导出前先确认没被上面任何一个
 * 模块占用。
 */
export * from './lcu/types';
export * from './lcu/parse';
export * from './lcu/client';
export * from './lcu/scan';
export * from './lcu/channels';
export * from './lcu/credentials';
```

- [ ] **Step 2: 删掉旧的测试文件**

```
删除 src/main/__tests__/lcu.test.ts
```

它测的是已经被重写掉的旧实现。内容已经按上面的表搬到新位置了。

- [ ] **Step 3: 把旧文件里仍然有效的三个 describe(共 6 个用例)补进 `client.test.ts`**

在 `src/main/lcu/__tests__/client.test.ts` 末尾追加：

```ts
function fakeClient(data: unknown): AxiosInstance {
  return { get: vi.fn(async () => ({ data })) } as unknown as AxiosInstance;
}

describe('getCurrentSummoner', () => {
  it('抽出显示名和 puuid', async () => {
    const client = fakeClient({ displayName: 'Tester', puuid: 'p-1' });
    await expect(getCurrentSummoner(client)).resolves.toEqual({
      displayName: 'Tester',
      puuid: 'p-1'
    });
  });

  it('响应不是对象时抛错', async () => {
    const client = fakeClient('nope');
    await expect(getCurrentSummoner(client)).rejects.toThrow(/Unexpected/);
  });
});

describe('getInventoryOwnedSkinIds', () => {
  it('只收 owned 的皮肤 id', async () => {
    const client = fakeClient([
      { itemId: 1001, owned: true },
      { itemId: 1002, owned: false },
      { itemId: 1003, rental: true },
      { itemId: 1004, ownershipType: 'OWNED' }
    ]);
    await expect(getInventoryOwnedSkinIds(client)).resolves.toEqual([1001, 1004]);
  });

  it('响应不是数组时抛错', async () => {
    const client = fakeClient({});
    await expect(getInventoryOwnedSkinIds(client)).rejects.toThrow(/Unexpected/);
  });
});

describe('getStoreOwnedSkinIds', () => {
  it('收商城目录里 owned 的皮肤,炫彩不算', async () => {
    const client = fakeClient([
      { itemId: 2001, inventoryType: 'CHAMPION_SKIN', owned: true },
      { itemId: 2002, inventoryType: 'CHAMPION_SKIN', owned: true, subInventoryType: 'RECOLOR' },
      { itemId: 2003, inventoryType: 'CHAMPION_SKIN', owned: false }
    ]);
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([2001]);
  });

  it('补充源挂掉时不影响已拿到的目录数据', async () => {
    let call = 0;
    const client = {
      get: vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return { data: [{ itemId: 3001, inventoryType: 'CHAMPION_SKIN', owned: true }] };
        }
        throw new Error('boom');
      })
    } as unknown as AxiosInstance;
    await expect(getStoreOwnedSkinIds(client)).resolves.toEqual([3001]);
  });
});
```

同时把该文件顶部的 import 改成：

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  createLcuClient,
  getCurrentSummoner,
  getInventoryOwnedSkinIds,
  getStoreOwnedSkinIds,
  isPortAlive
} from '../client';
import type { LcuAuth } from '../types';
```

- [ ] **Step 4: 跑全量测试**

Run: `npx vitest run`
Expected: 全绿,包括 `src/main/__tests__/ipc.test.ts` 和 `src/main/match/__tests__/poller.test.ts`。

> 这两个文件之所以不会红,是因为它们把 `../lcu` / `../../lcu` 整个 mock 掉了 ——
> mock 工厂给了什么就有什么,真实的 `createLcuClient` 签名压根没参与运行。
> 所以「旧签名」在这两个文件里是**类型错误**,不是**运行时错误**,下一步才看得到。

- [ ] **Step 5: 跑类型检查**

Run: `npm run typecheck:node`
Expected: 只报 `ipc.test.ts` / `poller.test.ts` 相关的错 —— 它们还在用旧的
`createLcuClient(port, token)` 签名和旧的 `{ port, token }` 凭据形状。这两处在
Task 8、Task 9 修。

**如果报 `Module ... has already exported a member named ...`**,说明 barrel 里两个模块
导出了同名符号 —— 改掉其中一个的名字,不要改 barrel。

- [ ] **Step 6: 提交（不自动执行）**

```bash
git add src/main/lcu.ts src/main/lcu/__tests__/client.test.ts
git rm src/main/__tests__/lcu.test.ts
git commit -m "refactor(lcu): 拆成 lcu/ 子模块,旧实现换成 barrel"
```

---

### Task 8: IPC + preload + 渲染层

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/__tests__/ipc.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/views/Sync.vue`
- Modify: `src/renderer/src/components/DevPanel.vue`

**这一层要做的事**：把裁决层的结论原样送到界面上 —— 一句话结论给普通用户，完整明细给开发者面板。

- [ ] **Step 1: 改 `src/main/ipc.ts` 的 `normalizeLcuError`**

把函数替换成（**优先用 `e.summary`** —— 裁决层给的中文结论比通用文案具体得多）：

```ts
/** 游戏客户端专属的错误包装:把网络错误码换成用户看得懂的话。 */
function normalizeLcuError(e: unknown): NormalizedSyncError {
  // 裁决层的结论优先 —— 「装的是国际服客户端」比「游戏客户端未运行」有用得多。
  const summary = (e as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.length > 0) {
    const err = new Error(summary) as NormalizedSyncError;
    err.name = e instanceof Error ? e.name : 'LcuError';
    const code = (e as { code?: unknown }).code;
    err.code = typeof code === 'string' ? code : 'LCU_UNREACHABLE';
    return err;
  }
  if (e instanceof lcu.LcuUnreachableError) {
    const err = new Error(LCU_UNREACHABLE_MESSAGE) as NormalizedSyncError;
    err.name = e.name;
    err.code = 'LCU_UNREACHABLE';
    return err;
  }
  if (e instanceof lcu.LcuNotRunningError) {
    const err = new Error(LCU_NOT_RUNNING_MESSAGE) as NormalizedSyncError;
    err.name = e.name;
    err.code = 'LCU_NOT_RUNNING';
    return err;
  }
  if (axios.isAxiosError(e)) {
    const code = (e as { code?: string }).code;
    const friendly = code ? FRIENDLY_LCU_MESSAGES[code] : undefined;
    const err = new Error(friendly ?? e.message) as NormalizedSyncError;
    err.name = e.name;
    err.status = e.response?.status;
    err.code = code;
    return err;
  }
  return normalizeSyncError(e);
}
```

- [ ] **Step 2: 改 `src/main/ipc.ts` 的 `lcu:check-status` 处理器**

把整个 `ipcMain.handle('lcu:check-status', ...)` 替换成：

```ts
  // deep = true 时允许扫盘找客户端。用户手点「检测客户端」走深检测,
  // 界面挂载时的自动检查走浅检测 —— 否则每次开界面都全盘扫一遍。
  ipcMain.handle('lcu:check-status', async (_event, deep?: boolean) => {
    try {
      const result = deep === true ? await lcu.detectLcuDeep() : await lcu.detectLcu();
      if (!result.ok) {
        return {
          running: false,
          code: result.code,
          summary: result.summary,
          diagnosis: result.diagnosis
        };
      }
      return {
        running: true,
        port: result.auth.port,
        summoner: result.summoner
      };
    } catch (error: unknown) {
      const normalized = normalizeLcuError(error);
      return {
        running: false,
        error: normalized.message,
        code: 'unknown' as const,
        summary: normalized.message
      };
    }
  });
```

- [ ] **Step 3: 改 `src/main/ipc.ts` 的 `lcu:fetch-skins`**

`createLcuClient` 的签名变了,改成传整个 auth 对象：

```ts
  ipcMain.handle('lcu:fetch-skins', async () => {
    try {
      const lcuAuth = await lcu.resolveLcuAuth();
      const client = lcu.createLcuClient(lcuAuth);
      const summoner = await lcu.getCurrentSummoner(client);
      const owned = await resolveOwnedSkinIds(client);
      return {
        summoner,
        ownedSkinIds: owned.ownedSkinIds,
        source: owned.source,
        catalogFiltered: owned.catalogFiltered
      };
    } catch (e) {
      throw normalizeLcuError(e);
    }
  });
```

- [ ] **Step 4: 改 `src/main/__tests__/ipc.test.ts`**

4a. 在 `vi.hoisted` 的返回对象里加两个 mock：

```ts
    detectLcu: vi.fn(),
    detectLcuDeep: vi.fn(),
```

4b. 在 `vi.mock('../lcu', ...)` 工厂里补上：

```ts
  detectLcu: mocks.detectLcu,
  detectLcuDeep: mocks.detectLcuDeep,
```

4c. 在 `beforeEach` 里加：

```ts
    mocks.detectLcu.mockReset();
    mocks.detectLcuDeep.mockReset();
```

4d. **`lcu:check-status` 现有的 5 个用例（`src/main/__tests__/ipc.test.ts:251-307`）全部作废。**
老的处理器是「解析凭据 → 取召唤师」,新处理器是「跑裁决层 → 拿结论」,返回结构完全不同,
老用例留着必然红 —— 一个都别留:

| 行 | 用例名 | 为什么作废 |
| --- | --- | --- |
| 251 | `returns running false when LCU is not detected` | 老处理器靠抛 `LcuNotRunningError` 才返回 false;新处理器走 `detectLcu`,不抛异常 |
| 257 | `reports why each credential source failed` | `reason` 字段没了,改成结构化的 `diagnosis.channels` |
| 271 | `returns running true with the current summoner` | 老用例断言 `createLcuClient` 被调用;新的凭据获取在裁决层内部,IPC 层不该断言它 |
| 288 | `reports axios failures without hiding the message` | 新处理器不在 IPC 层发请求;axios 错误由裁决层归类成 `stale-credentials` 之类 |
| 301 | `explains a stale client port in plain language` | 新结论由 `FAILURE_SUMMARIES` 决定,里面没有「游戏客户端」这几个字 |

删完之后,替换成下面这 5 个:

```ts
  it('lcu:check-status returns running true with the current summoner', async () => {
    const summoner = { displayName: 'Alice', puuid: 'puuid-1' };
    mocks.detectLcu.mockResolvedValue({
      ok: true,
      auth: { port: 1234, token: 'secret', protocol: 'https', host: '127.0.0.1' },
      summoner
    });

    await expect(invoke('lcu:check-status')).resolves.toEqual({
      running: true,
      port: 1234,
      summoner
    });
  });

  it('lcu:check-status reports the failure code and the plain-language summary', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'client-not-running',
      summary: '没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。',
      diagnosis: {
        code: 'client-not-running',
        summary: '没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as {
      running: boolean;
      code?: string;
      summary?: string;
    };
    expect(outcome.running).toBe(false);
    expect(outcome.code).toBe('client-not-running');
    expect(outcome.summary).toContain('没检测到');
  });

  it('lcu:check-status without the deep flag only runs the shallow detection', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'client-not-running',
      summary: 'x',
      diagnosis: {
        code: 'client-not-running',
        summary: 'x',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    await invoke('lcu:check-status', {});

    expect(mocks.detectLcu).toHaveBeenCalled();
    expect(mocks.detectLcuDeep).not.toHaveBeenCalled();
  });

  it('lcu:check-status with the deep flag runs the deep detection', async () => {
    mocks.detectLcuDeep.mockResolvedValue({
      ok: false,
      code: 'scan-timeout',
      summary: '没在常见位置找到客户端 —— 可能装在非标准位置。',
      diagnosis: {
        code: 'scan-timeout',
        summary: '没在常见位置找到客户端 —— 可能装在非标准位置。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status', {}, true)) as { code?: string };
    expect(mocks.detectLcuDeep).toHaveBeenCalled();
    expect(mocks.detectLcu).not.toHaveBeenCalled();
    expect(outcome.code).toBe('scan-timeout');
  });

  it('lcu:check-status reports stale credentials in plain language', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'stale-credentials',
      summary: '客户端重启过、凭据失效 —— 点检测重试。',
      diagnosis: {
        code: 'stale-credentials',
        summary: '客户端重启过、凭据失效 —— 点检测重试。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as {
      running: boolean;
      code?: string;
      summary?: string;
    };
    expect(outcome.running).toBe(false);
    expect(outcome.code).toBe('stale-credentials');
    expect(outcome.summary).toBe('客户端重启过、凭据失效 —— 点检测重试。');
  });

  it('lcu:check-status tells the user when only the international client is installed', async () => {
    mocks.detectLcu.mockResolvedValue({
      ok: false,
      code: 'not-cn-client',
      summary: '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
      diagnosis: {
        code: 'not-cn-client',
        summary: '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
        channels: [],
        environment: { proxyVars: [], localAppData: null, electron: 'test', node: 'test' }
      }
    });

    const outcome = (await invoke('lcu:check-status')) as { code?: string; summary?: string };
    expect(outcome.code).toBe('not-cn-client');
    expect(outcome.summary).toContain('国际服');
  });
```

> **`invoke` 的第一个参数是假 event —— 但 preload 那边不是。** 这个测试文件的
> `invoke(channel, ...args)` 直接把参数摊给 handler,所以 handler 的第一个形参
> (事件对象)要占掉一个位置 —— 现有测试里的 `invoke('auth:login', {}, { code: '482931' })`
> 就是这个约定。传 `deep` 必须写成 `invoke('lcu:check-status', {}, true)`,写成
> `invoke('lcu:check-status', true)` 会把 `true` 塞进事件参数,`deep` 变成 `undefined`,
> 深检测根本不会触发。
>
> preload 那边是另一回事:它的 `invoke` 就是 `ipcRenderer.invoke(channel, ...args)`,
> Electron 自己会补上事件对象,所以 preload 里写 `invoke('lcu:check-status', true)` 是对的
> —— 渲染进程传的 `true` 会落到 handler 的第二个形参上。两边写法不一样,是故意的。

4e. `lcu:fetch-skins` 那个用例里的 `mocks.resolveLcuAuth.mockResolvedValue({ port: 1234, token: 'secret' })` 改成 `mocks.resolveLcuAuth.mockResolvedValue({ port: 1234, token: 'secret', protocol: 'https', host: '127.0.0.1' })`,并把 `expect(mocks.createLcuClient).toHaveBeenCalledWith(1234, 'secret')` 改成 `expect(mocks.createLcuClient).toHaveBeenCalledWith(expect.objectContaining({ port: 1234, token: 'secret' }))`。

- [ ] **Step 5: 改 `src/preload/index.ts`**

5a. 顶部加类型导入与再导出:

```ts
import type { LcuDiagnosis, LcuFailureCode } from '../main/lcu/types';

export type { LcuChannelReport, LcuDiagnosis, LcuFailureCode } from '../main/lcu/types';
```

5b. 把 `LcuStatus` 接口替换成:

```ts
export interface LcuStatus {
  running: boolean;
  port?: number;
  summoner?: {
    displayName: string;
    puuid: string;
  };
  error?: string;
  /** 失败分类码 —— 界面据此决定文案与图标。 */
  code?: LcuFailureCode;
  /** 一句话结论,直接给用户看。 */
  summary?: string;
  /** 完整诊断明细,开发者面板用。 */
  diagnosis?: LcuDiagnosis;
}
```

> 旧字段 `reason` 去掉了 —— 它的信息现在在 `diagnosis.channels` 里,更结构化。

5c. 把 api 里的 `checkLcu` 替换成:

```ts
  /**
   * 检测游戏客户端。
   * deep = true 时允许扫盘找客户端(用户手点按钮时用);
   * 不传时是浅检测(界面挂载时的自动检查用)。
   */
  checkLcu: (deep?: boolean): Promise<LcuStatus> =>
    deep === true ? invoke('lcu:check-status', true) : invoke('lcu:check-status'),
```

- [ ] **Step 6: 改 `src/renderer/src/views/Sync.vue`**

6a. 按钮改成深检测:

```html
<el-button class="hx-gold" :loading="lcuChecking" @click="onCheckLcu(true)">检测客户端</el-button>
```

6b. `lcuTooltip` 换成:

```ts
const lcuTooltip = computed<string>(() => {
  if (lcuState.value === 'error') {
    return lastFetchError.value?.message ?? '游戏客户端连接失败';
  }
  if (lcuState.value === 'running') {
    return '游戏客户端已连接';
  }
  // 灰色只说明「没检测到」,后端给的是一句能照着做的中文结论。
  return lcuStatus.value.summary ?? lcuStatus.value.error ?? '未检测到游戏客户端';
});
```

6c. `onCheckLcu` 换成:

```ts
async function onCheckLcu(deep = false): Promise<void> {
  lcuChecking.value = true;
  lastFetchError.value = null;
  try {
    const s = await window.api.checkLcu(deep);
    lcuStatus.value = s;
    pushLog(
      'INFO',
      `LCU check(deep=${deep}): running=${s.running}` +
        `${s.code ? ' code=' + s.code : ''}${s.summary ? ' summary=' + s.summary : ''}`
    );
    if (s.error) {
      lastFetchError.value = new Error(s.error);
    }
  } catch (e: unknown) {
    const msg = describeError(e);
    lastFetchError.value = new Error(msg);
    pushLog('ERROR', `LCU check failed: ${msg}`);
    notifyError('检测游戏客户端失败', msg);
  } finally {
    lcuChecking.value = false;
  }
}
```

6d. `onMounted` 里保持 `await onCheckLcu();` 不变(浅检测)—— 注释加一句说明:

```ts
onMounted(async () => {
  await auth.refresh();
  // 挂载时的自动检查走浅检测 —— 每次开界面都扫全盘太重。
  // 用户手点按钮才是深检测。
  await onCheckLcu();
  ...
});
```

- [ ] **Step 7: 改 `src/renderer/src/components/DevPanel.vue`**

7a. `lcuDetail` 换成:

```ts
/** 客户端检测的失败原因 —— 一句话结论 + 内部错误。 */
const lcuDetail = computed(() => lcu.value.summary ?? lcu.value.error ?? '—');
```

7b. 在 `lcuDetail` 后面加诊断明细:

```ts
/** 客户端诊断明细 —— 每条通道各自的结果,排查时最有用。 */
const lcuDiagnosisText = computed<string>(() => {
  const d = lcu.value.diagnosis;
  if (!d) return '';
  const lines = d.channels.map((c) => {
    const probe = c.candidates
      .map((x) => x.port + '(' + x.origin + '/' + x.probe + ')')
      .join(', ');
    return '- ' + c.source + ': ' + c.detail + (probe ? ' | 候选: ' + probe : '');
  });
  const env = d.environment;
  lines.push(
    '- 环境: proxy=' +
      (env.proxyVars.length > 0 ? env.proxyVars.join(',') : '无') +
      ' electron=' +
      env.electron +
      ' node=' +
      env.node
  );
  if (d.error) lines.push('- 内部异常: ' + d.error);
  return lines.join('\n');
});
```

7c. `refreshLcu` 走深检测 —— 开发者面板要看的是完整信息:

```ts
async function refreshLcu(): Promise<void> {
  try {
    lcu.value = await window.api.checkLcu(true);
  } catch (e: unknown) {
    lcu.value = { running: false, error: (e as { message?: string }).message };
  }
}
```

7d. `onCopy` 里在数组末尾追加诊断明细:

```ts
async function onCopy(): Promise<void> {
  const diagnosis = lcuDiagnosisText.value;
  const text = [
    '[LOL 皮肤助手 · 诊断信息]',
    `时间: ${new Date().toLocaleString()}`,
    `游戏客户端: ${lcu.value.running ? `运行中(端口 ${port.value ?? '—'})` : '未检测到'}`,
    `客户端检测详情: ${lcuDetail.value}`,
    `游戏账号: ${summonerName.value}`,
    `PUUID: ${puuid.value}`,
    `图鉴条数: ${catalogSize.value}`,
    `已拥有(匹配): ${stats.value.ownedMatched}`,
    `拥有数据来源: ${ownedSource.value}`,
    `皮肤 ID 覆盖率: ${coverageText.value}`,
    `皮肤 ID 字段: ${skinIdFieldPresent.value ? '后端已升级' : '后端未升级'}`,
    `上次同步: ${lastSyncText.value}`,
    `图鉴原始记录数: ${skins.value.length}`,
    ...(diagnosis ? ['客户端诊断明细:', diagnosis] : [])
  ].join('\n');
  await window.api.copyText(text);
  ElMessage.success('诊断信息已复制到剪贴板');
}
```

- [ ] **Step 8: 跑测试与类型检查**

Run: `npx vitest run`
Expected: 全绿。`poller.test.ts` **不会红** —— 它把 `../../lcu` 整个 mock 掉了,
`createLcuClient` 是个 `vi.fn(() => ({ get: vi.fn() }))`,传几个参数都无所谓。

Run: `npm run typecheck`
Expected: 只剩两处错,都在 Task 9 的范围内:
- `src/main/match/poller.ts:360` —— `createLcuClient(auth.port, auth.token)` 的旧签名;
- `src/main/match/__tests__/poller.test.ts` —— `authMock.mockResolvedValue({ port, token })`
  少了新结构里必填的 `protocol` / `host`。

- [ ] **Step 9: 提交（不自动执行）**

```bash
git add src/main/ipc.ts src/main/__tests__/ipc.test.ts src/preload/index.ts src/renderer/src/views/Sync.vue src/renderer/src/components/DevPanel.vue
git commit -m "feat(lcu): 界面接上新的检测结论与诊断明细"
```

---

### Task 9: `poller.ts` / `iconAssets.ts` 适配

**Files:**
- Modify: `src/main/match/poller.ts`
- Modify: `src/main/match/iconAssets.ts`
- Modify: `src/main/match/liveClient.ts`
- Modify: `src/main/match/__tests__/poller.test.ts`

- [ ] **Step 1: 改 `src/main/match/poller.ts` 的 `describeError`**

裁决层的错误现在带 `summary`(一句能照着做的中文结论),优先用它:

```ts
function describeError(e: unknown): string {
  // 裁决层的结论优先 —— 「装的是国际服客户端」比「未检测到游戏客户端」具体得多。
  const summary = (e as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.length > 0) return summary;
  if (e instanceof lcu.LcuNotRunningError) return '未检测到游戏客户端,请先启动它。';
  if (e instanceof lcu.LcuUnreachableError) {
    return '游戏客户端端口已失效(客户端重启过),请重新启动客户端。';
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
```

- [ ] **Step 2: 改 `src/main/match/poller.ts` 里的 `createLcuClient` 调用**

`poller.ts:360` 那行：

```ts
const client = lcu.createLcuClient(auth.port, auth.token);
```

改成：

```ts
const client = lcu.createLcuClient(auth);
```

- [ ] **Step 3: 改 `src/main/match/iconAssets.ts`**

**这一步要做四件事。** 前两件是跟着 `createLcuClient` 的新签名一起改；后两件是补
**现存的老 bug** —— `lcuGetJson` 拿相对路径去 `axios.get`,而那个调用没有
`baseURL`,axios 在 Node 端会直接抛 "Invalid URL",于是图标元数据**从来没加载成功过**,
代码一直在走「猜路径」的降级分支。

3a. `iconAssets.ts:472` 那行：

```ts
return await resolvePatchVersion(createLcuClient(auth.port, auth.token));
```

改成：

```ts
return await resolvePatchVersion(createLcuClient(auth));
```

3b. `tryFetchLcu` 改成走 `createLcuClient`（`iconAssets.ts:369-393`）：

```ts
async function tryFetchLcu(auth: LcuAuth, assetPath: string): Promise<LcuFetchResult> {
  try {
    // 走 createLcuClient 而不是裸 axios:
    //   1) proxy: false —— 装了代理软件的机器上,裸 axios 会把回环请求丢给代理,必挂;
    //   2) baseURL 用 auth.protocol / auth.host —— 不再硬编码 https://127.0.0.1;
    //   3) 自签证书照样放行。
    const client = createLcuClient(auth);
    const { data } = await client.get<ArrayBuffer>(assetPath, {
      responseType: 'arraybuffer',
      timeout: LCU_TIMEOUT_MS,
      validateStatus: (status) => status === 200
    });
    const buffer = Buffer.from(data);
    return { buffer: buffer.length > 0 ? buffer : null, authFailed: false, status: 200 };
  } catch (e: unknown) {
    const response = (e as { response?: { status?: number; data?: unknown } })?.response;
    const status = response?.status;
    return {
      buffer: null,
      authFailed: status === 401 || status === 403,
      status,
      detail: readDetail(response?.data)
    };
  }
}
```

3c. `lcuGetJson` 改成走 `createLcuClient`（`iconAssets.ts:404-417`）：

```ts
/** GET 一次客户端的 JSON 接口。 */
async function lcuGetJson(auth: LcuAuth, url: string): Promise<unknown | null> {
  try {
    // url 是相对路径('/lol-game-data/...') —— 必须有 baseURL 才能拼成绝对地址。
    // 之前这里用裸 axios.get(相对路径),axios 在 Node 端会直接抛 Invalid URL,
    // 元数据一次都没加载成功过。
    const client = createLcuClient(auth);
    const { data } = await client.get(url, {
      timeout: LCU_TIMEOUT_MS,
      validateStatus: (status) => status === 200
    });
    return data;
  } catch {
    return null;
  }
}
```

3d. 3b/3c 改完之后,`basicAuthHeader`（`iconAssets.ts:419-421`）没人用了,
`import * as https from 'node:https'`（`iconAssets.ts:22`）也没人用了 ——
**两个都删掉**,否则 eslint 会报未使用。

> `fetchDdragonImage`（`iconAssets.ts:511`）用的是裸 `axios.get`,**保持原样** ——
> 它拉的是 Data Dragon 公网 CDN,用户装了代理软件时恰恰应该走代理。

3e. 顺带修 `src/main/match/liveClient.ts:40` 的同一个坑 ——
Live Client Data API（2999 端口）也是本机回环,裸 `axios.get` 一样会被代理截走:

```ts
    const response = await axios.get(`${LIVE_CLIENT_BASE}/liveclientdata/allgamedata`, {
      httpsAgent: LIVE_CLIENT_AGENT,
      timeout: timeoutMs,
      validateStatus: () => true,
      // 本机回环请求不能走代理 —— 装了代理软件的机器上,代理会直接接管这个请求。
      proxy: false
    });
```

- [ ] **Step 4: 改 `src/main/match/__tests__/poller.test.ts`**

4a. 把 `vi.mock('../../lcu', ...)` 换成带 `summary` / `code` 的错误类:

```ts
vi.mock('../../lcu', () => {
  // 默认值跟真实实现一样是中文 —— describeError 优先读 summary,
  // 这里要是留英文,'未检测到游戏客户端' 那句人话就没了。
  class LcuNotRunningError extends Error {
    readonly code: string;
    readonly summary: string;
    constructor(
      message = '未检测到游戏客户端,请先启动它。',
      code = 'client-not-running',
      summary = message
    ) {
      super(message);
      this.name = 'LcuNotRunningError';
      this.code = code;
      this.summary = summary;
    }
  }
  class LcuUnreachableError extends Error {
    readonly code: string;
    readonly summary: string;
    constructor(
      message = '游戏客户端端口已失效(客户端重启过),请重新启动客户端。',
      code = 'unknown',
      summary = message
    ) {
      super(message);
      this.name = 'LcuUnreachableError';
      this.code = code;
      this.summary = summary;
    }
  }
  return {
    LcuNotRunningError,
    LcuUnreachableError,
    resolveLcuAuthAsync: vi.fn(),
    createLcuClient: vi.fn(() => ({ get: vi.fn() })),
    setSharedLcuAuth: vi.fn(),
    getSharedLcuAuth: vi.fn(() => null),
    invalidateSharedLcuAuth: vi.fn()
  };
});
```

4b. `beforeEach` 里的 auth mock 换成完整形状:

```ts
authMock.mockResolvedValue({
  port: 1234,
  token: 'tok',
  protocol: 'https',
  host: '127.0.0.1'
});
```

4c. 在 `describe('MatchPoller')` 里加一个用例:

```ts
  it('错误优先显示裁决层给的中文结论', async () => {
    const err = new Error('raw');
    (err as unknown as { summary: string; code: string }).summary =
      '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。';
    (err as unknown as { summary: string; code: string }).code = 'not-cn-client';
    authMock.mockRejectedValue(err);
    const poller = new MatchPoller();
    const snapshot = await poller.refreshNow();
    expect(snapshot.lastError).toContain('国际服');
  });
```

- [ ] **Step 5: 跑全量测试**

Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 6: 跑类型检查与 lint**

Run: `npm run typecheck`
Expected: 无输出(通过)。

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 7: 提交（不自动执行）**

```bash
git add src/main/match/poller.ts src/main/match/iconAssets.ts src/main/match/liveClient.ts src/main/match/__tests__/poller.test.ts
git commit -m "fix(lcu): 轮询器与图标代理适配新的客户端凭据结构"
```

---

### Task 10: 全量验证

**Files:** 无改动 —— 这一步只跑命令。

- [ ] **Step 1: 跑全量单测**

Run: `npx vitest run`
Expected: 全部通过,0 failed。

- [ ] **Step 2: 跑类型检查**

Run: `npm run typecheck`
Expected: 无输出(通过)。

- [ ] **Step 3: 跑 lint**

Run: `npm run lint`
Expected: 无输出(通过)。

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 构建成功,`out/` 下产出 main / preload / renderer 三份。

- [ ] **Step 5: 打包(可选,确认 Windows 打包链路没被弄坏)**

Run: `npm run pack`
Expected: 在 `release/` 下产出 `.exe`。

> 如果 `npm run pack` 报签名/下载相关的错误,那是环境问题(没装代码签名证书 / electron-builder 缓存没就绪),与本次改动无关 —— 记下来就行,别在这上面耗时间。

- [ ] **Step 6: 手工验收清单(需要用户在自己装了国服客户端的机器上跑)**

本机没有装英雄联盟客户端,这一段没法自动验证。请在有客户端的机器上装好本分支后逐条走:

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 国服客户端开着(已进大厅),点「检测客户端」 | 状态点变绿,提示「游戏客户端已连接」 |
| 2 | 完全退出客户端,点「检测客户端」 | 状态点变灰,提示「没检测到英雄联盟客户端 —— 先打开客户端(进到大厅)再点检测。」 |
| 3 | 客户端刚启动、还停在登录界面,点检测 | 提示「找到了客户端但它还没准备好 —— 等 5 秒再点检测。」 |
| 4 | 装的是国际服客户端 | 提示「装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。」 |
| 5 | **开着 Clash / v2rayN 等代理软件**,重复场景 1 | 仍然检测成功(这条专门验 `proxy: false`) |
| 6 | 客户端装在非默认盘(如 `E:\wegameapps\英雄联盟\`) | 点「检测客户端」(深检测)能成功 |
| 7 | 客户端装在非常规路径(比如 `D:\Games\LOL\`) | 浅检测失败、深检测成功;若仍失败,提示「没在常见位置找到客户端 —— 可能装在非标准位置。」 |
| 8 | 打开开发者面板 → 「复制诊断信息」 | 剪贴板里能看到「客户端诊断明细」段落,每条通道各有结果 |
| 9 | 点「读取我的皮肤」 | 能读出已拥有皮肤(证明 `createLcuClient` 改签名后连接层还通) |
| 10 | 深检测成功过一次之后,不点任何按钮,直接「读取我的皮肤」 | 也能读出来 —— 扫盘找到的路径已经进了路径缓存(C4),浅检测靠它命中 |
| 11 | 开着代理软件时点「读取我的皮肤」 | 也能读出来 —— 图标代理和 Live Client 都补了 `proxy: false` |

- [ ] **Step 7: 收尾 —— 不要自动提交**

所有改动留在工作区,让用户自己看过 diff 之后提交。本计划的所有 **Step: 提交** 都只是命令清单,不是执行指令。

如果需要一次性提交,建议按 Task 分组,而不是每个 Step 一次提交:

```bash
git add src/main/lcu src/main/lcu.ts
git add src/main/ipc.ts src/main/__tests__/ipc.test.ts src/preload/index.ts
git add src/renderer/src/views/Sync.vue src/renderer/src/components/DevPanel.vue
git add src/main/match/poller.ts src/main/match/iconAssets.ts src/main/match/liveClient.ts src/main/match/__tests__/poller.test.ts
git status
```

---



