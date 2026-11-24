# 开黑大厅 —— 设计文档

日期：2026-11-24
范围：`local_skin_importer`（Electron 桌面端）+ `all_function_api`（后端，新模块）

**Goal：** 把桌面端现有的「同区开黑搭子」（一次性拉同区人 + 复制游戏ID）升级成一个**实时大厅** —— 参照 HexBox 的「开黑大厅」：大厅聊天、在线玩家列表（带游戏状态灯）、一键把人拉进自定义房间。

**参照产品：** HexBox v1.1.1「开黑大厅」（用户提供的截图）。参照的是**形状**（左聊天右列表、顶栏统计、状态灯、@邀请），不是它的实现。

**相关文档 / 代码位置：**
- `all_function_api/skin/src/main/java/com/lolskin/map/controller/MapDistributionController.java` —— 现有「同区找人」接口 `GET /map/region-users`（`@AllowsDesktopToken`），**本设计的离线候选不直接复用它**，理由见「离线候选」
- `all_function_api/skin/src/main/java/com/lolskin/skin/support/RankScores.java` —— 段位数值分口径（**不新造**）
- `all_function_api/skin/src/main/java/com/lolskin/skin/support/GameZones.java` —— 大区归一化（**同大区比较必须走它**）
- `all_function_api/skin/src/main/java/com/lolskin/map/service/impl/MapDistributionServiceImpl.java` —— 现有的取数路径（段位 / 收藏分 / 位置 / 大区别名）
- `all_function_api/chat/src/main/java/com/lolskin/chat/websocket/ChatWebSocketHandler.java` —— 公屏 WS（**不复用**，理由见「为什么不复用 chat」）
- `all_function_api/party/src/main/java/com/lolskin/party/ws/` —— 房间制 WS 骨架（`PartyWebSocketHandler` / `SessionRegistry` / `PartyHandshakeInterceptor` / `ReaperTask`）
- `all_function_api/app/src/main/java/com/lolskin/interceptor/DesktopScopeInterceptor.java` —— 桌面 token 的接口白名单
- `all_function_api/user/src/main/java/com/lolskin/user/entity/User.java` —— `t_user`（`nickname` / `gameId` / `gameZone` / `avatarUrl` / `vipUntil`）
- `local_skin_importer/src/shared/gameLabels.ts` —— **已有的** phase→中文映射（`LCU_PHASE_LABELS` / `lcuPhaseLabel()`），状态灯直接复用
- `local_skin_importer/src/shared/regionUsers.ts` —— 现有的「同区搭子」数据形状（`RegionUser` / `RankProfile`）
- `local_skin_importer/src/shared/matchProfile.ts` —— 位置代码（`PositionCode`）
- `local_skin_importer/docs/superpowers/specs/2026-11-18-game-end-skin-rating-design.md` —— 桌面端 LCU 能力的边界

