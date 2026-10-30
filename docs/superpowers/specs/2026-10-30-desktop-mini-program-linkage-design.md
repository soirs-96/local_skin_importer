# 桌面端 ↔ 微信小程序 皮肤联动

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让微信皮肤评分小程序能展示「这台游戏账号拥有哪些皮肤」——鉴赏页给皮肤打「已拥有」标记，个人中心提供按英雄维度的「我的皮肤收藏册」；数据由桌面客户端自动同步上来。

**Architecture:** 桌面端（Electron）在启动时自动从本机 LCU 抓已拥有皮肤并 UPSERT 到后端 `t_user_skin`；小程序拉一次「我拥有的 skinId 集合」在本地给列表打标（客户端 join），收藏册单独走一个按英雄聚合的统计接口。桌面端的 JWT 收窄成独立的 `DESKTOP` token 类型，只能访问白名单方法。

**Tech Stack:** Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + Redis（后端 `all_function_api`）；原生微信小程序 `wx.*` API（`wechat_rating_program`）；Electron 39 + Vue 3.5 + TypeScript 5.9 + vitest 3.2（`local_skin_importer`）。

**相关文档:**
- 前身：`docs/superpowers/specs/2026-08-11-sync-code-design.md`（6 位同步码绑定）
- 前身：`docs/superpowers/specs/2026-10-30-skin-overview-dialog-design.md`（桌面端皮肤总览弹窗）
- 复活对象：`wechat_rating_program/docs/superpowers/specs/2026-10-22-forum-tab-design.md`（删掉旧「藏品」tab 的那版设计）
- 暂缓方向：`all_function_api/docs/superpowers/specs/2026-08-18-a0-tencent-inventory-research.md`（后端直拉腾讯接口）

**跨仓库:** 本设计横跨三个仓库，路径均相对于 `D:\Code\Front_Project\all\`：
`all_function_api/`（后端）、`local_skin_importer/`（桌面端）、`wechat_rating_program/`（小程序）。

**三套入口 URL 不同，但都是同一个后端：**
桌面端直连 `http://101.34.210.254`（`src/main/catalog.ts:4`），小程序走 `https://www.sxdtaz.cn`（`wechat_rating_program/utils/config.js:6`）。

---

## Background and Motivation

当前链路已经跑通前两跳，**第三跳是断的**：

```
① 小程序生成 6 位码 → 桌面端兑换 JWT              ✓ 已跑通（2026-08-11 那版）
② 桌面端抓本机皮肤 → POST /skins/sync-user-skins → 写 t_user_skin   ✓ 已跑通
③ 小程序读取「我的皮肤」→ 展示收藏                ✗ 链路全断
```

小程序代码里搜不到任何 `my-owned` / `owned` 的调用——`GET /api/skins/my-owned` 这个接口目前**只有桌面端自己在用**，而且只用了 `ownedSkins[].skinId` 和 `totalOwnedCount` 两个字段，接口本身却返回了全量 2138 条 `SkinItemVO`（几 MB）。

### 旧「藏品」tab 的历史：这是复活，不是新造

2026-10-22 的论坛 tab 重构里，小程序原本的 **「藏品」tab（`pages/inventory/index`）被整体删掉了**。删掉的理由不是这个概念不好，而是**数据源是假的**：

- 旧藏品页展示的正是「已收集皮肤数 / 收集率 / 按英雄的收集进度」——**和本次要做的收藏册是同一张页面**。
- 但它的数据来自 `POST /api/user/skins/sync`（A0 那条链路），而 `pages/inventory/index.js` 里的 `buildMockAuthDto()` 把 `skey: 'demo-skey-local'` **写死在小程序代码里**，后端 `MockInventoryProvider` 返回的是假数据。
- 删除时**后端藏品链路全部保留**（`t_user_skin` / `/api/skins/my-owned` / `/api/user/skins/sync` / `LolInventoryController`），设计文档原话是「以后想捡回来成本很低」。
- `assets/discount.png` / `discount-active.png` 作为孤儿素材**特意没删**，注释写着「藏品功能随时可能捡回来，删了还得重新找素材」。
- `pages/inventory/`、`api/inventory.js`、`utils/sha256.js` 已随论坛 tab 一起删除。

