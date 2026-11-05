# LCU 客户端检测：候选池 + 实测裁决

日期：2026-11-05
状态：设计已确认，待实施

## 1. 背景

`local_skin_importer`（Electron + TS）的核心功能是**读取玩家已拥有的皮肤并同步到后端**。
数据来源只有一个：英雄联盟客户端（LCU）的本地 REST 接口。

检测客户端的方式目前有两条：

| 通道 | 实现 | 现状 |
| --- | --- | --- |
| 进程命令行 | PowerShell `Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'"` | 能抠出国服的 `--app-port` / `--remoting-auth-token`；但**多实例时把所有命令行拼成一段**，端口和 token 可能配错对（§2.3） |
| lockfile | 读 `%LOCALAPPDATA%\Riot Games\League of Legends\lockfile` | 2026-11-05 补了「exe 目录下的 lockfile」兜底 —— 仍只是又一条猜测的路径 |

两条都失败 → 界面上一个灰点，**不告诉用户为什么**。用户反馈"检测不到客户端"时，
能拿到的信息只有"没检测到"，没有任何可操作的结论。

## 2. 问题清单

按影响面排序：

### 2.1 `createLcuClient` 没关代理（最可能造成"同一台机器有人能检测有人不能"）

axios 默认读 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` 环境变量。用户机器上装了代理/VPN
（国服用户很常见）时，发往 `https://127.0.0.1:<port>` 的请求也会被丢给代理，
代理当然连不上用户本机的回环端口 → 必挂。修法是一行 `proxy: false`。

### 2.2 lockfile 路径只认一条硬编码路径

国服用腾讯 WeGame 装在 `E:\wegameapps\英雄联盟\LeagueClient\` 这种非默认位置，
`%LOCALAPPDATA%\Riot Games\...` 根本不存在。2026-11-05 已补了一条兜底
（从 `LeagueClientUx.exe` 的 `ExecutablePath` 推导 lockfile 位置），但那只是又一条猜测 ——
**没有任何一条路径是被验证过的**，而且改一次路径就要改一次代码。

### 2.3 多实例时端口和 token 可能配错对（真 bug）

现在的实现把**所有** `LeagueClientUx.exe` 进程的命令行**拼成一整段**再正则匹配：

```ts
function commandLinesOf(processes: LcuProcessInfo[]): string {
  return processes.map((p) => p.commandLine).join('\n');
}
// 然后对整段跑 /--app-port=(\d+)/ 和 /--remoting-auth-token=([\w-]+)/
```

客户端正常会起多个 `LeagueClientUx.exe`。拼起来之后，`--app-port` 可能来自 A 进程、
`--remoting-auth-token` 来自 B 进程 —— **端口和 token 来自不同进程，必然连不上**。
必须**每条命令行独立解析**。

### 2.4 失败只有两态，用户只能猜

`LcuNotRunningError` → 灰点，其它 → 红点。但下面四种情况的修法完全不同：

| 真实原因 | 现在的表现 | 现在的提示 | 用户该做什么 |
| --- | --- | --- | --- |
| 客户端没启动 | 灰 | 「未检测到游戏客户端，请先启动它。」 | 先打开客户端 |
| 客户端刚启动，端口还没监听 | 红 | 「端口已失效（客户端重启过），请重新启动客户端。」 | **等 5 秒**再试 |
| 客户端重启过，token 换了 | 红 | 「端口已失效（客户端重启过），请重新启动客户端。」 | 点检测重试 |
| 系统代理把本机请求拦了 | 红 | axios 的原始报错 | 关掉代理 |

两个问题：

1. **红点里的建议是错的** —— 「客户端正在启动」被说成「端口已失效，请重新启动客户端」，
   用户照做等于白重启一次。
2. **四种情况压成两态**，用户只能靠猜。代理拦截这一项尤其隐蔽：
   报错是 axios 的 `ECONNREFUSED` 之类，跟"客户端没开"长得一样。

### 2.5 中文路径在 PowerShell 管道重定向下可能乱码

国服安装路径带中文（`英雄联盟`）。当前靠 `[Console]::OutputEncoding = UTF8` 兜底，
但管道重定向时的编码行为跟控制台代码页有关，是个变量。

### 2.6 国际服用户和「没装客户端」的用户看到一样的提示

国服 WeGame 的 `LeagueClientUx.exe` 同时带两对参数，但 `--riotclient-*` 那对服务的是
Riot Client API，拿它请求游戏端点会 **404** —— 跟「端口被别的程序占了」的表现一模一样。

用户看到「端口已失效」只会去反复重开客户端，而真正的原因是「你装的是国际服」。
本工具只支持国服，所以这类用户应该得到一句**明确指向原因**的话（§6.2 的 `not-cn-client`），
而不是一个没法执行的提示。

## 3. 目标与边界

**目标**：让「装了**国服**英雄联盟客户端的 Windows 10/11 x64 用户」都能被检测到，
并且在检测不到时得到一句能照着做的中文结论。

**只做国服。** 国际服不在支持范围内 —— 但要能**认出来**并明确告诉用户
「你装的是国际服客户端」，而不是让这类用户反复重开客户端（见 §6.2 的 `not-cn-client`）。

**边界（明确不做）**：

- **不支持国际服**（Riot 客户端 / Steam 版），但要识别并提示（§6.2）。
- 不做 macOS / Linux —— 打包只出 win x64（`electron-builder.yml`）。
- 不动 Live Client（游戏内 `https://127.0.0.1:2999`）—— 那是另一套系统、另一套失败模式，
  合并会把范围撑爆。
