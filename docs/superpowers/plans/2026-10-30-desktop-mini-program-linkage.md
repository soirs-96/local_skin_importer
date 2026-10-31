# 桌面端 ↔ 微信小程序 皮肤联动 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面客户端启动时自动把本机已拥有皮肤同步到后端；微信小程序在鉴赏页给皮肤打「已拥有」徽标，并新增按英雄收集进度的「我的皮肤收藏册」页。

**Architecture:** 桌面端（Electron）从 LCU 抓已拥有皮肤 → `POST /api/skins/sync-user-skins` → 后端写 `t_user_skin`。小程序用 `GET /api/skins/my-owned` 拿 Riot skinId 集合在客户端 join 打徽标；收藏册走新增的 `GET /api/skins/my-collection`（按英雄聚合）。桌面端的 JWT 收窄成独立的 `DESKTOP` token 类型，只能访问白名单方法。

**Tech Stack:** Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + Redis（后端 `all_function_api`）；原生微信小程序 `wx.*` API（`wechat_rating_program`）；Electron 39 + Vue 3.5 + TypeScript 5.9 + vitest 3.2（`local_skin_importer`）。

**设计文档:** `local_skin_importer/docs/superpowers/specs/2026-10-30-desktop-mini-program-linkage-design.md`

---

## 执行须知（先读这段）

**三条硬约束，来自本仓库的既有约定，不要绕过：**

1. **不自动 commit。** 每个 Task 末尾给了 commit 命令，但**只输出给用户跑，不要自己执行**。改动留在工作区 / 暂存区，由用户自己提交。
2. **commit 按阶段分组，不要每 Task 一提交。** 后端一个 commit、桌面端一个、小程序一个（沿用 feature 分支「少量主题分组」的写法）。
3. **Bash 安全分类器可能宕机。** 如果命令被分类器拒绝（报 `claude-sonnet-4-6 is temporarily unavailable`），**不要尝试任何绕过手段**（不要用 `bash xxx.sh`、`npx <cli>`、`.cmd` shim、`run_in_background`、`dangerouslyDisableSandbox`）。改成：把命令写清楚交给用户执行，或改用只读工具（Read / Grep / Glob / Edit / Write）继续干活。

**仓库路径：**

| 仓库 | 绝对路径 | 说明 |
|---|---|---|
| 后端 | `D:\Code\Front_Project\all\all_function_api` | Spring Boot 多模块 Maven |
| 桌面端 | `D:\Code\Front_Project\all\local_skin_importer` | Electron + Vue 3 |
| 小程序 | `D:\Code\Front_Project\all\wechat_rating_program` | 原生微信小程序（**不是 git 仓库**） |

---

## 自检修订记录（2026-10-30）

正式的 plan-document-reviewer 子代理派发被 Bash 安全分类器宕机挡住了
（`claude-sonnet-4-6 is temporarily unavailable`，按既有约定不做任何绕过），
所以改成用只读工具（Read / Grep / Glob）把计划里的断言逐条对源码核了一遍。
**改了 4 处**，都是照抄就会编译不过 / 测试跑红的地方：

| # | 位置 | 问题 | 改法 |
|---|---|---|---|
| 1 | Task 2 Step 1 | `s.setIsActive(1)` —— `Skin.isActive` 的类型是 **`Boolean`** 不是 Integer | 改成 `s.setIsActive(true)` |
| 2 | Task 2 Step 1 | 用了 `org.assertj.core.api.Assertions` —— ⚠️ 原判断「本项目所有 pom 里都没有 assertj 依赖」**是错的**(2026-10-30 复核修正):assertj 由 `spring-boot-starter-test` 传递带入,`skin`/`app` 模块已有测试在用 `assertThat` | 断言仍统一改成 JUnit 5 原生 `org.junit.jupiter.api.Assertions.assertEquals`(与本次新增测试的实现一致),但**理由改为「与本批测试的其余断言风格统一」,不是「找不到依赖」**;顺手删掉原来那条「如果找不到就换 JUnit」的含糊提示 |
| 3 | Task 9 Step 1 | `normalizePayload` 的**测试和实现自相矛盾**：测试断言「以列表为准」(2)，实现返回「以服务端为准」(9) | 统一成**以服务端为准**（跟桌面端 `fetchMyOwned` 的 `totalOwnedCount ?? ownedSkinIds.length` 一致），改测试断言为 9，另加一条「服务端没给总数时回退到列表长度」的用例 |
| 4 | Task 2 Step 1 / Step 9 | stub 写成 `when(heroMapper.selectList(any()))`，但 assembler 实际调用是 `selectList(null)` | 统一改成 `selectList(null)`，跟存量测试 `PlayerSkinSyncServiceImplTest` 一致 |

另外核对过、**确认没问题**的点（别再改）：

- `Skin` / `Hero` 实体字段名、`PlayerSkinSyncServiceImpl` 的构造器参数顺序、
  `SkinSyncController` / `SyncCodeController` 的构造器参数顺序 —— 都跟计划里写的一致。
- `SyncCodeService.redeem` 用的是同一个 Lua 脚本 + 同一个 Redis 键，
  `redeem-desktop` 复用它 → 一个同步码跨两条路径仍然只能用一次。
- `Result` 是 `@JsonInclude(NON_NULL)` → `lastSyncAt` 为 null 时整个字段从 JSON 里消失，
  小程序侧按「字段不存在 = 从没同步过」处理。
- `utils/request.js` 的 `silentError: true` 确实能挡住 401 时的 `handleTokenExpired()`
  → 徽标请求不会把用户踢去登录页。
- `utils/request.js` / `utils/auth.js` 顶层都不碰 `wx`，node --test 里 require 不会炸。
- `PlayerSkinStatusAssembler.assemble` 的行为一个字没动，
  `assembleByHero` 是新加的公开静态方法，`assemble` 内部调用它。

---

## 实施过程中的偏离记录（2026-10-30）

代码全部落地后回填，共 7 处与计划原文不同的地方（都是照抄计划会出问题的地方，已按实际代码为准）：

| # | 位置 | 计划原文的问题 | 实际怎么做的 |
|---|---|---|---|
| 1 | Task 11 徽标样式 | 说「已拥有徽标放在评分徽标之前」避开重叠，但 `.skin-score-badge` 是 `position:absolute; top:12rpx; right:12rpx` —— 放左上会跟它撞 | `.skin-owned-badge` 改成 `left:12rpx; bottom:12rpx`（左下角），跟右上角的评分徽标彻底错开 |
| 2 | Task 10 `hero-detail.js` | 计划里 `_withRating` 里写死 `owned:false`，靠 `loadOwned` 回来再覆盖 → **两个请求谁先谁后不定**：`loadOwned` 先返回时 `loadSkins` 会把 owned 全刷成 false | `_withRating` 不再碰 `owned`；新增 `_withOwned(skin)` 在**映射那一刻**读 `this.data.ownedIndex` 求值。两种时序都正确 |
| 3 | Task 12 收藏册页 | 未登录时页面会渲染一张全是 0 的统计卡（假数据） | 加 `needLogin` 状态，未登录改渲染「去登录」按钮 |
| 4 | Task 12 收藏册页 | `onLoad` 和 `onShow` 都调 `loadCollection()` → 首次进入**请求两次** | 只在 `onShow` 里调（小程序首次进入 `onLoad`/`onShow` 都会触发） |
| 5 | `HeroSkinOwnershipVO.heroId` 的 `@Schema` | 描述写的是「业务侧英雄 ID(`Hero.heroId`,Integer)」，实际值是 `t_skin.hero_id` = **`t_hero.id`**（主键），不是 Riot 编号 | 描述改成「英雄主键(`t_hero.id`,Integer)」。**字段值本身一直是对的**（`/skins/list?heroId=` 过滤的就是 `t_skin.hero_id`），只是文档描述错了 |
| 6 | 桌面端 + 小程序的 `lastSyncAt` 解析 | 计划按 ISO 8601（带 `T`）解析时间，但后端**全局** `JacksonConfig` 把 `LocalDateTime` 序列化成 `"yyyy-MM-dd HH:mm:ss"`（**空格分隔**）——照计划写，相对时间会一直显示「还没同步」 | 两端各加一个 `parseServerTime()`：把第一个空格换成 `T` 再按本地时间解析，解析不了返回 `null`（不显示 NaN）。桌面端放在 `skinCatalogLogic.ts`，小程序放在 `utils/collection.js`；测试用例也改成后端真实格式 |
| 7 | 桌面端 `ipc.test.ts` | `vi.mock('../backend', ...)` 把整个模块替换掉了，但 `ipc.ts` 现在还从同一个模块导入 `shouldSkipSync` / `minIntervalFor` —— mock 里没有这两个，调用直接 TypeError，**节流相关的 4 条用例全红** | 改成 `vi.mock('../backend', async (importOriginal) => ({ ...(await importOriginal()), syncOwnedSkins: mocks.syncOwnedSkins }))`：只替换联网的那个函数，纯函数留真实实现，节流逻辑才真的被测到 |

另外更正两处注释/文档口径：

- `catalog.ts` / `preload/index.ts` 里 `OwnedSnapshot.ownedSkinIds` 的注释原写「已拥有**且目录里有对应行**的 skinId 列表」——
  实际 `UserSkinMapper.listSkinIdsByUserId` 是 `SELECT skin_id FROM t_user_skin WHERE user_id=?`，**不过滤目录**，会带目录没收录的皮肤。
  注释改成「已拥有的游戏内皮肤 ID 列表(`t_skin.skin_id` 口径,可能含目录没收录的)」。
- `docs/superpowers/specs/2026-08-18-a0-tencent-inventory-research.md` 加了路线状态说明（本次走桌面端路线，A0 道聚城直连暂缓）。

---

**设计文档里的「Redis 缓存 `skin:owned:ids:{userId}`」这一项本次不做。**

理由：设计文档同时把 `my-owned` 从「返回全量 2138 条 `SkinItemVO`」瘦身成了「只返回 skinId 数组」。瘦身之后这个接口只剩两条极轻的查询——`SELECT skin_id FROM t_user_skin WHERE user_id=?`（几十行）和 `SELECT MAX(last_seen_at) ...`。**原本贵的地方（把 2138 条皮肤 + 168 个英雄拉进内存、组装两个大列表）被瘦身本身消掉了，缓存要解决的那个问题已经不存在。**

反倒是**没有缓存**的那个更重：只有 `my-collection` 需要读全量目录做按英雄聚合，而它按设计就不缓存。给便宜的那个加缓存、给贵的那个不加，是本末倒置。

代价是：同步完不删键这条也不需要了，少一个失效路径、少一处可能出错的缓存一致性。

如果后续发现 `my-owned` 在生产上确实慢，再单独排期加缓存，那时它才有意义。

---

## 2026-10-31 线上数据核对后的修正

联调时拿真实账号比对了「桌面端上传的数量」和「游戏客户端显示的数量」，发现四处问题，都不是原计划能预见的：

| # | 问题 | 实测结论 | 改法 |
|---|---|---|---|
| 1 | **炫彩被当成皮肤上传了** | 炫彩在商城目录里 `inventoryType` 也是 `CHAMPION_SKIN`、也带 `owned: true`，但 `tags` 里没有 recolor 标记，只有 `subInventoryType === 'RECOLOR'` 能认。站内目录一条炫彩都没有，所以这 567 个炫彩全成了「目录未收录」，把「已拥有」总数和完成率全带歪 | 桌面端 `getOwnedSkinIds` 过滤掉炫彩；历史那 567 行用一次性 SQL 清理（不改表结构） |
| 2 | **分母里混了英雄默认皮肤** | 站内 2138 条里 173 条 `skin_id % 1000 == 0`（`rarity`/`price_rp` 都 NULL），就是每个英雄的默认皮肤；而客户端上报的已拥有真皮肤里**一条默认皮肤都没有** | `totalSkinsInGame` 与 `byHero.totalCount` 都按非默认皮肤统计（1965）；`assemble`（A0 专用）旧口径不动 |
| 3 | **桌面 token 7 天过期 → 数据静默停更** | 桌面端只看本地有没有 token 文件，过期了界面照样显示「已登录」，但每次同步都 401，用户的皮肤停在 2.5 个月前 | 后端新增 `jwt.desktop-expiration`（30 天），桌面 token 单独签发；桌面端 401 时清掉本地 token，过期 token 不再显示「已登录」 |
| 4 | **绝版皮肤读不到** | 把所有商城入口合并挖了一遍：`/lol-store/v1/skins`（在售）、`/lol-store/v1/bundles`、`/lol-store/v1/featured`、`/lol-store/v1/catalog`（9106 条，**零 owned 标记**），以及全部库存端点（`/lol-champions/v1/inventories/*`、`/lol-inventory/v1/*`、`/lol-cosmetics/v1/collection`、`/lol-loot/v1/loot`、`/lol-item-sets/v1/item-sets` —— 全 404/400）。合并去重后只有 **1367 个 owned**：747 个真皮肤 + 18 个皮肤变体 + 602 个炫彩。**747 个真皮肤 100% 都在站内目录里**；比商城目录多出来的那 18 个绝版皮肤（瓦尔基里 蕾欧娜、鲛妮座人 娜美、黑色荆棘 莫甘娜…）**只有 `/lol-store/v1/bundles` 能露头** | 桌面端把 bundles / featured 的 owned 合并进拥有集合（绝版皮肤唯一的露头点）；全目录与库存端点确认是死路，不再试 |
| 5 | **皮肤变体混在真皮肤里** | 商城目录的 owned 里除了标准炫彩（`subInventoryType === 'RECOLOR'`），还有 17 个「皮肤变体」—— 同样是 `CHAMPION_SKIN` + `owned`，但 `subInventoryType` 是 null，只能靠 `tags` 里的 `skin_variant` 认（如 神龙尊者 昼日真龙 亚索 itemId 157054） | 桌面端的过滤从「只认 RECOLOR」扩成「RECOLOR 或带 skin_variant 标签」；一次性清理脚本同步扩 |
| 6 | **桌面端总览的分母和小程序不是同一个口径** | 桌面端「皮肤总览」用的是目录总行数 2138（含 173 个英雄默认皮肤），小程序收藏册已经改成 1965 —— 两边自己就对不上（747/2138 vs 747/1965） | `computeStats` 增加 `collectableTotal`（按 skinId 去重、剔除 `skinId % 1000 === 0`），桌面端弹窗改用它当分母；并在统计区加一行「已下架(绝版)皮肤游戏接口读不到,数量会少于游戏内」 |

**探针 8 的结论（1717 已定性）：是「绝版皮肤」，不是口径歧义。** 用户确认客户端那一行叫「已拥有的皮肤总数」，且「限定 典藏 普通皮肤 殿堂 各种类型都有，不只是商城能买到的」。两条替代解释都被实测证伪：

| 候选解释 | 实测 | 结论 |
|---|---|---|
| 1717 把守卫皮肤/表情/图标也算了 | 三个入口合并后，非皮肤类型的 owned 条目总共只有 13 个（EMOTE 4 / EVENT_PASS 4 / SUMMONER_ICON 1 / WARD_SKIN 4） | 撑不起 350 的缺口，证伪 |
| 1717 = 真皮肤 + 已拥有的炫彩 | 商城目录 7048 个炫彩/变体里只有 18 个能推出父皮肤 id，且这 18 个都是变体自己的 tag；挂在「已拥有真皮肤」名下的炫彩是 **0 个** | 炫彩→父皮肤的映射根本不存在，证伪 |

⇒ **1717 = 账号拥有的全部英雄皮肤卡，其中约 970 个是已下架（绝版）皮肤，WeGame 的 LCU 一个都不吐。** 站内目录 1965 个真皮肤里，我们只能确认拥有 747 个 —— 剩下 1218 个里有 970 个其实也是拥有的。**这不是 bug，是数据源天花板。**

> ⚠️ **2026-10-31 晚间修正**：上面这句话关于「LCU 一个都不吐」的部分**已被探针 12 推翻**，见下面「探针 12/13」。

**探针 9 的结论：端点这条路彻底走死（2026-10-31 实测）。** 两个端口各扫 84 条候选路径（store / inventory / collection / cosmetics / champions / loot / 国服专属），**命中 0 个 200**：

| 端口 | 命中 |
|---|---|
| `--app-port`（LCU） | 0 / 84 |
| `--riotclient-app-port`（Riot Client，**此前从没扫过**） | 0 / 84 |

顺带把 `/lol-store/v1/skins` 的 `player` 对象整个打出来了，只有 `{accountId, ip, rp, summonerLevel}`（`rp: 82` —— 当年把 RP 花光了，符合「买过几乎所有皮肤」的画像），没有账号级皮肤计数。**⇒ 本地不存在任何能给出绝版皮肤拥有状态的端点，别再扫了。**

**探针 12/13 的结论：端点没走死，是我们把参数写错了（2026-10-31 实测）。** 探针 9 之所以 0 命中，是因为它按「路径后缀 + query 参数」的猜法去扫，而 inventory 家族要求 **inventoryType 用枚举名放在路径段里**：