**本次做的事 = 把藏品页捡回来，换上真实数据源。** 数据不再来自 mock，而是来自桌面端写进 `t_user_skin` 的真实 LCU 数据。收藏册的形态（收集率 + 按英雄进度）是旧藏品页已经验证过的形态，直接复用。

### 必须满足的约束

1. **桌面端是唯一数据源。** 小程序碰不到 LCU，也拿不到 QQ cookie；「已拥有」这件事只有桌面端能做。腾讯直连（A0）是另一条独立路线，本次不参与。
2. **不新增绑定摩擦。** 6 位码已经能用，跨设备手打虽然笨，但用户认可；不改成二维码/扫码。
3. **游客不被打扰。** 绝大多数小程序用户不会装 Windows 客户端，未绑定不能变成一种「缺失感」。
4. **桌面端不该持有超出自己职责的权限。** 现在桌面端拿到的是小程序的全权限 JWT，能发帖、评论、改资料。

### Scope

**In scope**

- 后端：`GET /api/skins/my-owned` 改造（瘦身 + 真实 lastSyncAt）；新增 `GET /api/skins/my-collection`；owned ids 的 Redis 缓存 + 同步后失效；`DESKTOP` token 类型 + 作用域拦截器。
- 桌面端：启动时自动同步 + 本地节流；总览弹窗读新接口结构、显示「上次同步于 X」和收集率。
- 小程序：`utils/owned-skins.js` 单例；鉴赏相关页面给皮肤打「已拥有」徽标；复活「我的皮肤收藏册」页（按英雄收集进度）；个人中心入口与空态引导。

**Out of scope**

- 二维码 / 扫码绑定（用户明确选择保留 6 位码）。
- 桌面端做按英雄的收藏册（桌面端已有全量网格，再做一遍是重复劳动）。
- `t_user_skin` 软删除改造（见「已知取舍」）。
- A0 腾讯直连路线的任何改动（该路线的代码原样保留，只在文档里标状态）。
- 旧 `pages/inventory` 的 mock 链路复活——只借形态，不借数据源。
- 自动更新（`electron-builder.yml` 至今没有 `publish` 配置，`latest.yml` 生成了但无上传目标）。
- 把后端地址从硬编码改成可配置（本次仍是 `http://101.34.210.254`）。

---

## Design

### 整体架构与数据流

整条链路是**四段三跳**，桌面端是唯一数据源，小程序是唯一出口：

```
【① 绑定】  ← 已完成，本次不动
   小程序 个人中心 → 生成 6 位码(TTL 300s) → 桌面端输入 → 兑换 JWT → safeStorage 落盘

【② 采集】  ← 新增：启动即自动，不用点按钮
   桌面端启动
     ├─ 读本地 JWT（没有 → 停在登录页，不做任何事）
     ├─ 探测 LCU（进程命令行 → lockfile 兜底）
     ├─ 拉 current-summoner + 已拥有 skinIds
     └─ POST /api/skins/sync-user-skins (Bearer)
            后端：限频 → Redis 锁 → PUUID 绑定校验 → UPSERT t_user_skin
            返回 { added, updated, totalOwned }

【③ 存储】  ← 已有，不动
   t_user_skin (user_id, skin_id, first_seen_at, last_seen_at)

【④ 消费】  ← 新增
   小程序 鉴赏页  → GET /api/skins/my-owned      → Set<skinId> → 本地给列表打「已拥有」
   小程序 我的收藏 → GET /api/skins/my-collection → 按英雄的收集进度卡片墙
```

### 关键 ID 口径（最容易踩坑的地方）

三种 ID 在这套代码里并存，join 前必须分清：