- 不引入原生依赖（ffi / better-sqlite3 之类）—— 纯 Node + PowerShell 足够。
- **token 不落盘**（见 §5.5）。
- 不做"让用户手填 port + token"的兜底入口。

## 4. 架构：候选池 + 实测裁决

核心判断：**多试一条候选路径的成本几乎为零**（一次 `readFile`），所以正确的策略是
「宁可多列候选，也不要漏」。

这条推论化解了本设计最关键的约束 —— **无法实地验证各发行版的 lockfile 真实路径**。
在候选池模式下，路径猜错的后果只是"多一条无效候选"，而不是"检测失败"。
最终判据始终是"这个 port + token 能不能真的读到账号"，而不是"我猜的路径对不对"。

```
┌─ 发现层（无裁决）─────────────────────────────────────┐
│ channels.ts                                          │
│  C1 进程命令行   C2 lockfile 候选集   C3 磁盘扫描      │
│  C4 落盘路径缓存   C5 内存凭据缓存                      │
│  职责只有一个：吐出候选，不管用哪个                     │
└───────────────────────┬──────────────────────────────┘
                        │ LcuCandidate[] { host, port, token, protocol, source }
                        │ + 每个通道的「有没有活进程」信号
┌───────────────────────▼──────────────────────────────┐
│ 裁决层 credentials.ts                                │
│  去重 → TCP 探活 → 真请求验证 → 第一个通过的胜出        │
│  全挂 → 生成诊断（分类 + 逐通道明细）                    │
│                                                     │
│  两个入口，差别只在「要不要扫盘」：                       │
│   detectLcu()        快通道，不扫盘，永不抛异常          │
│   detectLcuDeep()    快通道全挂再扫盘，永不抛异常        │
└───────────────────────┬──────────────────────────────┘
                        │ { host, port, token, protocol }
┌───────────────────────▼──────────────────────────────┐
│ 连接层 client.ts                                     │
│  proxy:false / 自签证书 / 按 protocol 选 http(s)        │
└──────────────────────────────────────────────────────┘
```

**裁决层永不抛异常**，统一返回 `{ ok: true, auth }` 或 `{ ok: false, code, summary, diagnosis }`。
现有的 `resolveLcuAuth()` / `resolveLcuAuthAsync()` 保留，改为这个结果的**兼容包装** ——
再把结果翻译成现有的 `LcuNotRunningError` / `LcuUnreachableError` 抛出去。
`poller.ts`、`match/iconAssets.ts` 这些既有调用点的控制流因此不用改。

### 4.1 为什么不是"分层降级链"

分层链（进程命令行 → lockfile → 扫描，每层失败才走下一层）改动更小，
但**优先级本身就是错的来源**：lockfile 里的端口可能是上一轮的旧值，进程命令行才是新的。
现在的 `pickAliveCandidate` 探活就是在给这个错误结构打补丁。再加两层只会让补丁更厚，
而且每一层的顺序都要手工论证。候选池不需要论证顺序 —— 它问的是"谁能连上"。

### 4.2 为什么不是"进程命令行单一真源"

凭据永远最新，但它把整条链押在 PowerShell 上。PowerShell 被执行策略禁用、
精简版 Windows 上没有它，整条链就废了 —— 而 lockfile 那条通道纯文件系统，
不依赖任何外部进程，能独立兜住。

## 5. 发现通道

### 5.1 通道清单