**跨仓库：** 路径相对 `D:\Code\Front_Project\all\`：`all_function_api/`（后端）、`local_skin_importer/`（桌面端）。

---

## Background

桌面端「实用功能」页里已有一块「同区开黑搭子」（随同区搭子功能落地）：按位置 / 段位窗口 / VIP 往上看几段筛出同区的人，列表里能复制他的召唤师ID，去游戏客户端加好友。

它的问题不是不准，是**不实时**：

- 拉的是库里「同步过段位的人」，不是「此刻在线的人」——不知道对方现在在打游戏还是在空闲
- 没有交流渠道。想组双排只能复制ID、加好友、再手动发消息
- 列表没有「游戏状态」这一维，不知道拉谁不会撞车

HexBox 的开黑大厅补的就是这三样：聊天（能约）、在线列表（能看到人）、状态灯 + 一键拉人（能开）。

**后端不是从零开始。** `all_function_api` 已有两套实时基建：

| 模块 | 端点 | 形态 | 能不能直接用 |
|---|---|---|---|
| `chat` | `/api/ws/chat` | 频道 + 大区双维度路由的公屏广播 | ❌ 见下 |
| `party`（狼人杀） | `/api/party/ws/{roomId}` | 房间制 WS + Redis 房间状态 + 跨实例 pub/sub | ✅ 抄骨架 |

**为什么不复用 `chat`：**

- `ChatPayload` 里没有「谁在线」「什么状态」这些概念，presence 消息只广播一个在线总数
- 消息正文被硬截断 30 字（`ChatWebSocketHandler.MAX_TEXT_LEN = 30`），大厅要发的是「艾欧尼亚 2700-2900 两黑，一个丢子前排，一个软辅以外任意位置，上人」这种整句约人
- 落库目标是 `t_chat_message`，它的 `role_type` / `badge` / `name` 是公屏「匿名代号」语义（`name` 是代号不是昵称），塞大厅会语义错位

⇒ **大厅单开一个 `lobby` 模块**，照 `party` 的模式写一套专用 WS + 专用表。

---

## Scope

**In scope**

- 桌面端「实用功能」页新增「开黑大厅」页（现有「同区开黑搭子」改造进去）
- 大厅聊天：落库 + 进大厅拉最近 50 条 + 实时收发
- 玩家列表：**在线的人**（带游戏状态灯）+ **同区离线候选**（标注上次在线时间）
- 顶栏统计：在线 / 同大区 / 可以拉人 / 我的段位分 / 我的收藏分
- 拉人：LCU 建自定义房间 + 邀请对方；**探测不到路由时自动降级**成复制游戏ID
- 设置里一个「在大厅公开我的信息」开关（默认开）

**Out of scope**

- **不做小程序版。** 用户已确认只做桌面端。小程序用户进不了大厅、也上不了列表。
- **不做 HexBox 那个「是否公开您的召唤师 ID」进门弹窗。** 用户已确认用设置开关代替。
- **不做被邀请方自动接受房间邀请。** 要双方都装桌面端 + 另一套接受流程，记为后续项。
- 不做跨区拉人（列表默认同大区优先，跨区只在「全部」里可见）。
- 不做敏感词过滤（沿用公屏的做法：不做）。
- 不做 HexBox 的「房间中」状态（读不到自定义房间里几个人）。
- 不做匹配算法（保留现有的段位窗口 / 位置 / VIP 往上看几段）。

---

## 评审定下的六条决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 大厅**只做桌面端** | 能读游戏状态、能一键拉人（LCU 在本机）；改动面最小 |
| 2 | 列表 = **在线的人 + 同区离线候选** | 纯实时的列表会永远是空的；离线候选撑住可浏览性，但拉不了（没人替他操作客户端） |
| 3 | 拉人做**真邀请，探测不到就降级** | 探测成本极低（GET 打 POST 看 405），降级后功能不残废 |
| 4 | **不弹公开同意框**，改设置开关 | 反复弹窗会让人一路点「不公开」，反而把功能挡死 |
| 5 | 聊天**落库**，进大厅拉最近 50 条 | 新人进来面对空白屏就没法接话 |
| 6 | 分数**沿用**段位数值分 + 收藏分 | 跟现有同区搭子口径一致，不新造一套 |

---

## 架构

```
桌面端 local_skin_importer
└─ 「实用功能」页 →「开黑大厅」
   ├─ 顶栏: 在线 N · 同大区 N · 可以拉人 N · 我的段位分 · 我的收藏分
   ├─ 左栏: 大厅聊天(历史 50 条 + 实时流) + 输入框
   └─ 右栏: 玩家列表(在线在上 / 同区离线候选在下,全部|同大区切换)
        │
        └─ 后端 lobby 模块(新)
           ├─ WS   /api/ws/lobby?token=<desktop token>
           ├─ REST /api/lobby/history · /api/lobby/players
           └─ MySQL t_lobby_message + t_user.last_lobby_at