| 名字 | 是什么 | 出处 |
|---|---|---|
| `t_skin.id` | DB 自增主键（Long） | `SkinVO.id` |
| `t_skin.skin_id` | **游戏内皮肤 ID（= LCU itemId，Integer）** | `SkinVO.skinId` / `Skin.skinId` |
| `t_hero.id` | DB 主键（Long），`t_skin.hero_id` 指向它 | `Hero.id` |

- `t_user_skin.skin_id` 存的是 **Riot 皮肤 ID**（桌面端从 LCU `/lol-store/v1/skins` 拿到的 `itemId`），和 `t_skin.skin_id` 同口径——`PlayerSkinStatusAssembler` 就是拿 `ownedIds` 去 `skinMap`（key = `Skin::getSkinId`）里查的，两者对得上。
- **徽标 join 必须用 `skin.skinId`（Riot ID），不能用 `skin.id`（主键）。**
- ⚠️ 小程序现有代码里叫 `skinId` 的地方**传的是主键**（`api/skin.js` 的 `getSkinDetail(skinId)` / `getSkinRatings(skinId)` / `rateSkin(skinId)`，实参是 `skin.id`）。这套命名有误导性，别被带偏——本次只新增 `skin.skinId` 的读取，不改既有命名。
- 小程序的皮肤数据来自 `SkinApi.getSkinList({ heroId, size: 50 })` → `GET /api/skins/list` → `SkinVO`，其中 `skinId` 字段**已经存在**（是桌面端皮肤总览那次加的）。

### 后端接口契约

两个接口都在 `skin` 模块，JWT 鉴权（沿用 `SkinSyncController.extractUserId` 的写法）。

#### A. 改造 `GET /api/skins/my-owned`

现状三个毛病：

- 返回 `PlayerSkinStatusVO`，带 `ownedSkins` + `unownedSkins` **全量 2138 条 `SkinItemVO`**（每条含 name / iconUrl / splashUrl / rarity / priceRp / releaseDate），而唯一消费者只用了 `ownedSkins[].skinId` 和 `totalOwnedCount`。
- `lastSyncAt` 填的是 `LocalDateTime.now()`，**不是真的同步时间**（`PlayerSkinStatusAssembler:76` 填的 `LocalDateTime.now()`；VO 的 `@Schema` 甚至写着「缓存命中时 = 当前请求时刻」）。
- 每次请求都要把 2138 条 `Skin` 实体拉进内存、组装两个大列表，只为了让调用方取两个数字。

新契约：

```json
{
  "ownedSkinIds": [161013, 16001],
  "totalOwnedCount": 87,
  "lastSyncAt": "2026-10-30T16:20:33"
}
```

| 字段 | 含义 | 来源 |
|---|---|---|
| `ownedSkinIds` | 该用户已拥有的全部 Riot skin_id | `SELECT skin_id FROM t_user_skin WHERE user_id = ?` |
| `totalOwnedCount` | `ownedSkinIds.length`（含目录未收录的） | 同上 |
| `lastSyncAt` | 最近一次同步时刻；**null 表示从未同步过** | `SELECT MAX(last_seen_at) FROM t_user_skin WHERE user_id = ?` |

`lastSyncAt` 之所以不用加字段：`UserSkinMapper.xml:12` 的 `batchUpsert` 是
`ON DUPLICATE KEY UPDATE last_seen_at = NOW()`，每次同步都会把该用户所有 owned 皮肤 upsert 一遍、
全部刷成 `NOW()`，所以 `MAX(last_seen_at)` 精确等于最近一次同步时刻。

配套改动：

- 新建 VO `MyOwnedSummaryVO`。
- `PlayerSkinSyncService.getOwnedSummary` 返回类型从 `PlayerSkinStatusVO` 改为 `MyOwnedSummaryVO`；`SkinSyncController.myOwned` 的返回类型同步改。
- `UserSkinMapper` 新增 `LocalDateTime maxLastSeenAt(@Param("userId") Long userId)`，XML 里写 `SELECT MAX(last_seen_at) FROM t_user_skin WHERE user_id = #{userId}`（无行时返回 null）。
- `PlayerSkinStatusVO` / `SkinItemVO` **原样保留**给 A0 那套（`LolInventoryServiceImpl` 在用），两套并存。
- 桌面端 `src/main/catalog.ts:134-136` 的 `fetchMyOwned` 改读 `ownedSkinIds`（现读 `ownedSkins[].skinId`）。