| # | 通道 | 产出 | 依赖 | 角色 |
| --- | --- | --- | --- | --- |
| C1 | 进程命令行 | host + port + token（**每个实例各一条**）+ exe 目录 | PowerShell | 国服主力 |
| C2 | lockfile 候选集 | host + port + token | 文件系统 | 国服主力 |
| C3 | 磁盘扫描 | 安装目录 → 喂给 C2 | 文件系统 | 兜底 |
| C4 | 落盘路径缓存 | 上次扫到的 lockfile 路径 | 本地文件 | 加速 |
| C5 | 内存凭据缓存 | 上次成功的 host + port + token | 内存 | 秒开 |

**没有注册表通道。** 原来设想的 C3（查 `Software\Riot Games\League of Legends`
的 InstallPath）已删 —— 那是 Riot 客户端的键，国服 WeGame 装的时候不写它，
留着只是白背一套 `reg.exe` 解析和一组测试。国服的安装位置靠 C1 的 exe 路径
（进程就在那儿，exe 目录 100% 准）+ C2 的候选集 + C3 的磁盘扫描就够了。

C1 与 C2 **互不依赖**：PowerShell 通道整体失败时，lockfile 通道还活着。

### 5.2 C1 进程命令行

**每条命令行独立解析**（修 §2.3 的 bug）：

```ts
// 每个 LeagueClientUx.exe 进程 → 各自产出一对 (port, token)
export interface LcuProcessInfo {
  executablePath: string;
  commandLine: string;
}
```

命令行参数形状：

| 发行版 | 参数对 | 服务什么 |
| --- | --- | --- |
| **国服 WeGame（主力）** | `--app-port` + `--remoting-auth-token` | **LCU 游戏 API**（要的就是这个） |
| 国服 WeGame | 同时也带 `--riotclient-app-port` + `--riotclient-auth-token` | Riot Client API —— **不是我们要的**，见下 |
| 国际服（不支持） | 只带 `--riotclient-app-port` + `--riotclient-auth-token` | Riot Client API |

**国服优先**：国服 WeGame 的 `LeagueClientUx.exe` **两对参数都带**，
`--app-port` + `--remoting-auth-token` 那对服务的是 LCU 游戏 API ——
这才是我们要的。`--riotclient-*` 那对服务的是 Riot Client API
（`/rso-auth/v1/...` 之类），拿它去请求游戏端点会 **404**。

所以解析规则：

1. **先找 `--app-port` + `--remoting-auth-token`** —— 找到就是国服凭据，直接用。
2. 只有 `--riotclient-*` 那对 → 这不是国服客户端。**仍然作为最后一个候选去实测**
   （一次探测的事），如果它连的是 Riot Client API（游戏端点 404），
   就报 `not-cn-client`（§6.2），明确告诉用户「你装的是国际服客户端」。

第 2 条为什么不干脆丢掉那对参数：国际服用户看到「没检测到客户端」会以为是自己
客户端没开，反复重开白费功夫。实测一下就能给出准确结论 —— 这符合本设计的核心原则
「让实测说话，不靠猜」。

另外解析 `--remoting-host`（客户端不一定只听 127.0.0.1）；取不到就默认 `127.0.0.1`。
lockfile 里没有 host 字段，也默认 `127.0.0.1`。

**输出走 base64 传输**（修 §2.5）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" |
  ForEach-Object {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(
      $_.ExecutablePath + [char]31 + $_.CommandLine))
  }