| 请求 | 结果 |
|---|---|
| `/lol-inventory/v2/inventory/CHAMPION_SKIN` | **200，1,144,781 字节** |
| `/lol-inventory/v2/inventory/{owned,items,skins,emotes,all,...}` | 200，但 body 是 `[]`（类型名不对就是空数组，不报错） |
| `/lol-inventory/v1/inventory/emotes` | 200，167,222 字节（v1 用小写复数） |
| `/lol-inventory/v1/inventory` | 400：`inventoryTypes` 要传**集合**，报 "input not a collection" |

拿到的条目形如：

```json
{"expirationDate":"","f2p":false,"inventoryType":"CHAMPION_SKIN","itemId":60081046,
 "loyalty":false,"loyaltySources":[],"owned":true,"ownershipType":"OWNED",
 "payload":{"isVintage":false},"purchaseDate":"20260716T020338.000Z",
 "quantity":1,"rental":false,"usedInGameDate":"","uuid":"...","wins":0}
```

⇒ 三个我们从没见过的字段：**`payload.isVintage`（绝版标记）**、`purchaseDate`（购买时间）、`ownershipType`/`rental`（拥有状态，且是**扁平**写法，不是社区逆向资料里的嵌套 `ownership.owned`）。

**探针 13 待跑**（`D:\Code\tmp\lcu-diff13.cjs`），要回答三件事：
1. 条数 / 去重 itemId 数 **是否 == 1717**（这是「拥有集合」的唯一判据）；
2. `itemId` 能否直接 join `t_skin.skin_id`（样例 `60081046` **不像** `champId*1000+n`，必须实测）；
3. `isVintage=true` 有多少条 —— 如果正好是那 970 个，绝版问题就地解决，A0 抓包降级为备选。

**如果 13 也对不上 1717**：再按 `all_function_api/docs/superpowers/specs/2026-08-18-a0-tencent-inventory-research.md` §4.1 抓包（判据仍是「抓到的响应 id 去重数 == 1717」）。在那之前收藏册页面按「下界」呈现，页面上写明「已下架（绝版）皮肤游戏接口读不到」。

---

## 2026-10-31 桌面端拥有集合的多入口合并

桌面端 `getOwnedSkinIds` 从「只读 `/lol-store/v1/skins`」改成「读三个入口后合并去重」：

| 入口 | 作用 | 失败处理 |
|---|---|---|
| `/lol-store/v1/skins` | 主来源：在售皮肤 + 炫彩 | 失败 → 整个同步失败（原来就依赖它） |
| `/lol-store/v1/bundles` | 绝版皮肤唯一的露头点（+18 个真皮肤） | 失败 → 忽略，只损失绝版部分 |
| `/lol-store/v1/featured` | 少量在售皮肤 | 失败 → 忽略 |

合并的实现是**深遍历**：商城 payload 的结构不固定（bundle 的条目嵌在 `items` 里，featured 的嵌在别的层级），所以递归找所有「`inventoryType === 'CHAMPION_SKIN'` 且 `owned === true`」的对象，取 `itemId`。

过滤规则也统一到一处（`isChroma`）：`subInventoryType === 'RECOLOR'`、`tags` 含 `recolor`、`tags` 含 `skin_variant*` —— 三种都是「没有原画、站内目录不收录」的东西，一律不上传。

一次性清理脚本 `chroma-cleanup.cjs` 同步扩成「删炫彩 + 删变体」，并且额外打印「真皮肤里站内没有的」清单（真正的读不到的绝版皮肤）。

---

## 关键 ID 口径（每个 Task 都要用到，先记住）

| 名字 | 是什么 | 出处 |
|---|---|---|
| `t_skin.id` | DB 自增主键（Long） | `SkinVO.id` |
| `t_skin.skin_id` | **游戏内皮肤 ID = LCU itemId（Integer）** | `SkinVO.skinId` |
| `t_hero.id` | DB 主键（Long），`t_skin.hero_id` 指向它 | `Hero.id` |

- `t_user_skin.skin_id` 存的是 **Riot 皮肤 ID**，和 `t_skin.skin_id` 同口径。
- **打「已拥有」徽标的 join 键是 `skin.skinId`（Riot ID），不是 `skin.id`（主键）。**
- ⚠️ 小程序现有代码里叫 `skinId` 的地方**传的是主键**（`api/skin.js` 的 `getSkinDetail(skinId)` 等，实参是 `skin.id`）。这套命名有误导性，本次只新增对 `skin.skinId` 的读取，**不改既有命名**。

---

## 文件结构

### 后端 `all_function_api`

| 文件 | 动作 | 职责 |
|---|---|---|
| `skin/src/main/java/com/lolskin/inventory/vo/MyOwnedSummaryVO.java` | 新建 | 瘦版「我拥有的」响应：`ownedSkinIds` / `totalOwnedCount` / `lastSyncAt` |
| `skin/src/main/java/com/lolskin/inventory/vo/MyCollectionVO.java` | 新建 | 收藏册聚合响应 |
| `skin/src/main/java/com/lolskin/inventory/mapper/UserSkinMapper.java` | 修改 | 加 `maxLastSeenAt` |
| `skin/src/main/resources/mapper/UserSkinMapper.xml` | 修改 | 加 `maxLastSeenAt` 的 SQL |
| `skin/src/main/java/com/lolskin/inventory/service/PlayerSkinSyncService.java` | 修改 | `getOwnedSummary` 换返回类型；新增 `getMyCollection` |
| `skin/src/main/java/com/lolskin/inventory/service/impl/PlayerSkinSyncServiceImpl.java` | 修改 | 实现两个方法 |
| `skin/src/main/java/com/lolskin/inventory/assembler/PlayerSkinStatusAssembler.java` | 修改 | 抽出 `assembleByHero`，`assemble` 改为调用它 |
| `skin/src/main/java/com/lolskin/inventory/controller/SkinSyncController.java` | 修改 | `my-owned` 换类型；新增 `my-collection`；标注桌面白名单 |
| `core/src/main/java/com/lolskin/annotation/AllowsDesktopToken.java` | 新建 | 桌面 token 可访问标记 |
| `app/src/main/java/com/lolskin/interceptor/DesktopScopeInterceptor.java` | 新建 | 桌面 token 作用域拦截器（默认拒绝） |
| `app/src/main/java/com/lolskin/config/WebConfig.java` | 修改 | 注册新拦截器 |
| `user/src/main/java/com/lolskin/user/service/JwtService.java` | 修改 | 加 `TOKEN_TYPE_DESKTOP` + `generateDesktopToken` |
| `user/src/main/java/com/lolskin/user/service/SyncCodeService.java` | 修改 | 加 `redeemDesktop` |
| `user/src/main/java/com/lolskin/user/controller/SyncCodeController.java` | 修改 | 加 `POST /sync-code/redeem-desktop` |

**测试文件：**

| 文件 | 动作 |
|---|---|
| `skin/src/test/java/com/lolskin/inventory/controller/SkinSyncControllerTest.java` | 修改（`myOwned` 相关用例换类型） |
| `skin/src/test/java/com/lolskin/inventory/controller/MyCollectionControllerTest.java` | 新建 |
| `skin/src/test/java/com/lolskin/inventory/service/impl/PlayerSkinSyncServiceImplTest.java` | 修改 |
| `skin/src/test/java/com/lolskin/inventory/assembler/PlayerSkinStatusAssemblerTest.java` | 新建 |
| `app/src/test/java/com/lolskin/interceptor/DesktopScopeInterceptorTest.java` | 新建 |
| `user/src/test/java/com/lolskin/user/controller/SyncCodeControllerTest.java` | 新建 |

### 桌面端 `local_skin_importer`

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/main/catalog.ts` | 修改 | `fetchMyOwned` 读新结构 + 带回 `lastSyncAt` |
| `src/main/auth.ts` | 修改 | `redeemSyncCode` 改调 `redeem-desktop` |
| `src/main/syncState.ts` | 新建 | `sync-state.json` 的读写（上次成功同步时刻） |
| `src/main/backend.ts` | 修改 | `syncOwnedSkins` 加 `mode` + 节流判断 |
| `src/main/ipc.ts` | 修改 | `backend:sync` 返回新结构 `SyncOutcome` |
| `src/preload/index.ts` | 修改 | 类型同步（`SyncPayload.mode` / `SyncOutcome` / `OwnedSnapshot.lastSyncAt`） |
| `src/renderer/src/views/Sync.vue` | 修改 | 启动自动同步（静默） |
| `src/renderer/src/components/SkinOverviewDialog.vue` | 修改 | 显示「上次同步于 X」 |
| `src/renderer/src/composables/useSkinCatalog.ts` | 修改 | 透传 `lastSyncAt` |
| `src/main/__tests__/catalog.test.ts` | 修改 | 解析断言 |
| `src/main/__tests__/backend.test.ts` | 修改 | 节流纯函数测试 |

### 小程序 `wechat_rating_program`

| 文件 | 动作 | 职责 |
|---|---|---|
| `utils/config.js` | 修改 | 加 `SKINS_MY_OWNED` / `SKINS_MY_COLLECTION` 常量 |
| `utils/owned-skins.js` | 新建 | 「已拥有」集合单例 + 纯函数（可 `node --test`） |
| `utils/collection.js` | 新建 | 收藏册纯函数：相对时间、百分比、进度文案 |
| `pages/hero-detail/hero-detail.js` | 修改 | 拉已拥有集合，给皮肤打 `owned` 标记 |
| `pages/hero-detail/hero-detail.wxml` | 修改 | 「已拥有」徽标 |
| `pages/hero-detail/hero-detail.wxss` | 修改 | 徽标样式 |
| `pages/collection/collection.js` | 新建 | 收藏册页逻辑 |
| `pages/collection/collection.wxml` | 新建 | 收藏册页结构 |
| `pages/collection/collection.wxss` | 新建 | 收藏册页样式 |
| `pages/collection/collection.json` | 新建 | 页面配置 |
| `pages/profile/profile.js` | 修改 | 收藏册入口跳转 |
| `pages/profile/profile.wxml` | 修改 | 收藏册入口菜单项 |
| `app.json` | 修改 | `pages` 数组加 `pages/collection/collection` |
| `tests/owned-skins.test.js` | 新建 | 纯函数单测 |
| `tests/collection.test.js` | 新建 | 纯函数单测 |

---

# 阶段一：后端

## Task 1: `MyOwnedSummaryVO` + `maxLastSeenAt` + 瘦身 `my-owned`

**Files:**
- Create: `all_function_api/skin/src/main/java/com/lolskin/inventory/vo/MyOwnedSummaryVO.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/mapper/UserSkinMapper.java`
- Modify: `all_function_api/skin/src/main/resources/mapper/UserSkinMapper.xml`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/service/PlayerSkinSyncService.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/service/impl/PlayerSkinSyncServiceImpl.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/controller/SkinSyncController.java`
- Modify: `all_function_api/skin/src/test/java/com/lolskin/inventory/controller/SkinSyncControllerTest.java`

- [ ] **Step 1: 写失败的测试**

在 `SkinSyncControllerTest.java` 里，把 `myOwned_happyPath_returns200WithByHero` 换成下面这个（返回结构变了，`byHero` 不再由 `my-owned` 提供）：

```java
    @Test
    void myOwned_happyPath_returns200WithOwnedSkinIds() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.getOwnedSummary(100L))
            .thenReturn(MyOwnedSummaryVO.builder()
                .ownedSkinIds(List.of(1001, 1002))
                .totalOwnedCount(2)
                .lastSyncAt(LocalDateTime.of(2026, 10, 30, 16, 20, 33))
                .build());

        mvc.perform(get("/skins/my-owned")
                .header("Authorization", "Bearer valid.token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(200))
            .andExpect(jsonPath("$.data.totalOwnedCount").value(2))
            .andExpect(jsonPath("$.data.ownedSkinIds[0]").value(1001))
            .andExpect(jsonPath("$.data.ownedSkinIds[1]").value(1002))
            .andExpect(jsonPath("$.data.lastSyncAt").value("2026-10-30T16:20:33"));
    }

    @Test
    void myOwned_neverSynced_returnsNullLastSyncAtAndEmptyIds() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.getOwnedSummary(100L))
            .thenReturn(MyOwnedSummaryVO.builder()
                .ownedSkinIds(List.of())
                .totalOwnedCount(0)
                .lastSyncAt(null)
                .build());

        mvc.perform(get("/skins/my-owned")
                .header("Authorization", "Bearer valid.token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.totalOwnedCount").value(0))
            .andExpect(jsonPath("$.data.ownedSkinIds").isEmpty())
            .andExpect(jsonPath("$.data.lastSyncAt").doesNotExist());
    }
```

加 import：`com.lolskin.inventory.vo.MyOwnedSummaryVO`。`LocalDateTime` / `List` 已经 import 过了。

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am test -Dmaven.test.skip=false -Dtest=SkinSyncControllerTest
```

预期：编译失败，`MyOwnedSummaryVO` 找不到符号。

> ⚠️ 根 pom 有 `<maven.test.skip>true</maven.test.skip>`，**必须加 `-Dmaven.test.skip=false`** 否则测试根本不跑。
> ⚠️ `-Dtest=` 配合多模块时，`-am` 会把依赖模块也拉进来，那些模块可能因为没有匹配的测试而失败。跑不通就去掉 `-Dtest=` 只跑 `mvn -pl skin -am test -Dmaven.test.skip=false`，慢但稳。

- [ ] **Step 3: 建 `MyOwnedSummaryVO`**

新建 `skin/src/main/java/com/lolskin/inventory/vo/MyOwnedSummaryVO.java`：

```java
package com.lolskin.inventory.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 当前用户已拥有的皮肤 ID 集合 —— 桌面端同步上来、存在 t_user_skin 的那批。
 *
 * <p>这是 {@link PlayerSkinStatusVO} 的瘦身版：老 VO 会把整个皮肤目录(两千多条)
 * 组装成 ownedSkins + unownedSkins 两个大列表,而唯一的调用方只需要 ID 集合。
 */
@Data
@Builder
@Schema(description = "当前用户已拥有的皮肤 ID 集合")
public class MyOwnedSummaryVO {

    @Schema(description = "已拥有的游戏内皮肤 ID(t_skin.skin_id 口径,等于 LCU itemId)")
    private List<Integer> ownedSkinIds;

    @Schema(description = "已拥有总数(含目录未收录的)")
    private Integer totalOwnedCount;

    @Schema(description = "最近一次同步时刻;null = 从未同步过")
    private LocalDateTime lastSyncAt;
}
```

- [ ] **Step 4: 加 `maxLastSeenAt`**

`UserSkinMapper.java` 里加方法（放在 `listSkinIdsByUserId` 下面）：

```java
    /**
     * 最近一次同步时刻。
     *
     * <p>batchUpsert 是 {@code ON DUPLICATE KEY UPDATE last_seen_at = NOW()},
     * 每次同步都会把该用户所有 owned 皮肤刷成 NOW(),
     * 所以 MAX(last_seen_at) 精确等于最近一次同步时刻,不需要额外的字段。
     * 该用户一行都没有时返回 null(从未同步过)。
     */
    LocalDateTime maxLastSeenAt(@Param("userId") Long userId);
```

加 import：`java.time.LocalDateTime`。

`UserSkinMapper.xml` 里加：

```xml
    <select id="maxLastSeenAt" resultType="java.time.LocalDateTime">
        SELECT MAX(last_seen_at) FROM t_user_skin WHERE user_id = #{userId}
    </select>
```

- [ ] **Step 5: 改 service 接口与实现**

`PlayerSkinSyncService.java`：

```java
package com.lolskin.inventory.service;

import com.lolskin.inventory.dto.SyncUserSkinsDTO;
import com.lolskin.inventory.vo.MyCollectionVO;
import com.lolskin.inventory.vo.MyOwnedSummaryVO;
import com.lolskin.inventory.vo.SyncResultVO;

public interface PlayerSkinSyncService {
    SyncResultVO sync(SyncUserSkinsDTO dto, Long userId);

    MyOwnedSummaryVO getOwnedSummary(Long userId);

    MyCollectionVO getMyCollection(Long userId);
}
```

（`MyCollectionVO` 在 Task 2 才建，**本 Task 先只写 `MyOwnedSummaryVO` 那两行**，Task 2 再回来加 `getMyCollection`。或者更省事：Task 1 就把 `MyCollectionVO` 的空壳先建好，Task 2 填字段。推荐后者——省一次改动来回。）

`PlayerSkinSyncServiceImpl.java` 里把 `getOwnedSummary` 换成：

```java
    @Override
    public MyOwnedSummaryVO getOwnedSummary(Long userId) {
        List<Integer> ownedIds = userSkinMapper.listSkinIdsByUserId(userId);
        return MyOwnedSummaryVO.builder()
            .ownedSkinIds(ownedIds)
            .totalOwnedCount(ownedIds.size())
            .lastSyncAt(userSkinMapper.maxLastSeenAt(userId))
            .build();
    }