#### B. 新增 `GET /api/skins/my-collection`

收藏册专用，一次聚合出按英雄的收集进度：

```json
{
  "totalOwnedCount": 87,
  "totalSkinsInGame": 2138,
  "ownedMatchedCount": 80,
  "completionRate": 0.0374,
  "lastSyncAt": "2026-10-30T16:20:33",
  "byHero": [
    {
      "heroId": 7,
      "heroName": "暗裔剑魔",
      "heroIcon": "https://...",
      "ownedCount": 12,
      "totalCount": 56,
      "heroCompletionRate": 0.2143
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `totalOwnedCount` | 已拥有总数（含目录未收录的） |
| `totalSkinsInGame` | `t_skin` 中 `is_active = 1` 的总数 |
| `ownedMatchedCount` | 已拥有 ∩ 目录 的匹配数 |
| `completionRate` | `ownedMatchedCount / totalSkinsInGame`，保留 4 位小数 |
| `byHero` | 按英雄聚合的收集进度 |

> 注意：现有 `GET /skins/my-owned` **已经返回 `byHero`**（现有测试 `SkinSyncControllerTest.myOwned_happyPath_returns200WithByHero` 就断言了）。所以 `my-collection` 不是凭空新造的聚合，而是**现有 `my-owned` 聚合的瘦身版**——同样的 `byHero` 口径，去掉两个大列表，换上交集口径的 `completionRate` 和真实的 `lastSyncAt`。

**三个必须修掉的坑：**

1. **收集率要用交集算。** 现有 `PlayerSkinStatusAssembler:73` 用 `ownedIds.size() / total`，把「已拥有但目录没收录」的皮肤也算进分子，收集率虚高。新接口用 `ownedIds ∩ 目录` 的匹配数，与桌面端 `computeStats` 的 `ownedMatched` / `ownedReported` 两套口径对齐。

2. **`byHero` 只算需要的部分。** 现有 assembler 为了算 168 行英雄统计，把 2138 条 `Skin` 实体全拉进内存，还组装 `ownedSkins` / `unownedSkins` 两个大列表。新增 `PlayerSkinStatusAssembler.assembleByHero(ownedIds, skinMapper, heroMapper)` 复用同样的 join 口径（`t_skin.hero_id → t_hero.id`），但跳过两个大列表的组装；现有 `assemble` 内部改为调用它，保证两处口径永不漂移。
   > **但 `assemble` 的 `completionRate` 不许改。** assembler 的类注释写了硬契约：「与重构前 `LolInventoryServiceImpl.sync` 输出按字节相同；若改此处行为, 必须同时跑 `LolInventoryServiceImplTest` 校验未回归」。交集口径**只在新 `my-collection` 路径生效**，`assemble`（A0 专用）保持 `ownedIds.size() / total` 原样。

3. **`heroId` 的口径要写对。** `HeroSkinOwnershipVO.heroId` 的 `@Schema` 注释写的是「业务侧英雄 ID（`Hero.heroId`, Integer）」，但代码里填的是 `e.getKey().intValue()`，也就是 `t_hero.id`（Long 主键）转 int。`SkinItemVO.heroId` 同理。两处实际口径一致，**新接口沿用 `t_hero.id`**，顺手把 `@Schema` 注释改对。

`byHero` 只包含**有 active 皮肤的英雄**（从 `is_active = 1` 的皮肤分组而来），不是 `t_hero` 的全部——没皮肤的英雄不必占位。

### Redis 缓存

| 项 | 决定 |
|---|---|
| 键 | `skin:owned:ids:{userId}` → `Set<Integer>` |
| TTL | 30 分钟（对齐 `PlayerSkinStatusVO.cached` 的 `@Schema`「是否命中 Redis 30min 缓存」既有约定） |
| 失效 | **同步成功后主动删键** |
| 缓存范围 | **只缓存 `my-owned` 的 ids** |
| 不缓存 | `my-collection` |

- **同步后主动删键**：否则用户刚同步完，小程序还看到 30 分钟前的旧数据。删键点：`PlayerSkinSyncServiceImpl.sync` 的 `finally` 块旁边（`redis.delete(lockKey)` 那一行附近）。
- **只缓存 ids**：原始集合，无派生字段，天然满足项目既有约束「redis-cache-value-shape-must-include-all-display-fields」（缓存值必须包含全部展示字段）。
- **`my-collection` 不缓存**：它的 `totalSkinsInGame` 依赖 `t_skin.is_active` 总量，后台同步皮肤会改变这个数，缓存容易过期；且含 `completionRate` 等派生字段。
- 键名与 A0 那套 `lol:inv:owned:{cookieHash}` 不冲突。

### 小程序侧

#### 1. 鉴赏页打标

新增 `utils/owned-skins.js`——模块级单例 + `wx.setStorage` 缓存（TTL 10 分钟）：

```js
load()          // 幂等：缓存新鲜直接返回，否则 GET /api/skins/my-owned
isOwned(skinId) // Set.has(skinId)  —— 传的是 skin.skinId，不是 skin.id
hasSnapshot()   // lastSyncAt != null —— 区分「没同步过」和「同步了但 0 个」
getLastSyncAt()
```

- **调接口前必须先 `Auth.isLoggedIn()`**（`utils/auth.js:18`）。否则 401 会触发 `utils/request.js:99 / :196` 的 `handleTokenExpired()`，把用户 token 清掉并 `reLaunch` 到登录页——游客误触就掉登录态。
- 注入点：`pages/hero-detail/hero-detail`（`SkinApi.getSkinList` 拉皮肤的那页）、`pages/skin-detail`、`components/skin-drawer`、`components/hero-detail-panel` 的 `onLoad` / `onShow` 里调 `load()`。幂等，缓存新鲜时不发请求。
- 徽标形态：缩略图上用**右上角小圆点 + 轻微高亮边框**（不遮挡图片）；皮肤详情页可用文字标签「已拥有」。
- **join 键是 `skin.skinId`**：`skin.skinId == null` 的皮肤无法比对 → 不显示徽标（与桌面端皮肤总览口径一致）。
- **后端未升级的保险**：若 `skin.skinId` 这个 key 在响应里**整个不存在**（老后端 `SkinVO` 没这个字段），说明整个后端没升级 → 全部不显示徽标，不能拿 `undefined` 去 join（`undefined` 命中任何 key 都会得到假阳性）。桌面端已有同款判断：`catalog.ts:112` 的 `skinIdFieldPresent`。
- 收藏册页的皮肤清单里，同样用 `skin.skinId` 比对。

#### 2. 我的皮肤收藏册

新页面 `pages/collection/collection`，`app.json` 的 `pages` 数组加路由。

**入口放哪：** tabBar 现在是 5 项（活动 / 攻略 / 高分 / 英雄 / 我的），**不加第 6 个 tab**。入口放在 tabBar 的「我的」页（`pages/profile/profile`）里，跟「桌面同步码」入口（`onSyncCodeTap`）并列。个人中心的 `assets/discount.png` / `discount-active.png` 是当初为旧藏品 tab 留的孤儿素材，正好拿来当收藏册入口图标。

```
┌ 总览卡 ──────────────────┐
│  3.74%                    │
│  已拥有 80 / 2138         │
│  另有 7 个目录未收录      │
│  上次同步 3 小时前        │
└───────────────────────────┘
┌ 英雄卡片墙（2 列）────────┐
│ ┌────────┐  ┌────────┐    │
│ │ [头像] │  │ [头像] │    │
│ │ 暗裔剑魔│  │ 冰霜女巫│    │
│ │ 12/56  │  │ 0/45   │    │
│ │ ▓▓▓░░░ │  │ ░░░░░░ │    │
│ └────────┘  └────────┘    │
└───────────────────────────┘
```

- **总览卡同时展示两个数，别只显示一个。** `totalOwnedCount`（已拥有总数，含目录未收录的）和 `ownedMatchedCount`（已拥有 ∩ 目录）不是一回事。例：已拥有 87 个，其中 7 个目录里查不到 → 卡片主数字写「80 / 2138」，旁边补一行「另有 7 个目录未收录」。只显示 80 会让用户以为丢了 7 个皮肤；只显示 87 会让 87/2138 跟百分比对不上。
- 点英雄卡 → 展开该英雄的皮肤清单（已拥有彩色 / 未拥有置灰），交互复用桌面端皮肤总览那套。清单里的「已拥有」同样按 `skin.skinId` 比对；`skin.skinId` 为 null 的皮肤归入「目录未收录」。
- 空态（`lastSyncAt == null`）：「还没有皮肤数据」+「打开桌面端同步」引导。
- ⚠️ 小程序不能用 CSS Grid（`grid-column` 会被静默忽略导致单列塌陷），横向排列一律 flex + absolute + 百分比。

#### 3. 降级矩阵

「登录未绑定桌面端」和「已绑定但还没同步过」在数据上是**同一状态**（`lastSyncAt == null`），体验上也该一样——都是「还没数据，去同步」，所以不区分：

| 状态 | 鉴赏页 | 收藏册 |
|---|---|---|
| 未登录 | 无徽标 | 进不去（被踢登录页） |
| 已登录 · `lastSyncAt == null` | 无徽标 | 空态 + 引导 |
| 已登录 · `lastSyncAt != null` | 有徽标 | 正常 |

### 桌面端侧

#### 1. 启动自动同步

`Sync.vue` 是默认路由（`/` → `/sync`），其 `onMounted`（`Sync.vue:254-260`）等价于应用启动。现有流程：

```
auth.refresh() → onCheckLcu() → 若 running 则 onFetchSkins()
```

改为在其后追加一步：

```
auth.refresh() → onCheckLcu() → 若 running 则 onFetchSkins()
                                        ↓
                                  若 loggedIn → 自动 sync