```

每个进程一行 base64（内含 `\u001F` 分隔 exe 路径与命令行）。Node 侧逐行 base64 解码 → UTF-8 →
按 `\u001F` 拆两段。base64 是纯 ASCII，任何控制台代码页下都不失真。

**进程名**：只查 `LeagueClientUx.exe`。国服和国际服同名，WeGame 版的主体进程
也是这个名。不查 `RiotClientServices.exe` —— 它是 Riot 客户端的，跟国服游戏客户端无关。

### 5.3 C2 lockfile 候选集

lockfile 格式：`LeagueClientUx:<pid>:<port>:<password>:<protocol>`，
port 是第 3 段、password 是第 4 段、protocol 是第 5 段（`https` 正常，`http` 为老客户端）。

候选路径（每条只是一次 `readFile`，多列无害；国服路径在前）：

```
<exe目录>\lockfile                                             国服 WeGame 实测在这个位置
<exe目录>\..\lockfile              <exe目录>\..\..\lockfile   有的版本写在上一层
<任意盘>\WeGameApps\rail_apps\英雄联盟\lockfile               国服布局（未验证，列进去成本为零）
<任意盘>\wegameapps\英雄联盟\lockfile
<任意盘>\wegameapps\英雄联盟\LeagueClient\lockfile
%LOCALAPPDATA%\Riot Games\League of Legends\lockfile          国际服（国服用不上，但一次 readFile 的成本，留着不亏）
%ProgramFiles%\Riot Games\League of Legends\lockfile          老独立安装器（国际服）
```

`<exe目录>` 来自 C1 的 `ExecutablePath` —— 进程在哪儿，exe 目录就一定对，
这条比任何硬编码路径都准。C1 挂了才轮到后面那几条静态路径兜底。

**半写状态要容忍**：客户端正在写 lockfile 时读出来可能不是 5 段。解析失败时重试几次
（间隔 200ms，最多 3 次），而不是直接判这条候选无效。

### 5.4 C3 磁盘扫描

**触发条件严格**：磁盘扫描**不属于凭据解析**，只有 `detectLcuDeep()` 会跑它，
而 `detectLcuDeep()` 只由**用户显式点「检测客户端」**这个动作调用。

为什么不放在 `resolveLcuAuth()` 里：`poller.ts` 的 2 秒轮询器（`POLL_INTERVAL_MS = 2000`）
调的是 `resolveLcuAuthAsync()`，客户端没开时它会按 `AUTH_RETRY_MS`（10 秒）的间隔重试。
把扫描塞进去，等于主进程**每 10 秒就扫一次全盘**（20s 预算）—— 扫描比重试间隔还长，
主进程被扫描占死，界面直接卡住。

两条进一步的收敛：

- 判定为 `client-starting`（**有**活进程但端口没起来）→ **不扫**，客户端本来就在那儿，
  扫了也没用。
- 判定为 `client-not-running`（无活进程）→ 扫一次，三种收场：
  - 扫到凭据 → 直接成功
  - 扫到路径但没凭据 → 把路径写进 C4 缓存，仍判 `client-not-running`
  - 扫描超时 → 改判 `scan-timeout`（比"没检测到客户端"更有信息量，
    见 §6.2 的判定顺序）

**双重校验**（这是必须的）：

> 父目录名 ∈ {`LeagueClient`, `英雄联盟`, `WeGameApps`, `wegameapps`, `rail_apps`}
> **且** 内容能解析成合法的 5 段 lockfile

理由很实在：开发机上就存在 `AppData\Local\Google\Chrome\User Data\lockfile`。
无脑扫 `lockfile` 会命中垃圾文件。目录名 + 内容格式两道关才能滤掉。

**路径剪枝替代深度上限**：BFS 从各已存在盘符根开始，只进入两类目录 ——

- 目标目录：名字匹配 `英雄联盟` / `LeagueClient` / `WeGameApps` / `wegameapps` / `rail_apps`
- 容器目录：`Program Files` / `Program Files (x86)` / `Users` / `ProgramData` /
  `games` / `Games` / `app` / `soft` / `腾讯游戏`

其它目录不进。不限深度，但有总时间预算：**单盘 15s / 总 20s**，跑在后台，可取消。

### 5.5 C4 / C5 缓存

- **C5 内存凭据缓存**：`{ host, port, token, protocol, at }`。客户端重启会换 port / token，
  所以带时间戳，**超过 60s 降权**（排到最后试）。裁决器对每个候选都要实测验证，
  所以缓存过期了也不会用错 —— 最多浪费一次探测。
- **C4 落盘路径缓存**：**只落路径**（lockfile 位置、安装目录），
  存在 `app.getPath('userData')` 下的小 JSON 里。
  **token 绝不落盘** —— 它是凭据，落盘等于泄露到磁盘上。代码里要显式约束住这条。

## 6. 裁决与诊断

### 6.1 裁决流程

候选按 `host + port + token` 去重后，探测顺序：

```
C5 内存缓存（60s 内） → C1 国服命令行 → C2 lockfile 候选集 → C4 路径缓存
  → C5 内存缓存（超期） → C1 国际服命令行（最低优先级）