```

加 import：`com.lolskin.inventory.vo.MyOwnedSummaryVO`、`java.util.List`。
注意删掉不再用的 `com.lolskin.inventory.vo.PlayerSkinStatusVO` import（如果这个类在本文件里没别的地方用）。`HashSet` / `Set` 还在 `sync()` 里用，保留。

- [ ] **Step 6: 改 controller**

`SkinSyncController.java`：

```java
    @Operation(summary = "查询当前用户的已拥有皮肤(从 t_user_skin)")
    @GetMapping("/my-owned")
    public Result<MyOwnedSummaryVO> myOwned(HttpServletRequest request) {
        Long userId = extractUserId(request);
        return Result.success(playerSkinSyncService.getOwnedSummary(userId));
    }
```

import 换成 `com.lolskin.inventory.vo.MyOwnedSummaryVO`（`PlayerSkinStatusVO` 如果别处没用就删掉）。

- [ ] **Step 7: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am test -Dmaven.test.skip=false
```

预期：Task 1 涉及的用例全绿。**注意：`PlayerSkinSyncServiceImplTest.getOwnedSummary_returnsExpectedShape` 这个存量用例现在会编译失败或断言失败**（它 mock 的是老 VO）。Task 3 里统一改，本 Task 先记着。

- [ ] **Step 8: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add skin/src/main/java/com/lolskin/inventory skin/src/main/resources/mapper/UserSkinMapper.xml skin/src/test
git commit -m "feat(skin): my-owned 返回瘦身后的 skinId 集合与真实同步时间"
```

---

## Task 2: `MyCollectionVO` + `assembleByHero` + `GET /skins/my-collection`

**Files:**
- Create: `all_function_api/skin/src/main/java/com/lolskin/inventory/vo/MyCollectionVO.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/assembler/PlayerSkinStatusAssembler.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/service/impl/PlayerSkinSyncServiceImpl.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/controller/SkinSyncController.java`
- Create: `all_function_api/skin/src/test/java/com/lolskin/inventory/assembler/PlayerSkinStatusAssemblerTest.java`
- Create: `all_function_api/skin/src/test/java/com/lolskin/inventory/controller/MyCollectionControllerTest.java`

- [ ] **Step 1: 写失败的 assembler 测试**

新建 `skin/src/test/java/com/lolskin/inventory/assembler/PlayerSkinStatusAssemblerTest.java`。用 Mockito mock `SkinMapper` / `HeroMapper`：

```java
package com.lolskin.inventory.assembler;

import com.lolskin.inventory.vo.HeroSkinOwnershipVO;
import com.lolskin.skin.entity.Hero;
import com.lolskin.skin.entity.Skin;
import com.lolskin.skin.mapper.HeroMapper;
import com.lolskin.skin.mapper.SkinMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlayerSkinStatusAssemblerTest {

    private final SkinMapper skinMapper = mock(SkinMapper.class);
    private final HeroMapper heroMapper = mock(HeroMapper.class);

    private Skin skin(int skinId, long heroId) {
        Skin s = new Skin();
        s.setSkinId(skinId);
        s.setHeroId(heroId);
        s.setIsActive(true);
        s.setName("皮肤" + skinId);
        return s;
    }

    private Hero hero(long id, String name) {
        Hero h = new Hero();
        h.setId(id);
        h.setName(name);
        h.setIconUrl("https://cdn/" + id + ".png");
        return h;
    }

    @Test
    void assembleByHero_countsOwnedOnlyAmongActiveSkins() {
        when(skinMapper.selectList(any())).thenReturn(List.of(skin(1001, 7L), skin(1002, 7L), skin(2001, 9L)));
        when(heroMapper.selectList(null)).thenReturn(List.of(hero(7L, "暗裔剑魔"), hero(9L, "冰霜女巫")));

        List<HeroSkinOwnershipVO> byHero =
            PlayerSkinStatusAssembler.assembleByHero(Set.of(1001), skinMapper, heroMapper);

        assertEquals(2, byHero.size());
        HeroSkinOwnershipVO aatrox = byHero.stream()
            .filter(h -> h.getHeroId() == 7).findFirst().orElseThrow();
        assertEquals("暗裔剑魔", aatrox.getHeroName());
        assertEquals(1, aatrox.getOwnedCount());
        assertEquals(2, aatrox.getTotalCount());
        assertEquals(0.5, aatrox.getHeroCompletionRate().doubleValue());
    }

    @Test
    void assembleByHero_usesHeroTablePrimaryKeyNotRiotHeroId() {
        when(skinMapper.selectList(any())).thenReturn(List.of(skin(1001, 62L)));
        when(heroMapper.selectList(null)).thenReturn(List.of(hero(62L, "亚索")));

        List<HeroSkinOwnershipVO> byHero =
            PlayerSkinStatusAssembler.assembleByHero(Set.of(1001), skinMapper, heroMapper);

        // heroId 是 t_hero.id(主键),不是 t_hero.hero_id(Riot 编号)
        assertEquals(Integer.valueOf(62), byHero.get(0).getHeroId());
    }

    @Test
    void assembleByHero_heroWithoutActiveSkinsIsAbsent() {
        when(skinMapper.selectList(any())).thenReturn(List.of(skin(1001, 7L)));
        when(heroMapper.selectList(null)).thenReturn(List.of(hero(7L, "暗裔剑魔"), hero(9L, "冰霜女巫")));

        List<HeroSkinOwnershipVO> byHero =
            PlayerSkinStatusAssembler.assembleByHero(Set.of(1001), skinMapper, heroMapper);

        assertEquals(1, byHero.size());
        assertEquals("暗裔剑魔", byHero.get(0).getHeroName());
    }
}
```

> ⚠️ **实体字段类型已经核对过，照抄下面这份就行**（2026-10-30 对着源码核过）：
> - `Skin.isActive` 是 **`Boolean`**（不是 Integer）→ `s.setIsActive(true)`
> - `Skin.skinId` 是 `Integer`、`Skin.heroId` 是 `Long`
> - `Hero.id` 是 `Long`、`Hero.heroId` 是 `Integer`（Riot 编号，**不是**本处要用的）
> - `Hero.iconUrl` 存在 → `h.setIconUrl(...)` 可用
>
> ⚠️ **本项目没有 assertj 依赖**（所有 pom 里都搜不到 `org.assertj`），所以用 JUnit 5 原生断言。
> 照 `PlayerSkinSyncServiceImplTest` 的风格写（它就是 Mockito + `org.junit.jupiter.api.Assertions`）。
> ⚠️ `heroMapper.selectList(null)` —— assembler 里查英雄表传的就是 `null`（不是 `any()`），
> stub 要跟实际调用参数一致，照抄现有测试 `PlayerSkinSyncServiceImplTest` 的写法。

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am test -Dmaven.test.skip=false
```

预期：编译失败，`assembleByHero` 找不到符号。

- [ ] **Step 3: 在 assembler 里抽 `assembleByHero`**

改 `PlayerSkinStatusAssembler.java`。**关键约束：`assemble` 的行为一个字都不能变**——它的类注释写着「行为契约: 与重构前 `LolInventoryServiceImpl.sync` 输出按字节相同；若改此处行为, 必须同时跑 `LolInventoryServiceImplTest` 校验未回归」。

改法：把 `assemble` 里算 `byHero` 的那段抽成公开静态方法，`assemble` 调用它。

```java
    /**
     * 按英雄维度聚合收集进度。
     *
     * <p>与 {@link #assemble} 里的 byHero 逻辑完全一致(同一份 join 口径:
     * t_skin.hero_id → t_hero.id),只是不组装 ownedSkins / unownedSkins 两个大列表,
     * 给只需要按英雄统计的调用方用。
     */
    public static List<HeroSkinOwnershipVO> assembleByHero(Set<Integer> ownedIds,
                                                            SkinMapper skinMapper,
                                                            HeroMapper heroMapper) {
        List<Skin> allActive = skinMapper.selectList(
            Wrappers.<Skin>lambdaQuery().eq(Skin::getIsActive, 1));
        Map<Long, Hero> heroMap = heroMapper.selectList(null).stream()
            .collect(Collectors.toMap(Hero::getId, h -> h, (a, b) -> a));

        Map<Long, List<Skin>> byHeroId = allActive.stream()
            .collect(Collectors.groupingBy(Skin::getHeroId));
        return byHeroId.entrySet().stream()
            .map(e -> {
                Hero h = heroMap.get(e.getKey());
                int total = e.getValue().size();
                int owned = (int) e.getValue().stream()
                    .filter(s -> ownedIds.contains(s.getSkinId())).count();
                return HeroSkinOwnershipVO.builder()
                    .heroId(e.getKey().intValue())
                    .heroName(h != null ? h.getName() : "未知英雄")
                    .heroIcon(h != null ? h.getIconUrl() : null)
                    .ownedCount(owned).totalCount(total)
                    .heroCompletionRate(total == 0 ? 0.0 : round4((double) owned / total))
                    .build();
            }).toList();
    }
```

然后把 `assemble` 里的 byHero 计算替换成：

```java
        List<HeroSkinOwnershipVO> byHero = assembleByHero(ownedIds, skinMapper, heroMapper);
```

**注意**：`assemble` 里原本是 `List<Hero> heroList = heroMapper.selectList(null);` 然后建 `heroMap`，而 `heroMap` 后面还被 `toSkinItemVO` 用着。**`heroMap` 那段留在 `assemble` 里不要删**，`assembleByHero` 自己再建一份（多一次 `selectList`，可接受；或者把 `assembleByHero` 改成接受已建好的 `heroMap`，但那样签名就复杂了——保持简单，多查一次 hero 表 insignificant）。

- [ ] **Step 4: 跑测试验证通过**

同 Step 2 的命令。预期：assembler 测试全绿，且 `LolInventoryServiceImplTest`（如果它覆盖 assemble 输出）也全绿。

- [ ] **Step 5: 写 `MyCollectionVO`**

新建 `skin/src/main/java/com/lolskin/inventory/vo/MyCollectionVO.java`：

```java
package com.lolskin.inventory.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 我的皮肤收藏册 —— 按英雄维度的收集进度。
 *
 * <p>与 {@link PlayerSkinStatusVO} 的差别:
 * <ul>
 *   <li>收集率用「已拥有 ∩ 目录」的交集算,不会因为拥有目录没收录的皮肤而虚高</li>
 *   <li>lastSyncAt 是真实的同步时刻,不是请求时刻</li>
 *   <li>不返回 ownedSkins / unownedSkins 两个大列表</li>
 * </ul>
 */
@Data
@Builder
@Schema(description = "我的皮肤收藏册(按英雄收集进度)")
public class MyCollectionVO {

    @Schema(description = "已拥有总数(含目录未收录的)")
    private Integer totalOwnedCount;

    @Schema(description = "已拥有且目录里有对应行的件数")
    private Integer ownedMatchedCount;

    @Schema(description = "目录里 is_active=1 的皮肤总数")
    private Integer totalSkinsInGame;

    @Schema(description = "总收集率(0~1,保留 4 位小数);按交集算")
    private Double completionRate;

    @Schema(description = "最近一次同步时刻;null = 从未同步过")
    private LocalDateTime lastSyncAt;

    @Schema(description = "按英雄维度的收集进度")
    private List<HeroSkinOwnershipVO> byHero;
}
```

- [ ] **Step 6: 实现 `getMyCollection`**

`PlayerSkinSyncServiceImpl.java` 加：

```java
    @Override
    public MyCollectionVO getMyCollection(Long userId) {
        Set<Integer> ownedIds = new HashSet<>(userSkinMapper.listSkinIdsByUserId(userId));

        // 目录里 is_active=1 的皮肤,按 Riot skinId 建索引
        List<Skin> allActive = skinMapper.selectList(
            Wrappers.<Skin>lambdaQuery().eq(Skin::getIsActive, 1));
        Set<Integer> catalogIds = new HashSet<>();
        for (Skin s : allActive) {
            if (s.getSkinId() != null) catalogIds.add(s.getSkinId());
        }

        // 收集率必须用交集:已拥有但目录没收录的皮肤不计入分子
        int matched = 0;
        for (Integer id : ownedIds) {
            if (catalogIds.contains(id)) matched++;
        }
        int total = allActive.size();
        double rate = total == 0 ? 0.0 : Math.round((double) matched / total * 10000.0) / 10000.0;

        return MyCollectionVO.builder()
            .totalOwnedCount(ownedIds.size())
            .ownedMatchedCount(matched)
            .totalSkinsInGame(total)
            .completionRate(rate)
            .lastSyncAt(userSkinMapper.maxLastSeenAt(userId))
            .byHero(PlayerSkinStatusAssembler.assembleByHero(ownedIds, skinMapper, heroMapper))
            .build();
    }
```

import 补：`com.lolskin.inventory.vo.MyCollectionVO`、`com.baomidou.mybatisplus.core.toolkit.Wrappers`、`com.lolskin.skin.entity.Skin`、`java.util.List`。

> `assembleByHero` 内部会再查一次 `selectList`，这里是第二次查目录。**2138 行的小表，MySQL 毫秒级，可接受。** 不要为此再加缓存（见开头的偏离说明）。

- [ ] **Step 7: 加 controller 端点**

`SkinSyncController.java`：

```java
    @Operation(summary = "我的皮肤收藏册(按英雄收集进度)")
    @GetMapping("/my-collection")
    public Result<MyCollectionVO> myCollection(HttpServletRequest request) {
        Long userId = extractUserId(request);
        return Result.success(playerSkinSyncService.getMyCollection(userId));
    }
```

import 加 `com.lolskin.inventory.vo.MyCollectionVO`。

- [ ] **Step 8: 写 controller 测试**

新建 `skin/src/test/java/com/lolskin/inventory/controller/MyCollectionControllerTest.java`，照 `SkinSyncControllerTest` 的 `MockMvcBuilders.standaloneSetup` 模式：

```java
package com.lolskin.inventory.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.lolskin.exception.GlobalExceptionHandler;
import com.lolskin.inventory.vo.HeroSkinOwnershipVO;
import com.lolskin.inventory.vo.MyCollectionVO;
import com.lolskin.user.service.JwtService;
import com.lolskin.inventory.service.PlayerSkinSyncService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MyCollectionControllerTest {

    private MockMvc mvc;
    private ObjectMapper mapper;
    private PlayerSkinSyncService skinSyncService;
    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        skinSyncService = mock(PlayerSkinSyncService.class);
        jwtService = mock(JwtService.class);
        SkinSyncController controller = new SkinSyncController(skinSyncService, jwtService);
        mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
            .build();
    }

    @Test
    void myCollection_returnsByHeroAndIntersectionRate() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.getMyCollection(100L))
            .thenReturn(MyCollectionVO.builder()
                .totalOwnedCount(87)
                .ownedMatchedCount(80)
                .totalSkinsInGame(2138)
                .completionRate(0.0374)
                .lastSyncAt(LocalDateTime.of(2026, 10, 30, 16, 20, 33))
                .byHero(List.of(HeroSkinOwnershipVO.builder()
                    .heroId(7).heroName("暗裔剑魔").ownedCount(12).totalCount(56)
                    .heroCompletionRate(0.2143).build()))
                .build());

        mvc.perform(get("/skins/my-collection")
                .header("Authorization", "Bearer valid.token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.totalOwnedCount").value(87))
            .andExpect(jsonPath("$.data.ownedMatchedCount").value(80))
            .andExpect(jsonPath("$.data.completionRate").value(0.0374))
            .andExpect(jsonPath("$.data.byHero[0].heroName").value("暗裔剑魔"))
            .andExpect(jsonPath("$.data.byHero[0].ownedCount").value(12));
    }

    @Test
    void myCollection_missingAuth_returns401() throws Exception {
        mvc.perform(get("/skins/my-collection"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    void myCollection_invalidToken_returns401() throws Exception {
        when(jwtService.getUserId("bad.token")).thenThrow(new RuntimeException("parse fail"));
        mvc.perform(get("/skins/my-collection").header("Authorization", "Bearer bad.token"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value(401));
    }
}
```

- [ ] **Step 9: 修 `PlayerSkinSyncServiceImplTest` 的存量用例**

这个测试里的 `getOwnedSummary_returnsExpectedShape` mock 的是老 VO，**现在会编译失败**。改成：

```java
    @Test
    void getOwnedSummary_returnsOwnedIdsAndLastSyncAt() {
        when(userSkinMapper.listSkinIdsByUserId(1L)).thenReturn(List.of(1001, 1002));
        when(userSkinMapper.maxLastSeenAt(1L)).thenReturn(LocalDateTime.of(2026, 10, 30, 16, 20, 33));

        MyOwnedSummaryVO vo = service.getOwnedSummary(1L);

        assertEquals(2, vo.getTotalOwnedCount());
        assertEquals(List.of(1001, 1002), vo.getOwnedSkinIds());
        assertEquals(LocalDateTime.of(2026, 10, 30, 16, 20, 33), vo.getLastSyncAt());
    }
```

