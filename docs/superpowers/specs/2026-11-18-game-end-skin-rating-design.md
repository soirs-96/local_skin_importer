# 局末皮肤评分卡 —— 设计文档

日期：2026-11-18
范围：`local_skin_importer`（Electron 桌面端）+ `all_function_api`（后端，小改）

**Goal：** 打完一局 → 自动弹出「这局用的皮肤」结算卡 → 用**微信小程序同一套打分机制**给这款皮肤打星 → 分数进同一个库，小程序榜单同步可见。

**相关文档：**
- `docs/superpowers/specs/2026-11-13-player-match-rating-design.md` —— 玩家**表现分**（另一套评分，别混）
- `docs/superpowers/specs/2026-10-30-desktop-mini-program-linkage-design.md` —— 桌面端 ↔ 小程序联动（DESKTOP token 收窄的来由）
- `wechat_rating_program/components/skin-drawer/index.js` —— 小程序打分表单（**口径来源**）
- `wechat_rating_program/pages/skin-detail/index.js` —— 小程序皮肤详情页（**段位口径来源**）
- `all_function_api/skin/.../controller/RatingController.java` —— 后端评分接口（**总分算法来源**）

**跨仓库：** 本设计横跨两个仓库，路径相对 `D:\Code\Front_Project\all\`：`all_function_api/`（后端）、`local_skin_importer/`（桌面端）。小程序仓库 `wechat_rating_program/` **本次不改**——它只是口径来源。

三套入口 URL 不同但都是同一个后端：桌面端直连 `http://101.34.210.254`（`src/main/catalog.ts:4`），小程序走 `https://www.sxdtaz.cn`（`wechat_rating_program/utils/config.js:6`）。

---

## Background

桌面端已经有「对局」页，能看到两队人、每个人的最近 10 场排位表现分（`src/shared/scoring.ts`），但**没有跟皮肤鉴赏这条线打通**——打完一局用了哪款皮肤、这款皮肤在小程序里被打了多少分，桌面端一概不知道。

微信小程序（皮肤鉴赏）有一套成熟的皮肤打分机制：四个维度各打 1~5 星，后端按固定权重算总分，用户评价进 `t_rating`，聚合进 `t_skin` 的冗余列，排行榜按维度排序。这套机制**已经有 2138 款皮肤、484 款有评分、499 条评价**在生产库里，是现成的资产。

用户诉求原话：「能不能读到使用的那款皮肤 直接游戏结束可以出现打分界面」，并明确「给这局使用的皮肤打分 引入我们微信小程序的打分机制」。

**这是一次「把已有的服务端能力接到桌面端」的事**，不是新建一套评分体系。

---

## Scope

**In scope**

- 桌面端在局末自动检测到「这一局结束了」，并弹出结算卡
- 结算卡识别出**我这局用的皮肤**，映射到站内目录 id
- 结算卡展示该皮肤的小程序现有评分（总分 / 四维 / 段位 / 评价数）+ 本局战绩
- 结算卡提供四维星级打分表单，提交到**同一个后端接口**，与小程序同一套口径、同一份数据
- 后端小改：皮肤列表支持按 Riot skinId 过滤；评分接口对 DESKTOP token 放行

**Out of scope**

- **不改小程序代码**。它的评分页、榜单页、段位文案一个字不动。
- 不做「十个人的皮肤」。只读**我自己**这一局用的那一款（用户已确认）。
- 不做对手结算面板、不做战绩排行、不做皮肤推荐。
- 不做历史沉淀（"我打过的分"存在后端 `t_rating`，桌面端不另存）。
- 不改后端评分算法与权重。
- 不做「局中实时打分」——只在局末弹。

---

## 关键口径

### 1. 分制与段位：从小程序**搬口径**，不是搬代码

小程序的 `utils/rating-tier.js` 与 `pages/skin-detail/index.js` 是原生小程序 JS，搬不进 Vue 3。桌面端在 `src/shared/ratingTier.ts` 重建**同口径**实现，并用单测锁死：