```

- **C3 磁盘扫描不在这个序列里** —— 它是 `detectLcuDeep()` 的后置步骤，见 §5.4。
- **国际服命令行排最后**：它服务的是 Riot Client API，去请求游戏端点基本必然 404。
  但实测一次的成本只是几百毫秒，换来的是「你装的是国际服客户端」这个准确结论
  （§6.2 的 `not-cn-client`），值得。
- **超期的 C5 排在国际服前面**：它至少是上一次**成功**过的凭据，
  只是端口可能换了，过期最多浪费一次探测（每个候选都要实测，不会用错）。

每个候选两步：

1. **TCP 探活** `host:port`（默认 `127.0.0.1`，1s 超时）—— 死了直接跳过
2. 活着 → **`GET /lol-summoner/v1/current-summoner`**（3s 超时）

第 2 步的五种结果互斥，穷举如下：

| HTTP 结果 | 含义 | 记为 |
| --- | --- | --- |
| `200` + 结构符合预期 | 凭据有效 | **胜出** |
| `200` + 结构不符合预期 | 连上了但不是 summoner 接口 | `not-a-lcu` |
| `404` | 连到了 Riot Client API（它对游戏端点返回 404） | `not-a-lcu` |
| `401` / `403` | 端口对、token 错 | `stale-credentials` |
| 超时 / 连接错误 / 其它 5xx | 端口在监听但服务没就绪 | `not-ready` |

`not-ready` 不是一种失败分类，它是**中间信号**：端口活着但服务没起来，
和「有活进程但端口全死」是同一个处境 —— 都归到 `client-starting`
（无活进程时归 `client-not-running`）。

**`not-a-lcu` 的两种含义要分开**：如果那个候选来自**国服**命令行，
404 说明"连的不是游戏客户端接口"（端口被别的程序占了之类）；
如果来自**国际服**命令行，404 恰恰是预期结果 —— 说明这是国际服客户端，
改判 `not-cn-client`。所以候选要带一个 `origin` 标记（见 §6.4）。

全挂 → 生成诊断。

### 6.1.1 判定必须看「有没有活进程」

**客户端退出时不删 lockfile**，所以残留 lockfile 里的旧端口探活必然失败。
光看探活结果，区分不出这两种情况：

| 情形 | 正确结论 |
| --- | --- |
| 客户端刚启动，lockfile 已写但端口还没监听 | `client-starting`（红，等它起） |
| 客户端早就退出了，lockfile 是上次运行的残留 | `client-not-running`（灰） |

两者探活结果**完全一样**（端口都是死的）。所以裁决层必须额外拿到
**「C1 有没有找到活的 `LeagueClientUx.exe` 进程」**这个信号：

- **有活进程** + 端口全死 → `client-starting`
- **无活进程** + 只剩残留 lockfile → `client-not-running`

因此通道报告里要带这个信号（类型定义见 §6.4），判定规则见 §6.2。

### 6.2 失败分类

| code | 触发条件 | 颜色 | 一句话结论（中文） |
| --- | --- | --- | --- |
| `client-not-running` | 无活进程 + 无可用凭据（含只有残留 lockfile、端口活着但服务没就绪的情况） | **灰** | 没检测到英雄联盟客户端 —— 先打开客户端（进到大厅）再点检测 |
| `client-starting` | **有**活进程，但所有候选端口都没能拿到有效凭据 | 红 | 找到了客户端但它还没准备好 —— 等 5 秒再点检测 |
| `stale-credentials` | 端口活着但 401/403（至少有一个端口活过） | 红 | 客户端重启过、凭据失效 —— 点检测重试 |
| `not-cn-client` | 只找到 `--riotclient-*` 那对参数，实测确认是 Riot Client API | 红 | 装的是国际服客户端 —— 本工具只支持国服，请装国服客户端 |
| `not-a-lcu` | 端口活着、认证没被拒，但响应不是预期的 summoner（**且候选来自国服命令行**） | 红 | 连上的不是游戏客户端接口 —— 可能是端口被别的程序占用 |
| `scan-timeout` | 磁盘扫描确实跑过且超时（还没找到任何凭据） | 红 | 没在常见位置找到客户端 —— 可能装在非标准位置 |
| `unknown` | 其它 | 红 | 检测失败 —— 看开发者面板 |

分类规则的判定顺序（**先判特殊的，再判兜底的**，避免一个 case 落进两个桶）：

```
1. 有任一候选拿到有效凭据            → 成功（不进分类表）
2. 有任一候选 401/403                → stale-credentials
3. 国际服候选实测出 404/结构不对      → not-cn-client
4. 有任一国服候选 200/404 但内容不对  → not-a-lcu
5. 有活进程                          → client-starting
6. 磁盘扫描确实跑过且超时             → scan-timeout
7. 无活进程                          → client-not-running
8. 其它                             → unknown
```

规则 3 在规则 4 之前：国际服候选的 404 是**预期结果**，不能跟国服候选的 404
混在一个桶里，否则国际服用户会看到「连上的不是游戏客户端接口」这种没法执行的提示。

「客户端没启动」是**正常状态**，灰点不是红点 —— 这跟现状一致，要保住。
真正要改的是另外几种：它们现在全是红点，而且提示是误导的（§2.4）。

`stale-credentials`、`not-cn-client`、`not-a-lcu` 的共同前提是「至少有一个端口活着」——
端口全死的话就是 `client-starting` 或 `client-not-running`。

### 6.3 对外接口形态

裁决层不抛异常，返回一个联合类型：

```ts
export type LcuDetectionResult =
  | { ok: true; auth: LcuAuth }
  | { ok: false; code: LcuFailureCode; summary: string; diagnosis: LcuDiagnosis };
