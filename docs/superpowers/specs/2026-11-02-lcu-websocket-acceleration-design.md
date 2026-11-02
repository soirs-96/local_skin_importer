# 对局助手:LCU WebSocket 事件加速 + 段位兜底

日期：2026-11-02
状态：已实施（测试与类型检查待跑）

## 1. 背景

`local_skin_importer`（Electron + TS）是 Python 版 `lol-match-data` 的移植产物。2026-11-02 对照两边的
`.git/logs/HEAD` reflog 核实过：移植方向是 Python → Electron，**没有东西被删**，但 Python 侧有两项
能力当时没跟着搬过来：

| 能力 | Python 版 | TS 版（本次之前） |
| --- | --- | --- |
| WebSocket 事件加速 | `lcu_ws.py` + `lcu_events.py`，接 `lcu-driver>=3.0` | 零 WebSocket 代码，纯 2 秒 HTTP 轮询 |
| 段位走 WS 取数 | `LCUEventSubscriber._summoner_payloads` —— **写了但没有调用点，是死代码** | 只有 HTTP 探测（`ranked.ts`） |

第一项是「Python 有、TS 没有」；第二项两边其实都不完整，Python 那份是死代码，**必须在 TS 里真正实现**。

另外还发现 TS 侧比 Python 多的东西（safeStorage 加密的 LLM Key、Data Dragon 静态数据、段位徽章本地绘制、
按 puuid 定位「我」的近期对局），这些保留不动。

## 2. 为什么这两件事重要

- **事件加速**：状态变化（进对局 / 进选人）现在最多延迟 2 秒才反映到界面。事件流推过来是即时的。
- **段位兜底**：新版客户端把 `/lol-ranked/*` 那几个 REST 端点删了。`ranked.ts` 依次探测
  `/lol-ranked/v1/current-ranked-stats`、`/lol-ranked/v{1,2,5,6}/ranked-stats/by-puuid/{puuid}`、
  `/lol-ranked/v5/ranked-stats`，再退到召唤师档案 `regalia.highestRankedEntry`。
  端点全废时只剩「最高段位徽章」这一条，信息量大幅缩水。事件流里还有完整段位。

## 3. 设计

### 3.1 新模块 `src/main/match/lcuWs.ts`

手写 WAMP v1 客户端，不引入 `lcu-driver`（那是 Python 生态的包；TS 侧 `ws` 就够）。

| 环节 | 做法 |
| --- | --- |
| 连接 | `wss://127.0.0.1:<port>/` |
| 认证 | `Authorization: Basic base64("riot:" + token)` |
| 证书 | 客户端自签名，`rejectUnauthorized: false`（凭据靠随机端口 + 一次性 token 保密） |
| 订阅 | SUBSCRIBE（opcode 5），topic = `OnJsonApiEvent`，即**全量事件流** |
| 收消息 | 形如 `[8, "OnJsonApiEvent", { uri, eventType, data }]`；opcode 8 才是事件 |
| 重连 | 指数退避 1s → 2s → 4s …… 上限 30s；**每次重连都重新取凭据**（客户端重启会换端口和 token） |
| 凭据失效 | 握手报 401/403 时回调 `onAuthRejected`，让轮询器作废缓存的凭据 |

抽象成两个可注入的口子，便于单测（不需要真的开 TLS 连接）：

```ts
export interface LcuWsSocket {
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}
export type LcuWsSocketFactory = (url: string, options: LcuWsConnectOptions) => LcuWsSocket;
```

`ws` 是运行期依赖，用 `createRequire(import.meta.url)` 加载，类型在本文件里自给自足 ——
不必为此单独装一份 `@types/ws`，也不会跟将来装的类型声明打架。

### 3.2 轮询器接入（`src/main/match/poller.ts`）

**不重构现有轮询循环**。2 秒 `setInterval` 继续留着当兜底，事件通道只是在旁边加一条「提前唤醒」的路：

```ts
private wake(): void {
  if (this.polling) {
    this.wakePending = true;   // 正在采,记一笔,采完补一轮
    return;
  }
  void this.poll();
}
```

采集过程中到来的唤醒不丢 —— 采完立刻补一轮。这跟 Python 的 `refresh_event` 等价，但不用把
`while` 循环改成事件驱动。

值得注意的事件 URI：

| URI | 为什么要 |
| --- | --- |
| `/lol-gameflow/v1/session` | 进对局 / 进选人的状态变化 |
| `/lol-champ-select/v1/session` | 选人详情变化 |
| `/lol-summoner/v1/current-summoner` | 登录的召唤师变了 |
| `/lol-ranked/*` | 段位变了 |