```

### 连接生命周期（**唯一的一套说法**）

- **应用启动即连 WS**，退到托盘也保持连接，退出应用才下线。
  ⇒ presence 反映的是「**应用在跑**」，不是「人正坐在大厅页里」。统计文案必须说清楚这点。
- **没有「离开大厅」按钮。** 是否出现在大厅里由设置里的「在大厅公开我的信息」开关控制（默认开）。
  关掉开关 → 后端把这个人标成 `public=false` → **不出现在列表里**（统计也不计入），
  别人也就看不到他、拉不到他；他本人仍然连着、仍然能在大厅里聊天。
- 开关状态随 hello 一起上报；切换后立刻发一条 `profile` 更新。
- 应用退出 / 令牌失效 → 主动关闭连接并清理 presence。

---

## 数据模型

### MySQL

```sql
-- 新表:大厅聊天
CREATE TABLE IF NOT EXISTS t_lobby_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '站内用户 id',
  nickname VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '游戏昵称(发言当时的快照)',
  game_id  VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '召唤师ID(数字标签,快照)',
  game_zone VARCHAR(32) NOT NULL DEFAULT '' COMMENT '大区(快照)',
  text VARCHAR(64) NOT NULL COMMENT '消息正文,后端硬截断 64 字',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='开黑大厅聊天消息';