```

`LcuAuth` 加 `protocol` 和 `host` 两个字段（现有的是 `{ port, token }`）：

```ts
export interface LcuAuth {
  port: number;
  token: string;
  protocol: 'http' | 'https';   // lockfile 第 5 段；命令行来源默认 https
  host: string;                 // 命令行的 --remoting-host；lockfile 来源默认 127.0.0.1
}
```

加字段是**向后兼容**的：现有 `LcuAuth` 的消费方（`getSharedLcuAuth`、
`poller.ts` 的缓存、`match/iconAssets.ts`）只读 `port` / `token`，
多两个字段不影响它们。

`resolveLcuAuth()` / `resolveLcuAuthAsync()` 保留为兼容包装，把失败结果翻译成现有的
`LcuNotRunningError` / `LcuUnreachableError` 再抛出去。既有调用点
（`poller.ts`、`match/iconAssets.ts`、`lcu:fetch-skins`）的**控制流不用改**，
只有 `createLcuClient` 的签名要跟着换（§7.2）。

映射关系：

| `LcuFailureCode` | 翻译成的异常 |
| --- | --- |
| `client-not-running` | `LcuNotRunningError` |
| `client-starting` / `stale-credentials` / `not-cn-client` / `not-a-lcu` | `LcuUnreachableError` |
| `scan-timeout` / `unknown` | `LcuUnreachableError` |

现有 `LcuNotRunningError` / `LcuUnreachableError` 两个类**保留不动** ——
`ipc.ts` 的 `normalizeLcuError`、`poller.ts` 的 `describeError` / `isAuthStale`、
`ipc.test.ts` 的 mock 都依赖它们。

**但异常上必须挂 `code` 和 `summary`**，否则新分类到不了用户眼前：

```ts
export class LcuUnreachableError extends Error {
  readonly code: LcuFailureCode;
  readonly summary: string;
  constructor(message: string, code: LcuFailureCode = 'unknown', summary = message) { ... }
}
```

原因很实在：`poller.ts:75-82` 的 `describeError` 现在只有两句话 ——
`LcuNotRunningError` →「未检测到游戏客户端，请先启动它。」、
`LcuUnreachableError` →「游戏客户端端口已失效（客户端重启过），请重新启动客户端。」。
`client-starting`（客户端正在启动）若也归 `LcuUnreachableError`，
用户会看到「端口已失效，请重新启动客户端」—— **建议是错的**。

所以：
- `poller.ts` 的 `describeError` 改成**优先用 `e.summary`**，没有才退回旧的两句话。
- `ipc.ts` 的 `normalizeLcuError` 同理，message 用 `summary`。
- `lcu:fetch-skins` 失败时的 message 也用 `summary`。

这样「检测」和「获取皮肤」两处给用户的结论一致，
不会一个说「未检测到客户端」另一个说「端口已失效」。

### 6.4 诊断明细

```ts
export interface LcuChannelReport {
  source: 'process' | 'lockfile' | 'disk-scan' | 'cache' | 'memory';
  ok: boolean;
  /**
   * 这个通道有没有找到「活着的客户端进程」。
   * 判定 client-starting vs client-not-running 用（见 §6.1.1）。
   * 只有 C1 能为 true，其余通道恒为 false。
   */
  liveProcess: boolean;
  detail: string;        // 这个通道干了啥 / 为什么失败
  candidates: {
    port: number;
    origin: 'cn' | 'riot';   // 这对参数是国服的还是 Riot 客户端的（见 §6.1）
    probe: 'alive' | 'dead' | 'unauthorized' | 'not-lcu' | 'not-ready';
  }[];
  paths?: string[];      // 试过的路径
}

export interface LcuDiagnosis {
  code: LcuFailureCode;
  summary: string;       // 一句话结论
  channels: LcuChannelReport[];
  environment: { proxyVars: string[]; localAppData: string; electron: string; node: string };
}
```

界面呈现：**主界面 tooltip 给一句话结论**，逐通道明细放进已有的开发者面板
（`DevPanel.vue`，那里已经有「复制诊断信息」，把这份 JSON 塞进去即可，不新增界面元素）。

## 7. 连接层

### 7.1 `proxy: false`

axios 实例加 `proxy: false`，绕开 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY`。
这是本次最可能一次性修好一批用户的原因。

