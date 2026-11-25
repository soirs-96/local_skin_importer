# 误绑账号自助改绑链路

**Goal:** 让绑错了 LOL 账号的用户能在桌面端自助改绑到另一个账号,不用再撞那句「请联系管理员」——后台目前并没有这个能力,那句话是死胡同。

**Architecture:** 后端新增一条独立的「改绑 + 同步」接口(同一个请求里完成清库、改绑、重新同步),桌面端在同步撞到 PUUID 不匹配时弹确认框引导用户改绑。绑定账号(「名字#标签」)落到 `t_user.bound_account` 一列,供弹窗显示「当前绑的是谁」,顺带补上后台看不到绑定账号的缺口。

**Tech Stack:** Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + Redis(后端 `all_function_api`);Electron 39 + Vue 3.5 + TypeScript 5.9 + vitest 3.2(桌面端 `local_skin_importer`)。

**跨仓库:** 路径相对 `D:\Code\Front_Project\all\`:`all_function_api/`(后端)、`local_skin_importer/`(桌面端)。小程序 `wechat_rating_program/` 本次不动 —— 收藏册数据由后端提供,改绑后自动跟着变。

**相关文档:**
- 前身:`docs/superpowers/specs/2026-08-11-lol-skin-local-importer-design.md`(PUID 一次性绑定的原始设计,当时明确把「换绑」列为 v1 范围外)
- 前身:`docs/superpowers/specs/2026-08-11-sync-code-design.md`(6 位同步码)

---

## Background and Motivation

用户在桌面端点「立即同步」,弹窗报:

```
Error invoking remote message 'backend:sync': AxiosError: 账号已绑定其他 LOL 账号,如需更换请联系管理员 (HTTP 403)
```

### 链路三处都缺

| 位置 | 现状 |
| --- | --- |
| 后端 `PlayerSkinSyncServiceImpl.sync()` | `t_user.puuid` 首次同步写入,之后不匹配就抛 `ForbiddenException`(403)。**没有解绑/改绑接口** |
| 桌面端 `Sync.vue` | 只把后端文案弹成 ElNotification,**没有任何可点入口** |
| 后台管理端 | `grep puuid` 零命中 —— 连 PUUID 都看不到,更没有解绑按钮 |

所以 403 文案里的「联系管理员」在当前代码里**没有对应实现**。README Q7 也写着「联系管理员解绑后重新同步一次」,这条指引同样是空的。

### 为什么这次要做自助

「联系管理员」这条路要么补后台按钮(人工介入),要么让用户自己改库。两条都不理想:用户等管理员上班是一天,自助是三十秒。

桌面端是**唯一能读出本机 LCU 里当前 LOL 账号 PUUID 的组件**,所以桌面端发起的改绑天然带着「占有证明」——用户能发起这次改绑,说明他的游戏客户端正登着那个账号。这比管理员在后台看一个静态字段然后手动 UPDATE 靠谱。

### Scope

**In scope**

- 后端:`POST /api/skins/rebind-user-skins`(改绑 + 重新同步,一个请求)、`GET /api/skins/my-binding`(当前绑定信息)、PUID 不匹配从 403 改成 409、迁移脚本加 `t_user.bound_account` 列。
- 桌面端:`backend.ts` / `ipc.ts` / `preload` 加 `rebind` 与 `getBindingInfo`;`Sync.vue` 加「当前绑定」信息行 + 改绑确认弹窗 + 常驻的「更换绑定账号」入口;版本号 0.52.0 → 0.53.0;README Q7/Q10 改写。

**Out of scope**

- 小程序侧改动(数据是后端给的,自动跟着变)。
- 后台管理端的人工解绑按钮(`bound_account` 列已经落库,以后要加很便宜)。
- 跨设备改绑(改绑只能在绑着目标账号的那台电脑上做)。
- PUID 的全局唯一性(一个 PUUID 被两个微信账号绑定目前是允许的,本次不收紧)。

---

## 数据流

```
用户在桌面端点「立即同步」
        │
        ├─ 后端 PUUID 与库里不一致 → 409 Conflict(不再用 403)
        │
        ▼
桌面端弹确认框
  「你的收藏册绑的是 A#B,当前游戏客户端是 C#D。
   改绑会清掉 A#B 已同步的皮肤数据,并按 C#D 重新同步。」
        │ 确认
        ▼
POST /api/skins/rebind-user-skins   (载荷跟普通同步完全一样)
        │
        ▼
后端(同一事务内)
  1. 限频:改绑专用桶(相邻 ≥60s、24h 内 ≤3 次)
  2. Redis 锁 skin:sync:locked:{userId}(与普通同步互斥)
  3. 若新 PUUID == 已绑定 PUUID → 400「已经是这个 LOL 账号,不需要改绑」
  4. 清库:删 t_user_skin / t_user_top_champion / t_user_rank_profile / t_user_position
  5. 解绑:t_user.puuid=NULL、bound_account=NULL、game_id=NULL、game_zone=NULL、skin_count=0
  6. 重新绑定:写新 puuid + bound_account,并按新账号回填昵称/游戏ID/大区
     (昵称只在「原来是旧账号自动回填的名字」时才覆盖 —— 见「服务层」第 5 条)
  7. 写入:皮肤 UPSERT + 本命英雄/段位/位置快照整份替换 + 重算 skin_count
  8. mapDistributionService.evictCache()(召唤师星图的大区均值)
        │
        ▼
返回 SyncResultVO(added/updated/totalOwned)—— 桌面端照常更新界面
```

**为什么是一个请求而不是「先解绑再同步」两步:** 拆两步的话,第二步会撞上 `inventorySyncLimiter` 的 10 秒最小间隔(第一步刚占了一个名额),用户会看到「请稍后再试」。合成一个请求既避开限频,也让「清空 + 重建」落在同一个事务里,中间态不会露给小程序。

---

## 后端设计

### `t_user` 新增一列

`bound_account VARCHAR(64) NULL` —— 存绑定账号的 Riot ID「名字#标签」。

为什么不用现成的 `nickname` + `game_id` 拼:`nickname` 是用户在小程序里能改的展示名,`game_id` 只存标签那一段,两者都不是「绑定关系」本身的记录。独立一列只在绑定/改绑时写,不受用户编辑影响,后台也能直接看到「这个微信号绑的是哪个 LOL 账号」。

**迁移脚本必须先于后端发版上线**(生产 MySQL 5.7,幂等写法沿用 `migration_user_puuid_2026_08_rework.sql` 的 INFORMATION_SCHEMA + prepared statement 模式):

```
app/src/main/resources/db/migration_user_bound_account_2026_11.sql
```

> 新列不存在时,后端的 UPDATE 会直接报 `Unknown column`,同步全挂。所以「跑迁移」和「发后端」不能颠倒。

### Mapper 改动

`UserMapper`:

- `updatePuuid(userId, puuid, boundAccount)` —— 改成同时写 `bound_account`(原签名只有一处调用方)。
- `updateBoundAccountIfChanged(userId, boundAccount)` —— 新增。迁移之前绑过账号的老用户 `bound_account` 是空的,下次同步(PUID 对得上)时补上;用户改了 Riot ID 也跟着刷新。SQL 里带 `AND (bound_account IS NULL OR bound_account <> #{boundAccount})` —— 值没变就不写,免得每次同步都动一下 `updated_at`(后台列表按它排序)。
- `selectBoundAccountById(userId)` —— 新增,只读这一列。
- `clearGameBinding(userId)` —— 新增,一条 SQL 清 `puuid / bound_account / game_id / game_zone / skin_count`。

`UserSkinMapper`:

- `deleteByUserId(userId)` —— 新增。同步只做 UPSERT 从不删行(卖掉皮肤后库里还留着那行),改绑必须显式删,否则两个账号的皮肤会混在同一个收藏册里。

> 这条 SQL 显式写 `SET game_id = NULL` 而不是走 `updateById`:MyBatis-Plus 全局 NOT_NULL 策略会静默跳过 null,「本来就没填」和「要清空」就分不清了。

### 服务层

`PlayerSkinSyncService` 新增两个方法:

- `SyncResultVO rebind(SyncUserSkinsDTO dto, Long userId)`
- `BindingInfoVO getBindingInfo(Long userId)`

`rebind()` 的实现要点:

1. **限频**:新增一个限频器 bean `inventoryRebindLimiter`(`SimpleRateLimiter(Duration.ofSeconds(60), Duration.ofHours(24), 3)`),key 用 `skin-rebind:{userId}`。跟普通同步的桶分开 —— 改绑是破坏性操作,不能让同步的额度把它带过去。
2. **锁**:沿用 `skin:sync:locked:{userId}`,跟普通同步互斥(同一把锁,同一份 Redis key)。
   **放锁时机**:改绑是 `@Transactional` 的,方法体跑完时事务还没提交,这时候把锁放了,另一个同步请求能抢到锁、读到还没提交的旧 `puuid`,于是它被判成「绑错了」—— 白白把用户挡在门外。所以**有事务时把放锁推迟到事务提交之后**(`TransactionSynchronizationManager.registerSynchronization` 的 `afterCompletion`);普通同步没有事务,还是照旧在 `finally` 里放。
3. **同一个 PUUID 直接拒绝**:否则会把用户的收藏册清空再原样填回来,白折腾还丢数据。
4. **清库 + 解绑 + 重新绑定 + 写入**:把现有 `sync()` 里的「绑定 → 回填资料 → UPSERT → 快照 → skin_count → evictCache」抽成可复用的内部步骤,`rebind()` 在前面插一段「清库 + 解绑」。
5. **资料回填的口径与普通同步不同**:普通同步只填空着的字段(用户自己填过的不动);改绑时游戏ID/大区**强制**按新账号重写 —— 这两个字段描述的是「绑定的那个 LOL 账号」,留着旧账号的值就会出现「旧账号的游戏ID + 新账号的皮肤」这种拼接出来的假身份。
   **昵称是例外**:不能无脑覆盖,否则用户在小程序里自己起的名字会被换绑抹掉。判据是「当前昵称 == 旧绑定账号的名字」—— 说明这一栏本来就是从旧账号自动回填的,这时才换成新账号的名字;不是自动回填的(用户自己改过的)就原样留着。
   实现上把旧账号名从 `oldBoundAccount`(= `名字#标签`)里截出来传进回填逻辑;`oldBoundAccount` 为空(迁移前的老用户)时拿不到证据,一律按「用户自己填过的」处理,不动昵称。

`getBindingInfo()` 返回 `BindingInfoVO{ bound, boundAccount, nickname, gameId, gameZone, skinCount, lastSyncAt }`,数据全部来自 `t_user` + `t_user_skin` 的现有查询,不新增表。

### 错误码调整

PUID 不匹配从 `ForbiddenException`(403)改成 `ConflictException`(409)。理由:403 在这套后端里还表示「桌面客户端无权访问该接口」(`DesktopScopeInterceptor`),桌面端没法只靠状态码区分两件事;409 的语义就是「资源状态跟你要的不一致」,而且 `ConflictException` 已经在 `GlobalExceptionHandler` 里映射好了,不需要新异常类。

### Controller

```
POST /api/skins/rebind-user-skins   @AllowsDesktopToken
GET  /api/skins/my-binding           @AllowsDesktopToken
```

两个都只认桌面端 token(改绑是桌面端的场景,小程序碰不到 LCU)。

---

## 桌面端设计

### 主进程

`src/main/backend.ts`:

- 抽出共用的 `postBackend<T>(path, body)` / `getBackend<T>(path)`,把现在 `syncOwnedSkins` 里那套「401 清 token、4xx 不重试、网络错误重试 3 次」的逻辑收进去,三个接口共用一套。
- 新增 `rebindOwnedSkins(...)`(POST `/api/skins/rebind-user-skins`)与 `fetchBindingInfo()`(GET `/api/skins/my-binding`)。请求体跟 `syncOwnedSkins` 完全一致。

`src/main/ipc.ts`:

- `backend:rebind` —— 校验载荷(复用 `assertSyncPayload`)→ 调 `rebindOwnedSkins` → 成功后写 `lastSyncAt`。
  **不套本地节流**:本地 10s 节流是给普通同步用的,改绑是用户明确点出来的动作,不能被上一次的同步时间挡掉(后端自己有 60s 冷却兜底)。
- `backend:binding-info` —— 取当前绑定信息。

`src/preload/index.ts`:暴露 `rebind(payload)` 与 `getBindingInfo()`,加 `BindingInfo` 类型。

### 界面(`src/renderer/src/views/Sync.vue`)

1. 同步卡片里加一行常驻信息:「当前绑定:A#B」/「未绑定」。
2. 旁边一个次要按钮「更换绑定账号」—— 不等用户撞到报错就能主动改绑。
3. 同步失败时,若错误 `status === 409`,弹 `ElMessageBox.confirm`:
   - 标题:更换绑定的 LOL 账号
   - 正文:「你的收藏册当前绑的是 **{boundAccount}**,当前游戏客户端是 **{summonerName}**。改绑会**清空** {boundAccount} 已同步的皮肤数据,并按 {summonerName} 重新同步。」
   - 按钮:确认改绑 / 取消
   - 取消 = 什么都不做,只记日志。
4. 确认后走 `window.api.rebind(...)`,成功则刷新 `lastSyncResult` / `skinCount` / 绑定信息,失败照常弹错误。
5. 客户端账号跟绑定的不是同一个时,「当前绑定」下面常驻一行金色提示 —— 不用等同步被拒才发现。

自动同步(`mode: 'auto'`)撞到 409 **不弹窗** —— 自动同步是静默的,只有用户主动点才打扰。

### 409 怎么传到渲染层(Electron 的坑)

Electron 的 `ipcRenderer.invoke` 会把主进程抛出的错误重新包一层,消息变成:

```
Error invoking remote method 'backend:sync': AxiosError: 账号已绑定其他 LOL 账号 (HTTP 403)
```

而且**自定义属性会被丢掉** —— 主进程挂上去的 `status` 到渲染层就没了,没法靠状态码判断。

所以主进程在识别到 409 时,往错误消息里塞一个标记 `[PUID_MISMATCH]`,渲染层用 `parseSyncError()` 解析:剥掉 IPC 的外层前缀 → 看有没有标记 → 剥掉标记和 `AxiosError:` / `BackendError:` 这样的名字前缀 → 得到干净的提示文案。标记放在**消息里**而不是属性上,就是为了绕开属性被丢的问题。

### 其它

- `package.json` 版本 0.52.0 → 0.53.0(界面版本号从 package.json 读)。
- README Q7 / Q10 改掉「联系管理员解绑」的说法。

---

## 测试

**后端(JUnit,`skin` 模块):**

- `rebind` 清掉旧的四张表数据 + 解绑 + 用新 PUUID 重新绑定。
- `rebind` 强制回填新账号的游戏ID/大区(旧值被覆盖)。
- `rebind` 昵称:旧账号自动回填的名字 → 跟着换成新账号的名字;用户自己起的名字 → 原样保留。
- `rebind` 撞同一个 PUUID → 抛错,不动数据。
- `rebind` 限频命中 → 抛 `RateLimitedException`,且**在动数据之前**就抛(不清库)。
- `rebind` 锁被占 → 抛 `RateLimitedException`。
- `rebind` 走自己的限频桶(不占普通同步的额度)。
- `rebind` 正常路径会 `evictCache()`。
- `sync` 撞不同 PUUID → 抛 `ConflictException`(不再是 `ForbiddenException`)。
- `getBindingInfo` 返回绑定账号与皮肤数;没绑过 → `bound=false`。

**桌面端(vitest):**

- `rebindOwnedSkins` 打的是 `/api/skins/rebind-user-skins`,带 Bearer。
- 409 错误被原样抛出,`status` 为 409(桌面端靠这个识别)。
- `fetchBindingInfo` 打的是 `/api/skins/my-binding`。
- `parseSyncError`:剥掉 IPC 前缀、认出 `[PUID_MISMATCH]` 标记、剥掉 `AxiosError:` 之类的名字前缀。

**桌面端(手工):** 改绑弹窗的文案与「当前绑定」显示。

---

## 风险与未实测项

1. **迁移先于发版**:列没加就发后端,同步接口全部报 `Unknown column`。上线顺序必须是「跑迁移 → 发后端 → 发桌面端」。
2. **改绑是破坏性的**:清库不可撤销。缓解手段是确认弹窗 + 60s 冷却 + 24h 3 次上限 + 改绑与同步同事务(要么全成,要么全不成)。
3. **共享电脑**:拿到这台电脑的人可以改绑(不需要额外同步码验证 —— 桌面端已持有该微信账号的 JWT,现有同步也是同一信任级别)。
4. **昵称不会被覆盖**:用户在小程序里自定义过昵称,换绑后原样留着 —— 只有「昵称就是旧账号自动回填的名字」时才跟着换。代价是迁移前的老用户(`bound_account` 为空,拿不到旧账号名做判据)换绑后昵称仍停在旧账号的名字上。
5. **大区可能变空**:新账号的大区认不出来时,大区字段留空(`GameZones` 认不出来不猜),用户的匹配分区会跟着变。
6. **未实测**:改绑事务里 `evictCache()` 在事务提交前执行,理论上存在一个极窄的窗口让并发读缓存到旧数据 —— 与现有同步(非事务)的风险同级,本次不额外处理。
7. **老用户的「当前绑定」是空的**:`bound_account` 是新列,迁移之前绑过账号的用户这一列是 NULL,桌面端只能显示「已绑定」而没有账号名 —— 直到他们下次成功同步一次才补上(`updateBoundAccountIfChanged`)。