-- 老表加一列:离线候选的「上次在线」
ALTER TABLE t_user ADD COLUMN last_lobby_at DATETIME NULL COMMENT '最后一次出现在开黑大厅的时间';
```

- `text` 的列宽跟后端截断长度一致（64），避免超长内容进库。
- `nickname` / `game_id` / `game_zone` 是**发言当时的快照** —— 昵称改了、皮肤换了，
  旧消息仍然显示当时的样子（跟公屏一致）。
- ⚠️ 生产 MySQL **5.7**（不是 8.0）—— DDL 避开 8.0 语法（`DEFAULT (now())`、函数索引等）。
- ⚠️ `ALTER TABLE` 加列在 5.7 上是 copy 算法 —— `t_user` 规模不大，但上线窗口选低峰。
- ⚠️ `last_lobby_at` 的写入在 WS 热路径上：**只在连接建立 / 公开开关变化时写**，不随每次心跳写。

### Redis（在线状态，不落库）

| Key | 类型 | 内容 | TTL |
|---|---|---|---|
| `lobby:online:{userId}` | String(JSON) | userId / public / phase / 心跳时刻 | 90s |
| `lobby:online:idx` | ZSET | member=userId, score=心跳时刻 | — |

- 客户端 **20 秒**心跳一次（ping 兼作心跳），刷新 TTL
- 昵称 / 大区 / 游戏ID / 头像 / 段位分 / 收藏分 **不存 Redis** —— 要展示时按 userId 查库算，
  避免 Redis 里存两份会过期的真相
- 后端定时任务每分钟扫一次 ZSET，剔掉对应 key 已消失的 member
- 多实例：Redis pub/sub `lobby:presence` 把「有人进/出/状态变了」推给所有实例的连接
  （写法照 `party/.../redis/RoomEventPublisher.java`）

⚠️ `all_function_api` 的 Redis 默认类型信息坑：value 序列化器只给非 final 类型写 `@class`。
这里存的是裸 JSON 字符串，**不要用 `List.of(...)` 之类去写**，读回来会报 400。

---

## 身份与分数：后端自己算

大厅展示的每一条记录，这些字段后端都能自己算 —— **客户端不上报，也不该上报**：

| 字段 | 取数路径 | 口径 |
|---|---|---|
| 昵称 / 游戏ID / 大区 / 头像 / VIP | `t_user` | — |
| 段位分 + 段位文字 | `UserRankProfileMapper.listByUserId(userId)` → `RankScores.rankScore()` / `RankScores.tierLabel()` | 单双排优先，没有再取灵活排（跟 `MapDistributionServiceImpl.myRank()` 一致） |
| 收藏分 | `MapDistributionMapper.selectRarityCounts(ids)` → `RankScores.rarityWeight()` 加权求和 | 11 档稀有度 |
| 主玩位置 | `UserPositionStatMapper`：上报过的在前，本命英雄推导的补在后面 | `t_user_position.position` |

**复用 `RankScores` + 那几个 mapper，不复用 `MapDistributionServiceImpl` 本身** ——
它的取数方法全是 private，而且形状是「我跟候选人比」（每个候选人都要拿我的分去算差值），
大厅要的是「这批人各自的分数」，形状不一样。

⚠️ **同大区比较必须先归一化**：库里同一个大区有多个原始写法
（`MapDistributionServiceImpl.aliasesOf()` 就是干这个的）。判「同大区」要
`GameZones.resolve(zone)` 之后比，**不能直接字符串比** —— 否则「同大区 N」会算错。

---

## WS 协议

端点 `GET /api/ws/lobby?token=<desktop token>`
（注册路径写 `/ws/lobby`，`application.yml` 的 `context-path: /api` 会自动带上前缀，
跟 `chat` 的 `/ws/chat` → `/api/ws/chat` 一个规矩。）

握手拦截器照 `party/.../ws/PartyHandshakeInterceptor.java` / `chat/.../JwtHandshakeInterceptor.java`：
从 query string 取 `?token=` → `jwtService.getUserId(token)` → 写 `session.attributes("userId")`。

⚠️ **大厅的握手跟 `chat` 不一样：token 无效就拒。**
`chat` 允许匿名进（公屏匿名可看），大厅要发消息、要在列表里出现 → 必须认人。
解析不出 userId → 把 response status 设成 **401** 再 `return false`（Spring 默认给 403，
要 401 得自己设 `HttpStatus.UNAUTHORIZED`），前端收到握手失败就提示
「登录已过期，去重新兑换同步码」。

⚠️ `DesktopScopeInterceptor` **管不到 WS 握手** —— 它的 `preHandle` 遇到非 `HandlerMethod`
的 handler 直接放行（WS 握手走的是 `WebSocketHttpRequestHandler`）。
REST 接口则相反：**每个 lobby 的 REST 接口都必须标 `@AllowsDesktopToken`**，
否则桌面 token 会被默认拒绝（403）。

### 客户端 → 服务端

```json
{"type":"hello","phase":"None","public":true}
{"type":"profile","phase":"InProgress","public":true}
{"type":"say","text":"来两把大乱斗"}
{"type":"ping"}
```

**客户端只上报「后端查不到的两样东西」**：

| 字段 | 谁给 | 为什么 |
|---|---|---|
| `phase` | 客户端 | 游戏状态只有本机客户端知道 |
| `public` | 客户端 | 公开开关是本地设置 |

昵称 / 游戏ID / 大区 / 头像 / 段位分 / 收藏分 / 位置 **一律不由客户端上报** ——
后端按 token 里的 userId 从 `t_user` + 现有段位表 + 收藏表自己算（`RankScores` 那套口径）。
这样客户端冒充不了别人，也不会跟库里对不上。

`phase` 传的是**原始串**（`None` / `Lobby` / `ChampSelect` / `InProgress` / `WaitingForStats` /
`PreEndOfGame` / `EndOfGame` / `PostGame`），后端只存串、不翻译 ——
中文由桌面端的 `lcuPhaseLabel()` 渲染（见「状态口径」）。

### 服务端 → 客户端

```json
{"type":"welcome","history":[...],"online":[...],"offline":[...],"stats":{...}}
{"type":"chat","id":123,"nickname":"…","gameId":"…","zone":"…","text":"…","createdAt":"2026-11-24 22:16:03"}
{"type":"presence","online":[...],"stats":{...}}
{"type":"pong"}
{"type":"error","code":"RATE_LIMIT","reason":"发言太快了"}
```

`stats` 的形状（顶栏四个数字就来自它）：

```json
{"online":3,"sameZone":2,"invitable":1}
```

- `online` —— 在线且 `public=true` 的人数
- `sameZone` —— 上面这些人里 `GameZones.resolve(zone)` 等于我的大区的
- `invitable` —— 上面这些人里 `phase ∈ {None, Lobby}` 且有 `gameId` 的

一条在线记录的形状：

```json
{"userId":1024,"nickname":"林俊杰","gameId":"18557","zone":"联盟五区",
 "avatarUrl":"…","phase":"None","public":true,
 "rankScore":32000,"rankLabel":"黄金 III","collectionScore":520,
 "positions":["mid"],"positionLabels":["中单"],"vip":false}