```

- **静默**：新增 `autoSync` 标志。自动同步失败只 `pushLog` 到控制台，**不弹 `ElNotification`**——用户没主动要求，不该被打扰。
- 手动「Sync now」按钮保留，其失败路径照旧弹提示（`Sync.vue:244-248`）。
- 自动同步复用现成的 `onSync()` 逻辑，只是把错误提示换成只记 log。

#### 2. 本地节流

后端限频是「相邻 ≥ 10 秒 + 60 秒内最多 5 次」——`PlayerSkinSyncServiceImpl:63` 用的就是 `inventorySyncLimiter`（`RateLimiterConfig:44-46`），key 是 `skin-sync:{userId}`。用户频繁重开应用会直接撞上 `RateLimitedException`，而自动同步是静默的——用户只会觉得「怎么数据不更新」。

桌面端持久化 `lastSyncAt` 到 `app.getPath('userData')/sync-state.json`（普通 JSON，无需加密）：

| 场景 | 行为 |
|---|---|
| 自动同步 · 距上次成功同步 < 60 秒 | **跳过**，记一条 log |
| 自动同步 · 距上次成功同步 ≥ 60 秒 | 发请求 |
| 手动 Sync now · 距上次同步 < 10 秒 | 不发请求，提示「刚刚已同步过」 |

（后端限频是 10 秒最小间隔，本地手动同步用同样的 10 秒阈值；自动同步放宽到 60 秒，因为启动时同步本身就没必要那么频繁。）

#### 3. 皮肤总览弹窗接入

- `src/main/catalog.ts` 的 `fetchMyOwned` 改读新结构的 `ownedSkinIds`。
- `SkinOverviewDialog` 的统计条加「上次同步于 X」和收集率百分比。
- `useSkinCatalog` 的三级降级不变（LCU 实时 → 后端快照 → 空集），只是 backend 分支现在能多拿一个 `lastSyncAt`。

### 安全收窄：独立的 DESKTOP token

现状：桌面端兑换到的是小程序的全权限 `USER` token（`JwtService.TOKEN_TYPE_USER`），能调所有小程序接口——发帖、评论、改资料全都行。

`JwtService` 里已有 `tokenType` claim（`USER` / `ADMIN`），`RoleInterceptor` 就是靠它区分的——复用现成机制，不另造一套。

```
JwtService
  加 TOKEN_TYPE_DESKTOP = "DESKTOP" + generateDesktopToken(userId, openid)
  （generate(userId, openid, tokenType) 目前是 private，要新开一个 public 包装）