| 口径 | 定义 | 来源 |
|---|---|---|
| `toTen(v)` | `round(v × 2 × 10) / 10` —— 1~5 分制展示成 10 分制，保留 1 位小数 | `wechat_rating_program/utils/rating-tier.js:20` |
| `scoreToTier(total10)` | ≥9.0 夯 / ≥8.0 顶级 / ≥6.5 人上人 / ≥5.0 NPC / <5.0 拉完了 | `pages/skin-detail/index.js:6-13` |
| `rankMap(stars)` | 5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了 —— 吃的是**单维星级** | `components/skin-drawer/index.js:42-48` |
| 维度标签 | 综合总分 / 手感巅峰 / 原画天花板 / 局部模型 / 嘲讽拉满 | `pages/skin-detail/index.js:133-139` |

⚠️ **`scoreToTier` 和 `rankMap` 口径不一样**：前者吃聚合总分（10 分制），后者吃单维星级（1~5 颗星）。总分 5.0 在 `scoreToTier` 里是「NPC」，但 2.5 颗星在 `rankMap` 里没有对应项。**两套都要，不能合并成一个函数**，也不能凭「看起来对」改阈值。

⚠️ **`src/shared/scoring.ts` 是另一套东西**（玩家表现分，见 `2026-11-13-player-match-rating-design.md`）。本次新增的是**皮肤**评分，文件命名（`ratingTier.ts` / `skinRating.ts`）必须跟它区分开，别混进 `scoring.ts`。

### 2. 三种皮肤 ID（最容易踩坑的地方）

| 名字 | 是什么 | 出处 | 本次用在哪 |
|---|---|---|---|
| `t_skin.id` | DB 自增主键（**站内 id**） | `SkinVO.id` | **打分接口要的就是它**（`POST /api/ratings` 的 `skinId`） |
| `t_skin.skin_id` | **游戏内皮肤 ID**（= Riot itemId = LCU 皮肤 id） | `SkinVO.skinId` | 局内读到的是这个 |
| `t_hero.id` | DB 主键，`t_skin.hero_id` 指向它 | `Hero.id` | — |

⚠️ **`t_skin.hero_id` 是站内 `t_hero.id`，不是 Riot championId。** 所以**不能用 `heroId` 过滤去定位皮肤**——局内拿到的是 Riot championId，两套不是一个数，绕不过去。

⇒ 定位皮肤走 **`skinId` 过滤**：`GET /api/skins/list?skinId={Riot skinId}` 精确命中一条。

### 3. 局内怎么读到「我用的皮肤」

四条兜底链，按可靠度依次降级 —— 完整表格见「关键口径 7」。要点：**选人会话只在选人阶段存在**，局末已 404，所以必须在选人阶段就记下来。

### 4. 局末怎么检测

`gameflow` 的 `phase` 进入「结束」段。`src/shared/gameLabels.ts:433-442` 的 `LCU_PHASE_LABELS` 已经把这三个阶段都映射成「对局结束」：

| phase | 时机 | 2999 端口 |
|---|---|---|
| `PreEndOfGame` | 终局判定已出、结算画面还没上 | **还活着**（最后一帧数据最完整） |
| `EndOfGame` | 结算画面 | 可能已关 |
| `PostGame` | 结算后 | 已关 |

⇒ **触发集 = `{PreEndOfGame, EndOfGame, PostGame}`**，取**第一个**进入的那个（通常是 `PreEndOfGame`，此时 2999 还活着、即时战绩最全）。判定直接用 `lcuPhaseLabel(phase) === '对局结束'`，不新造枚举。

轮询器现在的 `MatchState` 只有 `idle` / `lobby` / `champ_select` / `in_game`，**没有「局末」**。加一条**边沿检测**：phase 从「局中」进入「结束」的那一次触发，同一局只触发一次（去重用 `(championId, skinId, 本局开始时间戳)`）。