### 3.3 段位：HTTP 优先，WS 兜底

**HTTP 优先是刻意的**：`/lol-ranked/*` 的载荷形状稳定，还有 60 秒缓存，拿得到就没什么理由去猜事件流的形状。
WS 兜底存在的唯一理由是「新版客户端把那几个端点删了」。

```ts
private async fetchRanked(client, puuid) {
  // 缓存期内直接用；空结果也缓存，否则每 2 秒要把七八个端点挨个试一遍
  if (缓存没过期) return 有缓存 ? 缓存 : 走 WS 兜底;
  const { entries, source } = await getRankedEntries(client, puuid);
  if (entries.length > 0) { this.rankedSource = source; return entries; }
  return 走 WS 兜底;   // this.rankedSource = 'ws'
}
```

WS 兜底的段位有 **5 分钟有效期**（`WS_RANKED_TTL_MS`）：客户端推过来的本来就是最新的，
但客户端换账号、或者事件流断了很久才重连，旧段位就没意义了。

事件载荷的形状不统一（有的是队列数组、有的是 `{ queues: [...] }`、有的裹了一层 `{ data: ... }`），
所以 `extractRankedEntriesFromEvent` 依次试三种形状，试到有东西为止。

### 3.4 看得见才敢用

加速通道是隐形的 —— 接错了用户根本不知道。所以快照里加了两个字段：

| 字段 | 含义 |
| --- | --- |
| `wsStatus` | `disconnected` / `connecting` / `connected` |
| `rankedSource` | 段位来源：`'ws'` / `'summoner-profile'` / 命中的 HTTP 端点路径 / null |

界面上：

- `MatchStatusCard` 多一行「事件加速」：已连接（蓝）/ 连接中 / 未连接（并注明「按 2 秒轮询刷新」）。
- `RankedCard` 标题旁标出来源：「来源:事件流」/「来源:召唤师档案」/「来源:客户端接口」。

没连上不是故障 —— 客户端没开时就是这样，所以文案是陈述当前刷新方式，不是报错。

## 4. 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/main/match/lcuWs.ts` | 新增：WAMP v1 客户端 + 事件分类 + 段位提取 |
| `src/main/match/poller.ts` | 挂 WS 通道；`wake()` 提前唤醒；段位 WS 兜底；快照带 `wsStatus` / `rankedSource` |
| `src/shared/match.ts` | 新增 `LcuWsStatus` 类型；`MatchSnapshot` 加两个字段 |
| `src/renderer/src/components/match/MatchStatusCard.vue` | 「事件加速」指示行 |
| `src/renderer/src/components/match/RankedCard.vue` | 段位来源标签 |
| `src/renderer/src/views/Match.vue` | 把 `rankedSource` 传给 `RankedCard` |
| `package.json` | 依赖加 `ws@8.21.3` |
| `src/main/match/__tests__/lcuWs.test.ts` | 新增：协议编码、事件解析、事件分类、段位提取、重连退避、401 作废凭据 |
| `src/main/match/__tests__/poller.test.ts` | 改：ranked 模块改用 `importOriginal` 保留真实解析函数；新增 WS 分支四例 |

## 5. 测试

`src/main/match/__tests__/lcuWs.test.ts`（假 socket，不连真客户端）：

- 认证头解出来是 `riot:tok`；订阅消息是 `[5,"OnJsonApiEvent"]`；
- 事件消息解出 uri / eventType / data；非事件消息、坏 JSON 一律丢掉；
- 事件分类：状态类事件触发唤醒，无关 URI 不触发；
- 段位提取：三种载荷形状各一例；
- 连上之后发订阅；断线按 1s / 2s 退避重连；401 通知上层作废凭据；客户端没开时不抛错。

`src/main/match/__tests__/poller.test.ts`：

- 状态类事件立刻唤醒一轮采集；
- HTTP 段位为空 → 用事件流兜底，来源标成 `ws`；
- HTTP 有段位 → 不改用事件流，来源保持 HTTP 端点；
- 快照带上 `wsStatus`。

## 6. 不做的事

- 不把 HTTP 轮询换掉 —— 事件流断了还要能继续用。
- 不引入 `lcu-driver`（Python 生态），也不在 TS 侧找等价的第三方包。
- 不做 WS 写操作（下单、选人等）。
- 不给段位做「暴力扫 14 个端点」的第三层兜底。
- 不把 WS 的段位做成主来源（HTTP 优先，见 §3.3）。