```

### REST 接口（两个,都是给轮询降级用的）

| 接口 | 用途 |
|---|---|
| `GET /api/lobby/players` | 在线列表 + 离线候选 + stats（WS 不可用时按 3 秒轮询这个） |
| `GET /api/lobby/history?limit=50` | 最近 50 条聊天（WS 不可用时按 2 秒轮询这个；WS 可用时由 `welcome` 一次性带下来） |

两个都要标 `@AllowsDesktopToken`。

### 连接与消息的硬性规则

| 规则 | 值 |
|---|---|
| 连接后多久必须发 `hello` | 10 秒内，超了服务端断开（防空连接占位） |
| 客户端心跳 | 20 秒一次 `ping` |
| 服务端多久没收到任何帧就断开 | 60 秒 |
| 发言正文上限 | 64 字（后端硬截断） |
| 发言频率 | 10 秒内不超过 5 条，超了回 `RATE_LIMIT` |
| 重连退避 | 1 / 2 / 4 / 8 / 16 秒，上限 30 秒；重连后必须重新 `hello` |

重连时后端把这条连接当**新连接**处理：旧 session 的 presence 已经在断开时清掉了，
重连后重新写 Redis + 更新 `last_lobby_at`。

---

## 状态口径

**复用已有的映射表，不新造。**
`local_skin_importer/src/shared/gameLabels.ts` 里已经有：

```ts
export const LCU_PHASE_LABELS: Record<string, string> = {
  None: '空闲', Lobby: '大厅', ChampSelect: '选人', InProgress: '对局中',
  WaitingForStats: '等待结算', PreEndOfGame: '对局结束',
  EndOfGame: '对局结束', PostGame: '对局结束'
};
export function lcuPhaseLabel(phase: string): string { … }
```

- 后端存 phase 原始串，桌面端用 `lcuPhaseLabel()` 渲染成状态灯文案 —— 跟对局页面同一份映射，
  不会出现「大厅说空闲、对局页说对局中」
- 状态灯颜色由 phase 归类：**空闲 / 大厅** = 绿，**选人 / 对局中 / 等待结算 / 对局结束** = 灰
- **`phase` 为空或认不出来** → 显示「未知」，按不可拉处理（**不猜**）

**「可以拉人」= `phase ∈ {None, Lobby}`** —— 他没在打，拉了不撞车。
另外还要有 `gameId`（没有召唤师ID就邀不了）。

### phase 从哪来

**复用 `MatchPoller` 手上那一份，不另开一路读取。**

`MatchPoller` 已经有 `this.phase`（gameflow 的原始阶段串），两条路都在维护它：
- LCU 事件流通了 → `handleWsEvent` → `onPhaseChange(phase)`
- 事件流没连上 → 轮询兜底 `getGameflowPhase(client)` → `onPhaseChange(phase)`

⚠️ `MatchState`（`'idle' | 'lobby' | 'champ_select' | 'in_game'`）**不够用** ——
它是「有没有选人会话」推出来的四档，**表达不了「结算中」**。
大厅要的是原始 phase，所以要**把 `MatchPoller` 的 phase 暴露出来**
（加一个 `getPhase()`，或把 `phase` 塞进 `MatchSnapshot`），大厅客户端订阅它、变了就推 `profile`。

`phase` 为空（还没采集到 / 客户端没开）→ 按「未知」处理，**不猜**，也不许拉人。

HexBox 那个「房间中」读不到（LCU 不给「自定义房间里几个人」），先不做。

---

## 离线候选

**定义：** 同大区 + **最近 7 天来过大厅** + 现在不在线的人。

- 筛选：`t_user.game_zone IN (我的大区的全部原始名) AND t_user.last_lobby_at IS NOT NULL
  AND t_user.last_lobby_at >= NOW() - INTERVAL 7 DAY AND id NOT IN (在线的人)`
  - ⚠️ **大区要用别名集合，不能等值比** —— 库里同一个大区有多个原始写法
    （`MapDistributionServiceImpl.aliasesOf()` 就是按 `GameZones.resolve()` 把它们归到一起的）。
    直接 `game_zone = '艾欧尼亚'` 会漏掉写成别的名字的人。
- 排序：`last_lobby_at` 倒序（最近来过的排前面），取前 30
- 附带：段位分 / 收藏分（跟在线的人同一套口径）
- 界面上标「上次在线 X 小时前」

**不复用 `GET /map/region-users`** —— 那个接口是按「分数窗口 + 位置 + VIP 往上看几段」筛的，
语义是「跟我实力差不多的人」，不是「来过大厅的人」。名单口径不一样，混用会让列表看着像两拨人。
但**分数口径**（`RankScores`）是共用的。

---

## 拉人流程

```
1. 目标「空闲」(phase ∈ {None, Lobby}) + 有 gameId → 否则邀请按钮灰掉
2. 本机 LCU:
   a. 昵称#标签 → summonerId
      GET /lol-summoner/v1/summoners?name=林俊杰#18557
      （这条国服实测活着,是唯一能搜到人的路）
   b. 建房  POST /lol-lobby/v2/lobby        ← 路由/body 待撞
   c. 邀请  POST /lol-lobby/v2/lobby/...    ← 路由/body 待撞