### 7.2 按 protocol 选 http(s) 与 host

`createLcuClient` 现在硬编码 `https://`。lockfile 第 5 段就是 protocol 字段
（`https` 正常，`http` 为老客户端）；进程命令行来源没有这个字段，默认 `https`。

签名从 `createLcuClient(port, token)` 改成 `createLcuClient(auth: LcuAuth)` ——
host 和 protocol 都得从 auth 里来，散成位置参数迟早漏传。
4 个调用点要改：`ipc.ts:137`、`ipc.ts:160`、`poller.ts:360`、`match/iconAssets.ts:472`。

### 7.3 TLS

`rejectUnauthorized: false` 保留（客户端自签名）。
`minVersion` 不动 —— Node 22 默认 TLS 1.2，LCU 支持；真撞上 TLS 失败再降级，不预先放宽。

## 8. 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/main/lcu/types.ts` | 新增：`LcuCandidate` / `LcuDiagnosis` / `LcuFailureCode` / `LcuChannelReport` / `LcuDetectionResult` |
| `src/main/lcu/parse.ts` | 新增：纯解析函数（lockfile / 命令行 / PowerShell 输出），无 IO |
| `src/main/lcu/channels.ts` | 新增：五条通道的 IO 实现 |
| `src/main/lcu/credentials.ts` | 新增：编排 + 裁决 + 诊断生成 |
| `src/main/lcu/client.ts` | 新增：HTTP 客户端（proxy / TLS / protocol）+ 端点调用 |
| `src/main/lcu/scan.ts` | 新增：磁盘扫描（目录剪枝 + 双重校验 + 时间预算） |
| `src/main/lcu.ts` | 改：瘦身为 barrel，只做 `export * from './lcu/...'` |
| `src/main/__tests__/lcu.test.ts` | 迁移到 `src/main/lcu/__tests__/`，按模块拆 |
| `src/main/__tests__/ipc.test.ts` | 改：它 mock 了整个 `../lcu` 模块，`lcu:check-status` 返回结构一变就得跟着改 |
| `src/main/match/poller.ts` | 改：`ensureAuth()` 改调新的裁决入口，异常类型保持不变（`LcuNotRunningError` / `LcuUnreachableError`）；`describeError` 优先用 `e.summary` |
| `src/main/match/iconAssets.ts` | 改：`createLcuClient(auth)` 新签名 |
| `src/main/ipc.ts` | 改：`lcu:check-status` 返回结构换成 `{ running, code, summary, diagnosis }` |
| `src/preload/index.ts` | 改：`LcuStatus` 类型跟着换 |
| `src/renderer/src/views/Sync.vue` | 改：tooltip 用 `summary`，颜色按 `code` 分灰/红；「检测客户端」按钮走 `detectLcuDeep()`（`Sync.vue:11` 的 `onCheckLcu`） |
| `src/renderer/src/components/DevPanel.vue` | 改：诊断明细进「复制诊断信息」 |

**`src/main/lcu.ts` 保留成 barrel，不删** —— 现有代码里有
`import * as lcu from './lcu'`（`ipc.ts`、`match/poller.ts`、`match/iconAssets.ts` 等），
删掉文件、只留 `src/main/lcu/index.ts` 的话，`'./lcu'` 会隐式解析到目录的 index，
能用但依赖解析器行为。保留 barrel 让解析规则显式且不受 bundler 影响。
（`lcu.ts` 文件与 `lcu/` 目录同名共存没有冲突 —— 相对路径 `'./lcu'` 优先命中文件。）

## 9. 测试

`src/main/lcu/__tests__/`：

- **`parse.test.ts`** —— 纯函数，无 IO：
  - lockfile 解析（正常 / 字段数不对 / 端口非法 / token 空）
  - **每条命令行独立解析**：给两个进程的命令行，断言产出两个独立的候选，
    且 `--app-port` 与 `--remoting-auth-token` 不跨进程配对（§2.3 的回归用例）
  - **国服优先**：同一条命令行同时带两对参数时，产出的是国服候选（`origin: 'cn'`）
  - **只带 `--riotclient-*`** → 产出 `origin: 'riot'` 的候选
  - PowerShell base64 输出解析（含中文路径、含 BOM、空输出、只有分隔符的空记录）