SyncCodeController
  新增 POST /api/sync-code/redeem-desktop
    逻辑与 /redeem 一致（同一个 Redis 键、同样的 Lua 原子取值+删除、同样 IP 失败计数限频），
    只是签 DESKTOP token
    为什么必须单开端点：同步码本身不记录是谁在兑换，兑换方无法从码里判断身份

@AllowsDesktopToken 注解 + DesktopScopeInterceptor
  规则：tokenType == DESKTOP 时，方法上没有 @AllowsDesktopToken → 403
        tokenType != DESKTOP → 直接放行（小程序 / 后台管理的 token 行为完全不变）
  标注 3 个方法：sync-user-skins / my-owned / my-collection
```

**用注解而不是路径白名单**：注解是「默认拒绝」——以后新增接口忘了标注，桌面 token 是访问不了的（fail-safe）；路径白名单则会漏。顺带绕开 context-path 是 `/api`、`request.getRequestURI()` 带 `/api` 前缀的坑。

`RoleInterceptor` 的现成模式可照抄：方法上没有 `@RequiresRole` 就 `return true` 放行；`DesktopScopeInterceptor` 是它的镜像逻辑（没有 `@AllowsDesktopToken` 就拦）。两个拦截器互不干扰，可以共存。

桌面端 `src/main/auth.ts` 的 `redeemSyncCode` 改调 `/api/sync-code/redeem-desktop`。

### 死代码：保留但标状态

A0 那套（`LolInventoryController` / `LolInventoryService(Impl)` / `InventoryProvider` / `TencentInventoryProvider` / `MockInventoryProvider` / `LcuAuthDTO` / `CookieContext` / `PlayerSkinStatusVO` / `SkinItemVO`）**原样保留，不删**。

理由：A0 文档状态是「进行中」，那条路线（后端直拉腾讯接口、小程序直连、彻底不要桌面端）是**另一个独立方向**，不是死代码。删了就把那个方向也删了。

只在 A0 文档加一行状态说明：「本次联动确定走桌面端路线，A0 暂缓，未参与本次改动」。同时**修正 A0 文档里已经过时的那句**（`2026-08-18-a0-tencent-inventory-research.md:15`：「新加 `GET /api/skins/my-owned` 已让小程序读 `t_user_skin`(Electron 写)」）——小程序侧那次调用在 2026-10-22 论坛 tab 重构里已经连同 `api/inventory.js` 一起删了。

### 错误处理与边界

| 场景 | 行为 |
|---|---|
| 桌面端未登录 | 停在登录页，不做任何事，不发请求 |
| 桌面端已登录但游戏客户端没开 | LCU 探测失败 → 不同步，界面显示「League client not detected」 |
| 自动同步被后端限频（429） | 静默失败，只写 log（本地节流已挡掉大部分，剩余情况由用户手动 Sync now 重试） |
| 自动同步时 PUUID 不匹配 | 后端返回 403「账号已绑定其他 LOL 账号」→ 静默失败，但 log 要记清楚（这是需要用户知道的问题） |
| 小程序未登录调 `my-owned` | 401 → `handleTokenExpired()` 清 token 跳登录页（因此前端要先判 `isLoggedIn()`） |
| 小程序后端未升级（无 `skinId` 字段） | 全局不显示徽标，不做 join |
| 小程序目录里 `skin.skinId` 为 null | 无法比对，不显示徽标 |
| 后端 `t_skin` 里某个 owned skin_id 已下线 | 仍出现在 `ownedSkinIds` 里，但不进目录匹配数 → 计入 `totalOwnedCount` 不计入 `ownedMatchedCount`，收藏册展示为「目录未收录」 |

### 已知取舍

**`t_user_skin` 只增不减。** `batchUpsert` 只有 `ON DUPLICATE KEY UPDATE last_seen_at = NOW()`，没有「这次没出现就标记为失去」的逻辑——「已拥有」是**历史累计**而非当前快照。

LOL 皮肤不可退还、账号级永久拥有，实践中几乎不会出错。但它跟「打开桌面端自动同步」的语义有偏差：用户期待的其实是「当前拥有」。要做严格语义得给 `t_user_skin` 加 `is_owned` 列做软删除（要 DDL 迁移 + 改 upsert 逻辑 + 改所有读取点）。

**本次决定：接受只增不减**，并且接口文档和收藏册页面**不宣称「实时拥有」**，统一表述为「上次同步时的收藏」。若将来出现皮肤确实失去的情况，再单独排期做软删除。

---

## Testing

### 后端（JUnit 5 + Mockito，根 pom 默认 `maven.test.skip=true`，跑测试须加 `-Dmaven.test.skip=false`）

- `MyOwnedSummaryControllerTest`
  - 无 token → 401；token 无效 → 401
  - 返回结构含 `ownedSkinIds` / `totalOwnedCount` / `lastSyncAt`
  - `t_user_skin` 无行 → `ownedSkinIds` 为空、`lastSyncAt` 为 null
- `MyCollectionControllerTest`
  - `ownedMatchedCount` 用交集算：构造「有目录外的已拥有皮肤」场景，断言 `completionRate` 不虚高
  - `byHero` 只含有 active 皮肤的英雄
  - `heroId` 取 `t_hero.id`
- `PlayerSkinStatusAssemblerTest`
  - `assemble` 输出与重构前**逐字节一致**（assembler 类注释的硬契约，`LolInventoryServiceImplTest` 也要一起跑）
- `PlayerSkinSyncServiceImplTest`（扩展现有）
  - 同步成功后 `skin:owned:ids:{userId}` 缓存被删除
- `DesktopScopeInterceptorTest`
  - DESKTOP token 调未标注 `@AllowsDesktopToken` 的方法 → 403
  - DESKTOP token 调已标注方法 → 200
  - USER token 调同样方法 → 200（行为不变）

### 桌面端（vitest）

- `src/main/__tests__/catalog.test.ts`：更新 `fetchMyOwned` 的解析断言（`ownedSkinIds`）。
- 新增节流逻辑的纯函数测试：距上次同步 < 60 秒跳过自动同步；手动同步 < 10 秒不发请求。
- `src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts`：现有 112 个用例保持通过。

### 小程序（`node --test`，跑法 `node --test tests/xxx.test.js`）

- `tests/owned-skins.test.js`：`hasSnapshot` / `isOwned` / 缓存新鲜度判断 / 「`skinId` 字段整体缺失时不 join」（纯逻辑部分抽成可导出函数）。
- `tests/collection-relative-time.test.js`：相对时间格式化（「3 小时前」）抽纯函数后测试。

---

## 交付顺序

```
1. 后端   MyOwnedSummaryVO + 改造 my-owned + my-collection + 缓存失效 + DESKTOP token + 作用域拦截器
2. 桌面端 catalog.ts 改结构 + 启动自动同步 + 本地节流 + 弹窗显示上次同步与收集率
3. 小程序 utils/owned-skins + 鉴赏页徽标 + 收藏册页 + 个人中心入口与空态
4. 联调 + 手工验收
```

先做后端，因为桌面端和小程序都依赖新的接口结构。