### 5. 本局战绩从哪来

**客户端自己的 match history 就够了** —— `/lol-match-history/v1/products/lol/current-summoner/matches`，`recentMatches.ts` 已经在解析它，`parseMatchEntry` 读出来的东西直接能用：

| 数据 | 字段 | 现状 |
|---|---|---|
| 胜负 | `stats.win` | `parseMatchEntry` 已读成 `win` |
| KDA | `stats.kills / deaths / assists` | 已读 |
| 补刀 | `stats.totalMinionsKilled` | 已读 |
| 时长 | `gameDuration` | 已读 |
| 位置 | `timeline.lane` / `timeline.role` / `stats.roleBoundItemName` | 已读（`roleBoundItemName` 是最不会写错的位置来源——名字里写着「下路任务」「中路任务」） |
| 模式 / 队列 | `gameMode` / `mapId` / `queueId` / `queueType` | 已读 |
| 装备 | `stats.item0..6` | 已读（转成带图标的 item） |
| 英雄 | `championId` | 已读 |

⚠️ **唯一的坑：落库延迟。** 客户端要等游戏服务器把战绩同步过来，局末那一瞬间往往还查不到刚打完的这局。

⇒ **两段式取数**：

- **立即段**（弹窗秒开）：Live Client 2999 的**最后一帧**给 KDA / 补刀 / 经济 / 伤害 / 等级 / 装备 —— 游戏内最后一帧就是终局数据，不依赖落库。
- **补齐段**（弹窗开着的时候）：查一次 match history，定位到刚打完的那一局后**把胜负、时长、位置补上**。

**怎么定位「刚打完的那一局」**：match history 返回最近 20 局，每局有 `gameCreation`（毫秒时间戳）和 `championId`。取 **`gameCreation` 距今 30 分钟内 + `championId` 与本局英雄一致**的那些里最新的一个。查不到就保持缺失，不显示。

**2999 端口在局末会关。** 结算界面那段时间它还活着，之后就没了。所以轮询器要**缓存最后一次成功的 live 数据**——现在 `collect()` 里 `live` 为 null 时直接把上一次的丢掉（`poller.ts:471-482`），改成保留 `lastLive`。

⚠️ **不放假数据。** 拿不到的字段整块不显示，不写「0」「—」以外的占位。

### 6. 桌面端怎么知道「我的 userId」

查「我打过的分」要用 `GET /api/ratings?userId={我的userId}`，而后端的 `isSelfQuery` 是拿 **token 里的 userId** 去比对的。

桌面端现在**只持久化了 token，没存 userId**（`src/main/auth.ts` 的 `saveToken` 只写 JWT 本身；兑换接口其实返回了 `userId`，但 `RedeemEnvelope` 的类型声明把它丢了）。

⇒ **不改存储，直接从 JWT 里解。** `JwtService.generate` 签的 claim 是 `userId` / `openid` / `tokenType`（`JwtService.java:80-83`），而 `auth.ts` 里已经有解码 JWT payload 的代码（`readTokenExpiry`）。在旁边加一个 `readTokenUserId(jwt)` 即可，**老 token 也立刻能用**，不用让用户重新兑换同步码。

### 7. 皮肤 id 的兜底链（补充）

见「关键口径 3」。链条比初稿多一环：

| 优先级 | 来源 | 可靠性 | 说明 |
|---|---|---|---|
| 1 | 选人会话 `/lol-champ-select/v1/session` 的 `myTeam[localPlayerCellId].skinId` | 高 | 轮询器每轮都拉选人会话，**在选人阶段记一次**即可。选人会话只在选人阶段存在，局末已 404 —— 所以必须提前记。 |
| 2 | LCU match history 的 participant 里如果有 skin 字段 | 中 | 待探测（探测 2）。**局后可用，不依赖选人阶段** —— 比初稿多这一环是因为它同时能给出胜负。 |
| 3 | Live Client `/liveclientdata/allgamedata` 的 `allPlayers[].skin` | 中 | 是英文 display name（如 `game_character_displayname_Ahri_Snow_Dawn`），要反查客户端 `skins.json` 才能拿到 Riot skinId，匹配有风险。 |
| 4 | 都拿不到 → 只有英雄 id | 低 | 按**英雄默认皮肤**（`skinId % 1000 === 0`）处理，UI 上**必须明写「未识别到具体皮肤」**，不能装作知道。 |