同时给这个测试类补一个 `getMyCollection` 的用例：

```java
    @Test
    void getMyCollection_usesIntersectionForCompletionRate() {
        when(userSkinMapper.listSkinIdsByUserId(1L)).thenReturn(List.of(1001, 9999));
        when(userSkinMapper.maxLastSeenAt(1L)).thenReturn(null);
        // 目录里只有 1001(9999 不在目录里)
        when(skinMapper.selectList(any())).thenReturn(List.of(activeSkin(1001, 7L)));
        when(heroMapper.selectList(null)).thenReturn(List.of(hero(7L, "暗裔剑魔")));

        MyCollectionVO vo = service.getMyCollection(1L);

        assertEquals(2, vo.getTotalOwnedCount());   // 已拥有总数
        assertEquals(1, vo.getOwnedMatchedCount());  // 交集
        assertEquals(1, vo.getTotalSkinsInGame());
        assertEquals(1.0, vo.getCompletionRate().doubleValue());  // 1/1
        assertNull(vo.getLastSyncAt());
    }
```

（`activeSkin` / `hero` 两个 helper 自己在测试类里造，先读 `PlayerSkinSyncServiceImplTest` 现有的 setup 再照着写。
`PlayerSkinSyncServiceImplTest` 现在只 import 了 `java.util.List`，**要补 `import java.time.LocalDateTime;`**，
还要补 `import com.lolskin.inventory.vo.MyOwnedSummaryVO;` 和 `import com.lolskin.inventory.vo.MyCollectionVO;`。）

- [ ] **Step 10: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am test -Dmaven.test.skip=false
```

预期：`skin` 模块全绿。**`LolInventoryServiceImplTest` 也必须绿**——它验证 assembler 没回归。

- [ ] **Step 11: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add skin/src
git commit -m "feat(skin): 新增 my-collection 按英雄收集进度接口,收集率改用交集口径"
```

---

## Task 3: `DESKTOP` token 类型 + `redeem-desktop` 端点

**Files:**
- Modify: `all_function_api/user/src/main/java/com/lolskin/user/service/JwtService.java`
- Modify: `all_function_api/user/src/main/java/com/lolskin/user/service/SyncCodeService.java`
- Modify: `all_function_api/user/src/main/java/com/lolskin/user/controller/SyncCodeController.java`
- Create: `all_function_api/user/src/test/java/com/lolskin/user/controller/SyncCodeControllerTest.java`

- [ ] **Step 1: 写失败的 controller 测试**

新建 `user/src/test/java/com/lolskin/user/controller/SyncCodeControllerTest.java`。照 `SkinSyncControllerTest` 的 standaloneSetup 模式：

```java
package com.lolskin.user.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.lolskin.exception.GlobalExceptionHandler;
import com.lolskin.user.service.JwtService;
import com.lolskin.user.service.SyncCodeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SyncCodeControllerTest {

    private MockMvc mvc;
    private ObjectMapper mapper;
    private SyncCodeService syncCodeService;
    private JwtService jwtService;
    private StringRedisTemplate redis;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        syncCodeService = mock(SyncCodeService.class);
        jwtService = mock(JwtService.class);
        redis = mock(StringRedisTemplate.class);
        SyncCodeController controller = new SyncCodeController(syncCodeService, jwtService, redis);
        mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
            .build();
    }

    @Test
    void redeemDesktop_returnsDesktopToken() throws Exception {
        when(redis.opsForValue()).thenReturn(mock(org.springframework.data.redis.core.ValueOperations.class));
        when(syncCodeService.redeemDesktop("123456"))
            .thenReturn(new SyncCodeService.RedeemResult("desktop.jwt.token", 100L, "峡谷之魂"));

        mvc.perform(post("/sync-code/redeem-desktop")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"123456\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(200))
            .andExpect(jsonPath("$.data.token").value("desktop.jwt.token"));
    }

    @Test
    void redeemDesktop_invalidCode_returns400() throws Exception {
        when(redis.opsForValue()).thenReturn(mock(org.springframework.data.redis.core.ValueOperations.class));
        when(syncCodeService.redeemDesktop("000000")).thenReturn(null);

        mvc.perform(post("/sync-code/redeem-desktop")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"000000\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(400));
    }
}
```

> `ValueOperations` 的 mock 需要 `when(redis.opsForValue()).thenReturn(...)` 且 `get(failKey)` 返回 null。照抄即可——`get` 默认返回 null，Mockito 的 mock 默认值就是 null。
> 现有 `SyncCodeController` 用 `@RequiredArgsConstructor`，构造器参数顺序是 `(SyncCodeService, JwtService, StringRedisTemplate)`。

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl user -am test -Dmaven.test.skip=false
```

预期：编译失败，`redeemDesktop` 找不到符号。

- [ ] **Step 3: `JwtService` 加 DESKTOP 类型**

```java
    /**
     * token 类型：桌面同步客户端。
     *
     * <p>桌面端只需要「上传我的皮肤」和「读我的收藏」两件事，
     * 不该持有小程序的全权限 token(能发帖、评论、改资料)。
     * 靠 DesktopScopeInterceptor 默认拒绝 + @AllowsDesktopToken 白名单收窄。
     */
    public static final String TOKEN_TYPE_DESKTOP = "DESKTOP";
```

加一个方法（放在 `generateAdminToken` 后面）：

```java
    /**
     * 桌面同步客户端专用 token。
     *
     * <p>和用户 token 分开：桌面端的职责只有皮肤同步，
     * 不该能调发帖 / 评论 / 改资料这些小程序接口。
     */
    public String generateDesktopToken(Long userId, String openid) {
        return generate(userId, openid, TOKEN_TYPE_DESKTOP);
    }
```

- [ ] **Step 4: `SyncCodeService` 加 `redeemDesktop`**

现有 `redeem(String code)` 里签的是 `jwtService.generateToken(...)`。改成：

```java
    public RedeemResult redeem(String code) {
        return redeem(code, false);
    }

    /**
     * 兑换桌面端专用 token。
     *
     * <p>必须单开端点而不是复用 /redeem：同步码本身不记录是谁在兑换，
     * 兑换方无法从码里判断身份,只能由调用方指定签哪种 token。
     */
    public RedeemResult redeemDesktop(String code) {
        return redeem(code, true);
    }

    private RedeemResult redeem(String code, boolean desktop) {
        String userIdStr = redis.execute(
            redeemScript,
            List.of("sync_code:lookup:" + code)
        );
        if (userIdStr == null) return null;
        Long userId = Long.valueOf(userIdStr);
        User user = userMapper.selectById(userId);
        if (user == null) {
            log.warn("sync-code redeem: userId={} not found in t_user", userId);
            return null;
        }
        String jwt = desktop
            ? jwtService.generateDesktopToken(user.getId(), user.getOpenid())
            : jwtService.generateToken(user.getId(), user.getOpenid());
        return new RedeemResult(jwt, user.getId(), user.getNickname());
    }
```

**同一个 Lua 脚本、同一个 Redis 键**——所以一个同步码只能被兑换一次，两条路径共享这个语义。这是对的：码是给桌面端用的。

- [ ] **Step 5: `SyncCodeController` 加端点**

现有 `/redeem` 的 IP 限频逻辑（`failKey` / `failCount` / `LOCKOUT_THRESHOLD`）要**复用**，不能复制粘贴两份。用一个私有方法抽出来：

```java
    @Operation(summary = "兑换同步码拿 JWT(公开,带 IP 限频)")
    @PostMapping("/redeem")
    public Result<RedeemSyncCodeVO> redeem(@Valid @RequestBody RedeemSyncCodeRequest dto,
                                            HttpServletRequest request) {
        String ip = ClientIpResolver.resolveClientIp(request);
        String failKey = "rate:redeem:fail:" + ip;
        assertNotLockedOut(failKey);
        SyncCodeService.RedeemResult result = syncCodeService.redeem(dto.getCode());
        return finishRedeem(result, failKey);
    }

    @Operation(summary = "兑换同步码拿桌面端专用 JWT(公开,带 IP 限频)")
    @PostMapping("/redeem-desktop")
    public Result<RedeemSyncCodeVO> redeemDesktop(@Valid @RequestBody RedeemSyncCodeRequest dto,
                                                   HttpServletRequest request) {
        String ip = ClientIpResolver.resolveClientIp(request);
        String failKey = "rate:redeem:fail:" + ip;
        assertNotLockedOut(failKey);
        SyncCodeService.RedeemResult result = syncCodeService.redeemDesktop(dto.getCode());
        return finishRedeem(result, failKey);
    }

    private void assertNotLockedOut(String failKey) {
        String fails = redis.opsForValue().get(failKey);
        int failCount = 0;
        if (fails != null) {
            try {
                failCount = Integer.parseInt(fails);
            } catch (NumberFormatException e) {
                // Poisoned counter — fail-open, reset so a future INCR starts clean.
                log.warn("sync-code redeem: non-numeric fail counter for ip={}, resetting", failKey);
                redis.delete(failKey);
            }
        }
        if (failCount >= SyncCodeService.LOCKOUT_THRESHOLD) {
            throw new RateLimitedException("尝试次数过多,请 10 分钟后再试");
        }
    }

    private Result<RedeemSyncCodeVO> finishRedeem(SyncCodeService.RedeemResult result, String failKey) {
        if (result == null) {
            syncCodeService.incrementRedeemFailCount(ClientIpResolver.resolveClientIp(...)); // ← 见下方说明
            return Result.error(400, "无效或过期");
        }
        redis.delete(failKey);
        return Result.success(new RedeemSyncCodeVO(result.token(), result.userId(), result.nickname()));
    }
```

**⚠️ `finishRedeem` 需要 ip 参数**（`incrementRedeemFailCount(ip)` 要 ip），所以签名改成：

```java
    private Result<RedeemSyncCodeVO> finishRedeem(SyncCodeService.RedeemResult result, String ip, String failKey) {
        if (result == null) {
            syncCodeService.incrementRedeemFailCount(ip);
            return Result.error(400, "无效或过期");
        }
        redis.delete(failKey);
        return Result.success(new RedeemSyncCodeVO(result.token(), result.userId(), result.nickname()));
    }
```

两个调用点都传 `ip`。（上面 `finishRedeem` 那版的 `...` 是我写岔了，按这版来。）

- [ ] **Step 6: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl user -am test -Dmaven.test.skip=false
```

预期：`user` 模块全绿（注意 `PasswordResetServiceImplTest` 等存量测试也要绿）。

- [ ] **Step 7: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add user/src
git commit -m "feat(auth): 新增桌面端专用 DESKTOP token 与 redeem-desktop 端点"
```

---

## Task 4: `@AllowsDesktopToken` + `DesktopScopeInterceptor`

**Files:**
- Create: `all_function_api/core/src/main/java/com/lolskin/annotation/AllowsDesktopToken.java`
- Create: `all_function_api/app/src/main/java/com/lolskin/interceptor/DesktopScopeInterceptor.java`
- Modify: `all_function_api/app/src/main/java/com/lolskin/config/WebConfig.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/inventory/controller/SkinSyncController.java`
- Create: `all_function_api/app/src/test/java/com/lolskin/interceptor/DesktopScopeInterceptorTest.java`

- [ ] **Step 1: 写失败的拦截器测试**

新建 `app/src/test/java/com/lolskin/interceptor/DesktopScopeInterceptorTest.java`：

```java
package com.lolskin.interceptor;

import com.lolskin.annotation.AllowsDesktopToken;
import com.lolskin.exception.ForbiddenException;
import com.lolskin.user.service.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.HandlerMethod;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DesktopScopeInterceptorTest {

    private JwtService jwtService;
    private DesktopScopeInterceptor interceptor;

    static class Allowed {
        @AllowsDesktopToken
        public void ok() {}
    }

    static class NotAllowed {
        public void nope() {}
    }

    @BeforeEach
    void setUp() {
        jwtService = mock(JwtService.class);
        interceptor = new DesktopScopeInterceptor(jwtService);
    }

    private HttpServletRequest requestWithToken(String token) {
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getHeader("Authorization")).thenReturn("Bearer " + token);
        return req;
    }

    @Test
    void desktopToken_onAllowedMethod_passes() throws Exception {
        when(jwtService.getTokenType("desktop.token")).thenReturn(JwtService.TOKEN_TYPE_DESKTOP);

        boolean ok = interceptor.preHandle(requestWithToken("desktop.token"),
            mock(jakarta.servlet.http.HttpServletResponse.class),
            new HandlerMethod(new Allowed(), Allowed.class.getMethod("ok")));

        assertTrue(ok);
    }

    @Test
    void desktopToken_onUnannotatedMethod_throws403() throws Exception {
        when(jwtService.getTokenType("desktop.token")).thenReturn(JwtService.TOKEN_TYPE_DESKTOP);

        assertThrows(ForbiddenException.class, () -> interceptor.preHandle(
            requestWithToken("desktop.token"),
            mock(jakarta.servlet.http.HttpServletResponse.class),
            new HandlerMethod(new NotAllowed(), NotAllowed.class.getMethod("nope"))));
    }

    @Test
    void userToken_passesUnannotatedMethod() throws Exception {
        when(jwtService.getTokenType("user.token")).thenReturn(JwtService.TOKEN_TYPE_USER);

        boolean ok = interceptor.preHandle(requestWithToken("user.token"),
            mock(jakarta.servlet.http.HttpServletResponse.class),
            new HandlerMethod(new NotAllowed(), NotAllowed.class.getMethod("nope")));

        assertTrue(ok);
    }

    @Test
    void adminToken_passesUnannotatedMethod() throws Exception {
        when(jwtService.getTokenType("admin.token")).thenReturn(JwtService.TOKEN_TYPE_ADMIN);

        boolean ok = interceptor.preHandle(requestWithToken("admin.token"),
            mock(jakarta.servlet.http.HttpServletResponse.class),
            new HandlerMethod(new NotAllowed(), NotAllowed.class.getMethod("nope")));

        assertTrue(ok);
    }
}
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl app -am test -Dmaven.test.skip=false
```

预期：编译失败，`AllowsDesktopToken` / `DesktopScopeInterceptor` 找不到符号。

- [ ] **Step 3: 建注解**

新建 `core/src/main/java/com/lolskin/annotation/AllowsDesktopToken.java`：

```java
package com.lolskin.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记「桌面同步客户端的 token 可以访问」的方法。
 *
 * <p>配合 {@code DesktopScopeInterceptor} 使用:桌面 token 访问没有这个注解的方法 → 403。
 * 默认拒绝,新增接口忘了标注时桌面 token 进不来(fail-safe)。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AllowsDesktopToken {
}
```

- [ ] **Step 4: 建拦截器**

新建 `app/src/main/java/com/lolskin/interceptor/DesktopScopeInterceptor.java`：

```java
package com.lolskin.interceptor;

import com.lolskin.annotation.AllowsDesktopToken;
import com.lolskin.exception.ForbiddenException;
import com.lolskin.user.service.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 桌面同步客户端的 token 作用域限制。
 *
 * <p>桌面端只需要「上传我的皮肤」和「读我的收藏」,不该持有小程序的全权限 token。
 * 规则:
 * <ul>
 *   <li>tokenType == DESKTOP:方法上没有 {@link AllowsDesktopToken} → 403</li>
 *   <li>其他 tokenType(USER / ADMIN / 无效):原样放行,行为完全不变</li>
 * </ul>
 *
 * <p>用注解而不是路径白名单:注解默认拒绝,以后新增接口忘了标注,桌面 token 进不来。
 */
@Component
@RequiredArgsConstructor
public class DesktopScopeInterceptor implements HandlerInterceptor {

    private final JwtService jwtService;

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        if (!(handler instanceof HandlerMethod hm)) return true;

        String token = bearerToken(req);
        if (token == null) return true;   // 匿名请求交给各自的控制器处理(401)

        String tokenType = jwtService.getTokenType(token);
        if (!JwtService.TOKEN_TYPE_DESKTOP.equals(tokenType)) return true;

        if (hm.getMethodAnnotation(AllowsDesktopToken.class) == null) {
            throw new ForbiddenException("桌面客户端无权访问该接口");
        }
        return true;
    }

    private String bearerToken(HttpServletRequest req) {
        String auth = req.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) return null;
        String token = auth.substring(7);
        return token.isEmpty() ? null : token;
    }
}
```

> **无 token 时放行**（不抛 401）：这个拦截器只管「桌面 token 的作用域」，
> 「未登录要 401」由各控制器自己判（`SkinSyncController.extractUserId` 就是这么做的）。
> 拦截器抢着抛 401 会让公开端点（`/sync-code/generate` 之类）行为变复杂。

- [ ] **Step 5: 注册拦截器**

`WebConfig.java`：

```java
import com.lolskin.interceptor.DesktopScopeInterceptor;
import com.lolskin.interceptor.RoleInterceptor;
...
    @Autowired
    private RoleInterceptor roleInterceptor;

    @Autowired
    private DesktopScopeInterceptor desktopScopeInterceptor;