3. 任一步失败 → 降级:复制游戏ID + 提示「复制到客户端加好友」
```

**邀请完全在客户端本地做**（本机 LCU + 本机游戏客户端），后端不参与 ——
所以不需要任何 `invite-ticket` 之类的服务端接口。

### 探测脚本

`local_skin_importer/scripts/probe-lobby-invite.mjs` —— 纯本机回环，跟对局状态无关，随时能跑。

手法：拿 **GET** 打一个 POST 端点 —— 回 **405 = 路由存在**，回 **404 = 不存在**。不用猜 body 就能先验出路由在不在。
候选逐个撞：`/lol-lobby/v2/lobby`、`/lol-lobby/v2/lobby/invitations`、`/lol-lobby/v2/lobby/{id}/invite`、
`/lol-lobby/v2/party/invitations`、`/lol-lobby/v1/lobby/invitations` 等。

⚠️ 探测**不阻塞上线** —— 撞不到就走降级路径，界面上是「复制ID」而不是「拉人」。

---

## 桌面端 UI

```
┌ 开黑大厅 ───────────────────────────────────────┐
│  在线 3   同大区 2   可以拉人 1   段位分 32000   收藏分 520 │
├─────────────────────┬──────────────────────────┤
│ 大厅聊天             │ 在线 (3)  [全部|同大区]    │
│ 15:44 林俊杰 来两把   │ ● 林俊杰#18557 32000 空闲 复制ID @ │
│ 16:34 圣奇曼美 到了吗│ ○ 叶淑慧#84174 1053 结算中 复制ID @ │
│ [输入框........] 发送│ ── 同区离线候选 ──        │
│                     │ ○ 一天至美小维纯 上次在线2小时前 │
└─────────────────────┴──────────────────────────┘
```

- 每行：头像字 / `昵称#游戏ID` / 段位分 / 大区 / 状态灯 / 复制ID / @邀请
- 顶栏「我的段位分」「我的收藏分」是**两个数**，都来自后端现成口径，**不合并成一个「匹配分」**
  （现有同区搭子也是两个数：`myRank.score` 和 `myCollectionScore`）