---

## Design

### 整体数据流

```
【① 选人阶段】轮询器每轮拉选人会话
   myTeam[localPlayerCellId].championId + skinId
        └─→ 记录到内存（仅本局）
              │
【② 局末】gameflow.phase → PreEndOfGame / EndOfGame / PostGame（边沿触发一次）
   同时缓存 lastLive（2999 最后一帧）+ lastGameflow
        └─ 弹窗先拿 lastLive 的即时战绩，再补 match history 的胜负/时长/位置
              （match history 有落库延迟，补齐段晚一步到）
        │
【③ 定位皮肤】
   GET /api/skins/list?skinId={Riot skinId}&size=1
        → { id: 站内id, name, nameEn, rarity, iconUrl, splashUrl, heroId }
        │  （目录里没有这条 → 提示「这款皮肤不在皮肤鉴赏目录里」，不给打分表单）
【④ 拉评分】
   GET /api/ratings/skin-stats?skinIds={站内id}   → 现有总分/四维/评价数/段位
   GET /api/ratings?userId={我的userId}&skinId={站内id}  → 我打过的分（回填）
        │
【⑤ 弹窗】渲染进程：应用内 overlay；窗口不可见 → Electron 系统通知（点击进来再开）
        │
【⑥ 提交】
   POST /api/ratings   (Bearer: 桌面端 DESKTOP token)
   { skinId: 站内id, handFeel, artwork, model, mockery }
        │  后端 calculateScore：0.35×手感 + 0.25×原画 + 0.25×模型 + 0.15×嘲讽
【⑦ 回写】重拉 ④ → 角标更新
```

### 后端改动（`all_function_api`，共两处）

#### 改动 A：`GET /api/skins/list` 支持按 Riot skinId 过滤

现在 `SkinQueryDTO` 只有 `current / size / heroId / seriesId / rarity / keyword / pool / status`，**没有 skinId**（`heroId` 是站内 id，用不上）。

改 4 个点，全是照抄现有过滤条件的写法（`SkinServiceImpl:72-80` 用的是 MyBatis-Plus `LambdaQueryWrapper`）：

| 文件 | 改动 |
|---|---|
| `skin/.../dto/SkinQueryDTO.java` | 加 `private Long skinId;`（`@Schema(description = "游戏内皮肤ID(t_skin.skin_id,可选)")`） |
| `skin/.../controller/SkinController.java` | `listSkins` 把 `dto.getSkinId()` 传下去 |
| `skin/.../service/SkinService.java` | `listSkins` 签名加 `Long skinId` |
| `skin/.../service/impl/SkinServiceImpl.java` | 签名加参数 + `if (skinId != null) { queryWrapper.eq(Skin::getSkinId, skinId); }` |

`status` 不传 = 只看上架（既有行为不变）。皮肤被下架时查不到 → 桌面端按「不在目录里」处理。

⚠️ **桌面端调这个接口必须「匿名」——不附 Authorization 头。** 桌面端**没有全局 axios 拦截器**，是每个调用点自己决定带不带头：`catalog.ts:91` 拉目录不带（匿名），`catalog.ts:152` 拉 `my-owned` 才带。而 `SkinController.listSkins` 没有 `@AllowsDesktopToken`，**带了 DESKTOP token 反而 403**。所以定位皮肤这一步要**沿用 `catalog.ts` 的匿名写法**，别图省事塞进带 token 的统一封装里。