- **`channels.test.ts`** —— mock `fs` / `child_process`：
  - 逐通道测产出与失败原因
  - C2 半写 lockfile 的重试
- **`credentials.test.ts`** —— 注入假通道 + 假探活 / 假 HTTP：
  - 第一个候选通过就用它
  - 第一个 401 → 试第二个 → 第二个通过 → 用第二个
  - 端口全死 + **有活进程** → `client-starting`
  - 端口全死 + **无活进程**（只剩残留 lockfile）→ `client-not-running`
  - 全空 → `client-not-running`
  - **C5 命中时断言 C3 磁盘扫描没被触发**（扫描不该白跑）
  - 端口活着但响应不对 → `not-a-lcu`
  - **国际服候选实测出 404 → `not-cn-client`**（不是 `not-a-lcu`）
  - **国服候选实测出 404 → `not-a-lcu`**（不是 `not-cn-client`）
  - **`detectLcu()` 断言磁盘扫描通道从未被调用**；`detectLcuDeep()` 断言快通道全挂后它被调用一次
  - **`detectLcuDeep()` 断言扫到的路径写进了 C4 缓存**
  - **`detectLcu()` / `detectLcuDeep()` 都不抛异常**（只返回 `{ok:false, code, summary}`）
- **`scan.test.ts`** —— 临时目录造目录树：
  - 找到深层的合法 lockfile
  - **跳过 Chrome 那种无目录名约束的 lockfile**
  - 目录名对但内容不是 5 段 → 跳过
  - 超时 → `scan-timeout`
- **`client.test.ts`** —— 断言 `proxy: false`、按 protocol 选 http/https、
  baseURL 用 auth 里的 host + port、认证头正确
- **`ipc.test.ts`**（改现有的）—— 断言 `lcu:check-status` 在失败时返回 `{ running:false, code, summary }`，
  `code` 与裁决层给的一致；`lcu:fetch-skins` 抛出的 message 与 `summary` 一致
- **`src/main/match/__tests__/poller.test.ts`**（改现有的）—— 断言 `describeError` 对
  `client-starting` 输出「等 5 秒」类文案，而**不是**旧的「端口已失效，请重启客户端」

现有 `src/main/__tests__/lcu.test.ts` 的用例**全部保留**并迁移。

## 10. 不做的事

- **不支持国际服**（Riot 客户端 / Steam 版）—— 但要识别出来并明确提示（§6.2 的 `not-cn-client`）
- 不查注册表（Riot Games 的键国服 WeGame 不写）
- 不做 macOS / Linux
- 不动 Live Client（2999）那条链路
- 不做"让用户手填 port + token"的兜底入口
- 不落盘 token
- 不做无剪枝的全盘扫描
- 不引入原生依赖
- 不预设 `minVersion` 放宽 TLS

## 11. 风险

| 风险 | 缓解 |
| --- | --- |
| 磁盘扫描比预期慢 | 后台跑 + 单盘 15s / 总 20s 预算 + 可取消 + 扫到就缓存 |
| `proxy: false` 改变现有行为 | 这是修复（之前误走代理的请求改成直连），发版说明里提一句 |
| 候选集越列越长，探测变慢 | 每个候选先 TCP 探活（极便宜），只有活着的才发 HTTP 请求 |
| 路径猜测错误 | 候选池模式下猜错只是多一条无效候选，不影响最终裁决 |
| PowerShell 输出编码 | base64 传输，绕开控制台代码页 |
| 客户端退出不删 lockfile，残留文件被当成有效凭据 | 残留端口必然探活失败；用「有无活进程」把 `client-starting` 和 `client-not-running` 分开（§6.1.1）。裁决层从不采信未实测的候选 |
| PowerShell 被策略禁用 / 精简版 Windows 缺 PowerShell | C1 与 C2 互不依赖；C2 是纯文件系统通道，不依赖任何外部进程 |
| 国服客户端若某版本只带 `--riotclient-*` 而不带 `--app-port` | 会被误判成 `not-cn-client`。缓解：国服 WeGame 的 LeagueClientUx 始终带 `--app-port` + `--remoting-auth-token`（现有代码就是这么取的）；真撞上时用户看到的是明确文案，不是静默失败 —— 可以把诊断 JSON 发上来补白名单 |
| 磁盘扫描的目录名白名单漏了国服的实际安装目录 | 白名单已含 `英雄联盟` / `LeagueClient` / `WeGameApps` / `wegameapps` / `rail_apps`；漏了只影响扫盘这一条通道，C1 的 exe 路径推导不受影响 |