- `@`：在线 + 空闲 → 走真邀请；离线 → 只能复制ID
- 设置里「在大厅公开我的信息」开关（默认开），下面一行说明公开了哪几项：
  召唤师ID / 大区 / 段位分 / 游戏状态 / 发出的消息
  - 开关存在本地：桌面端没有 electron-store，**照 `src/main/autoAcceptState.ts` 的做法**
    —— `userData` 下一个 JSON 文件（如 `lobby-prefs.json`），读坏了当默认值
- 列表顶部标一行小字：「在线 = 应用在运行中」（presence 口径，避免误解）

---

## 降级策略

| 场景 | 降级 |
|---|---|
| WS 握手被拒（token 过期） | 提示「登录已过期，去重新兑换同步码」，大厅不可用（不静默降级） |
| 网络不通 / WS 连不上 | 自动退回 HTTP 轮询（列表 3s、聊天 2s），界面标「已降级为轮询模式」，大厅仍能用 |
| LCU 邀请路由撞不到 | 「邀请」按钮退化成「复制游戏ID」+ 提示 |
| 目标不是空闲状态 | 邀请按钮灰掉，提示「他现在在游戏中」 |

---

## 测试

**后端（`all_function_api` 新增 `lobby` 模块）**
- WS 集成测试，照 `app/src/test/java/com/lolskin/party/integration/PartyRoomIntegrationTest.java` 写：
  两个客户端连上 → 一方发言另一方收到；一方断开 → 另一方收到 presence 更新
- 消息落库 + 拉最近 50 条
- 限流：10 秒内第 6 条被拒
- 离线候选：`last_lobby_at` 过期（>7 天）的人不出现
- 握手：token 无效 → 握手被拒（**不匿名放行**）

**桌面端（`local_skin_importer`）**
- WS 客户端协议测试，照 `src/main/match/__tests__/poller.test.ts` 的 `vi.hoisted` 假 WS：
  hello→welcome、say→chat、presence→列表刷新
- phase → 状态灯的映射测试（**复用 `lcuPhaseLabel()`**，不另造一套映射）
- 降级路径：WS 连不上 → 走轮询

---

## 风险

| 风险 | 应对 |
|---|---|
| LCU 邀请端点国服未实测 | 探测脚本 + 自动降级到复制ID；探测不阻塞上线 |
| 大厅冷清（桌面端用户少） | 离线候选撑住列表；「在线」数字如实显示，不粉饰 |
| WS 握手被 `DesktopScopeInterceptor` 拦 | 握手走 `WebSocketHttpRequestHandler`，拦截器对非 `HandlerMethod` 直接放行；REST 接口补 `@AllowsDesktopToken` |
| 后端多实例 | Redis pub/sub 广播 presence |
| 桌面端不是常驻应用 | presence 只反映「应用在跑」，不是「人坐在大厅里」—— 统计文案要说清楚 |
| 后端要直连生产 5.7 | DDL 避开 8.0 语法；上线窗口选低峰（`ALTER TABLE` 是 copy 算法） |

---

## 落地顺序建议

1. **后端 lobby 模块**（表 + WS + presence + 历史 + REST）—— 独立可测，不依赖桌面端
2. **桌面端大厅页**（空壳 + WS 客户端 + 列表 + 聊天）
3. **状态上报**（把 `MatchPoller` 的 phase 暴露出来）+ 统计条
4. **离线候选**（`last_lobby_at` + `/api/lobby/players` 的离线部分）
5. **拉人**（探测脚本 → 真邀请 → 降级路径）

每一步落地都要**升一次 `package.json` 的 version**（桌面端每改一次升一次，界面版本号是从这儿读的）。

后续项：被邀请方自动接受、敏感词、小程序版大厅。