⚠️ **不要想着复用渲染进程那份 1.2 万条目录缓存。** `useSkinCatalog.ts:14` 的 `catalogCache` 是渲染进程里的模块级缓存，但**只有调过 `load()` 的页面才会有**——结算弹窗多半出现在「对局」页，那时目录还没拉过，硬要用就得在局末再拉一次几 MB 的 JSON（60s 超时）。局末这个节点上，一条 `?skinId=` 的窄查询才是对的。

#### 改动 B：评分接口对 DESKTOP token 放行

⚠️ **桌面端现在是打不了分的。** `DesktopScopeInterceptor` 的规则是「`tokenType == DESKTOP` 且方法上没有 `@AllowsDesktopToken` → 403」，目前只标了 4 个方法（`SkinSyncController` 的 `sync-user-skins` / `my-owned` / `my-collection` 等）。

⚠️ 而且它是**看 tokenType 就拦**的，不是看方法要不要鉴权 —— 桌面端**带 token** 调 `GET /api/ratings/skin-stats` 也会 403，哪怕这个接口本来公开读。

所以给 `RatingController` 三个方法加 `@AllowsDesktopToken`：

| 方法 | 要不要加 | 理由 |
|---|---|---|
| `POST /api/ratings`（create） | **必须** | 否则桌面端完全没法提交评分 |
| `GET /api/ratings`（list） | **必须** | 查「我打过的分」必须带 token（`isSelfQuery` 靠 token 里的 userId 判定） |
| `GET /api/ratings/skin-stats` | **必须** | 这个接口本身不含官方评价过滤（`skinStats` 里没有 `officialOnly` 逻辑，匿名也能查），但桌面端的 `rating.ts` 三个接口走同一个带 token 的封装，带头就会被拦 —— 统一标上比「这个接口特殊、要记得别带头」可靠 |

**口径不会因此变松。** `list` 的「官方评价」口径由 `isAdminCaller` / `isSelfQuery` 决定，桌面 token 既不是 admin、`userId` 又是自己，所以拿到的跟小程序**完全一样**（有文字、且作者是超管的那批）。DESKTOP token 不是 admin token，`isAdminCaller` 判 false。

**用户身份是同一个。** `JwtService.generateDesktopToken(userId, openid)` 签的 token 里有 userId claim，`RatingController.create` 用 `extractUserId(request)` 从 token 取 userId（不信请求体）—— 所以**桌面端打的分算在同一个用户头上，小程序看得到、反过来也一样**，`(userId, skinId)` 重复提交是 upsert（覆盖）。

### 桌面端改动（`local_skin_importer`）

| 文件 | 职责 |
|---|---|
| `src/shared/ratingTier.ts` | **新增** —— 分制/段位口径（纯函数，无 IO） |
| `src/shared/__tests__/ratingTier.test.ts` | **新增** —— 口径单测（锁死与小程序一致） |
| `src/shared/match.ts` | `MatchSnapshot` 加 `settlement: SettlementSnapshot \| null`；新增 `SettlementSnapshot` 类型 |
| `src/main/auth.ts` | 加 `readTokenUserId(jwt)`（跟 `readTokenExpiry` 并列，解 JWT payload 的 `userId` claim） |
| `src/main/rating.ts` | **新增** —— 后端三接口（拉聚合 / 查我的分 / 提交评分） |
| `src/main/catalog.ts` | 加 `fetchCatalogSkinBySkinId(riotSkinId)` —— 匿名调 `/api/skins/list?skinId=`，返回站内 id + 名字/图标/稀有度 |
| `src/main/match/usedSkin.ts` | **新增** —— 纯解析：记下本局我用的 Riot skinId（选人会话 / match history / Live Client 三条来源），**不碰网络** |
| `src/main/match/liveClient.ts` | 加 `/liveclientdata/playerstats` 解析（即时战绩：KDA / 补刀 / 经济 / 伤害 / 等级 / 装备） |
| `src/main/match/recentMatches.ts` | 加「定位刚打完的那一局」helper（30 分钟内 + championId 匹配，取最新） |
| `src/main/match/poller.ts` | 局末边沿检测；缓存 `lastLive` / `lastGameflow` / `usedSkin` |
| `src/main/ipc.ts` + `src/preload/index.ts` | 新增通道 `match:get-settlement` / `rating:submit` 等 |
| `src/renderer/src/components/match/SkinRatingDialog.vue` | **新增** —— 结算卡弹窗 |