...
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(roleInterceptor)
            .addPathPatterns("/**")
            .excludePathPatterns("/auth/login", "/admin/login", "/login", "/cms/**", "/static/**");
        registry.addInterceptor(desktopScopeInterceptor)
            .addPathPatterns("/**");
    }
```

**不要给 `desktopScopeInterceptor` 加 `excludePathPatterns`** —— 它对非桌面 token 是透传的，加了排除反而留下漏洞。

- [ ] **Step 6: 标注三个方法**

`SkinSyncController.java`：

```java
    @AllowsDesktopToken
    @PostMapping("/sync-user-skins")
    public Result<SyncResultVO> sync(...)

    @AllowsDesktopToken
    @GetMapping("/my-owned")
    public Result<MyOwnedSummaryVO> myOwned(...)

    @AllowsDesktopToken
    @GetMapping("/my-collection")
    public Result<MyCollectionVO> myCollection(...)
```

import 加 `com.lolskin.annotation.AllowsDesktopToken`。

> ⚠️ **注解和 `@GetMapping` 的顺序无所谓**（Java 注解不按顺序生效）。
> ⚠️ `RoleInterceptor` 用的是 `hm.getMethodAnnotation(...)`（只看方法级），本项目没有类级 `@RequiresRole` 的用法，`DesktopScopeInterceptor` 保持一致。

- [ ] **Step 7: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl app,skin,user -am test -Dmaven.test.skip=false
```

预期：全绿。

- [ ] **Step 8: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add core/src app/src skin/src
git commit -m "feat(auth): 新增桌面 token 作用域拦截器,默认拒绝未标注接口"
```

---

# 阶段二：桌面端

## Task 5: `catalog.ts` 读新结构 + `auth.ts` 换兑换端点

**Files:**
- Modify: `local_skin_importer/src/main/catalog.ts`
- Modify: `local_skin_importer/src/main/auth.ts`
- Modify: `local_skin_importer/src/preload/index.ts`
- Modify: `local_skin_importer/src/main/__tests__/catalog.test.ts`
- Modify: `local_skin_importer/src/main/__tests__/auth.test.ts`

- [ ] **Step 1: 写失败的测试**

先读 `src/main/__tests__/catalog.test.ts` 看现有的 `fetchMyOwned` 用例长什么样，把 `ownedSkins` 形状改成 `ownedSkinIds`，并加一条 `lastSyncAt` 的断言：

```ts
    it('parses the slim ownedSkinIds shape and the last sync time', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: {
                code: 200,
                data: {
                    ownedSkinIds: [161013, 16001],
                    totalOwnedCount: 87,
                    lastSyncAt: '2026-10-30T16:20:33'
                }
            }
        });

        const snap = await fetchMyOwned();

        expect(snap.ownedSkinIds).toEqual([161013, 16001]);
        expect(snap.totalOwnedCount).toBe(87);
        expect(snap.lastSyncAt).toBe('2026-10-30T16:20:33');
    });
```

（`mockedAxios` 的名字照抄现有测试文件里的。）

`auth.test.ts` 里：把期望的请求 URL 从 `/api/sync-code/redeem` 改成 `/api/sync-code/redeem-desktop`。

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
```

预期：catalog 用例失败（`lastSyncAt` 是 undefined），auth 用例失败（URL 不匹配）。

- [ ] **Step 3: 改 `catalog.ts`**

```ts
export interface OwnedSnapshot {
  /** 已同步到后端的已拥有总数(含目录未收录的) */
  totalOwnedCount: number;
  /** 已拥有且目录里有对应行的 skinId 列表 */
  ownedSkinIds: number[];
  /**
   * 最近一次同步时刻(ISO 字符串)。
   * null = 该用户从未同步过 —— 小程序据此决定要不要显示「已拥有」徽标。
   */
  lastSyncAt: string | null;
}
```

```ts
interface OwnedPayload {
  totalOwnedCount?: number;
  ownedSkinIds?: number[];
  lastSyncAt?: string | null;
}
```

```ts
export async function fetchMyOwned(): Promise<OwnedSnapshot> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再查看已拥有皮肤');

  const url = `${BACKEND_BASE_URL}/api/skins/my-owned`;
  const { data } = await axios.get<BackendEnvelope<OwnedPayload>>(url, {
    timeout: OWNED_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` }
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(data.message ?? '获取已拥有皮肤失败');
  }
  const ownedSkinIds = (data.data.ownedSkinIds ?? []).filter(
    (v): v is number => typeof v === 'number'
  );
  return {
    totalOwnedCount: data.data.totalOwnedCount ?? ownedSkinIds.length,
    ownedSkinIds,
    lastSyncAt: typeof data.data.lastSyncAt === 'string' ? data.data.lastSyncAt : null
  };
}
```

- [ ] **Step 4: 改 `auth.ts`**

`redeemSyncCode` 里的 URL：

```ts
  const { data } = await axios.post<RedeemEnvelope>(
    `${BACKEND_BASE_URL}/api/sync-code/redeem-desktop`,
    { code },
    { headers: { 'Content-Type': 'application/json' } }
  );
```

- [ ] **Step 5: 改 `preload/index.ts`**

`OwnedSnapshot` 加 `lastSyncAt: string | null`（和 `catalog.ts` 保持一致）。

- [ ] **Step 6: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
npm run typecheck
```

预期：全绿。

- [ ] **Step 7: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src
git commit -m "feat: 适配新的 my-owned 接口结构与桌面端专用兑换端点"
```

---

## Task 6: 同步节流（`sync-state.json` + 纯函数）

**Files:**
- Create: `local_skin_importer/src/main/syncState.ts`
- Modify: `local_skin_importer/src/main/backend.ts`
- Modify: `local_skin_importer/src/main/ipc.ts`
- Modify: `local_skin_importer/src/preload/index.ts`
- Modify: `local_skin_importer/src/main/__tests__/backend.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `src/main/__tests__/backend.test.ts` 里加：

```ts
describe('shouldSkipSync', () => {
  it('skips when the last sync was more recent than the minimum interval', () => {
    expect(shouldSkipSync(1_000_000, 1_030_000, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(true);
  });

  it('does not skip when the minimum interval has elapsed', () => {
    expect(shouldSkipSync(1_000_000, 1_000_000 + MANUAL_SYNC_MIN_INTERVAL_MS, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(false);
  });

  it('does not skip when there is no previous sync', () => {
    expect(shouldSkipSync(null, 1_000_000, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(false);
  });

  it('uses a wider interval for automatic syncs', () => {
    expect(shouldSkipSync(1_000_000, 1_030_000, AUTO_SYNC_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldSkipSync(1_000_000, 1_030_000, MANUAL_SYNC_MIN_INTERVAL_MS)).toBe(false);
  });
});
```

import：`import { shouldSkipSync, AUTO_SYNC_MIN_INTERVAL_MS, MANUAL_SYNC_MIN_INTERVAL_MS } from '../backend';`

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
```

预期：编译失败，`shouldSkipSync` 未导出。

- [ ] **Step 3: `backend.ts` 加节流纯函数和 mode**

```ts
/** 后端 inventorySyncLimiter 是 10 秒最小间隔 + 60 秒内 5 次。 */
export const MANUAL_SYNC_MIN_INTERVAL_MS = 10_000;
/** 自动同步放宽到 60 秒:用户反复重开应用时不必每次都打后端。 */
export const AUTO_SYNC_MIN_INTERVAL_MS = 60_000;

export type SyncMode = 'auto' | 'manual';

/**
 * 这次同步要不要跳过。纯函数,不碰 IO,方便单测。
 *
 * 后端对同一用户有 10 秒最小间隔的限频,自动同步是静默的——
 * 撞上 429 用户只会觉得「怎么数据不更新」。本地先挡一道。
 */
export function shouldSkipSync(
  lastSyncAt: number | null,
  now: number,
  minIntervalMs: number
): boolean {
  if (lastSyncAt === null) return false;
  return now - lastSyncAt < minIntervalMs;
}

export function minIntervalFor(mode: SyncMode): number {
  return mode === 'auto' ? AUTO_SYNC_MIN_INTERVAL_MS : MANUAL_SYNC_MIN_INTERVAL_MS;
}
```

`syncOwnedSkins` 的签名改成：

```ts
export async function syncOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[],
  mode: SyncMode = 'manual'
): Promise<SyncResult> {
```

（`mode` 在 service 层不参与逻辑，只在 ipc 层做节流判断——加参数是为了让 ipc 层知道用哪个阈值。**如果你觉得这个参数没用，去掉它，改在 ipc.ts 里直接 `mode === 'auto' ? AUTO : MANUAL` 选阈值。后者更干净，推荐后者。**）

**决定：用后者。`syncOwnedSkins` 签名不变，节流逻辑放 ipc.ts。** 这样 `backend.ts` 只剩一个纯网络函数 + 纯节流函数。

- [ ] **Step 4: 建 `syncState.ts`**

新建 `src/main/syncState.ts`：

```ts
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILENAME = 'sync-state.json';

export interface SyncState {
  /** 最近一次成功同步的时刻(epoch ms);null = 从没同步过 */
  lastSyncAt: number | null;
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readSyncState(): SyncState {
  try {
    const p = stateFilePath();
    if (!fs.existsSync(p)) return { lastSyncAt: null };
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { lastSyncAt?: unknown };
    return {
      lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : null
    };
  } catch {
    // 文件损坏 / 读不到 = 当作从没同步过,不该挡住启动
    return { lastSyncAt: null };
  }
}

export function writeSyncState(state: SyncState): void {
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(state), 'utf-8');
  } catch {
    // 写不进去只影响节流,不影响同步本身
  }
}
```

> 这个文件**不含敏感信息**（只有一个时间戳），所以不用 `safeStorage` 加密，
> 也不需要 `auth.ts` 那套「加密不可用就拒绝落盘」的逻辑。

- [ ] **Step 5: `ipc.ts` 改 `backend:sync`**

```ts
interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
}
```

`assertSyncPayload` 里加 mode 校验（注意现有函数里的形参叫 `p`、转成 `obj` 后再取字段，照着写）：

```ts
  if (obj.mode !== undefined && obj.mode !== 'auto' && obj.mode !== 'manual') {
    throw new Error('invalid mode');
  }
```

handler：

```ts
  ipcMain.handle('backend:sync', async (_event, payload: SyncPayload) => {
    try {
      assertSyncPayload(payload);
      const mode = payload.mode ?? 'manual';
      const minInterval = mode === 'auto' ? AUTO_SYNC_MIN_INTERVAL_MS : MANUAL_SYNC_MIN_INTERVAL_MS;
      const state = readSyncState();
      const now = Date.now();

      if (shouldSkipSync(state.lastSyncAt, now, minInterval)) {
        return {
          skipped: true,
          lastSyncAt: state.lastSyncAt,
          result: null
        };
      }

      const result = await syncOwnedSkins(payload.puuid, payload.summonerName, payload.ownedSkinIds);
      // 只在成功后记时间戳 —— 失败不能算「已同步」
      writeSyncState({ lastSyncAt: now });
      return {
        skipped: false,
        lastSyncAt: now,
        result
      };
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });
```

import 补：`import { AUTO_SYNC_MIN_INTERVAL_MS, MANUAL_SYNC_MIN_INTERVAL_MS, shouldSkipSync } from './backend';`、`import { readSyncState, writeSyncState } from './syncState';`

- [ ] **Step 6: `preload/index.ts` 加类型**

```ts
export interface SyncPayload {
  puuid: string;
  summonerName: string;
  ownedSkinIds: number[];
  /** auto = 启动自动同步(60s 节流);manual = 用户手点(10s 节流) */
  mode?: 'auto' | 'manual';
}

export interface SyncOutcome {
  /** true = 被本地节流挡掉了,没打后端 */
  skipped: boolean;
  /** 最近一次成功同步的时刻(epoch ms) */
  lastSyncAt: number | null;
  /** 后端返回的计数;skipped 时为 null */
  result: SyncResult | null;
}
```

api 对象里：

```ts
  sync: (payload: SyncPayload): Promise<SyncOutcome> => invoke('backend:sync', payload),
```

- [ ] **Step 7: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
npm run typecheck
```

> ⚠️ `typecheck:web` 会检查 renderer。`Sync.vue` 现在还在用老的 `SyncResult`（`window.api.sync(...)` 的返回值类型变了），**Task 7 之前 typecheck 会红**。先把 `Sync.vue` 一起改了再跑 typecheck，或者这一步只跑 `npm run typecheck:node`。

- [ ] **Step 8: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src
git commit -m "feat: 同步增加本地节流,避免自动同步撞后端限频"
```

---

## Task 7: `Sync.vue` 启动自动同步（静默）

**Files:**
- Modify: `local_skin_importer/src/renderer/src/views/Sync.vue`

- [ ] **Step 1: 改 `onSync` 支持自动模式**

```ts
async function onSync(options: { auto?: boolean } = {}): Promise<void> {
  const isAuto = options.auto === true;
  if (!lastFetchedSkins.value) {
    // 自动模式下没有皮肤列表说明游戏客户端没开,静默跳过
    if (isAuto) {
      pushLog('WARN', 'Auto sync skipped: no skins fetched');
      return;
    }
    ElNotification({
      title: 'Cannot sync',
      message: '请先获取皮肤列表',
      type: 'warning',
      duration: 4000
    });
    return;
  }
  syncing.value = true;
  try {
    const { summoner, ownedSkinIds } = lastFetchedSkins.value;
    const outcome: SyncOutcome = await window.api.sync({
      puuid: summoner.puuid,
      summonerName: summoner.displayName,
      ownedSkinIds,
      mode: isAuto ? 'auto' : 'manual'
    });

    if (outcome.skipped) {
      pushLog('INFO', 'Sync skipped: 刚刚已同步过');
      if (!isAuto) {
        ElNotification({
          title: 'Sync skipped',
          message: '刚刚已同步过,稍后再试',
          type: 'info',
          duration: 4000
        });
      }
      return;
    }

    lastSyncResult.value = outcome.result;
    if (outcome.result) {
      skinCount.value = outcome.result.totalOwned;
      pushLog(
        'INFO',
        `Sync OK: added=${outcome.result.added} updated=${outcome.result.updated} totalOwned=${outcome.result.totalOwned}`
      );
    }
  } catch (e: unknown) {
    const msg = describeError(e);
    pushLog('ERROR', `Sync failed: ${msg}`);
    // 自动同步是静默的:用户没主动要求,失败不弹窗打扰他
    if (!isAuto) {
      notifyError('Sync failed', msg);
    }
  } finally {
    syncing.value = false;
  }
}
```

import 补 `import type { SyncOutcome } from '../../../preload/index';`（`SyncResult` 还要留着给 `lastSyncResult` 的 ref 类型）。

- [ ] **Step 2: 改 `onMounted` 加自动同步**

```ts
onMounted(async () => {
  await auth.refresh();
  await onCheckLcu();
  if (lcuStatus.value.running) {
    await onFetchSkins();
    if (loggedIn.value) {
      await onSync({ auto: true });
    }
  }
});
```

- [ ] **Step 3: 手动按钮传 manual**

模板里的 `@click="onSync"` 改成 `@click="onSync()"`——不传参数时 `options.auto` 是 undefined，等于 manual。**模板里不用改**，`@click="onSync"` 会把点击事件对象当第一个参数传进去！`onSync(options)` 收到的是 `MouseEvent`，`options.auto` 是 undefined → 走 manual 分支，**碰巧对**。但这是隐患，改成 `@click="onSync()"` 更明确。

- [ ] **Step 4: 跑测试和 typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
npm run typecheck
```

- [ ] **Step 5: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src
git commit -m "feat: 启动时自动同步皮肤,失败静默只记日志"
```

---

## Task 8: 皮肤总览弹窗显示「上次同步于 X」

**Files:**
- Modify: `local_skin_importer/src/renderer/src/composables/useSkinCatalog.ts`
- Modify: `local_skin_importer/src/renderer/src/components/SkinOverviewDialog.vue`

- [ ] **Step 1: `useSkinCatalog` 透传 `lastSyncAt`**

```ts
  const ownedLastSyncAt = ref<string | null>(null);
```

在 `loadOwned()` 的 backend 分支里：

```ts
      const snap: OwnedSnapshot = await window.api.fetchMyOwned();
      ownedIds.value = new Set(snap.ownedSkinIds);
      ownedReported.value = snap.totalOwnedCount;
      ownedLastSyncAt.value = snap.lastSyncAt;
      ownedSource.value = 'backend';
      return;
```

LCU 分支和降级分支里 `ownedLastSyncAt.value = null`。

return 里加上 `ownedLastSyncAt`。

- [ ] **Step 2: 弹窗加一行**

`SkinOverviewDialog.vue` 的 `.overview-stats` 区域，`ownedSourceText` 那一行下面加：

```html
          <span v-if="ownedSource === 'backend' && ownedLastSyncAt" class="stat-sub">
            上次同步于 {{ lastSyncText }}
          </span>
```

script 里加：

```ts
const lastSyncText = computed(() => {
  const iso = ownedLastSyncAt.value;
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return `${Math.floor(diffHour / 24)} 天前`;
});
```

- [ ] **Step 3: 跑测试和 typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
npm run typecheck
```

- [ ] **Step 4: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src
git commit -m "feat: 皮肤总览显示上次同步时间"
```

---

# 阶段三：小程序

## Task 9: `utils/owned-skins.js` —— 已拥有集合单例

**Files:**
- Create: `wechat_rating_program/utils/owned-skins.js`
- Create: `wechat_rating_program/tests/owned-skins.test.js`
- Modify: `wechat_rating_program/utils/config.js`

- [ ] **Step 1: 写失败的测试**

新建 `tests/owned-skins.test.js`：

```js
// tests/owned-skins.test.js
// 跑法: node --test tests/owned-skins.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizePayload,
  hasSnapshot,
  isOwned,
  isCacheFresh,
  CACHE_TTL_MS
} = require('../utils/owned-skins')