⚠️ **不改 `Opponent`。** 初稿想在 gameflow 的 `Opponent` 上加位置字段，评审后**取消**：match history 的 `roleBoundItemName`（名字里写着「下路任务」「中路任务」）是更准的位置来源，gameflow 的 `selectedPosition` 是**玩家自己选的位置**、不是实际打的路，两者口径不同，混进对局页的现有卡片反而会跟既有显示打架。位置只在结算卡里用。

### 结算卡界面

海克斯科技主题（近黑底 + 金边金字 + 魔法蓝高亮；蓝 = 核心操作，金 = 次级操作），跟现有 `OpponentsCard.vue` / `RecommendationCard.vue` 同一套 CSS 变量。

```
┌──────────────────────────────────────────────┐
│ 本局结算                          [×]         │
├──────────────────────────────────────────────┤
│  ┌────────┐   死亡誓约 · 维克托                │
│  │ 皮肤立绘 │   传说                            │
│  │        │   本局 中路 · 8/2/5 · 补刀 186     │
│  └────────┘   胜利 · 28:41 · 排位              │
│                                               │
│  现有评分                                     │
│  ┌───────────────────────────────────────┐    │
│  │  8.4  顶级   12 人评过                  │    │
│  │  手感 8.0  原画 9.0  模型 8.5  嘲讽 7.0 │    │
│  └───────────────────────────────────────┘    │
│                                               │
│  给它打分                                     │
│  手感巅峰   ★ ★ ★ ★ ☆                        │
│  原画天花板  ★ ★ ★ ★ ★                        │
│  局部模型   ★ ★ ★ ☆ ☆                        │
│  嘲讽拉满   ★ ★ ★ ☆ ☆                        │
│                                               │
│  你已打过（提交会覆盖）                        │
│                            [ 提交评分 ]      │
└──────────────────────────────────────────────┘
```

- **星级**用 `el-rate`（1~5 星，允许半星？**不允许**——小程序是整数星，后端按 1~5 存，半星会被四舍五入成不同值，破坏口径对齐）。
- **四个维度的标签**照抄小程序的「手感巅峰 / 原画天花板 / 局部模型 / 嘲讽拉满」，不要改成「手感 / 画质」之类的近义词。
- 提交按钮是**魔法蓝**（核心操作）；「稍后再评」是金色文字按钮（次级操作）。
- 皮肤图降级链：**图标 → 原画 → 占位符**（照抄小程序 `skin-drawer` 的 `_resetImage` / `onImgError` 逻辑——腾讯 CDN 偶发皮肤图标 404，不降级就是一块空白格）。
- **没登录**（没有本地 token）：显示现有评分和本局战绩，星级与提交按钮禁用，提示「用同步码登录后才能打分」（跟小程序「登录之后方可打分」同一口径）。
- **皮肤不在目录里**：显示皮肤名和本局战绩，**不显示打分表单**，提示「这款皮肤还不在皮肤鉴赏目录里」。
- **已经打过分**：表单回填我那一评的四维，标一行「你已打过，再提交会覆盖」。

### 弹窗的触发与去重

- 窗口可见 → 应用内 overlay
- 窗口不可见 / 最小化 → Electron `new Notification()`，点击跳到对局页并打开弹窗
- **同一局只弹一次**：去重键 = `(championId, skinId, 本局开始时间戳)`
- 弹窗可以关掉；关掉后这一局不再自动弹（不重复打扰），但结算快照仍留在 `MatchSnapshot.settlement` 里，对局页可以再打开

### 错误处理矩阵

| 场景 | 行为 |
|---|---|
| 桌面端未登录 | 弹窗照常（显示评分 + 战绩），打分表单禁用 + 提示去登录 |
| 没识别到具体皮肤（兜底 4） | 明写「未识别到具体皮肤，按默认皮肤打分」，或干脆不给表单 —— **不装作知道** |
| 皮肤不在站内目录 | 显示名字/战绩，不给表单，提示「还不在皮肤鉴赏目录里」 |
| 局末时 2999 已关 | 本局战绩那块整块不显示；皮肤和评分照常（皮肤来自选人阶段的记录） |
| match history 还没落库，查不到刚打完那局 | 胜负 / 时长 / 位置先空着，弹窗开着时补一次；补不到就整项不显示，不写「0」 |
| 提交评分 401 | 提示「登录已过期，请用同步码重新登录」，清本地 token（跟 `catalog.ts` 的既有处理一致） |
| 提交评分 403 | 提示「桌面端暂无打分权限」——说明后端没加 `@AllowsDesktopToken`，这是部署顺序问题 |
| 后端 `/api/ratings/skin-stats` 返回空 | 皮肤零评分 → 显示「还没有人评分」，表单照常可用 |

---

## Testing

### 桌面端（vitest）

- `src/shared/__tests__/ratingTier.test.ts`
  - `toTen`：1→2、4.5→9、3→6、null→null、undefined→null
  - `scoreToTier`：9.0→夯、8.9→顶级、8.0→顶级、6.5→人上人、5.0→NPC、4.9→拉完了
  - `rankMap`：5→夯、4→顶级、3→人上人、2→NPC、1→拉完了
  - **`scoreToTier` 与 `rankMap` 不等价**（如总分 5.0→NPC，而 2.5 星在 rankMap 里没有）——用一条断言把这个差异钉死，防止后人「优化」成同一个函数
- `src/main/match/__tests__/usedSkin.test.ts`
  - 选人会话里 skinId 是字符串 / 数字 / 缺失 三种形态都能归一
  - 三条来源优先级：选人会话 > match history > Live Client
  - 一个都没拿到 → null（**不猜**，不按默认皮肤编一个 id）
- `src/main/__tests__/catalog.test.ts`（扩展）
  - `fetchCatalogSkinBySkinId` **不带 Authorization 头**（带 DESKTOP token 会被 `DesktopScopeInterceptor` 拦）
  - 命中返回站内 id + 名字；查不到返回 null（不抛）
- `src/main/match/__tests__/liveClient.test.ts`（新增）
  - `playerstats` 解析：KDA / 补刀 / 经济 / 伤害；字段缺失不崩
- `src/main/match/__tests__/recentMatches.test.ts`（扩展）
  - 「定位刚打完的那一局」：命中 30 分钟内 + championId 匹配的那一局
  - 有多局匹配时取 `gameCreation` 最新的
  - 一局都匹配不上时返回 null（不返回最近的那局冒充）
- `src/main/__tests__/auth.test.ts`（扩展）
  - `readTokenUserId` 解出 payload 里的 userId；token 损坏 / 无 userId claim → null
- `src/main/match/__tests__/poller.test.ts`（扩展）
  - phase 进入 `PreEndOfGame`（以及 `EndOfGame` / `PostGame`）时**只触发一次**；再来一轮不重复触发
  - live 变 null 时 `lastLive` 保留
- `src/main/__tests__/ipc.test.ts` —— 通道数断言要跟着加

### 后端（JUnit 5 + Mockito，根 pom 默认 `maven.test.skip=true`，跑测试须加 `-Dmaven.test.skip=false`）