test('normalizePayload 只保留数字 ID', () => {
  const p = normalizePayload({ ownedSkinIds: [1001, 'x', null, 1002], totalOwnedCount: 9 })
  assert.deepEqual(p.ownedSkinIds, [1001, 1002])
  // 总数以服务端为准:后端 my-owned 里 totalOwnedCount 恒等于 ownedSkinIds.length
  assert.equal(p.totalOwnedCount, 9)
})

test('normalizePayload 服务端没给总数时回退到列表长度', () => {
  const p = normalizePayload({ ownedSkinIds: [1001, 1002] })
  assert.equal(p.totalOwnedCount, 2)
})

test('normalizePayload 缺字段时给空集合而不是崩', () => {
  const p = normalizePayload(null)
  assert.deepEqual(p.ownedSkinIds, [])
  assert.equal(p.totalOwnedCount, 0)
  assert.equal(p.lastSyncAt, null)
})

test('hasSnapshot 看 lastSyncAt 有没有,不看集合空不空', () => {
  assert.equal(hasSnapshot({ lastSyncAt: '2026-10-30T16:20:33' }), true)
  assert.equal(hasSnapshot({ lastSyncAt: null }), false)
  assert.equal(hasSnapshot(null), false)
})

test('isOwned 用的是 skin.skinId(游戏内 ID),不是主键', () => {
  const set = new Set([161013])
  assert.equal(isOwned(set, 161013), true)
  assert.equal(isOwned(set, 999), false)
})

test('isOwned 遇到 null / undefined 不算拥有', () => {
  const set = new Set([161013])
  assert.equal(isOwned(set, null), false)
  assert.equal(isOwned(set, undefined), false)
})