- `SkinControllerTest` / `SkinServiceImplTest`（扩展）：`skinId` 过滤命中唯一一条；`skinId` 与 `heroId` 同时传时是「与」关系
- `DesktopScopeInterceptorTest`（扩展）：DESKTOP token 调 `POST /api/ratings` → 200；调 `GET /api/ratings/skin-stats` → 200
- `RatingControllerTest`（扩展）：DESKTOP token 提交的评分，`userId` 取自 token（**不信请求体**）

---

## 交付顺序

```
1. 后端   改动 A（skinId 过滤）+ 改动 B（@AllowsDesktopToken）→ 部署
2. 桌面端 shared/ratingTier.ts + 单测 → 跑通
3. 桌面端 主进程：auth 解 userId / usedSkin（纯解析）/ catalog 按 skinId 定位 /
                   liveClient playerstats / recentMatches 定位刚打完那局 /
                   poller 局末检测 / rating.ts
4. 桌面端 渲染进程：SkinRatingDialog.vue + IPC 打通
5. 联调：真实打一局 → 局末弹窗 → 打分 → 小程序榜单能看到
```

后端先上：桌面端的新链路依赖 `/api/skins/list?skinId=` 和 DESKTOP token 能打评分，否则弹窗里查不到皮肤、也提交不了。

---

## 实现前必做的探测（没验证过，不能靠猜）

**探测 1 —— 选人会话里到底有没有 `skinId`、值是什么形态。**
现成脚本，不用写新的：

```powershell
# 在选人阶段跑
node scripts\dump-lcu-champselect.mjs
```

它会打印每个成员的**全部字段**（`full first entry`），并把完整 session 存到 `scripts/champselect-dump.json`。看 `myTeam` 里本地玩家那条有没有 `skinId`，以及是数字还是字符串。

**探测 2 —— LCU match history 的 participant 有没有 skin 字段。**

```powershell
# 打完一局跑
node scripts\dump-lcu-match-history.mjs
```

输出里那行 `participant fields:` 就是全部字段名。

这条探测同时决定两件事：① 兜底链第 2 环成不成立（局后能不能不靠选人阶段就拿到皮肤）；② 局末那一刻 match history 里**有没有刚打完的那一局**（`gameCreation` 是不是已经落库）——这直接决定「补齐段」是秒补还是永远补不上。

**探测 3 —— `t_skin.skin_id` 跟 LCU 的皮肤 id 是不是同一个数。**
拿一个已知皮肤对：局内读到的 Riot skinId，跟 `GET /api/skins/list?skinId=<它>` 能不能命中。

探测结果决定兜底链的最终形态：**探测 1 成功 → 只用兜底 1**；**探测 1 失败 → 靠探测 2 / 3**，实在不行就走兜底 4（默认皮肤 + 明写未识别）。

---

## 已知取舍

**桌面端和小程序共用一个 `t_rating` 写入口，意味着桌面端打的评价会立刻出现在小程序榜单上。** 这是本次的目的，但也意味着桌面端的打分**没有「官方评价」保护**——普通用户写的分数会进聚合（文字不会外露，因为小程序只显示「官方评价」那条）。这是后端既有的口径，桌面端不特殊。

**局末自动弹窗会打断手头操作。** 用户在游戏结束瞬间可能正在做别的事。去重键只保证「一局一次」，不保证「一局只弹一次」。缓解手段：应用窗口不可见时只发系统通知，不抢焦点。

**本局战绩里的「胜负」有延迟。** 客户端的 match history 要等游戏服务器把战绩同步过来，局末那一瞬间往往还查不到刚打完的这局。所以胜负可能晚于弹窗出现，甚至永远不出现（同步失败）。这是**唯一一个可能永远缺项的数据**，设计上接受「缺就缺」——取数因此是两段式的：先拿 2999 最后一帧的即时数据把弹窗撑起来，再补 match history。

**本局战绩不查对手。** 结算卡只讲「我这一局」。十人面板已经在对局页里了（`OpponentsCard.vue`），再做一遍是重复劳动。