test('isCacheFresh 十分钟内算新鲜', () => {
  const now = 1_000_000_000
  assert.equal(isCacheFresh(now - 1000, now), true)
  assert.equal(isCacheFresh(now - CACHE_TTL_MS - 1, now), false)
  assert.equal(isCacheFresh(null, now), false)
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/owned-skins.test.js
```

预期：`Cannot find module '../utils/owned-skins'`。

- [ ] **Step 3: 建 `utils/owned-skins.js`**

```js
// utils/owned-skins.js
/**
 * 「我拥有的皮肤」集合 —— 桌面端同步上来、存在后端 t_user_skin 的那批。
 *
 * 用法:
 *   const OwnedSkins = require('../../utils/owned-skins.js')
 *   await OwnedSkins.load()
 *   OwnedSkins.isOwned(skin.skinId)   // 注意是 skin.skinId,不是 skin.id
 *
 * 降级:未登录 / 请求失败 / 后端没升级 → 空集合,不显示任何徽标。
 * 徽标是锦上添花,不该因为它把用户踢去登录页。
 */
const http = require('./request.js')
const config = require('./config.js')
const Auth = require('./auth.js')

const CACHE_KEY = 'ownedSkinsCache'
const CACHE_TTL_MS = 10 * 60 * 1000

// ===== 纯函数(可 node --test) =====

/**
 * 把后端返回的 my-owned 归一化成 { ownedSkinIds, totalOwnedCount, lastSyncAt }。
 * 后端没升级时 ownedSkinIds 是 undefined,这里兜成空数组。
 */
function normalizePayload (data) {
  if (!data) return { ownedSkinIds: [], totalOwnedCount: 0, lastSyncAt: null }
  const ids = Array.isArray(data.ownedSkinIds)
    ? data.ownedSkinIds.filter(v => typeof v === 'number')
    : []
  const reported = Number(data.totalOwnedCount)
  return {
    ownedSkinIds: ids,
    // 总数以服务端为准(后端 my-owned 里 totalOwnedCount 恒等于 ownedSkinIds.length);
    // 服务端没给这个字段时才回退到列表长度。桌面端 fetchMyOwned 用的是同一套规则。
    totalOwnedCount: isFinite(reported) && reported > 0 ? reported : ids.length,
    lastSyncAt: typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null
  }
}

/**
 * 有没有同步过快照。
 * lastSyncAt 为 null = 从没同步过(桌面端没跑过 / 没绑定)。
 * 跟「同步了但一个皮肤都没有」是两回事。
 */
function hasSnapshot (payload) {
  return !!(payload && payload.lastSyncAt)
}

/**
 * 这个皮肤是不是已拥有。
 * skinId 传 skin.skinId(游戏内皮肤 ID = t_skin.skin_id = LCU itemId)。
 * null / undefined = 目录里这条皮肤没有游戏内 ID,无法比对,一律 false。
 */
function isOwned (ownedSet, skinId) {
  if (skinId === null || skinId === undefined) return false
  return ownedSet.has(skinId)
}

/**
 * 本地缓存还有效吗
 */
function isCacheFresh (cachedAt, now) {
  if (typeof cachedAt !== 'number') return false
  return now - cachedAt < CACHE_TTL_MS
}

// ===== wx 依赖部分 =====

let ownedSet = new Set()
let snapshot = { ownedSkinIds: [], totalOwnedCount: 0, lastSyncAt: null }
let loaded = false
let inflight = null

function readCache () {
  try {
    const c = wx.getStorageSync(CACHE_KEY)
    if (!c || !isCacheFresh(c.cachedAt, Date.now())) return null
    return c.payload
  } catch (e) {
    return null
  }
}

function writeCache (payload) {
  try {
    wx.setStorageSync(CACHE_KEY, { cachedAt: Date.now(), payload })
  } catch (e) {
    // 存储写不进去不影响主流程
  }
}

function apply (payload) {
  snapshot = normalizePayload(payload)
  ownedSet = new Set(snapshot.ownedSkinIds)
}

async function fetchRemote () {
  const data = await http.get(config.API_PATHS.SKINS_MY_OWNED, {}, {
    showLoading: false,
    // 徽标是锦上添花,401 不要把用户踢去登录页
    silentError: true
  })
  const payload = normalizePayload(data)
  writeCache(payload)
  return payload
}

const OwnedSkins = {
  /**
   * 加载已拥有集合。幂等:已加载过就直接返回,缓存新鲜也不发请求。
   * @param {Object} options force = true 时忽略内存和本地缓存
   */
  async load (options = {}) {
    if (loaded && !options.force) return snapshot
    if (inflight) return inflight
    inflight = doLoad().finally(() => { inflight = null })
    return inflight
  },

  isOwned (skinId) {
    return isOwned(ownedSet, skinId)
  },

  hasSnapshot () {
    return hasSnapshot(snapshot)
  },

  getSnapshot () {
    return snapshot
  },

  getLastSyncAt () {
    return snapshot.lastSyncAt
  },

  _reset () {
    ownedSet = new Set()
    snapshot = { ownedSkinIds: [], totalOwnedCount: 0, lastSyncAt: null }
    loaded = false
    inflight = null
  }
}

async function doLoad () {
  loaded = true
  if (!Auth.isLoggedIn()) {
    apply(null)
    return snapshot
  }
  const cached = readCache()
  if (cached) {
    apply(cached)
    return snapshot
  }
  try {
    apply(await fetchRemote())
  } catch (e) {
    console.warn('加载已拥有皮肤失败:', e)
    apply(null)
  }
  return snapshot
}

module.exports = OwnedSkins
module.exports.normalizePayload = normalizePayload
module.exports.hasSnapshot = hasSnapshot
module.exports.isOwned = isOwned
module.exports.isCacheFresh = isCacheFresh
module.exports.CACHE_TTL_MS = CACHE_TTL_MS
```

> ⚠️ `module.exports = OwnedSkins` 之后再挂纯函数，是为了 `require('../utils/owned-skins')` 能同时拿到单例方法和纯函数。
> ⚠️ **`require('./request.js')` 在 node --test 里会执行 `utils/config.js` 的 `console.log`**——无害。
> ⚠️ **`utils/request.js` 顶层会 `new Request()`，但构造器里不碰 `wx`**，所以 node 下 require 不会炸。`utils/auth.js` 顶层也不碰 `wx`。**但 `OwnedSkins` 模块顶层的 `require('./auth.js')` 是安全的**——`wx` 只在函数体里用。
> ⚠️ 如果 node 下 require 真的炸了（某个依赖顶层用了 `wx`），把 `require('./request.js')` / `require('./auth.js')` 改成**惰性 require**（在 `doLoad` / `fetchRemote` 函数体里 require）。

- [ ] **Step 4: 加端点常量**

`utils/config.js` 的 `API_PATHS` 里，在「桌面端同步码」那段下面加：

```js
  // 桌面端同步码(小程序生成,桌面端兑换)
  SYNC_CODE_GENERATE: '/api/sync-code/generate',

  // 已拥有皮肤(桌面端同步上来,存在后端 t_user_skin)
  SKINS_MY_OWNED: '/api/skins/my-owned',
  // 皮肤收藏册(按英雄收集进度)
  SKINS_MY_COLLECTION: '/api/skins/my-collection',
```

- [ ] **Step 5: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/owned-skins.test.js
```

预期：全绿。

- [ ] **Step 6: 提交（交给用户）**

小程序**不是 git 仓库**，这步跳过。改动留在目录里。

---

## Task 10: 鉴赏页「已拥有」徽标

**Files:**
- Modify: `wechat_rating_program/pages/hero-detail/hero-detail.js`
- Modify: `wechat_rating_program/pages/hero-detail/hero-detail.wxml`
- Modify: `wechat_rating_program/pages/hero-detail/hero-detail.wxss`

- [ ] **Step 1: 改 `hero-detail.js`**

顶部加 require：

```js
const OwnedSkins = require('../../utils/owned-skins.js')
```

data 里加：

```js
    // 已拥有的游戏内皮肤 ID,做成 map 便于 O(1) 查。
    // key 是 String(skin.skinId);skin.skinId 为 null 时 String(null)='null',
    // 不会误命中,自然就是「不显示徽标」。
    ownedIndex: {},
```

`loadSkins` 改成：

```js
  loadSkins(heroId) {
    SkinApi.getSkinList({ heroId, size: 50 })
      .then(res => {
        const skins = (res && res.records) ? res.records : []
        this.setData({ skins: skins.map(s => this._withRating(s)) })
        this._loadRatingStats(skins)
      })
      .catch(err => {
        console.error('加载皮肤列表失败:', err)
        this.setData({ skins: [] })
      })
  },
```

新增一个方法，在 `_withRating` 之后：

```js
  /**
   * 拉「我拥有的皮肤」并给列表打标。
   * 失败/未登录 → 空 map,所有皮肤都不显示徽标(不打扰游客)。
   */
  loadOwned () {
    OwnedSkins.load()
      .then(() => {
        const map = {}
        OwnedSkins.getSnapshot().ownedSkinIds.forEach(id => {
          map[String(id)] = true
        })
        this.setData({ ownedIndex: map })
        // 集合到位后重新给已渲染的皮肤打标
        this.setData({
          skins: this.data.skins.map(skin => this._withOwned(skin))
        })
      })
      .catch(err => {
        console.warn('加载已拥有皮肤失败:', err)
      })
  },

  _withOwned (skin) {
    const owned = !!(skin.skinId != null && this.data.ownedIndex[String(skin.skinId)])
    return Object.assign({}, skin, { owned })
  },
```

`onLoad` 里加调用：

```js
  onLoad(options) {
    const { heroId } = options
    if (heroId) {
      this.setData({ heroId: Number(heroId) })
      this.loadHeroDetail(heroId)
      this.loadSkins(heroId)
      this.loadOwned()
    }
  },
```

`_withRating` 里也顺手带上 `owned`（初始为 false，等 `loadOwned` 回来再覆盖）：

```js
  _withRating(skin) {
    const count = Number(skin.ratingCount) || 0
    return Object.assign({}, skin, {
      scoreBadge: count > 0 ? toTen(skin.totalScore) : null,
      ratingCount: count,
      owned: false
    })
  },
```

- [ ] **Step 2: 改 `hero-detail.wxml`**

在 `.skin-image-wrapper` 里，评分徽标**之前**插入已拥有徽标（避免两个徽标重叠）：

```html
        <view class="skin-image-wrapper">
          <image ... />
          <view class="skin-image-fallback" wx:else>
            <text class="fallback-icon">🎴</text>
          </view>
          <view class="skin-owned-badge" wx:if="{{item.owned}}">已拥有</view>
          <view class="skin-score-badge" wx:if="{{item.ratingCount > 0}}">⭐ {{item.scoreBadge}}</view>
          <view class="skin-score-badge skin-score-badge-empty" wx:else>暂无评分</view>
        </view>
```

- [ ] **Step 3: 改 `hero-detail.wxss`**

先读现有的 `.skin-image-wrapper` / `.skin-score-badge` 样式，照着它们的定位方式加（`.skin-image-wrapper` 应该是 `position: relative`）：

```css
/* 已拥有徽标:右上角小圆点 + 文字标签,不遮挡皮肤图 */
.skin-owned-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.4;
  color: #0a0f14;
  background: linear-gradient(135deg, #c8aa6e, #e8d5a3);
  box-shadow: 0 0 6px rgba(200, 170, 110, 0.6);
  z-index: 2;
}
```

> ⚠️ **先确认 `.skin-image-wrapper` 有 `position: relative`**，没有就加上，否则徽标会相对更外层的祖先定位、跑到奇怪的位置。
> ⚠️ 评分徽标 `.skin-score-badge` 也在同一个 wrapper 里，如果它是 `position: absolute; bottom: ...`，两个徽标不会打架（一个上一个下）。**先读 wxss 确认**。

- [ ] **Step 4: 验证**

小程序没有自动化测试框架，验证方式：

1. 用微信开发者工具打开项目，编译无报错。
2. 进「英雄」tab → 点一个英雄 → 进英雄详情页。
3. **未登录状态**：不显示任何「已拥有」徽标，也不弹错误。
4. 用桌面端同步一次皮肤（Task 8 之后）→ 小程序重新进入英雄详情页 → 已拥有的皮肤右上角出现金色「已拥有」标签。
5. 退出登录 → 徽标消失。

**离线编译校验**（可选，DevTools 自带 wcc/wcsc）：

```bash
# DevTools 安装目录下的 wcc.exe / wcsc.exe，路径按本机实际替换
node_modules/.bin/... 
```

> 小程序没有 git，跳过提交。

---

## Task 11: `utils/collection.js` 纯函数 + 收藏册页

**Files:**
- Create: `wechat_rating_program/utils/collection.js`
- Create: `wechat_rating_program/tests/collection.test.js`
- Create: `wechat_rating_program/pages/collection/collection.js`
- Create: `wechat_rating_program/pages/collection/collection.wxml`
- Create: `wechat_rating_program/pages/collection/collection.wxss`
- Create: `wechat_rating_program/pages/collection/collection.json`
- Modify: `wechat_rating_program/app.json`

- [ ] **Step 1: 写失败的测试**

新建 `tests/collection.test.js`：

```js
// tests/collection.test.js
// 跑法: node --test tests/collection.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildRelativeTime,
  percentText,
  unmatchedCount,
  buildProgressWidth
} = require('../utils/collection')

test('相对时间:一分钟内说刚刚', () => {
  const now = Date.parse('2026-10-30T16:20:33')
  assert.equal(buildRelativeTime('2026-10-30T16:20:00', now), '刚刚')
})

test('相对时间:分钟 / 小时 / 天', () => {
  const now = Date.parse('2026-10-30T16:20:33')
  assert.equal(buildRelativeTime('2026-10-30T16:05:33', now), '15 分钟前')
  assert.equal(buildRelativeTime('2026-10-30T13:20:33', now), '3 小时前')
  assert.equal(buildRelativeTime('2026-10-27T16:20:33', now), '3 天前')
})

test('相对时间:数据缺失或解析不了就说还没同步', () => {
  assert.equal(buildRelativeTime(null, Date.now()), '还没同步')
  assert.equal(buildRelativeTime('不是时间', Date.now()), '还没同步')
})

test('percentText 把 0~1 的比例变成两位小数的百分数', () => {
  assert.equal(percentText(0.0374), '3.74')
  assert.equal(percentText(1), '100.00')
  assert.equal(percentText(0), '0.00')
})

test('percentText 非法输入给 0.00,不显示 NaN', () => {
  assert.equal(percentText(null), '0.00')
  assert.equal(percentText('abc'), '0.00')
})

test('unmatchedCount 是已拥有总数减去目录匹配数', () => {
  assert.equal(unmatchedCount(87, 80), 7)
  assert.equal(unmatchedCount(80, 80), 0)
})

test('buildProgressWidth 夹在 0~100 之间', () => {
  assert.equal(buildProgressWidth(0.5), 50)
  assert.equal(buildProgressWidth(2), 100)
  assert.equal(buildProgressWidth(-1), 0)
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/collection.test.js
```

预期：`Cannot find module '../utils/collection'`。

- [ ] **Step 3: 建 `utils/collection.js`**

```js
// utils/collection.js
/**
 * 收藏册的纯逻辑:相对时间、百分数、进度条宽度。
 * 抽成纯函数是为了能用 node --test 测(小程序页面本身没有测试框架)。
 */

/**
 * 「3 小时前」这类相对时间。
 * 后端 lastSyncAt 是 ISO 字符串(本地时区),用 Date.parse 解析。
 * 数据缺失 / 解析失败 → '还没同步'。
 */
function buildRelativeTime (isoString, now) {
  if (!isoString) return '还没同步'
  const t = Date.parse(isoString)
  if (Number.isNaN(t)) return '还没同步'
  const diffMin = Math.floor(((now || Date.now()) - t) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return diffMin + ' 分钟前'
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return diffHour + ' 小时前'
  return Math.floor(diffHour / 24) + ' 天前'
}

/**
 * 0~1 的比例 → 两位小数的百分数数字(不含 % 号)。
 * 非法输入给 '0.00',不显示 NaN。
 */
function percentText (rate) {
  const v = Number(rate)
  if (!isFinite(v) || v <= 0) return '0.00'
  return (Math.min(v, 1) * 100).toFixed(2)
}

/**
 * 已拥有但目录没收录的件数
 */
function unmatchedCount (totalOwnedCount, ownedMatchedCount) {
  const total = Number(totalOwnedCount) || 0
  const matched = Number(ownedMatchedCount) || 0
  return Math.max(0, total - matched)
}

/**
 * 进度条宽度百分比,夹在 0~100
 */
function buildProgressWidth (rate) {
  const v = Number(rate)
  if (!isFinite(v) || v <= 0) return 0
  return Math.min(v, 1) * 100
}

module.exports = {
  buildRelativeTime,
  percentText,
  unmatchedCount,
  buildProgressWidth
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/collection.test.js
```

预期：全绿。

- [ ] **Step 5: 建收藏册页 `collection.json`**

```json
{
  "navigationBarTitleText": "我的皮肤收藏册",
  "navigationBarBackgroundColor": "#0a0f14",
  "navigationBarTextStyle": "white",
  "backgroundColor": "#05070a"
}
```

- [ ] **Step 6: 建 `collection.js`**

```js
const http = require('../../utils/request.js')
const config = require('../../utils/config.js')
const Auth = require('../../utils/auth.js')
const OwnedSkins = require('../../utils/owned-skins.js')
const SkinApi = require('../../api/skin.js')
const {
  buildRelativeTime,
  percentText,
  unmatchedCount,
  buildProgressWidth
} = require('../../utils/collection')

Page({
  data: {
    loading: true,
    loadError: '',
    // 空态:登录了但从没同步过
    empty: false,

    completionPercent: '0.00',
    ownedMatchedCount: 0,
    totalSkinsInGame: 0,
    totalOwnedCount: 0,
    unmatchedCount: 0,
    lastSyncText: '',

    byHero: [],
    expandedHeroId: null,
    expandedSkins: [],
    expandedLoading: false
  },

  onLoad () {
    this.loadCollection()
    // 已拥有集合要单独拉一份,用来给展开的皮肤清单打标
    OwnedSkins.load()
  },

  loadCollection () {
    if (!Auth.isLoggedIn()) {
      this.setData({ loading: false })
      return
    }
    http.get(config.API_PATHS.SKINS_MY_COLLECTION, {}, { showLoading: false })
      .then(data => {
        const byHero = (data && Array.isArray(data.byHero)) ? data.byHero : []
        const ownedMatchedCount = Number(data.ownedMatchedCount) || 0
        const totalOwnedCount = Number(data.totalOwnedCount) || 0
        this.setData({
          loading: false,
          loadError: '',
          // lastSyncAt 为空 = 从没同步过 → 空态
          empty: !data || !data.lastSyncAt,
          completionPercent: percentText(data && data.completionRate),
          ownedMatchedCount,
          totalSkinsInGame: Number(data && data.totalSkinsInGame) || 0,
          totalOwnedCount,
          unmatchedCount: unmatchedCount(totalOwnedCount, ownedMatchedCount),
          lastSyncText: buildRelativeTime(data && data.lastSyncAt, Date.now()),
          byHero: byHero.map(h => Object.assign({}, h, {
            progressWidth: buildProgressWidth(h.heroCompletionRate)
          }))
        })
      })
      .catch(err => {
        console.error('加载收藏册失败:', err)
        this.setData({ loading: false, loadError: '加载失败,请重试' })
      })
  },

  /**
   * 点英雄卡 → 展开该英雄的皮肤清单。
   * byHero 只给了聚合数字,皮肤清单要现拉 —— 复用鉴赏页那套接口,
   * 客户端 join 已拥有集合。
   */
  onHeroTap (e) {
    const heroId = Number(e.currentTarget.dataset.heroId)
    if (!heroId) return
    if (this.data.expandedHeroId === heroId) {
      this.setData({ expandedHeroId: null, expandedSkins: [] })
      return
    }
    this.setData({ expandedHeroId: heroId, expandedLoading: true, expandedSkins: [] })
    SkinApi.getSkinList({ heroId, size: 50 })
      .then(res => {
        const skins = (res && res.records) ? res.records : []
        const snapshot = OwnedSkins.getSnapshot()
        const ownedSet = new Set(snapshot.ownedSkinIds)
        this.setData({
          expandedLoading: false,
          expandedSkins: skins.map(s => Object.assign({}, s, {
            // 用 skin.skinId(游戏内 ID),不是 skin.id(主键)
            owned: s.skinId != null && ownedSet.has(s.skinId)
          }))
        })
      })
      .catch(err => {
        console.error('加载英雄皮肤失败:', err)
        this.setData({ expandedLoading: false, expandedSkins: [] })
      })
  },

  onRetry () {
    this.setData({ loading: true, loadError: '' })
    this.loadCollection()
  }
})
```

- [ ] **Step 7: 建 `collection.wxml`**

⚠️ **小程序不支持 CSS Grid**（`grid-column` 会被静默忽略导致单列塌陷）——2 列卡片墙用 **flex + `width: 48%` + `justify-content: space-between`**。
⚠️ **嵌套 `wx:for` 的产物是父节点的 flex item**——英雄卡里的皮肤清单要用一个**块级容器**包起来，不能让皮肤项直接成为英雄卡的 flex item。

```html
<view class="collection-page">
  <!-- 加载中 -->
  <view class="collection-loading" wx:if="{{loading}}">
    <text class="loading-text">正在读取收藏册...</text>
  </view>

  <!-- 加载失败 -->
  <view class="collection-error" wx:elif="{{loadError}}">
    <text class="error-text">{{loadError}}</text>
    <button class="retry-btn" bindtap="onRetry">重试</button>
  </view>

  <!-- 空态:登录了但从没同步过 -->
  <view class="collection-empty" wx:elif="{{empty}}">
    <text class="empty-icon">🎴</text>
    <text class="empty-title">还没有皮肤数据</text>
    <text class="empty-hint">打开电脑上的桌面客户端,它会自动把你的皮肤同步过来</text>
  </view>

  <block wx:else>
    <!-- 总览卡 -->
    <view class="collection-summary-card">
      <text class="summary-percent">{{completionPercent}}%</text>
      <text class="summary-detail">已拥有 {{ownedMatchedCount}} / {{totalSkinsInGame}}</text>
      <text class="summary-detail" wx:if="{{unmatchedCount > 0}}">另有 {{unmatchedCount}} 个目录未收录</text>
      <text class="summary-sync">上次同步 {{lastSyncText}}</text>
    </view>

    <!-- 英雄卡片墙:flex 两列,不能用 grid -->
    <view class="hero-card-wall">
      <view
        class="hero-progress-card"
        wx:for="{{byHero}}"
        wx:key="heroId"
        bindtap="onHeroTap"
        data-hero-id="{{item.heroId}}"
      >
        <image class="hero-card-icon" src="{{item.heroIcon}}" mode="aspectFill" />
        <text class="hero-card-name">{{item.heroName}}</text>
        <text class="hero-card-count">{{item.ownedCount}} / {{item.totalCount}}</text>
        <view class="hero-card-bar">
          <view class="hero-card-bar-fill" style="width: {{item.progressWidth}}%;"></view>
        </view>

        <!-- 展开的皮肤清单:必须用块级容器包住,否则会挤进父级 flex 行 -->
        <view class="hero-card-skins" wx:if="{{expandedHeroId === item.heroId}}">
          <text class="hero-card-skins-loading" wx:if="{{expandedLoading}}">加载中...</text>
          <view
            class="hero-skin-row"
            wx:for="{{expandedSkins}}"
            wx:for-item="skin"
            wx:key="id"
          >
            <image
              class="hero-skin-thumb"
              src="{{skin.iconUrl || skin.splashUrl}}"
              mode="aspectFill"
            />
            <text class="hero-skin-name {{skin.owned ? 'is-owned' : ''}}">{{skin.name}}</text>
          </view>
        </view>
      </view>
    </view>
  </block>
</view>
```

> ⚠️ **`style="width: {{item.progressWidth}}%;"` 只能写在一行里**，不能换行（小程序 style 属性不支持多行）。
> ⚠️ **`expandedHeroId === item.heroId` 在 WXML 里能这么写吗？**——WXML 支持 `===` 比较运算符。✅ 但保险起见可以改成在 JS 里给每张卡加 `expanded: true/false` 字段，WXML 里 `wx:if="{{item.expanded}}"`。**推荐后者**，避免踩 WXML 表达式支持的坑。

**改成后者**，`collection.js` 的 `byHero.map` 改成：

```js
          byHero: byHero.map(h => Object.assign({}, h, {
            progressWidth: buildProgressWidth(h.heroCompletionRate)
          }))
```

在 `onHeroTap` 里同步 `expanded` 标记：

```js
    const byHero = this.data.byHero.map(h => Object.assign({}, h, {
      expanded: h.heroId === heroId
    }))
    this.setData({ byHero, expandedHeroId: heroId, expandedLoading: true, expandedSkins: [] })
```

关闭时：

```js
      const byHero = this.data.byHero.map(h => Object.assign({}, h, { expanded: false }))
      this.setData({ byHero, expandedHeroId: null, expandedSkins: [] })
```

WXML 里改成 `wx:if="{{item.expanded}}"`。

- [ ] **Step 8: 建 `collection.wxss`**

```css
.collection-page {
  padding: 24rpx;
  background: #05070a;
  min-height: 100vh;
}

.collection-loading,
.collection-error,
.collection-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 40rpx;
}

.loading-text,
.error-text {
  color: #8b93a7;
  font-size: 26rpx;
}

.retry-btn {
  margin-top: 24rpx;
  background: #c8aa6e;
  color: #0a0f14;
  font-size: 26rpx;
}

/* 总览卡 */
.collection-summary-card {
  display: flex;
  flex-direction: column;
  padding: 32rpx;
  border-radius: 16rpx;
  background: linear-gradient(135deg, #131a24, #0d131b);
  border: 1rpx solid rgba(200, 170, 110, 0.25);
  margin-bottom: 24rpx;
}

.summary-percent {
  font-size: 72rpx;
  font-weight: 600;
  color: #c8aa6e;
}

.summary-detail {
  font-size: 26rpx;
  color: #c8d0de;
  margin-top: 8rpx;
}

.summary-sync {
  font-size: 22rpx;
  color: #6b7385;
  margin-top: 12rpx;
}

/* 英雄卡片墙:flex 两列(小程序不支持 grid) */
.hero-card-wall {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.hero-progress-card {
  width: 48%;
  box-sizing: border-box;
  margin-bottom: 20rpx;
  padding: 20rpx;
  border-radius: 14rpx;
  background: #0d131b;
  border: 1rpx solid rgba(139, 147, 167, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.hero-card-icon {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #131a24;
}

.hero-card-name {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #e6ebf3;
  text-align: center;
}

.hero-card-count {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #8b93a7;
}

.hero-card-bar {
  width: 100%;
  height: 8rpx;
  margin-top: 12rpx;
  border-radius: 4rpx;
  background: #1b2431;
  overflow: hidden;
}

.hero-card-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #c8aa6e, #e8d5a3);
}

/* 展开的皮肤清单:块级容器,不能成为父级 flex item */
.hero-card-skins {
  width: 100%;
  margin-top: 16rpx;
  padding-top: 12rpx;
  border-top: 1rpx solid rgba(139, 147, 167, 0.18);
}

.hero-card-skins-loading {
  font-size: 22rpx;
  color: #6b7385;
}

.hero-skin-row {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}

.hero-skin-thumb {
  width: 56rpx;
  height: 56rpx;
  border-radius: 8rpx;
  background: #131a24;
}

.hero-skin-name {
  margin-left: 12rpx;
  font-size: 22rpx;
  color: #5a6478;
}

.hero-skin-name.is-owned {
  color: #c8aa6e;
}
```

- [ ] **Step 9: 注册路由**

`app.json` 的 `pages` 数组里，在 `"pages/profile/profile"` 后面加一行：

```json
    "pages/profile/profile",
    "pages/collection/collection",
```

（`pages` 数组的顺序不影响路由，但**不要加进 `tabBar`**——tabBar 已经是 5 项了。）

- [ ] **Step 10: 验证**

```bash
cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/
```

（`node --test tests/` 会跑目录下所有测试文件。）

微信开发者工具里编译无报错。

---

## Task 12: 个人中心加收藏册入口

**Files:**
- Modify: `wechat_rating_program/pages/profile/profile.js`
- Modify: `wechat_rating_program/pages/profile/profile.wxml`

- [ ] **Step 1: 改 `profile.wxml`**

在「获取桌面同步码」那一项**上面**加一项（收藏册是主要内容，同步码是设置类）：

```html
    <view class="hextech-menu-item" bindtap="onCollectionTap">
      <text class="menu-node-icon">🎴</text>
      <text class="menu-node-label">我的皮肤收藏册</text>
      <text class="menu-node-arrow">➡️</text>
    </view>

    <view class="hextech-menu-item" bindtap="onSyncCodeTap">
      <text class="menu-node-icon">🔗</text>
      <text class="menu-node-label">获取桌面同步码</text>
      <text class="menu-node-arrow">➡️</text>
    </view>
```

- [ ] **Step 2: 改 `profile.js`**

加方法（放在 `onSyncCodeTap` 附近）：

```js
  /**
   * 我的皮肤收藏册。
   * 没登录直接跳登录页 —— 收藏册是登录后才有的数据。
   */
  onCollectionTap () {
    if (!Auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }
    wx.navigateTo({ url: '/pages/collection/collection' })
  },
```

**先确认 `profile.js` 里有没有 require `Auth`。** 如果没有，在文件顶部加：

```js
const Auth = require('../../utils/auth.js')
```

> ⚠️ `pages/login/login` 是**登录页**，用 `wx.navigateTo` 跳过去的话，登录完不会自动退回收藏册。要凑合也行；如果登录页本身是 tabBar 页（不是），要用 `wx.reLaunch`。**先读 `pages/login/login.js` 看它登录成功后怎么跳的**，照抄那个模式。

- [ ] **Step 3: 验证**

开发者工具里：进「我的」→ 点「我的皮肤收藏册」→ 跳转正常；未登录时点它 → 跳登录页。

---

# 阶段四：联调与验收

## Task 13: 端到端联调

**前置：** 后端已部署到 `http://101.34.210.254`（小程序侧走 `https://www.sxdtaz.cn`），桌面端已重新打包。

- [ ] **Step 1: 后端冒烟**

```bash
curl -s -H "Authorization: Bearer <小程序 token>" http://101.34.210.254/api/skins/my-owned
```

预期：`{"code":200,"data":{"ownedSkinIds":[...],"totalOwnedCount":N,"lastSyncAt":"..."}}`

```bash
curl -s -H "Authorization: Bearer <小程序 token>" http://101.34.210.254/api/skins/my-collection
```

预期：`{"code":200,"data":{"totalOwnedCount":N,"ownedMatchedCount":M,"totalSkinsInGame":2138,"completionRate":0.0,"byHero":[...]}}`

- [ ] **Step 2: 桌面端换端点后仍能登录**

跑桌面端 → 输入同步码 → 应能拿到 token 并跳到同步页（`redeem-desktop` 端点生效）。

- [ ] **Step 3: 自动同步**

桌面端启动 → 游戏客户端开着 → Console 面板应出现 `Sync OK: added=... updated=... totalOwned=...`。

**再启动一次** → Console 应出现 `Sync skipped: 刚刚已同步过`（本地节流生效）。

- [ ] **Step 4: 小程序看到数据**

小程序登录 → 英雄详情页 → 已拥有的皮肤有「已拥有」徽标；「我的」→「我的皮肤收藏册」→ 显示总览卡 + 英雄卡片墙，数字跟后端一致。

- [ ] **Step 5: 桌面 token 的作用域**

用桌面端兑换到的 token 调一个不该能调的接口：

```bash
curl -s -X POST -H "Authorization: Bearer <桌面 token>" -H "Content-Type: application/json" \
  -d '{"name":"x","content":"y"}' http://101.34.210.254/api/forum/posts
```

预期：**403**，`{"code":403,"message":"桌面客户端无权访问该接口"}`。

再用**同一个**桌面 token 调 `my-owned` → 预期 200。

- [ ] **Step 6: 文档更新**

- `all_function_api/docs/superpowers/specs/2026-08-18-a0-tencent-inventory-research.md` 加一行状态说明：
  > 本次「桌面端 ↔ 小程序皮肤联动」确定走桌面端路线，A0 暂缓，未参与本次改动。
  并修正第 15 行那句已过时的话（小程序侧对 `my-owned` 的调用在 2026-10-22 论坛 tab 重构里已随 `api/inventory.js` 一起删除）。

- `all_function_api/README2.0.md` 里 `SkinSyncController` 那一行加上新端点：
  ```
  | `SkinSyncController` | `POST /skins/sync-user-skins`, `GET /skins/my-owned`, `GET /skins/my-collection` | 同步 + 查询我的持有 + 收藏册 |
  ```

- [ ] **Step 7: 全量测试**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn test -Dmaven.test.skip=false

cd D:/Code/Front_Project/all/local_skin_importer
npm run test
npm run typecheck

cd D:/Code/Front_Project/all/wechat_rating_program
node --test tests/
```

- [ ] **Step 8: 提交（交给用户）**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add -A
git commit -m "docs: 补充 my-collection 端点与 A0 路线状态说明"

cd D:/Code/Front_Project/all/local_skin_importer
git add -A
git commit -m "docs: 补充皮肤联动设计文档与实施计划"
```

小程序不是 git 仓库，跳过。

---

## 验收清单

- [ ] 桌面端启动时游戏客户端开着 → 自动同步成功，Console 有 `Sync OK`
- [ ] 桌面端 60 秒内重启 → 跳过同步，Console 有 `Sync skipped`
- [ ] 桌面端手动点 Sync now → 10 秒内点会提示「刚刚已同步过」
- [ ] 小程序未登录 → 鉴赏页无徽标，不掉登录态
- [ ] 小程序已登录但没同步过 → 无徽标，收藏册是空态
- [ ] 小程序已同步 → 鉴赏页有「已拥有」徽标，收藏册有数据
- [ ] 收藏册总览卡同时显示「已拥有 X / Y」和「另有 N 个目录未收录」
- [ ] 桌面 token 调论坛发帖接口 → 403
- [ ] 桌面 token 调 `my-owned` / `my-collection` / `sync-user-skins` → 200
- [ ] 小程序 token 调所有接口 → 行为跟改动前完全一致
- [ ] `t_user_skin` 表结构没变（没加字段）
- [ ] `PlayerSkinStatusAssembler.assemble` 的输出与改动前一致（`LolInventoryServiceImplTest` 全绿）

---

# 2026-10-31 晚间修正：拥有集合改用 LCU 库存端点（探针 13~17 的结论）

上面「商城三入口合并」那套方案**作废**。探针 13~17 在真实账号上跑完后，结论变了：
拥有集合要读 **LCU 库存端点**，再跟**站内目录**取交集。

## 一、库存端点就是权威口径

```
GET /lol-inventory/v2/inventory/CHAMPION_SKIN
```

路径段必须是**枚举名**（`owned` / `skins` / `all` 都是 200 + 空数组，不报错，静默返回 0 条）。
返回 3513 条 owned 条目，拥有状态是**扁平**的：`owned` / `ownershipType` / `rental` / `quantity`，
不是社区资料里那种嵌套的 `ownership.owned`。

条目里两个关键字段：`payload.isVintage`（绝版标记）、`purchaseDate`。

## 二、商城目录不能当「什么是皮肤」的依据

用户看到商城数据里混着**云顶之弈**的东西之后自己问出来的：商城目录是**商品**目录，
里面除了皮肤还有云顶棋盘（33200001）、英雄礼包（55500006）、货币（105）、蛋（396），
**全都标着 `inventoryType: CHAMPION_SKIN`**。

⇒ 商城目录只能当**炫彩黑名单**用，绝不能拿来定义「什么是皮肤」。
「站内有没有这条」的唯一依据是**站内目录的 skinId**。

## 三、最终口径：库存 ∩ 站内目录 = 1678

```
拥有 = 库存端点的 owned 条目 ∩ 站内目录的 skinId
```

取交集一步到位，炫彩、皮肤变体、经典版长 id（`60000000 + champId*1000 + 序号`）、
商城有而站内没收录的皮肤，全被滤掉 —— 因为站内目录一条炫彩/变体都没有。

对账（两条等式互相印证）：

| 等式 | 说明 |
|---|---|
| `1717 = 1678 + 39` | 客户端总数 = 站内收录的 1678 + 39 张经典版英雄皮肤卡 |
| `1717 = 2055 − 338` | 库存里 2055 条 normal 减去 338 条站内没收录的 |

经典版英雄皮肤卡（长 id）在站内没有对应行，**按「可收集皮肤」口径不计入**，
所以小程序和桌面端都比游戏客户端少 39 —— 这是口径差异，不是丢数据。

英雄默认皮肤（`skinId % 1000 === 0`）同样不计入：人人都有，客户端的收藏册也不算。
后端 `my-collection` 的 `totalSkinsInGame`（1965）和 `ownedMatchedCount` 用的就是这个规则，
桌面端上传前把默认皮肤也剔掉，两边数字才对得上。

## 四、改动清单

| 文件 | 改动 |
|---|---|
| `src/main/lcu.ts` | 新增 `getInventoryOwnedSkinIds`（读 v2 库存端点，30s 超时）；原商城逻辑改名 `getStoreOwnedSkinIds` 留作降级；删掉 `getOwnedSkinIds` |
| `src/main/owned.ts`（新增） | 唯一决定上传集合的地方：库存优先 → 失败退商城 → 都跟站内目录取交集、剔默认皮肤；返回数据来源 `inventory` / `store` |
| `src/main/catalog.ts` | 新增 `fetchCatalogSkinIds`（拿站内目录的 skinId 集合；后端没升级返回 null） |
| `src/main/ipc.ts` | `lcu:fetch-skins` 改用 `resolveOwnedSkinIds`，多返回 `source` / `catalogFiltered` |
| `src/preload/index.ts` | `FetchSkinsResult` 加 `source` / `catalogFiltered` |
| `src/renderer/src/views/Sync.vue` | 拥有数下面显示数据来源，降级到商城时一眼看得出 |
| `src/renderer/src/components/SkinOverviewDialog.vue` | 「绝版读不到」那句改成「绝版也能读到，差额是经典版英雄皮肤卡」 |
| `wechat_rating_program/pages/collection/collection.wxml` | 同上，改掉免责文案 |

降级链路：库存端点 404（老客户端）→ 用商城目录；站内目录拉不到（后端没升级）→ 只做商城口径，
并在界面上标出「未能与站内目录比对」。

## 五、历史脏数据要清一次

后端同步只有 `batchUpsert`（`ON DUPLICATE KEY UPDATE`），**没有 delete**。
早期误传的炫彩 / 变体 / 经典版长 id 会永远留在 `t_user_skin` 里，
把 `totalOwnedCount`（= 原始行数）撑大，小程序就会显示「另有 N 个目录未收录」。

一次性清理脚本：`all_function_api/app/src/main/resources/db/cleanup_user_skin_unlisted_2026_10.sql`
（不改表结构，只删「站内目录没有」的行和英雄默认皮肤行；先备份再删）。

桌面端修好之后**不会再产生新脏数据**，所以只清这一次就够。

# 2026-10-31 晚间追加：海克斯科技主题（Hextech）

桌面客户端整体换主题：深色金属魔法风。风格基准是「金 + 蓝 + 黑」，
形状靠 方形 / 菱形 / 圆形 三种几何拼出来，文字走小字号 + 大写 + 宽字距。

## 一、配色与质感

| 角色 | Token | 值 | 用在哪 |
|---|---|---|---|
| 近黑底 | `--hx-void` | `#05070a` | 页面底、弹窗遮罩 |
| 底色 | `--hx-bg` | `#070b11` | 页面底 |
| 面板 | `--hx-panel` | `#0b1219` | 卡片、弹窗、下拉面板 |
| 金 | `--hx-gold` | `#c8aa6e` | 金属边框、次级文字、拥有态 |
| 亮金 | `--hx-gold-bright` | `#f5d375` | 悬停 / 强调 |
| 金线 | `--hx-line` | `rgba(200,170,110,.22)` | 1px 分隔线 |
| 魔法蓝 | `--hx-blue` | `#35b8e8` | 核心交互高亮 |
| 亮蓝 | `--hx-blue-bright` | `#6ed3f6` | 悬停 |
| 蓝辉 | `--hx-blue-glow` | `rgba(53,184,232,.35)` | 聚焦光晕 |
| 正文 | `--hx-text` | `#dbe3ee` | 主文字 |
| 次级文字 | `--hx-text-dim` | `#8b93a7` | 说明、标签 |
| 弱文字 | `--hx-text-faint` | `#59637a` | 时间戳、角标 |
| 危险 | `--hx-danger` | `#ff6b6b` | 错误态 |

全部 token 集中在 `src/renderer/src/styles/hextech.css` 的 `:root`，
Element Plus 的暗色变量在同文件的 `html.dark` 里覆写。

**Element Plus 暗色必须给 `<html>` 加 `class="dark"`** —— `theme-chalk/dark/css-vars.css`
里的变量只在 `html.dark` 下生效。之前仓库里已经 import 了那行 css 但没加类，
界面一直是亮色。`hextech.css` 必须排在 element-plus 两个 css **之后** import，
否则同优先级下 Element 的规则会反超。

## 二、形状语言

| 形状 | 语义 | 落点 |
|---|---|---|
| 方形 | 结构 | 面板、按钮、卡片、输入框 —— `--el-border-radius-*: 0px`，全局去圆角 |
| 菱形 | 引导视线 | `.hx-diamond`（7px 正方形 `rotate(45deg)`），标题 / 品牌 / 状态行前面 |
| 圆形 | 聚焦 | `StatusDot`（LCU 状态点）、皮肤总览的完成度环（conic-gradient） |

## 三、按钮色彩规则

- **蓝色 = 与游戏本身互动的核心操作**：`Fetch skins`、`Sync now`、`打开皮肤总览`、`登录`
- **金色 = 次级交互**：`Check LCU`、`刷新目录`、`重试`、`Logout`、弹窗关闭

实现：主操作走 `el-button type="primary"`（主题里已改成魔法蓝），
次级操作加 `class="hx-gold"`。

## 四、语义色也收进金蓝体系

`html.dark` 里把 Element 的语义色换掉，避免出现默认的红/绿/橙塑料感：
成功 = 金、警告 = 亮金、错误 = 危险红、信息 = 中性灰，
对应的 `-light-9` 底色换成低透明度金/红/灰。

## 五、改动清单

| 文件 | 改动 |
|---|---|
| `src/renderer/src/styles/hextech.css`（新增） | 全部 token + Element Plus 覆写 + `.hx-label` / `.hx-diamond` / `.hx-divider` 通用零件 |
| `src/renderer/index.html` | `<html>` 加 `class="dark"` |
| `src/renderer/src/main.ts` | 引入 `hextech.css`（排在 element-plus 之后） |
| `src/renderer/src/App.vue` | 顶栏渐变底 + 金边、品牌菱形 + 金色大字距 |
| `src/renderer/src/views/Sync.vue` | 状态行 / 拥有数 / 数据来源标签 / 控制台面板改版；蓝色=实时来源，金色=降级来源 |
| `src/renderer/src/views/Login.vue` | 标题菱形 + 金色、登录蓝、登出金、hint 弱化 |
| `src/renderer/src/components/SkinOverviewDialog.vue` | 统计区加完成度环（圆形聚焦）+ 文字块分层 |
| `src/renderer/src/components/SkinCard.vue` | 缩略图金边、已拥有金字、未拥有置灰 + 直角「未拥有」角标 |
| `src/renderer/src/components/SkinDetailDialog.vue` | 大图金边、名称金色、标签金色 |
| `src/renderer/src/components/StatusDot.vue` | 运行态改魔法蓝 + 蓝辉 |

## 六、坑

- **`.thumb` 必须 `box-sizing: border-box`**：虚拟滚动网格按 `CARD_W=132 / CARD_H=176 / GAP=12 / ROW_H=188`
  算行高，加 1px 边框不内含就会撑破网格。
- **scoped 样式会盖掉全局 `.hx-label`**：原先 `.field-label` / `.skins-label` 自带 font-size/color，
  优先级更高。改法是删掉这些 scoped 规则里的 font-size/color，只留不冲突的属性。
- **`.el-alert` 的底色是 Element 内联 style 写死的**（`var(--el-color-xxx-light-9)`），
  所以要改的是 `--el-color-xxx-light-9` 变量，而不是给 `.el-alert` 写 background。

# 2026-10-31 晚间追加二:原皮剔除 + toC 化 + 开发者模式

## 一、图鉴里不再出现原皮

目录里混着 173 条英雄默认皮肤(原皮)。它们的名字和英雄名一模一样,
在「未拥有」列表里看着像一堆待收集的皮肤,但游戏收藏册本来就不算它们 —— 属于纯噪音。

判定规则(两条都留):

| 条件 | 依据 |
|---|---|
| `skinId % 1000 === 0` | 权威:skinId = champId * 1000 |
| 没有 skinId 且 `name === heroName` | 兜底:老数据没给 skinId 时,原皮的名字 = 英雄名 |

落点:`skinCatalogLogic.ts` 的 `isDefaultSkin` / `dropDefaultSkins`,
在 `useSkinCatalog.applyCatalog` 里去掉默认皮肤(先去原皮再去重)。后端接口不用动。

## 二、界面文案 toC 化

原则:**只说用户关心的事,内部标识一律收进开发者面板。**

| 原来 | 改后 |
|---|---|
| League Client | 游戏客户端 |
| Check LCU | 检测客户端 |
| Fetch skins | 读取我的皮肤 |
| Owned skins | 已拥有皮肤 |
| 皮肤总览 / 打开皮肤总览 | 皮肤图鉴 / 浏览图鉴 |
| Sync to backend | 同步到小程序 |
| Sync now | 立即同步 |
| added / updated / totalOwned | 新增 X 款 · 更新 Y 款 · 当前共 Z 款 |
| Console / No events yet. | (整块挪进开发者面板,叫「运行记录」) |
| PUUID、token 预览 | (挪进开发者面板) |
| 价格 / RP | 点券 |
| 目录未收录 | 暂未收录到图鉴 |
| 服务端版本过低,未返回皮肤 ID | 服务器版本较旧,暂时无法判断哪些皮肤你已经拥有 |

主界面只剩四张卡片:游戏客户端 / 已拥有皮肤 / 皮肤图鉴 / 同步到小程序。

## 三、开发者模式

口令是明文常量 `src/renderer/src/config/dev.ts` 的 `DEV_PASSWORD`(想改只改这一行)。

- **入口**:登录页底部那行很淡的版本号(同步页底部也有一份)。点它弹口令框。
- **解锁后**:本次运行内不再重复输口令,再点直接开面板。
- **面板**(`components/DevPanel.vue`,挂在 App.vue 上,全 App 一份):
  - 账号与内部标识:游戏账号、PUUID、客户端端口、登录凭证预览
  - 数据诊断:图鉴条数、已拥有(匹配)、拥有数据来源、皮肤 ID 覆盖率、皮肤 ID 字段是否到位、上次同步
  - 运行记录:原来主界面上的 Console 面板,挪到这里
  - 快捷操作:刷新图鉴、复制诊断信息(一键生成一段文本贴给排查用)、打开开发者工具、清除本机登录状态、退出开发者模式

新增两条 IPC:`dev:open-devtools`、`dev:copy-text`(剪贴板走主进程,
渲染进程是 sandbox 的,`navigator.clipboard` 不可靠)。

