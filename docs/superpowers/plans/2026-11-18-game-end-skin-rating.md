# 局末皮肤评分卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打完一局后自动弹出「这局用的皮肤」结算卡，用微信小程序同一套打分机制给这款皮肤打四维星级，提交进同一个 `t_rating` 表，小程序榜单同步可见。

**Architecture:** 后端只做两处小改（`/api/skins/list` 支持按 Riot `skinId` 过滤；`RatingController` 三个方法放行 DESKTOP token）。桌面端在主进程里用**已有的 LCU WebSocket 事件流**做局末边沿检测（`gameflow.phase` 进入 `PreEndOfGame/EndOfGame/PostGame`），用**已有的选人会话**记下本局的 Riot skinId，用 **2999 端口的最后一帧**给出即时战绩，再用 **match history**（有落库延迟，延后补）补上胜负/时长/位置。渲染进程收到主进程推送后弹一个海克斯科技主题的 `el-dialog`，星级表单复用小程序的四个维度标签和段位阈值。

**Tech Stack:** Electron 39.8.10 + electron-vite 3.1.0 + Vue 3.5.41 `<script setup>` + Element Plus 2.14.4 + TypeScript 5.9.3 + vitest 3.2.7 / Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + JUnit 5 + Mockito

**Spec:** `docs/superpowers/specs/2026-11-18-game-end-skin-rating-design.md`

---

## 0. 这个计划跟 spec 的出入（先看一眼）

| spec 写的 | 计划里改成 | 为什么 |
|---|---|---|
| `MatchSnapshot` 加 `settlement` 字段 | **不加**。结算走自己的一条推送频道 `match:settlement` + 一条取数频道 `match:get-settlement` | `src/shared/match.ts` 顶部有硬规则「不许 import 任何东西」，结算类型放进去就得 import；而且结算数据是局末那一刻才产生的，塞进每 2 秒推一次的快照里没有意义。行为等价：结算卡关掉后还能从界面重新打开（`App.vue` 里留一个「本局结算」入口） |
| 后端 `SkinQueryDTO.skinId` 用 `Long` | 用 `Integer` | `t_skin.skin_id` 本身就是 `Integer`（`SkinVO.skinId` 是 `Integer`），LCU 给的皮肤 id 也是 `Integer`。用 `Long` 会在 MyBatis-Plus 的 `eq` 里做类型转换 |
| 局末检测只靠轮询器读 `gameflow` | **事件流为主 + 轮询兜底** | 轮询器在「对局中」是**直接 return** 的（`poller.ts:471-482`，`live` 非空就早退），根本不会去读 gameflow。而现有的 `poller.test.ts` 里有一条断言「在对局里不该去问 LCU」，改成读 gameflow 会破坏它。所以局末判定走**已经连着的 WebSocket 事件流**，轮询路径只作为 WS 断了之后的兜底 |
| `liveClient.ts` 加 `/liveclientdata/playerstats` | 加，但**同时**扩展 `allgamedata` 的解析 | 两个端点的载荷形状各版本不一致，`playerstats` 的字段名没实测过。解析器接受多组候选字段名，两个端点哪个认得出来用哪个 |

---

## 1. 文件清单

### 后端 `all_function_api`（相对 `D:\Code\Front_Project\all\all_function_api\`）

| 文件 | 动作 |
|---|---|
| `skin/src/main/java/com/lolskin/skin/dto/SkinQueryDTO.java` | 改：加 `skinId` |
| `skin/src/main/java/com/lolskin/skin/controller/SkinController.java` | 改：`listSkins` 传 `dto.getSkinId()` |
| `skin/src/main/java/com/lolskin/skin/service/SkinService.java` | 改：`listSkins` 签名加 `Integer skinId` |
| `skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java` | 改：加 `skinId` 过滤条件 |
| `skin/src/main/java/com/lolskin/rating/controller/RatingController.java` | 改：三个方法加 `@AllowsDesktopToken` |
| `skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java` | 改：13 处 `listSkins` 调用补参数 + 1 个新用例 |
| `skin/src/test/java/com/lolskin/skin/service/impl/SkinPoolCodesTest.java` | 改：2 处 `listSkins` 调用补参数 |
| `skin/src/test/java/com/lolskin/rating/controller/RatingControllerTest.java` | 改：新增 3 个用例 |

### 桌面端 `local_skin_importer`（相对 `D:\Code\Front_Project\all\local_skin_importer\`）

| 文件 | 动作 |
|---|---|
| `src/shared/ratingTier.ts` | **新增** —— 分制/段位口径（纯函数，无 IO） |
| `src/shared/settlement.ts` | **新增** —— 跨进程结算类型（纯类型，不 import 任何东西） |
| `src/shared/__tests__/ratingTier.test.ts` | **新增** —— 口径单测 |
| `src/main/auth.ts` | 改：加 `readTokenUserId` / `getStoredUserId` |
| `src/main/__tests__/auth.test.ts` | 改：加 3 个用例 |
| `src/main/catalog.ts` | 改：加 `fetchCatalogSkinBySkinId`（匿名） |
| `src/main/__tests__/catalog.test.ts` | 改：加 2 个用例 |
| `src/main/rating.ts` | **新增** —— 后端三个评分接口 |
| `src/main/__tests__/rating.test.ts` | **新增** |
| `src/main/match/usedSkin.ts` | **新增** —— 纯解析：认皮肤（不发请求） |
| `src/main/match/__tests__/usedSkin.test.ts` | **新增** |
| `src/main/match/liveClient.ts` | 改：加 `getPlayerStats`；扩展 `getAllGameData` |
| `src/main/match/__tests__/liveClient.test.ts` | **新增** |
| `src/main/match/recentMatches.ts` | 改：加 `findJustFinishedMatch` / `toMatchScore`；`findMyParticipant` 导出 |
| `src/main/match/__tests__/recentMatches.test.ts` | 改：加 3 个用例 |
| `src/main/match/opponents.ts` | 改：加 `getGameflowPhase` |
| `src/main/match/poller.ts` | 改：局末边沿检测 + 皮肤/英雄记录 + 结算产出 + 补齐段 |
| `src/main/match/__tests__/poller.test.ts` | 改：加 4 个用例 |
| `src/main/match/settlement.ts` | **新增** —— 把本地事实补成渲染进程要的那份 |
| `src/main/__tests__/settlement.test.ts` | **新增** |
| `src/main/ipc.ts` | 改：2 个新通道 + 结算推送 + 系统通知 |
| `src/preload/index.ts` | 改：3 个新方法 + 类型导出 |
| `src/main/__tests__/ipc.test.ts` | 改：通道数 27 → 29 |
| `src/main/index.ts` | 改：启动时把轮询器拉起来 |
| `src/renderer/src/components/match/SkinRatingDialog.vue` | **新增** —— 结算卡弹窗 |
| `src/renderer/src/App.vue` | 改：挂弹窗 + 订阅结算推送 |
| `package.json` | 改：版本 0.34.0 → 0.35.0 |

---

## 2. 三条铁律（写代码前再看一遍）

1. **匿名 vs 带 token，不能混。** 桌面端**没有全局 axios 拦截器**，每个调用点自己决定带不带头。`SkinController.listSkins` **没有** `@AllowsDesktopToken` —— 给它带上 DESKTOP token 会被 `DesktopScopeInterceptor` 拦成 403。目录查询（`/api/skins/list`）必须**匿名**；评分接口（`/api/ratings*`）必须**带 token**。
2. **三套皮肤 id 别混。** `t_skin.id` = 站内 id（打分接口要的是它）；`t_skin.skin_id` = 游戏内 Riot id（局内读到的是它）；`t_skin.hero_id` = 站内 `t_hero.id`（**不是** Riot championId）。所以 `/api/skins/list` 的 `heroId` 参数对局内数据**没用**，只能新加 `skinId` 过滤。
3. **拿不到就缺着，不编。** 没认到皮肤 → 不给打分表单；没查到 match history → 不显示胜负；后端 404 → 整块不显示。界面上不许出现「0」「—」以外的占位假数据。

---

## Task 0：探测（先跑，再写代码）

**这一步不写任何代码。** 它决定后面几处解析器要不要留兜底。

### Task 0.1：选人会话里有没有 `skinId`

在**选人阶段**（进了选人、还没开局）跑：

```powershell
cd D:\Code\Front_Project\all\local_skin_importer
node scripts\dump-lcu-champselect.mjs
```

打开 `scripts/champselect-dump.json`，找 `myTeam` 里**本地玩家那一条**（用 `localPlayerCellId` 对上 `cellId`）。

**记录下来**（写进实施记录，后面 Task 6 / Task 12 要用）：

- [ ] 有没有 `skinId` 这个 key？
- [ ] 值是数字还是字符串？
- [ ] 是不是 0（0 = 客户端没给）？

### Task 0.2：match history 的 participant 有没有 skin 字段

**打完一局**（等结算画面出来之后）跑：

```powershell
node scripts\dump-lcu-match-history.mjs
```

输出里那行 `participant fields:` 就是全部字段名。

- [ ] 有没有 skin 相关的字段？叫什么？
- [ ] 刚打完的那一局**在不在**列表里？（`gameCreation` 是不是已经落库）—— 这决定 Task 12 的「补齐段」是秒补还是永远补不上

### Task 0.3：`t_skin.skin_id` 跟 LCU 的皮肤 id 是不是同一个数

拿 Task 0.1 读到的 skinId，浏览器打开：

```
http://101.34.210.254/api/skins/list?current=1&size=5&skinId=<skinId>
```

- [ ] 有没有命中？（Task 1 之后这个参数才生效，现在先用 `keyword` 搜皮肤名对一下）

**探测结论如果与本计划假设不符**，停下来告诉用户，不要自己改口径。

---

## Task 1：后端 —— `/api/skins/list` 支持按 Riot `skinId` 过滤

**Files:**
- Modify: `skin/src/main/java/com/lolskin/skin/dto/SkinQueryDTO.java`
- Modify: `skin/src/main/java/com/lolskin/skin/controller/SkinController.java:33-45`
- Modify: `skin/src/main/java/com/lolskin/skin/service/SkinService.java:23`
- Modify: `skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java:46-105`
- Test: `skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java`

- [ ] **Step 1: 先写失败的测试**

在 `SkinServiceImplTest.java` 末尾（最后一个 `}` 之前）加：

```java
    @Test
    void listSkins_skinIdFilter_按游戏内皮肤id过滤() {
        stubPage(List.of());
        when(heroMapper.selectBatchIds(any())).thenReturn(List.of());

        service.listSkins(1L, 20L, null, null, null, null, null, null, 161013);

        ArgumentCaptor<Wrapper<Skin>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(skinMapper).selectPage(any(), captor.capture());
        String sql = captor.getValue().getSqlSegment();
        Map<String, Object> params = paramsOf(captor.getValue());
        assertTrue(sql.contains("skinId") || sql.contains("skin_id"), "实际 SQL 片段: " + sql);
        assertTrue(params.containsValue(161013), "应该按游戏内皮肤 id 过滤: " + params);
    }

    @Test
    void listSkins_skinId不传时不加这个条件() {
        stubPage(List.of());
        when(heroMapper.selectBatchIds(any())).thenReturn(List.of());

        service.listSkins(1L, 20L, null, null, null, null, null, null, null);

        ArgumentCaptor<Wrapper<Skin>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(skinMapper).selectPage(any(), captor.capture());
        String sql = captor.getValue().getSqlSegment();
        assertTrue(!sql.contains("skinId") && !sql.contains("skin_id"), "实际 SQL 片段: " + sql);
    }
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
cd D:\Code\Front_Project\all\all_function_api
mvn -pl skin -am install -DskipTests -Dmaven.test.skip=true
mvn -pl skin test -Dmaven.test.skip=false -Dtest=SkinServiceImplTest
```

Expected: **编译失败** —— `listSkins` 现在只有 8 个参数，9 个参数的那个重载不存在。

- [ ] **Step 3: `SkinQueryDTO` 加 `skinId`**

在 `private String status;` 之后加：

```java
    /**
     * 游戏内皮肤 ID(t_skin.skin_id,不是站内主键)。
     *
     * <p>桌面端局内读到的是 Riot 的皮肤 id,拿它反查站内那条皮肤。
     * 用 heroId 查不行 —— t_skin.hero_id 指的是站内 t_hero.id,跟 Riot 的 championId 不是一回事。
     */
    @Schema(description = "游戏内皮肤ID(t_skin.skin_id,可选)")
    private Integer skinId;
```

- [ ] **Step 4: `SkinService` 改签名**

```java
    /**
     * 分页查询皮肤列表
     *
     * @param pool 奖池编码;不传 = 不按奖池过滤,传了未知编码 = 没有成员(空列表)
     * @param seriesId 系列ID;不传 = 不按系列过滤
     * @param skinId 游戏内皮肤 ID(t_skin.skin_id);不传 = 不按皮肤过滤
     */
    IPage<SkinVO> listSkins(Long current, Long size, Long heroId, String rarity, String keyword, String pool, Long seriesId, String status, Integer skinId);
```

- [ ] **Step 5: `SkinServiceImpl` 改签名 + 加过滤**

签名改成：

```java
    @Override
    public IPage<SkinVO> listSkins(Long current, Long size, Long heroId, String rarity, String keyword, String pool, Long seriesId, String status, Integer skinId) {
```

在 `if (heroId != null) { ... }` 之后紧接着加：

```java
        // 游戏内皮肤 ID(t_skin.skin_id)。桌面端局内读到的是 Riot 的皮肤 id,
        // 拿它反查站内这一条 —— heroId 查不了,那是站内 t_hero.id。
        if (skinId != null) {
            queryWrapper.eq(Skin::getSkinId, skinId);
        }
```

- [ ] **Step 6: `SkinController` 传参**

```java
    @GetMapping("/list")
    public Result<PageResult<SkinVO>> listSkins(SkinQueryDTO dto) {
        IPage<SkinVO> page = skinService.listSkins(
                dto.getCurrent(),
                dto.getSize(),
                dto.getHeroId(),
                dto.getRarity(),
                dto.getKeyword(),
                dto.getPool(),
                dto.getSeriesId(),
                dto.getStatus(),
                dto.getSkinId()
        );
        return Result.success(new PageResult<>(page));
    }
```

- [ ] **Step 7: 修所有既有调用点（编译会一条条报出来）**

`SkinServiceImplTest.java` 里 **13 处** `service.listSkins(...)` 调用、`SkinPoolCodesTest.java` 里 **2 处** —— 每处在末尾补一个 `null`：

```java
// 原来
service.listSkins(1L, 20L, null, null, null, null, null, null);
// 改成
service.listSkins(1L, 20L, null, null, null, null, null, null, null);
```

带参数的同理（`"SANYHE"` / `19L` / `"all"` 那几个）：

```java
service.listSkins(1L, 20L, null, null, null, "SANYHE", null, null, null);
service.listSkins(1L, 20L, null, null, null, null, 19L, null, null);
service.listSkins(1L, 20L, null, null, null, null, null, "all", null);
service.listSkins(1L, 20L, null, null, null, null, null, "active", null);
service.listSkins(1L, 20L, null, null, null, null, null, "inactive", null);
```

- [ ] **Step 8: 跑测试，确认全绿**

```powershell
mvn -pl skin test -Dmaven.test.skip=false -Dtest=SkinServiceImplTest+SkinPoolCodesTest
```

Expected: `Tests run: 20, Failures: 0, Errors: 0`（两个类的用例总数，以实际输出为准）。

- [ ] **Step 9: 提交**

```powershell
git add -A
git commit -m "feat(skin): 皮肤列表支持按游戏内 skinId 过滤"
```

---

## Task 2：后端 —— 评分接口放行 DESKTOP token

**Files:**
- Modify: `skin/src/main/java/com/lolskin/rating/controller/RatingController.java`
- Test: `skin/src/test/java/com/lolskin/rating/controller/RatingControllerTest.java`

- [ ] **Step 1: 先写失败的测试**

在 `RatingControllerTest.java` 里，`setUp()` 之后加：

```java
    /**
     * 桌面端要能打分,就得让 DESKTOP token 进得来。
     *
     * DesktopScopeInterceptor 看的是「方法上有没有 @AllowsDesktopToken」,
     * 不是「这个接口要不要鉴权」—— 所以公开读的 skin-stats 也得标。
     */
    @Test
    void 评分接口_都放行桌面端token() throws Exception {
        assertTrue(RatingController.class.getMethod("list", RatingQueryDTO.class, jakarta.servlet.http.HttpServletRequest.class)
                .isAnnotationPresent(com.lolskin.annotation.AllowsDesktopToken.class));
        assertTrue(RatingController.class.getMethod("create", com.lolskin.rating.entity.Rating.class, jakarta.servlet.http.HttpServletRequest.class)
                .isAnnotationPresent(com.lolskin.annotation.AllowsDesktopToken.class));
        assertTrue(RatingController.class.getMethod("skinStats", RatingQueryDTO.class)
                .isAnnotationPresent(com.lolskin.annotation.AllowsDesktopToken.class));
    }
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
mvn -pl skin test -Dmaven.test.skip=false -Dtest=RatingControllerTest
```

Expected: FAIL —— `评分接口_都放行桌面端token` 断言失败（注解不存在）。

- [ ] **Step 3: 加注解**

`RatingController.java`：

1. import 加上：`import com.lolskin.annotation.AllowsDesktopToken;`
2. `list` 方法（`@GetMapping` 下面那行）加：
   ```java
    @GetMapping
    @AllowsDesktopToken
    public Result<IPage<RatingListVO>> list(RatingQueryDTO query, HttpServletRequest request) {
   ```
3. `create` 方法加：
   ```java
    @PostMapping
    @AllowsDesktopToken
    public Result<Rating> create(@RequestBody Rating rating, HttpServletRequest request) {
   ```
4. `skinStats` 方法加：
   ```java
    @GetMapping("/skin-stats")
    @AllowsDesktopToken
    public Result<IPage<SkinRatingStatsVO>> skinStats(RatingQueryDTO query) {
   ```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
mvn -pl skin test -Dmaven.test.skip=false -Dtest=RatingControllerTest
```

Expected: `Tests run: 6, Failures: 0, Errors: 0`

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat(rating): 评分接口放行桌面端 token"
```

---

## Task 3：桌面端 —— 分制/段位口径

**Files:**
- Create: `src/shared/ratingTier.ts`
- Create: `src/shared/__tests__/ratingTier.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/shared/__tests__/ratingTier.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { RATING_DIMENSIONS, RATING_TIERS, rankMap, scoreToTier, toTen } from '../ratingTier';

describe('toTen', () => {
  it('1~5 分制换算成 10 分制,保留一位小数', () => {
    expect(toTen(1)).toBe(2);
    expect(toTen(3)).toBe(6);
    expect(toTen(4.5)).toBe(9);
    expect(toTen(2.5)).toBe(5);
  });

  it('空值原样返回 null —— 不拿 0 顶替', () => {
    expect(toTen(null)).toBeNull();
    expect(toTen(undefined)).toBeNull();
  });
});

describe('scoreToTier', () => {
  it('10 分制总分映射到段位', () => {
    expect(scoreToTier(9)).toBe('hang');
    expect(scoreToTier(9.5)).toBe('hang');
    expect(scoreToTier(8.9)).toBe('top');
    expect(scoreToTier(8)).toBe('top');
    expect(scoreToTier(6.5)).toBe('above');
    expect(scoreToTier(5)).toBe('npc');
    expect(scoreToTier(4.9)).toBe('trash');
  });

  it('空值当 NPC —— 跟小程序一致', () => {
    expect(scoreToTier(null)).toBe('npc');
    expect(scoreToTier(undefined)).toBe('npc');
  });
});

describe('rankMap', () => {
  it('单维星级映射到段位文案', () => {
    expect(rankMap(5)).toBe('夯');
    expect(rankMap(4)).toBe('顶级');
    expect(rankMap(3)).toBe('人上人');
    expect(rankMap(2)).toBe('NPC');
    expect(rankMap(1)).toBe('拉完了');
  });

  it('认不出来的星级返回空串', () => {
    expect(rankMap(0)).toBe('');
    expect(rankMap(2.5)).toBe('');
  });
});

describe('两套口径不能合并', () => {
  it('scoreToTier 吃 10 分制,rankMap 吃 1~5 星 —— 同一个数结论不一样', () => {
    // 5.0 分的总分是「NPC」,但 5 不是合法的星级
    expect(scoreToTier(5)).toBe('npc');
    expect(rankMap(5)).toBe('夯');
    // 2.5 星在 rankMap 里没有对应项
    expect(rankMap(2.5)).toBe('');
    expect(scoreToTier(2.5)).toBe('trash');
  });
});

describe('维度标签', () => {
  it('四个维度的标签跟小程序一字不差', () => {
    expect(RATING_DIMENSIONS.map((d) => d.label)).toEqual([
      '手感巅峰',
      '原画天花板',
      '局部模型',
      '嘲讽拉满'
    ]);
    expect(RATING_DIMENSIONS.map((d) => d.key)).toEqual([
      'handFeel',
      'artwork',
      'model',
      'mockery'
    ]);
  });
});

describe('段位元数据', () => {
  it('五个段位都有文案', () => {
    expect(Object.keys(RATING_TIERS)).toEqual(['hang', 'top', 'above', 'npc', 'trash']);
    expect(RATING_TIERS.hang.label).toBe('夯');
    expect(RATING_TIERS.npc.label).toBe('NPC');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
cd D:\Code\Front_Project\all\local_skin_importer
npm test -- src/shared/__tests__/ratingTier.test.ts
```

Expected: FAIL —— `Failed to resolve import "../ratingTier"`。

- [ ] **Step 3: 写实现**

`src/shared/ratingTier.ts`：

```ts
/**
 * 皮肤评分的「分制 / 段位」口径。
 *
 * ⚠️ **口径是从微信小程序搬过来的,不是重新发明的。** 来源:
 *   - `wechat_rating_program/utils/rating-tier.js`      —— RATING_TIERS / toTen
 *   - `wechat_rating_program/pages/skin-detail/index.js`  —— scoreToTier
 *   - `wechat_rating_program/components/skin-drawer/index.js` —— rankMap
 *
 * ⚠️ **`scoreToTier` 和 `rankMap` 不是同一个函数,也不能合并**:
 *   - `scoreToTier` 吃的是 **10 分制的聚合总分**
 *   - `rankMap`     吃的是 **1~5 的单维星级**
 *   两者的阈值也不一样(总分 5.0 是「NPC」,5 星却是「夯」)。
 *   有一单测专门把这个差异钉死,别去「优化」它。
 *
 * ⚠️ 这个文件跟 `src/shared/scoring.ts` 是**两套东西** —— 那份是玩家**表现分**。
 */

/** 段位 key */
export type TierKey = 'hang' | 'top' | 'above' | 'npc' | 'trash';

/** 段位元数据 —— 抄小程序 `utils/rating-tier.js` 的 RATING_TIERS */
export const RATING_TIERS: Record<TierKey, { label: string; color: string }> = {
  hang: { label: '夯', color: '#C8AA6E' },
  top: { label: '顶级', color: '#9D6EE3' },
  above: { label: '人上人', color: '#4A9EE3' },
  npc: { label: 'NPC', color: '#b8b8b8' },
  trash: { label: '拉完了', color: '#b85c5c' }
};

/**
 * 1~5 分制 → 10 分制展示,保留一位小数。
 *
 * 后端存的是 1~5 分制,界面统一按 10 分制显示 —— 量纲换算只此一处。
 */
export function toTen(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(v) * 2 * 10) / 10;
}

/**
 * 10 分制总分 → 段位 key。
 *
 * 抄小程序 `pages/skin-detail/index.js` 的 scoreToTier。
 */
export function scoreToTier(score: number | null | undefined): TierKey {
  if (score === null || score === undefined) return 'npc';
  if (score >= 9.0) return 'hang';
  if (score >= 8.0) return 'top';
  if (score >= 6.5) return 'above';
  if (score >= 5.0) return 'npc';
  return 'trash';
}

/**
 * 单维星级(1~5) → 段位文案。
 *
 * 抄小程序 `components/skin-drawer/index.js` 的 rankMap。**跟 scoreToTier 不是一回事。**
 */
export function rankMap(stars: number): string {
  const map: Record<number, string> = {
    5: '夯',
    4: '顶级',
    3: '人上人',
    2: 'NPC',
    1: '拉完了'
  };
  return map[stars] ?? '';
}

/** 四个评分维度 —— 标签照抄小程序,别改成近义词。 */
export const RATING_DIMENSIONS = [
  { key: 'handFeel', label: '手感巅峰' },
  { key: 'artwork', label: '原画天花板' },
  { key: 'model', label: '局部模型' },
  { key: 'mockery', label: '嘲讽拉满' }
] as const;

export type RatingDimensionKey = (typeof RATING_DIMENSIONS)[number]['key'];
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/shared/__tests__/ratingTier.test.ts
```

Expected: PASS —— 7 个用例全过。

- [ ] **Step 5: 提交**

```powershell
git add src/shared/ratingTier.ts src/shared/__tests__/ratingTier.test.ts
git commit -m "feat(shared): 皮肤评分分制与段位口径(对齐小程序)"
```

---

## Task 4：桌面端 —— 结算的跨进程类型

**Files:**
- Create: `src/shared/settlement.ts`

- [ ] **Step 1: 建文件**

`src/shared/settlement.ts`：

```ts
/**
 * 局末结算的跨进程类型。
 *
 * ⚠️ **这个文件不许 import 任何东西** —— main / preload / renderer 三个构建目标都引用它,
 * 带依赖就会把 Node 侧模块拖进渲染进程的编译范围。
 */

/** 主进程 → 渲染进程的推送频道。 */
export const SETTLEMENT_CHANNEL = 'match:settlement';

/**
 * 「我这局用的皮肤」。
 *
 * 四条来源,可靠度依次降级(见 src/main/match/usedSkin.ts):
 *   1. 选人会话 —— 数字 skinId,最准(但选人会话只在选人阶段存在)
 *   2. gameflow 的队伍条目 —— 也是数字 skinId,而且一直活到局末
 *   3. match history 的 participant —— 局后可用
 *   4. Live Client 的 allPlayers[].skin —— 只有英文资源名,拿不到数字 id
 */
export interface UsedSkin {
  /** 游戏内皮肤 id(= LCU itemId);0 = 没认出来 */
  riotSkinId: number;
  /** 只认到名字时的兜底(英文资源名);null = 没有 */
  displayName: string | null;
  /** 认皮肤认到哪儿了;null = 一条都没认到 */
  source: 'champ-select' | 'gameflow' | 'match-history' | 'live-client' | null;
}

/**
 * 局内最后一帧的即时战绩(2999 端口)。
 *
 * 全部字段都是 0 表示「这项没取到」—— 调用方按整块不显示处理。
 */
export interface LiveScore {
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  goldEarned: number;
  damageToChampions: number;
  level: number;
}

/**
 * match history 补齐段的本局战绩。
 *
 * 拿不到就整块是 null —— **不编**。
 */
export interface MatchScore {
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  durationS: number;
  /** 分路;空串 = 没给 */
  lane: string;
  /** 角色任务道具的名字(名字里写着位置,最准);空串 = 没给 */
  roleBoundItemName: string;
  gameMode: string;
  queueType: string;
  championId: number;
}

/**
 * 主进程检测到「这一局结束了」时的本地事实。
 *
 * 这一份**不碰网络** —— 皮肤名字、站内 id、现有评分都是渲染进程那边另外拉的。
 */
export interface LocalSettlement {
  /** 去重键:`${championId}-${riotSkinId}-${endedAt}`,同一局只弹一次 */
  key: string;
  championId: number;
  championName: string;
  usedSkin: UsedSkin;
  /** 2999 的即时战绩;null = 没取到 */
  live: LiveScore | null;
  /** match history 补齐段的战绩;null = 还没补上 / 补不上 */
  match: MatchScore | null;
  /** 局末那一刻的时间戳(epoch ms) */
  endedAt: number;
}

/** 站内目录里的这条皮肤。 */
export interface SettlementSkin {
  /** 站内 id(t_skin.id)—— 打分接口要的就是它 */
  id: number;
  /** 游戏内皮肤 id(t_skin.skin_id) */
  skinId: number | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  iconUrl: string | null;
  splashUrl: string | null;
}

/** 某款皮肤的聚合评分(后端 /api/ratings/skin-stats 的一条)。 */
export interface SkinRatingStats {
  skinId: number;
  skinName: string | null;
  iconUrl: string | null;
  splashUrl: string | null;
  rarity: string | null;
  /** 有多少人打过;0 = 还没人打 */
  totalCount: number;
  avgScore: number | null;
  avgHandFeel: number | null;
  avgArtwork: number | null;
  avgModel: number | null;
  avgMockery: number | null;
}

/** 我打过的这一条评分(四维都是 1~5 的整数星)。 */
export interface MyRating {
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
}

/**
 * 渲染进程要的那份:本地事实 + 站内皮肤 + 现有评分 + 我打过的分。
 *
 * 缺的字段就是 null —— 界面上那块整块不显示,不写占位数字。
 */
export interface SettlementView extends LocalSettlement {
  /** 站内目录里的这条皮肤;null = 不在目录里 / 没认到皮肤 */
  skin: SettlementSkin | null;
  /** 现有聚合评分;null = 后端没给 / 还没拉到 */
  stats: SkinRatingStats | null;
  /** 我打过的分;null = 没打过 */
  myRating: MyRating | null;
  /** 桌面端有没有登录(没登录不能打分) */
  loggedIn: boolean;
}
```

- [ ] **Step 2: 确认能编译**

```powershell
npm run typecheck
```

Expected: 无新报错。

- [ ] **Step 3: 提交**

```powershell
git add src/shared/settlement.ts
git commit -m "feat(shared): 局末结算的跨进程类型"
```

---

## Task 5：桌面端 —— 从 token 里解出 userId

**Files:**
- Modify: `src/main/auth.ts`
- Test: `src/main/__tests__/auth.test.ts`

- [ ] **Step 1: 先写失败的测试**

在 `src/main/__tests__/auth.test.ts` 的 `describe('auth', ...)` 块里追加：

```ts
  it('readTokenUserId 解出 payload 里的 userId', () => {
    const payload = Buffer.from(JSON.stringify({ userId: 42, tokenType: 'DESKTOP' })).toString(
      'base64url'
    );
    expect(readTokenUserId(`h.${payload}.s`)).toBe(42);
  });

  it('readTokenUserId 把字符串形态的 userId 也认出来', () => {
    const payload = Buffer.from(JSON.stringify({ userId: '42' })).toString('base64url');
    expect(readTokenUserId(`h.${payload}.s`)).toBe(42);
  });

  it('readTokenUserId 在 token 坏了 / 没有 userId 时返回 null', () => {
    expect(readTokenUserId('not-a-jwt')).toBeNull();
    const payload = Buffer.from(JSON.stringify({ openid: 'x' })).toString('base64url');
    expect(readTokenUserId(`h.${payload}.s`)).toBeNull();
  });

  it('getStoredUserId 从本地存的 token 里取 userId', () => {
    const payload = Buffer.from(JSON.stringify({ userId: 7 })).toString('base64url');
    writeFileSync(tokenPath, Buffer.from(`enc:h.${payload}.s`));
    expect(getStoredUserId()).toBe(7);
  });

  it('getStoredUserId 在没登录时返回 null', () => {
    expect(getStoredUserId()).toBeNull();
  });
```

同时把 import 行改成：

```ts
import {
  redeemSyncCode,
  saveToken,
  getStoredToken,
  clearStoredToken,
  getAuthStatus,
  readTokenUserId,
  getStoredUserId
} from '../auth';
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/__tests__/auth.test.ts
```

Expected: FAIL —— `readTokenUserId` 未导出。

- [ ] **Step 3: 实现**

`src/main/auth.ts` —— 找到 `readTokenExpiry` 那个函数，在它**后面**加：

```ts
/**
 * 读 JWT 里的 userId。
 *
 * 后端 JwtService 签的 claim 里有 userId / openid / tokenType。
 * 桌面端只存了 token 本身,没存 userId —— 从 payload 里解出来就够,
 * 不用改存储格式,老 token 也立刻能用。
 */
export function readTokenUserId(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
      userId?: unknown;
    };
    if (typeof payload.userId === 'number' && Number.isFinite(payload.userId)) {
      return payload.userId;
    }
    // 有的实现把 id 给成字符串
    if (typeof payload.userId === 'string' && payload.userId.trim() !== '') {
      const parsed = Number(payload.userId);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** 本地存的 token 里的 userId;没登录 / token 坏了 = null。 */
export function getStoredUserId(): number | null {
  const token = getStoredToken();
  if (!token) return null;
  return readTokenUserId(token);
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/__tests__/auth.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/auth.ts src/main/__tests__/auth.test.ts
git commit -m "feat(auth): 从 token 里解出 userId"
```

---

## Task 6：桌面端 —— 认「我这局用的皮肤」（纯解析，不发请求）

**Files:**
- Create: `src/main/match/usedSkin.ts`
- Create: `src/main/match/__tests__/usedSkin.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/match/__tests__/usedSkin.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  parseChampSelectSkinId,
  parseLiveClientSkinName,
  parseMatchHistorySkinId,
  resolveUsedSkin
} from '../usedSkin';

describe('parseChampSelectSkinId', () => {
  const session = {
    localPlayerCellId: 3,
    myTeam: [
      { cellId: 0, championId: 1 },
      { cellId: 3, championId: 64, skinId: 161013 }
    ]
  };

  it('按 localPlayerCellId 找到本地玩家那条的 skinId', () => {
    expect(parseChampSelectSkinId(session)).toBe(161013);
  });

  it('skinId 是字符串形态也认得出来', () => {
    const s = { localPlayerCellId: 0, myTeam: [{ cellId: 0, skinId: '161013' }] };
    expect(parseChampSelectSkinId(s)).toBe(161013);
  });

  it('没给 skinId / 给的是 0 → null', () => {
    const s = { localPlayerCellId: 0, myTeam: [{ cellId: 0 }] };
    expect(parseChampSelectSkinId(s)).toBeNull();
    const zero = { localPlayerCellId: 0, myTeam: [{ cellId: 0, skinId: 0 }] };
    expect(parseChampSelectSkinId(zero)).toBeNull();
  });

  it('认不出本地玩家是谁 → null', () => {
    const s = { localPlayerCellId: 9, myTeam: [{ cellId: 0, skinId: 161013 }] };
    expect(parseChampSelectSkinId(s)).toBeNull();
  });

  it('载荷不是对象 → null', () => {
    expect(parseChampSelectSkinId(null)).toBeNull();
    expect(parseChampSelectSkinId('x')).toBeNull();
  });
});

describe('parseMatchHistorySkinId', () => {
  it('认得出来的字段名都试一遍', () => {
    expect(parseMatchHistorySkinId({ skinId: 161013 })).toBe(161013);
    expect(parseMatchHistorySkinId({ skin_id: 161013 })).toBe(161013);
  });

  it('皮肤给的是名字而不是 id → null(不拿英雄 id 顶替)', () => {
    expect(parseMatchHistorySkinId({ skin: 'game_character_displayname_Ahri' })).toBeNull();
    expect(parseMatchHistorySkinId({})).toBeNull();
    expect(parseMatchHistorySkinId(null)).toBeNull();
  });
});

describe('parseLiveClientSkinName', () => {
  it('认 activePlayer 那条的皮肤资源名', () => {
    const data = {
      activePlayer: { summonerName: '我' },
      allPlayers: [
        { summonerName: '别人', skin: 'game_character_displayname_Jinx' },
        { summonerName: '我', skin: 'game_character_displayname_Ahri_Snow_Dawn' }
      ]
    };
    expect(parseLiveClientSkinName(data)).toBe('game_character_displayname_Ahri_Snow_Dawn');
  });

  it('没有 allPlayers → null', () => {
    expect(parseLiveClientSkinName({ activePlayer: {} })).toBeNull();
    expect(parseLiveClientSkinName(null)).toBeNull();
  });
});

describe('resolveUsedSkin', () => {
  it('选人会话优先', () => {
    expect(
      resolveUsedSkin({
        champSelectSkinId: 111,
        gameflowSkinId: 333,
        matchHistorySkinId: 222,
        liveClientSkinName: 'name'
      })
    ).toEqual({ riotSkinId: 111, displayName: null, source: 'champ-select' });
  });

  it('选人会话没有就退到 gameflow', () => {
    expect(
      resolveUsedSkin({ gameflowSkinId: 333, matchHistorySkinId: 222, liveClientSkinName: 'name' })
    ).toEqual({ riotSkinId: 333, displayName: null, source: 'gameflow' });
  });

  it('选人会话和 gameflow 都没有就退到 match history', () => {
    expect(resolveUsedSkin({ matchHistorySkinId: 222, liveClientSkinName: 'name' })).toEqual({
      riotSkinId: 222,
      displayName: null,
      source: 'match-history'
    });
  });

  it('只剩 Live Client 的名字 → 只给名字,不编 id', () => {
    expect(resolveUsedSkin({ liveClientSkinName: 'name' })).toEqual({
      riotSkinId: 0,
      displayName: 'name',
      source: 'live-client'
    });
  });

  it('一条都没拿到 → 空(不猜,不按默认皮肤编一个 id)', () => {
    expect(resolveUsedSkin({})).toEqual({
      riotSkinId: 0,
      displayName: null,
      source: null
    });
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/match/__tests__/usedSkin.test.ts
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写实现**

`src/main/match/usedSkin.ts`：

```ts
/**
 * 「我这局用的皮肤」的认法 —— **纯解析,不发任何请求**。
 *
 * 四条来源,可靠度依次降级:
 *
 *   1. 选人会话(`/lol-champ-select/v1/session`)本地玩家那条的 `skinId`
 *      —— 数字 id,最准。但选人会话只在选人阶段存在,局末已经 404,
 *      所以**必须在选人阶段就记下来**。
 *   2. gameflow(`/lol-gameflow/v1/session`)队伍条目里的 `skinId`
 *      —— 也是数字 id,而且**一直活到局末**。本地玩家那条靠 `teamOwner` 认。
 *   3. match history 的 participant —— 局后可用(取决于客户端给不给这个字段,
 *      见探测 2)。它同时能给出胜负。
 *   4. Live Client `/liveclientdata/allgamedata` 的 `allPlayers[].skin`
 *      —— 只给英文资源名(如 `game_character_displayname_Ahri_Snow_Dawn`),
 *      拿不到数字 id,对不上站内的中文名。所以它只能当「认出了名字」用。
 *
 * 一个都没认出来 = `riotSkinId: 0` —— **不猜**,不按「英雄默认皮肤」编一个 id 上去。
 */

import type { UsedSkin } from '../../shared/settlement';

export type { UsedSkin };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * 选人会话里本地玩家那条的皮肤 id。
 *
 * 「本地玩家是谁」有三种认法(localPlayerCellId / puuid / summonerId),
 * 跟 `champSelect.ts` 的认法一致。认不出来就 null。
 */
export function parseChampSelectSkinId(
  raw: unknown,
  opts: { myCellId?: number; myPuuid?: string; mySummonerId?: number } = {}
): number | null {
  if (!isRecord(raw)) return null;
  const myTeam = Array.isArray(raw.myTeam) ? raw.myTeam.filter(isRecord) : [];
  if (myTeam.length === 0) return null;

  const cellId = opts.myCellId ?? num(raw.localPlayerCellId);
  const puuid = opts.myPuuid ?? '';
  const summonerId = opts.mySummonerId ?? 0;

  const mine =
    (puuid ? myTeam.find((m) => str(m.puuid) === puuid) : undefined) ??
    (summonerId > 0 ? myTeam.find((m) => num(m.summonerId) === summonerId) : undefined) ??
    (cellId >= 0 ? myTeam.find((m) => num(m.cellId) === cellId) : undefined) ??
    null;
  if (!mine) return null;

  const skinId = num(mine.skinId);
  return skinId > 0 ? skinId : null;
}

/**
 * match history 里「我」那条 participant 的皮肤 id。
 *
 * ⚠️ 客户端给不给这个字段**还没实测**(探测 2)—— 所以这里把可能的字段名都试一遍。
 * 认不出来就 null,**绝不用英雄 id 顶替**。
 */
export function parseMatchHistorySkinId(participant: unknown): number | null {
  if (!isRecord(participant)) return null;
  for (const key of ['skinId', 'skin_id']) {
    const value = num(participant[key]);
    if (value > 0) return value;
  }
  return null;
}

/**
 * Live Client 的 allgamedata 里本地玩家那条的皮肤资源名。
 *
 * 形如 `game_character_displayname_Ahri_Snow_Dawn` —— 是**资源名**,不是皮肤 id,
 * 也对不上站内的中文名。所以它只能当「认出了皮肤名」用,不能拿去查站内目录。
 */
export function parseLiveClientSkinName(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const allPlayers = Array.isArray(raw.allPlayers) ? raw.allPlayers.filter(isRecord) : [];
  if (allPlayers.length === 0) return null;

  const active = isRecord(raw.activePlayer) ? raw.activePlayer : {};
  const myName = str(active.summonerName);
  const mine =
    (myName ? allPlayers.find((p) => str(p.summonerName) === myName) : undefined) ??
    allPlayers[0] ??
    null;
  const skin = mine ? str(mine.skin) : '';
  return skin !== '' ? skin : null;
}

/**
 * 四条来源合成一个结论。
 *
 * 优先级:选人会话 > gameflow > match history > Live Client。
 * 认到数字 id 就用数字;只认到名字就只给名字(界面据此说明「没认到具体皮肤」)。
 */
export function resolveUsedSkin(candidates: {
  champSelectSkinId?: number | null;
  gameflowSkinId?: number | null;
  matchHistorySkinId?: number | null;
  liveClientSkinName?: string | null;
}): UsedSkin {
  if (candidates.champSelectSkinId && candidates.champSelectSkinId > 0) {
    return {
      riotSkinId: candidates.champSelectSkinId,
      displayName: null,
      source: 'champ-select'
    };
  }
  if (candidates.gameflowSkinId && candidates.gameflowSkinId > 0) {
    return {
      riotSkinId: candidates.gameflowSkinId,
      displayName: null,
      source: 'gameflow'
    };
  }
  if (candidates.matchHistorySkinId && candidates.matchHistorySkinId > 0) {
    return {
      riotSkinId: candidates.matchHistorySkinId,
      displayName: null,
      source: 'match-history'
    };
  }
  if (candidates.liveClientSkinName) {
    return { riotSkinId: 0, displayName: candidates.liveClientSkinName, source: 'live-client' };
  }
  return { riotSkinId: 0, displayName: null, source: null };
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/match/__tests__/usedSkin.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/match/usedSkin.ts src/main/match/__tests__/usedSkin.test.ts
git commit -m "feat(match): 认我这局用的皮肤(纯解析)"
```

---

## Task 7：桌面端 —— 按 skinId 定位站内皮肤（匿名）

**Files:**
- Modify: `src/main/catalog.ts`
- Test: `src/main/__tests__/catalog.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/__tests__/catalog.test.ts` **末尾追加一个 describe**（自带 `beforeEach` 重置
`axios.get` —— 不重置的话 `mock.calls[0]` 拿到的是上一个用例的调用）：

```ts
describe('catalog.fetchCatalogSkinBySkinId', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('fetchCatalogSkinBySkinId 命中时返回站内那条', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          current: 1,
          size: 1,
          total: 1,
          pages: 1,
          records: [
            {
              id: 42,
              skinId: 161013,
              heroId: 7,
              heroName: '暗裔剑魔',
              name: '黑暗之女',
              nameEn: 'Dark Crystal',
              rarity: '传说',
              priceRp: 1350,
              splashUrl: 'https://x/splash.jpg',
              iconUrl: 'https://x/icon.jpg'
            }
          ]
        }
      }
    });

    const skin = await fetchCatalogSkinBySkinId(161013);

    expect(skin?.id).toBe(42);
    expect(skin?.name).toBe('黑暗之女');
    expect(vi.mocked(axios.get).mock.calls[0][0]).toContain('skinId=161013');
  });

  it('fetchCatalogSkinBySkinId 不带 Authorization —— 带了 DESKTOP token 会被拦成 403', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: { current: 1, size: 1, total: 0, pages: 0, records: [] } }
    });

    await fetchCatalogSkinBySkinId(161013);

    const options = vi.mocked(axios.get).mock.calls[0][1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(options?.headers?.Authorization).toBeUndefined();
  });

  it('fetchCatalogSkinBySkinId 查不到时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: { current: 1, size: 1, total: 0, pages: 0, records: [] } }
    });

    await expect(fetchCatalogSkinBySkinId(161013)).resolves.toBeNull();
  });
});
```

（import 行加上 `fetchCatalogSkinBySkinId`；文件里已有的 `vi.mock('../auth')` 保持不动。）

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/__tests__/catalog.test.ts
```

Expected: FAIL —— `fetchCatalogSkinBySkinId` 未导出。

- [ ] **Step 3: 实现**

`src/main/catalog.ts` —— 在 `fetchCatalogSkinIds()` 后面加：

```ts
/**
 * 按**游戏内皮肤 id**(Riot itemId)查站内目录里的一条。
 *
 * ⚠️ **这个请求必须匿名 —— 不附 Authorization 头。**
 * 桌面端没有全局 axios 拦截器,是每个调用点自己决定带不带头。
 * `SkinController.listSkins` 没有 `@AllowsDesktopToken`,
 * 带了桌面端 token 反而会被 DesktopScopeInterceptor 拦成 403。
 * (目录是公开数据,匿名查就行。)
 *
 * ⚠️ **不要去复用渲染进程那份 1.2 万条目录缓存** ——
 * `useSkinCatalog.ts` 里的 catalogCache 只有调过 load() 的页面才有,
 * 局末那一刻多半还没拉过。窄查询才是对的。
 */
export async function fetchCatalogSkinBySkinId(riotSkinId: number): Promise<CatalogSkin | null> {
  if (!Number.isFinite(riotSkinId) || riotSkinId <= 0) return null;
  const url = `${BACKEND_BASE_URL}/api/skins/list?current=1&size=1&skinId=${riotSkinId}`;
  const { data } = await axios.get<BackendEnvelope<CatalogPage>>(url, {
    timeout: CATALOG_TIMEOUT_MS
  });
  if (data.code !== 200 || !data.data) return null;
  const record = data.data.records[0];
  return record ? toCatalogSkin(record) : null;
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/__tests__/catalog.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/catalog.ts src/main/__tests__/catalog.test.ts
git commit -m "feat(catalog): 按游戏内 skinId 定位站内皮肤"
```

---

## Task 8：桌面端 —— 后端三个评分接口

**Files:**
- Create: `src/main/rating.ts`
- Create: `src/main/__tests__/rating.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/__tests__/rating.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchMyRating, fetchSkinRatingStats, submitSkinRating } from '../rating';
import { getStoredToken } from '../auth';

vi.mock('axios');
vi.mock('../auth', () => ({
  getStoredToken: vi.fn(() => 'desktop-token'),
  clearStoredToken: vi.fn()
}));

const tokenMock = vi.mocked(getStoredToken);

function page(records: Record<string, unknown>[]): { data: unknown } {
  return { data: { code: 200, data: { current: 1, size: 10, total: records.length, pages: 1, records } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.mockReturnValue('desktop-token');
});

describe('fetchSkinRatingStats', () => {
  it('把后端的一条聚合评分映射出来', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([
        {
          skinId: 42,
          skinName: '黑暗之女',
          skinIconUrl: 'https://x/i.jpg',
          skinSplashUrl: 'https://x/s.jpg',
          rarity: '传说',
          totalCount: 12,
          avgScore: 8.4,
          avgHandFeel: 8,
          avgArtwork: 9,
          avgModel: 8.5,
          avgMockery: 7
        }
      ])
    );

    const stats = await fetchSkinRatingStats(42);

    expect(stats?.skinId).toBe(42);
    expect(stats?.totalCount).toBe(12);
    expect(stats?.avgScore).toBe(8.4);
    expect(stats?.iconUrl).toBe('https://x/i.jpg');
  });

  it('带 Authorization —— 桌面端 token 不带会被拦成 403', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));

    await fetchSkinRatingStats(42);

    const options = vi.mocked(axios.get).mock.calls[0][1] as
      | { headers?: Record<string, string>; params?: Record<string, unknown> }
      | undefined;
    expect(options?.headers?.Authorization).toBe('Bearer desktop-token');
    expect(options?.params?.skinIds).toBe('42');
  });

  it('后端没给数据时返回 null', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));
    await expect(fetchSkinRatingStats(42)).resolves.toBeNull();
  });
});

describe('fetchMyRating', () => {
  it('查到我打过的分', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      page([{ handFeel: 5, artwork: 4, model: 3, mockery: 2 }])
    );

    const mine = await fetchMyRating(42, 7);

    expect(mine).toEqual({ handFeel: 5, artwork: 4, model: 3, mockery: 2 });
  });

  it('没打过 → null', async () => {
    vi.mocked(axios.get).mockResolvedValue(page([]));
    await expect(fetchMyRating(42, 7)).resolves.toBeNull();
  });
});

describe('submitSkinRating', () => {
  it('POST 四个维度,再拉一次聚合评分', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 200, data: {} } });
    vi.mocked(axios.get).mockResolvedValue(page([{ skinId: 42, totalCount: 13, avgScore: 8.5 }]));

    const stats = await submitSkinRating({
      skinId: 42,
      handFeel: 5,
      artwork: 4,
      model: 3,
      mockery: 2
    });

    const body = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({ skinId: 42, handFeel: 5, artwork: 4, model: 3, mockery: 2 });
    expect(stats?.totalCount).toBe(13);
  });

  it('没登录时报错', async () => {
    tokenMock.mockReturnValue(null);
    await expect(
      submitSkinRating({ skinId: 42, handFeel: 5, artwork: 4, model: 3, mockery: 2 })
    ).rejects.toThrow('未登录');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/__tests__/rating.test.ts
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写实现**

`src/main/rating.ts`：

```ts
import axios from 'axios';
import { clearStoredToken, getStoredToken } from './auth';
import type { MyRating, SkinRatingStats } from '../shared/settlement';

/**
 * 后端的三个评分接口。
 *
 * ⚠️ **这三个请求都带桌面端 token。**
 * 后端 `RatingController` 的 create / list / skin-stats 三个方法都标了
 * `@AllowsDesktopToken` —— 没标的话 DesktopScopeInterceptor 会把 DESKTOP token
 * 的请求全拦成 403(它看的是 tokenType,不是方法要不要鉴权)。
 *
 * ⚠️ 跟 `catalog.ts` 的目录查询相反 —— **那边必须匿名,这边必须带头**。
 */

const BACKEND_BASE_URL = 'http://101.34.210.254';
const RATING_TIMEOUT_MS = 15_000;

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

interface PagePayload {
  records?: Record<string, unknown>[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 桌面端 token;没登录就抛 —— 打分这件事必须有身份。 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再打分');
  return { Authorization: `Bearer ${token}` };
}

function toStats(raw: Record<string, unknown>): SkinRatingStats {
  return {
    skinId: num(raw.skinId) ?? 0,
    skinName: str(raw.skinName),
    iconUrl: str(raw.skinIconUrl),
    splashUrl: str(raw.skinSplashUrl),
    rarity: str(raw.rarity),
    totalCount: num(raw.totalCount) ?? 0,
    avgScore: num(raw.avgScore),
    avgHandFeel: num(raw.avgHandFeel),
    avgArtwork: num(raw.avgArtwork),
    avgModel: num(raw.avgModel),
    avgMockery: num(raw.avgMockery)
  };
}

/**
 * 拉某款皮肤的聚合评分。
 *
 * 后端没这条皮肤 → null(不是 0 分,是「没人打过」)。
 */
export async function fetchSkinRatingStats(skinId: number): Promise<SkinRatingStats | null> {
  const { data } = await axios.get<BackendEnvelope<PagePayload>>(
    `${BACKEND_BASE_URL}/api/ratings/skin-stats`,
    {
      timeout: RATING_TIMEOUT_MS,
      params: { skinIds: String(skinId), page: 1, size: 1 },
      headers: await authHeaders()
    }
  );
  if (data.code !== 200 || !data.data) return null;
  const record = data.data.records?.[0];
  return record ? toStats(record) : null;
}

/**
 * 查「我打过的这一条」。
 *
 * 后端按 token 里的 userId 判定「是不是查自己」—— 所以必须带 token,
 * 而且查的 userId 要跟 token 里的一致。
 */
export async function fetchMyRating(skinId: number, userId: number): Promise<MyRating | null> {
  const { data } = await axios.get<BackendEnvelope<PagePayload>>(
    `${BACKEND_BASE_URL}/api/ratings`,
    {
      timeout: RATING_TIMEOUT_MS,
      params: { userId, skinId, page: 1, size: 1 },
      headers: await authHeaders()
    }
  );
  if (data.code !== 200 || !data.data) return null;
  const record = data.data.records?.[0];
  if (!record) return null;
  return {
    handFeel: num(record.handFeel) ?? 0,
    artwork: num(record.artwork) ?? 0,
    model: num(record.model) ?? 0,
    mockery: num(record.mockery) ?? 0
  };
}

export interface SubmitRatingPayload {
  skinId: number;
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
}

/**
 * 提交评分。
 *
 * 后端按 (userId, skinId) upsert —— 重复提交是覆盖。
 * userId 由后端从 token 里取,**不信请求体**。
 * 提交完再拉一次聚合评分,界面上的角标才是最新的。
 */
export async function submitSkinRating(
  payload: SubmitRatingPayload
): Promise<SkinRatingStats | null> {
  const headers = await authHeaders();
  try {
    await axios.post(
      `${BACKEND_BASE_URL}/api/ratings`,
      {
        skinId: payload.skinId,
        handFeel: payload.handFeel,
        artwork: payload.artwork,
        model: payload.model,
        mockery: payload.mockery
      },
      {
        timeout: RATING_TIMEOUT_MS,
        headers: { ...headers, 'Content-Type': 'application/json' }
      }
    );
  } catch (e) {
    // token 过期时清掉本地 token —— 留着过期 token 只会让「已登录」的假象一直挂着
    if (axios.isAxiosError(e) && e.response?.status === 401) {
      clearStoredToken();
      throw new Error('登录已过期,请用同步码重新登录');
    }
    if (axios.isAxiosError(e) && e.response?.status === 403) {
      throw new Error('桌面端暂无打分权限(后端还没放行桌面端 token)');
    }
    throw e;
  }
  return await fetchSkinRatingStats(payload.skinId);
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/__tests__/rating.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/rating.ts src/main/__tests__/rating.test.ts
git commit -m "feat(rating): 后端三个评分接口"
```

---

## Task 9：桌面端 —— 2999 即时战绩 + 皮肤资源名

**Files:**
- Modify: `src/shared/match.ts`（`LiveGameInfo` 加两个可选字段）
- Modify: `src/main/match/liveClient.ts`
- Create: `src/main/match/__tests__/liveClient.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/match/__tests__/liveClient.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { getAllGameData, getPlayerStats } from '../liveClient';

vi.mock('axios');

function ok(data: unknown): { data: unknown; status: number } {
  return { data, status: 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAllGameData', () => {
  it('认得出英雄名和我用的皮肤资源名', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: { summonerName: '我', currentGold: 500, championName: '阿狸' },
        gameData: { gameTime: 300, gameMode: 'CLASSIC' },
        allPlayers: [{ summonerName: '我', skin: 'game_character_displayname_Ahri_Snow_Dawn' }]
      })
    );

    const live = await getAllGameData();

    expect(live?.championName).toBe('阿狸');
    expect(live?.skinName).toBe('game_character_displayname_Ahri_Snow_Dawn');
  });

  it('端口不通时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getAllGameData()).resolves.toBeNull();
  });
});

describe('getPlayerStats', () => {
  it('从 activePlayer 里读出 KDA / 补刀 / 经济', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: {
          championsKilled: 8,
          deaths: 2,
          assists: 5,
          minionsKilled: 186,
          goldEarned: 12400,
          damageDealtToChampions: 23400,
          level: 16
        }
      })
    );

    const score = await getPlayerStats();

    expect(score?.kills).toBe(8);
    expect(score?.deaths).toBe(2);
    expect(score?.assists).toBe(5);
    expect(score?.minionKills).toBe(186);
    expect(score?.goldEarned).toBe(12400);
    expect(score?.level).toBe(16);
  });

  it('activePlayer 没统计时退到 allPlayers 里按召唤师名找', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        activePlayer: { summonerName: '我' },
        allPlayers: [
          { summonerName: '别人', kills: 1 },
          { summonerName: '我', kills: 3, deaths: 1, assists: 7, minionsKilled: 150 }
        ]
      })
    );

    const score = await getPlayerStats();

    expect(score?.kills).toBe(3);
    expect(score?.minionKills).toBe(150);
  });

  it('字段名不认识 / 一个数都没读到 → null', async () => {
    vi.mocked(axios.get).mockResolvedValue(ok({ activePlayer: { foo: 'bar' } }));
    await expect(getPlayerStats()).resolves.toBeNull();
  });

  it('端口不通时返回 null(不抛)', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getPlayerStats()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/match/__tests__/liveClient.test.ts
```

Expected: FAIL —— `getPlayerStats` 未导出。

- [ ] **Step 3: `LiveGameInfo` 加两个可选字段**

`src/shared/match.ts`：

```ts
export interface LiveGameInfo {
  summonerName: string;
  currentGold: number;
  gameTime: number;
  gameMode: string;
  /** 英雄名字;空串 = 客户端没给 */
  championName?: string;
  /**
   * 我这局用的皮肤的**资源名**(如 game_character_displayname_Ahri_Snow_Dawn);
   * 空串 = 客户端没给。
   *
   * ⚠️ 这是资源名不是皮肤 id —— 对不上站内的中文名,只能当提示用。
   */
  skinName?: string;
}
```

- [ ] **Step 4: 实现 `liveClient.ts`**

改 import：

```ts
import type { LiveGameInfo } from '../../shared/match';
import type { LiveScore } from '../../shared/settlement';
```

`getAllGameData` 的返回改成：

```ts
    const activePlayer = isRecord(data.activePlayer) ? data.activePlayer : {};
    const gameData = isRecord(data.gameData) ? data.gameData : {};
    const allPlayers = Array.isArray(data.allPlayers) ? data.allPlayers.filter(isRecord) : [];
    const myName = str(activePlayer.summonerName);
    const me = myName ? allPlayers.find((p) => str(p.summonerName) === myName) : undefined;

    return {
      summonerName: str(activePlayer.summonerName),
      currentGold: num(activePlayer.currentGold),
      gameTime: num(gameData.gameTime),
      gameMode: str(gameData.gameMode),
      championName: str(activePlayer.championName) || (me ? str(me.championName) : ''),
      skinName: me ? str(me.skin) : ''
    };
```

文件末尾加：

```ts
/** 从一条记录里按候选字段名取第一个能用的数。 */
function pickNum(raw: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = num(raw[key]);
    if (value !== 0) return value;
  }
  return 0;
}

/**
 * 从一条玩家记录里读出即时战绩。
 *
 * 认不出来(一个数都没有)返回 null —— 那说明这份载荷不是我们认得的形状,
 * 别把一堆 0 当成「这一局啥也没干」。
 */
function toLiveScore(raw: Record<string, unknown>): LiveScore | null {
  const score: LiveScore = {
    kills: pickNum(raw, ['championsKilled', 'kills']),
    deaths: pickNum(raw, ['deaths']),
    assists: pickNum(raw, ['assists']),
    minionKills: pickNum(raw, ['minionsKilled', 'totalMinionsKilled', 'minionKills']),
    goldEarned: pickNum(raw, ['goldEarned', 'totalGoldEarned', 'currentGold']),
    damageToChampions: pickNum(raw, [
      'damageDealtToChampions',
      'damageToChampions',
      'totalDamageDealtToChampions'
    ]),
    level: pickNum(raw, ['level', 'championLevel'])
  };
  const allZero =
    score.kills === 0 &&
    score.deaths === 0 &&
    score.assists === 0 &&
    score.minionKills === 0 &&
    score.goldEarned === 0;
  return allZero ? null : score;
}

/**
 * 局内即时战绩(/liveclientdata/playerstats)。
 *
 * 载荷形状各版本不一样:统计可能在 `activePlayer` 里,也可能只在
 * `allPlayers[]` 里(按召唤师名找「我」那条)。两种都试。
 *
 * **不抛异常** —— 2999 连不上是常态(局末它就关了)。
 */
export async function getPlayerStats(
  timeoutMs = LIVE_CLIENT_TIMEOUT_MS
): Promise<LiveScore | null> {
  try {
    const response = await axios.get(`${LIVE_CLIENT_BASE}/liveclientdata/playerstats`, {
      httpsAgent: LIVE_CLIENT_AGENT,
      timeout: timeoutMs,
      validateStatus: () => true,
      proxy: false
    });
    if (response.status !== 200) return null;
    const data = response.data;
    if (!isRecord(data)) return null;

    const active = isRecord(data.activePlayer) ? data.activePlayer : {};
    const players = Array.isArray(data.allPlayers) ? data.allPlayers.filter(isRecord) : [];
    const myName = str(active.summonerName);
    const inAllPlayers = myName ? players.find((p) => str(p.summonerName) === myName) : undefined;

    for (const source of [active, inAllPlayers]) {
      if (!isRecord(source)) continue;
      const score = toLiveScore(source);
      if (score) return score;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 跑测试，确认全绿**

```powershell
npm test -- src/main/match/__tests__/liveClient.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/shared/match.ts src/main/match/liveClient.ts src/main/match/__tests__/liveClient.test.ts
git commit -m "feat(match): 2999 即时战绩与皮肤资源名"
```

---

## Task 10：桌面端 —— 定位「刚打完的那一局」

**Files:**
- Modify: `src/main/match/recentMatches.ts`
- Test: `src/main/match/__tests__/recentMatches.test.ts`

- [ ] **Step 1: 先写失败的测试**

在 `src/main/match/__tests__/recentMatches.test.ts` 末尾追加（先看一下这个文件已有的 helper 名字，别重复定义）：

```ts
describe('findJustFinishedMatch', () => {
  it('命中窗口内 + 英雄一致的那一局', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            {
              gameId: 2,
              gameCreation: now - 60_000,
              participants: [
                {
                  participantId: 1,
                  championId: 64,
                  stats: { kills: 8, deaths: 2, assists: 5, win: true, totalMinionsKilled: 186 },
                  timeline: { lane: 'MIDDLE' }
                }
              ],
              participantIdentities: [{ participantId: 1, player: { puuid: 'p-1' } }]
            }
          ]
        }
      })
    } as unknown as AxiosInstance;

    const found = await findJustFinishedMatch(client, emptyStaticData(), 'p-1', 64, { now });

    expect(found?.match.gameId).toBe(2);
    expect(found?.match.win).toBe(true);
  });

  it('多局都匹配时取 gameCreation 最新的那个', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            { gameId: 1, gameCreation: now - 120_000, participants: [{ championId: 64, stats: {} }] },
            { gameId: 2, gameCreation: now - 30_000, participants: [{ championId: 64, stats: {} }] }
          ]
        }
      })
    } as unknown as AxiosInstance;

    const found = await findJustFinishedMatch(client, emptyStaticData(), '', 64, { now });

    expect(found?.match.gameId).toBe(2);
  });

  it('窗口外 / 英雄对不上 / 一局都没有 → null(不拿最近的那局冒充)', async () => {
    const now = 1_700_000_000_000;
    const client = {
      get: vi.fn().mockResolvedValue({
        data: {
          games: [
            { gameId: 1, gameCreation: now - 60 * 60_000, participants: [{ championId: 64, stats: {} }] },
            { gameId: 2, gameCreation: now - 60_000, participants: [{ championId: 103, stats: {} }] }
          ]
        }
      })
    } as unknown as AxiosInstance;

    await expect(findJustFinishedMatch(client, emptyStaticData(), '', 64, { now })).resolves.toBeNull();
  });
});
```

（import 行加上 `findJustFinishedMatch`；`AxiosInstance` 从 `axios` 导入；`emptyStaticData` 从 `../staticData` 导入。）

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/match/__tests__/recentMatches.test.ts
```

Expected: FAIL —— `findJustFinishedMatch` 未导出。

- [ ] **Step 3: 实现**

`src/main/match/recentMatches.ts`：

1. import 加上：`import { parseMatchHistorySkinId } from './usedSkin';` 和 `import type { MatchScore } from '../../shared/settlement';`
2. `function findMyParticipant(` 改成 `export function findMyParticipant(`
3. 文件末尾加：

```ts
/** 「刚打完的那一局」的查找窗口:30 分钟。 */
export const JUST_FINISHED_WINDOW_MS = 30 * 60_000;

/**
 * 定位「刚打完的那一局」。
 *
 * 客户端的 match history 有**落库延迟** —— 局末那一刻往往还查不到刚打完的这局,
 * 稍后再查就有了。定位规则:**gameCreation 距今 windowMs 内 + 英雄跟本局一致**,
 * 取最新的那个。
 *
 * 认不出来就返回 null —— **不拿最近的那一局冒充**。
 */
export async function findJustFinishedMatch(
  client: AxiosInstance,
  staticData: StaticData,
  puuid: string,
  championId: number,
  opts: { now?: number; windowMs?: number } = {}
): Promise<{ match: RecentMatch; skinId: number | null } | null> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? JUST_FINISHED_WINDOW_MS;
  const { data } = await client.get(MATCHES_PATH, {
    params: { begIndex: MATCHES_BEG, endIndex: MATCHES_END },
    timeout: 10_000
  });
  const games = extractGames(data);
  let best: { match: RecentMatch; skinId: number | null } | null = null;
  for (const game of games) {
    if (!isRecord(game)) continue;
    const match = parseMatchEntry(game, staticData, puuid);
    if (!match) continue;
    if (match.timestampMs <= 0) continue;
    const age = now - match.timestampMs;
    if (age < 0 || age > windowMs) continue;
    if (championId > 0 && match.championId !== championId) continue;
    if (!best || match.timestampMs > best.match.timestampMs) {
      best = { match, skinId: parseMatchHistorySkinId(findMyParticipant(game, puuid)) };
    }
  }
  return best;
}

/** 把 RecentMatch 缩成结算卡要的那几个字段。 */
export function toMatchScore(match: RecentMatch): MatchScore {
  return {
    win: match.win,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    minionKills: match.minionKills,
    durationS: match.durationS,
    lane: match.lane,
    roleBoundItemName: match.roleBoundItemName ?? '',
    gameMode: match.gameMode,
    queueType: match.queueType,
    championId: match.championId
  };
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/match/__tests__/recentMatches.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/match/recentMatches.ts src/main/match/__tests__/recentMatches.test.ts
git commit -m "feat(match): 定位刚打完的那一局"
```

---

## Task 11：桌面端 —— 只取 gameflow 阶段

**Files:**
- Modify: `src/main/match/opponents.ts`

- [ ] **Step 1: 实现**

`src/main/match/opponents.ts` 文件末尾加：

```ts
/**
 * gameflow 的阶段。
 *
 * 只取 phase,不取队伍信息 —— 那一套要给十个人补名字,轮询器每 2 秒问一次
 * 太浪费。局末判定要的只是这个阶段串。
 *
 * 连不上就返回空串 —— 不抛。
 */
export async function getGameflowPhase(client: AxiosInstance): Promise<string> {
  try {
    const { data } = await client.get(GAMEFLOW_PATH, { timeout: GAMEFLOW_TIMEOUT_MS });
    if (!isRecord(data)) return '';
    return str(data.phase);
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: 确认能编译**

```powershell
npm run typecheck
```

Expected: 无新报错。

- [ ] **Step 3: 提交**

```powershell
git add src/main/match/opponents.ts
git commit -m "feat(match): 只取 gameflow 阶段"
```

---

## Task 12：桌面端 —— 局末检测（核心）

**Files:**
- Modify: `src/main/match/champSelect.ts`（选人会话带出 skinId）
- Modify: `src/shared/match.ts`（`ChampSelectMember.skinId` / `ChampSelectSession.mySkinId`）
- Modify: `src/main/match/poller.ts`
- Test: `src/main/match/__tests__/poller.test.ts`

- [ ] **Step 1: 先写失败的测试**

在 `src/main/match/__tests__/poller.test.ts` 里：

**(a)** mock 工厂补上新函数：

```ts
vi.mock('../liveClient', () => ({ getAllGameData: vi.fn(), getPlayerStats: vi.fn() }));
```

并加 import：

```ts
import { getAllGameData, getPlayerStats } from '../liveClient';
```

**(b)** `beforeEach` 里补：

```ts
  vi.mocked(getPlayerStats).mockResolvedValue(null);
```

**(c)** 新增一组用例（放在文件末尾）：

> ⚠️ **这组用例必须先把「我这一局是谁」喂进去**，否则 `createSettlement()` 的
> 守卫（`currentChampionId > 0 || lastLive !== null`）会把结算挡掉 ——
> 那是**故意的**：应用刚启动、客户端正停在结算画面上时，我们根本没打过这一局。
> 所以用 `champSelectMock` 喂一个选人会话（英雄 64 / 皮肤 161013）。

```ts
describe('MatchPoller 的局末检测', () => {
  const myChampSelect = {
    myTeam: [],
    theirTeam: [],
    myRole: 'MIDDLE',
    myChampionId: 64,
    mySkinId: 161013,
    myCellId: -1,
    bannedChampions: []
  };

  it('phase 进入 PreEndOfGame 时产生一次结算', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();
    settlements.length = 0;

    wsFire({
      uri: '/lol-gameflow/v1/session',
      eventType: 'Update',
      data: { phase: 'PreEndOfGame' }
    });
    await flush();

    expect(settlements).toHaveLength(1);
    expect(settlements[0].championId).toBe(64);
    expect(settlements[0].usedSkin.riotSkinId).toBe(161013);
    expect(settlements[0].usedSkin.source).toBe('champ-select');
    poller.stop();
  });

  it('同一局只触发一次 —— 后面再来两个结束阶段也不重复', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    for (const phase of ['PreEndOfGame', 'EndOfGame', 'PostGame']) {
      wsFire({
        uri: '/lol-gameflow/v1/session',
        eventType: 'Update',
        data: { phase }
      });
      await flush();
    }

    expect(settlements).toHaveLength(1);
    poller.stop();
  });

  it('打完一局、进下一局后会再触发一次', async () => {
    champSelectMock.mockResolvedValue(myChampSelect);
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PreEndOfGame' } });
    await flush();
    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'None' } });
    await flush();
    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PreEndOfGame' } });
    await flush();

    expect(settlements).toHaveLength(2);
    poller.stop();
  });

  it('应用刚启动、客户端停在结算画面上 → 不产生结算(没打过这一局)', async () => {
    // champSelectMock 默认就是 null,currentChampionId 拿不到,lastLive 也是 null
    const poller = new MatchPoller();
    const settlements: LocalSettlement[] = [];
    poller.subscribeSettlement((s) => settlements.push(s));

    poller.start();
    await flush();

    wsFire({ uri: '/lol-gameflow/v1/session', eventType: 'Update', data: { phase: 'PostGame' } });
    await flush();

    expect(settlements).toHaveLength(0);
    poller.stop();
  });
});
```

（import 加上 `import type { LocalSettlement } from '../../../shared/settlement';`）

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/match/__tests__/poller.test.ts
```

Expected: FAIL —— `subscribeSettlement` 不存在。

- [ ] **Step 3: 选人会话带出 skinId**

`src/shared/match.ts`：

```ts
export interface ChampSelectMember extends ChampionRef {
  /** LCU 给的位置:TOP / MIDDLE / BOTTOM / JUNGLE / SUPPORT,可能是空串 */
  assignedPosition: string;
  cellId: number;
  /**
   * 游戏内皮肤 id(= LCU itemId);0 = 客户端没给。
   *
   * ⚠️ 客户端给不给这个字段**还没实测** —— 探测 1 的结论决定它是不是真的有用。
   */
  skinId: number;
  // ↓ 下面原有的字段(summonerId / puuid / displayName / tagLine /
  //   summonerLevel / profileIconId / rankedDisplay)一个不动
}
```

```ts
export interface ChampSelectSession {
  myTeam: ChampSelectMember[];
  theirTeam: ChampSelectMember[];
  /** 我方这一行被分配到的位置;空串 = 还没选位置 */
  myRole: string;
  myChampionId: number;
  /**
   * 我这一局用的游戏内皮肤 id;0 = 客户端没给。
   *
   * ⚠️ 选人会话只在选人阶段存在 —— **必须在选人阶段就把它记下来**,
   * 局末再问这个端点已经 404 了。
   */
  mySkinId: number;
  /** 我在 myTeam 里的格位;渲染进程靠它把「我」标出来 */
  myCellId: number;
  bannedChampions: ChampionRef[];
}
```

`src/main/match/champSelect.ts` —— `parseChampSelectMembers` 里 `out.push({...})`
的那个对象字面量，在 `cellId: num(entry.cellId),` 后面加一行：

```ts
      // 游戏内皮肤 id;客户端没给就是 0
      skinId: num(entry.skinId),
```

`parseChampSelectSession` 的返回里加：

```ts
    myChampionId: myMember?.championId ?? 0,
    mySkinId: myMember?.skinId ?? 0,
```

> ⚠️ **这一步会打破既有测试** —— 两个字段都是**必填**,下面这 6 个地方要补
> `skinId: 0` / `mySkinId: 0`。跑 `npm test` 按报错补也行,但照着这份清单补更快:
>
> | 文件 | 位置 | 补什么 |
> |---|---|---|
> | `src/shared/__tests__/roster.test.ts` | `member()` 辅助函数(~第 5 行) | 加 `skinId: 0,` |
> | `src/shared/__tests__/roster.test.ts` | `session()` 辅助函数(~第 23 行) | 加 `mySkinId: 0,` |
> | `src/main/match/__tests__/champSelect.test.ts` | `parseChampSelectMembers` 的 `toEqual([...])` 断言(~第 26 行) | 期望对象里加 `skinId: 0,` |
> | `src/main/match/__tests__/recommender.test.ts` | `session` 字面量里的 `myTeam[0]`(~第 32 行) | 成员上加 `skinId: 0,` |
> | `src/main/match/__tests__/recommender.test.ts` | `session` 字面量(~第 51 行) | 加 `mySkinId: 0,` |
> | `src/main/match/__tests__/poller.test.ts` | `champSelectMock.mockResolvedValue({...})`(~第 148 行) | 加 `mySkinId: 0,` |
> | `src/main/__tests__/ipc.test.ts` | session 字面量(~第 785 行) | 加 `mySkinId: 0,` |

- [ ] **Step 4: 轮询器改局末检测**

`src/main/match/poller.ts`：

**(a)** import 改成：

```ts
import { getAllGameData, getPlayerStats } from './liveClient';
import { getChampSelectSession } from './champSelect';
import { getRankedEntries } from './ranked';
import { findJustFinishedMatch, getRecentMatches, toMatchScore } from './recentMatches';
import { getGameflowPhase, getOpponents } from './opponents';
```

再加：

```ts
import { lcuPhaseLabel } from '../../shared/gameLabels';
import type { ChampSelectSession } from '../../shared/match';
import type { LiveScore, LocalSettlement, UsedSkin } from '../../shared/settlement';
```

**(b)** 常量区加：

```ts
/**
 * 结算补齐段:局末之后过多久才开始查 match history(毫秒)。
 *
 * 客户端的 match history 有落库延迟 —— 局末那一刻往往还查不到刚打完的那局。
 */
const SETTLEMENT_ENRICH_DELAY_MS = 15_000;
/** 结算补齐段:两次查询之间的间隔(毫秒)。 */
const SETTLEMENT_ENRICH_RETRY_MS = 20_000;
```

**(c)** 在 `describeError` 附近加两个导出函数：

```ts
/**
 * gameflow 是不是已经进了「对局结束」段。
 *
 * 直接用共享的阶段标签表判断 —— `PreEndOfGame` / `EndOfGame` / `PostGame`
 * 三个阶段在 `gameLabels.ts` 里都映射成「对局结束」。不新造枚举。
 */
export function isGameEndPhase(phase: string): boolean {
  return lcuPhaseLabel(phase) === '对局结束';
}

/** 从 gameflow 事件载荷里取 phase。 */
export function phaseFromEvent(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const phase = (data as Record<string, unknown>).phase;
  return typeof phase === 'string' ? phase : '';
}

/**
 * 从 gameflow 事件载荷里取「我」这条的英雄编号和皮肤编号。
 *
 * gameflow 用 `teamOwner: true` 标本地玩家那条 —— 这是最准的认法。
 * 认不到就退到「第一个带 championId 的条目」—— 那是本地玩家还是队友分不清,
 * 但**英雄编号对结算卡有用**,拿错了也只是界面上写错个名字,比空着强。
 *
 * ⚠️ 顺带读 `skinId`:gameflow 的队伍条目里是有皮肤编号的,
 * 这是选人会话之外的**第二条皮肤来源**,而且它一直活到局末。
 *
 * ⚠️ `teamOne` / `teamTwo` 的具体载荷形状没实测过(见探测 1),
 * 所以这里对字段名保持宽容。
 */
export function selfPlayerFromEvent(data: unknown): { championId: number; skinId: number } {
  const empty = { championId: 0, skinId: 0 };
  if (typeof data !== 'object' || data === null) return empty;
  const gameData = (data as Record<string, unknown>).gameData;
  if (typeof gameData !== 'object' || gameData === null) return empty;
  const gd = gameData as Record<string, unknown>;

  let fallback: { championId: number; skinId: number } = empty;
  for (const key of ['teamOne', 'teamTwo']) {
    const team = gd[key];
    if (!Array.isArray(team)) continue;
    for (const entry of team) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const championId = typeof e.championId === 'number' ? e.championId : 0;
      const skinId = typeof e.skinId === 'number' ? e.skinId : 0;
      if (championId <= 0 && skinId <= 0) continue;
      if (e.teamOwner === true) return { championId, skinId };
      if (fallback.championId <= 0 && championId > 0) {
        fallback = { championId, skinId };
      }
    }
  }
  return fallback;
}
```

**(d)** 类字段区加：

```ts
  /** 最近的 gameflow 阶段(事件流或轮询兜底) */
  private phase = '';
  /** 局内最后一帧的实时数据(2999) */
  private lastLive: LiveGameInfo | null = null;
  /** 局内最后一帧的即时战绩(2999) */
  private lastPlayerStats: LiveScore | null = null;
  /** 本局我用的皮肤(选人阶段记下) */
  private usedSkin: UsedSkin = { riotSkinId: 0, displayName: null, source: null };
  /** 本局英雄编号(选人阶段 / gameflow 事件里记下) */
  private currentChampionId = 0;
  /** 局末结算 */
  private settlement: LocalSettlement | null = null;
  /** 上次尝试补 match history 的时刻 */
  private settlementEnrichedAt = 0;
  private settlementListeners = new Set<SettlementListener>();
```

并在 import 里补 `LiveGameInfo` 类型（`shared/match` 的类型 import 列表里加 `LiveGameInfo`）。

**(e)** 加订阅方法（放在 `subscribe` 后面）：

```ts
export type SettlementListener = (settlement: LocalSettlement) => void;

  /**
   * 订阅「局末结算」。
   *
   * 跟快照订阅分开 —— 结算不是快照的一部分,是局末那一刻单独产生的一条消息。
   */
  subscribeSettlement(listener: SettlementListener): () => void {
    this.settlementListeners.add(listener);
    return () => {
      this.settlementListeners.delete(listener);
    };
  }

  /** 主进程手上这一份结算;null = 还没打过一局 */
  getSettlement(): LocalSettlement | null {
    return this.settlement;
  }
```

**(f)** `handleWsEvent` 改成：

```ts
  private handleWsEvent(event: LcuWsEvent): void {
    if (isRankedEvent(event)) {
      const entries = extractRankedEntriesFromEvent(event);
      if (entries.length > 0) {
        this.wsRanked = { entries, fetchedAt: Date.now() };
      }
    }
    // gameflow:局末判定的主通路 —— 事件流比 2 秒轮询快得多,
    // 而且不用去问 LCU(对局中轮询器是直接 return 的)。
    if (event.uri.startsWith('/lol-gameflow/v1/session')) {
      const self = selfPlayerFromEvent(event.data);
      if (self.championId > 0) this.currentChampionId = self.championId;
      // gameflow 里的皮肤编号 —— 选人会话之外的第二条来源
      if (self.skinId > 0 && this.usedSkin.riotSkinId === 0) {
        this.usedSkin = { riotSkinId: self.skinId, displayName: null, source: 'gameflow' };
      }
      const phase = phaseFromEvent(event.data);
      if (phase) this.onPhaseChange(phase);
    }
    if (isAcceleratedEvent(event)) {
      this.wake();
    }
  }
```

**(g)** 加三个私有方法（放在 `emit()` 后面）：

```ts
  /**
   * gameflow 阶段变了。
   *
   * 边沿检测:从「不是结束」进入「结束」的那一次才触发 —— 同一局只触发一次。
   */
  private onPhaseChange(phase: string): void {
    if (!phase || phase === this.phase) return;
    const wasEnd = isGameEndPhase(this.phase);
    const isEnd = isGameEndPhase(phase);
    this.phase = phase;
    if (!isEnd || wasEnd) return;
    this.createSettlement();
  }

  /**
   * 局末:生成结算快照。
   *
   * 只有真的打过这一局才生成 —— 应用刚启动时客户端可能正停在结算画面上,
   * 那时候读到的 phase 也是「对局结束」,但我们根本没打过这一局。
   */
  private createSettlement(): void {
    if (!this.currentChampionId && !this.lastLive) return;

    const endedAt = Date.now();
    const live = this.lastLive;
    const usedSkin: UsedSkin = {
      riotSkinId: this.usedSkin.riotSkinId,
      displayName: this.usedSkin.displayName ?? (live?.skinName || null),
      source: this.usedSkin.source ?? (live?.skinName ? 'live-client' : null)
    };

    const settlement: LocalSettlement = {
      key: `${this.currentChampionId}-${usedSkin.riotSkinId}-${endedAt}`,
      championId: this.currentChampionId,
      championName: live?.championName ?? '',
      usedSkin,
      live: this.lastPlayerStats,
      match: null,
      endedAt
    };
    this.settlement = settlement;
    this.settlementEnrichedAt = 0;
    this.emitSettlement(settlement);
  }

  private emitSettlement(settlement: LocalSettlement): void {
    for (const listener of this.settlementListeners) {
      try {
        listener(settlement);
      } catch {
        // 订阅者自己的问题不能带崩轮询
      }
    }
  }

  /**
   * 记下本局的英雄和皮肤(选人阶段每轮都调)。
   *
   * 选人会话只在选人阶段存在 —— 局末再问已经 404,所以必须提前记。
   */
  private recordChampSelect(champSelect: ChampSelectSession | null): void {
    if (!champSelect) return;
    if (champSelect.myChampionId > 0) this.currentChampionId = champSelect.myChampionId;
    if (champSelect.mySkinId > 0) {
      this.usedSkin = {
        riotSkinId: champSelect.mySkinId,
        displayName: null,
        source: 'champ-select'
      };
    }
  }
```

**(h)** `collect()` 里改三处：

第一处（`live` 分支）：

```ts
    // 1. 在对局里?Live Client Data 是最直接的判据
    const live = await getAllGameData();
    if (live) {
      // 2999 在局末会关 —— 最后一帧得留住
      this.lastLive = live;
      // 即时战绩也缓存一份(等下结算要用)
      const stats = await getPlayerStats();
      if (stats) this.lastPlayerStats = stats;
      return {
        ...previous,
        state: 'in_game',
        live,
        champSelect: null,
        wsStatus: this.wsStatus,
        lastError: null,
        updatedAt: now
      };
    }
```

第二处（拿到 client 之后）：

```ts
    const client = lcu.createLcuClient(auth);

    // gameflow 阶段 —— **只在事件流没连上的时候**才走这一路兜底。
    // 事件流连着的时候每 2 秒再问一次 HTTP 是白花钱(LCU 那边也算请求)。
    if (this.wsStatus !== 'connected') {
      const phase = await getGameflowPhase(client);
      if (phase) this.onPhaseChange(phase);
    }
```

第三处（选人会话之后）：

```ts
    const champSelect = await getChampSelectSession(
      client,
      staticData,
      summoner.summonerId,
      summoner.puuid
    );
    this.recordChampSelect(champSelect);
    const state: MatchState = champSelect ? 'champ_select' : 'lobby';
```

第四处（大厅分支之后，补齐段）：

```ts
    let ranked = previous.ranked;
    let recent = previous.recent;
    if (state === 'lobby') {
      ranked = await this.fetchRanked(client, summoner.puuid);
      recent = await this.fetchRecent(client, staticData, summoner.puuid);
    }

    // 结算的补齐段:局末之后 match history 才落库,过一会儿再查一次。
    //
    // ⚠️ **放在大厅分支外面** —— 打完之后玩家可能直接排下一把,那时
    // state 是 'champ_select',放在分支里就永远补不上了。
    await this.enrichSettlement(client, staticData, summoner.puuid, now);
```

> ⚠️ 这一段只在**没在对局里**的时候才会跑到 —— 对局中 `collect()` 在第一步
> (`live` 非空)就 return 了。所以补齐段天然有延迟(2999 关掉之后才轮到它),
> 这跟「match history 有落库延迟」叠加起来,意味着弹窗是**先开、后补**的。

**(i)** 加 `enrichSettlement`：

```ts
  /**
   * 补齐结算里的胜负 / 时长 / 位置。
   *
   * 客户端的 match history 有落库延迟 —— 局末那一刻往往还查不到刚打完的那局。
   * 所以弹窗先开起来(靠 2999 的即时战绩),过一会儿再补。
   */
  private async enrichSettlement(
    client: AxiosInstance,
    staticData: StaticData,
    puuid: string,
    now: number
  ): Promise<void> {
    const settlement = this.settlement;
    if (!settlement || settlement.match) return;
    // 不知道英雄 —— 不猜是哪一局
    if (!this.currentChampionId) return;
    if (now - settlement.endedAt < SETTLEMENT_ENRICH_DELAY_MS) return;
    if (now - this.settlementEnrichedAt < SETTLEMENT_ENRICH_RETRY_MS) return;

    this.settlementEnrichedAt = now;
    try {
      const found = await findJustFinishedMatch(client, staticData, puuid, this.currentChampionId, {
        now
      });
      if (!found) return;
      const enriched: LocalSettlement = { ...settlement, match: toMatchScore(found.match) };
      // 选人阶段没记到皮肤的话,match history 里的 participant 可能给
      if (enriched.usedSkin.riotSkinId === 0 && found.skinId && found.skinId > 0) {
        enriched.usedSkin = {
          riotSkinId: found.skinId,
          displayName: null,
          source: 'match-history'
        };
      }
      this.settlement = enriched;
      this.emitSettlement(enriched);
    } catch {
      // 查不到就还是缺 —— 不编
    }
  }
```

- [ ] **Step 5: 跑测试，确认全绿**

```powershell
npm test -- src/main/match/__tests__/poller.test.ts
```

Expected: PASS —— 原有 12 个用例 + 新增 4 个。

> ⚠️ 如果 Step 3 改了 `ChampSelectSession` / `ChampSelectMember`,`champSelect.test.ts` 和 `poller.test.ts` 里的字面量要补 `skinId: 0` / `mySkinId: 0`。跑 `npm test` 按报错补。

- [ ] **Step 6: 提交**

```powershell
git add src/main/match/poller.ts src/main/match/champSelect.ts src/shared/match.ts src/main/match/__tests__/poller.test.ts
git commit -m "feat(match): 局末结算检测"
```

---

## Task 13：桌面端 —— 把本地事实补成渲染进程要的那份

**Files:**
- Create: `src/main/match/settlement.ts`
- Create: `src/main/__tests__/settlement.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/__tests__/settlement.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSettlementView } from '../match/settlement';
import { fetchCatalogSkinBySkinId } from '../catalog';
import { fetchMyRating, fetchSkinRatingStats } from '../rating';
import { getStoredUserId } from '../auth';
import type { LocalSettlement } from '../../shared/settlement';

vi.mock('../catalog', () => ({ fetchCatalogSkinBySkinId: vi.fn() }));
vi.mock('../rating', () => ({
  fetchSkinRatingStats: vi.fn(),
  fetchMyRating: vi.fn()
}));
vi.mock('../auth', () => ({
  getStoredUserId: vi.fn(),
  getStoredToken: vi.fn(() => 'desktop-token'),
  clearStoredToken: vi.fn()
}));

const catalogMock = vi.mocked(fetchCatalogSkinBySkinId);
const statsMock = vi.mocked(fetchSkinRatingStats);
const myRatingMock = vi.mocked(fetchMyRating);
const userIdMock = vi.mocked(getStoredUserId);

const local: LocalSettlement = {
  key: '64-161013-1',
  championId: 64,
  championName: '阿狸',
  usedSkin: { riotSkinId: 161013, displayName: null, source: 'champ-select' },
  live: null,
  match: null,
  endedAt: 1
};

beforeEach(() => {
  vi.clearAllMocks();
  userIdMock.mockReturnValue(7);
  catalogMock.mockResolvedValue({
    id: 42,
    skinId: 161013,
    heroId: 64,
    heroName: '阿狸',
    name: '黑暗之女',
    nameEn: 'Dark Crystal',
    rarity: '传说',
    priceRp: 1350,
    splashUrl: 'https://x/s.jpg',
    iconUrl: 'https://x/i.jpg'
  });
  statsMock.mockResolvedValue({
    skinId: 42,
    skinName: '黑暗之女',
    iconUrl: null,
    splashUrl: null,
    rarity: null,
    totalCount: 3,
    avgScore: 8,
    avgHandFeel: 8,
    avgArtwork: 8,
    avgModel: 8,
    avgMockery: 8
  });
  myRatingMock.mockResolvedValue({ handFeel: 5, artwork: 4, model: 3, mockery: 2 });
});

describe('buildSettlementView', () => {
  it('把皮肤、现有评分、我打过的分都补上', async () => {
    const view = await buildSettlementView(local);

    expect(view.skin?.id).toBe(42);
    expect(view.stats?.totalCount).toBe(3);
    expect(view.myRating).toEqual({ handFeel: 5, artwork: 4, model: 3, mockery: 2 });
    expect(view.loggedIn).toBe(true);
  });

  it('皮肤不在目录里 → skin 为 null,评分那一块也跳过', async () => {
    catalogMock.mockResolvedValue(null);

    const view = await buildSettlementView(local);

    expect(view.skin).toBeNull();
    expect(view.stats).toBeNull();
    expect(view.myRating).toBeNull();
  });

  it('没登录 → loggedIn false,不给「我打过的分」', async () => {
    userIdMock.mockReturnValue(null);

    const view = await buildSettlementView(local);

    expect(view.loggedIn).toBe(false);
    expect(view.myRating).toBeNull();
  });

  it('后端挂了 → 那一块是 null,整份结算还是能出来', async () => {
    statsMock.mockRejectedValue(new Error('后端挂了'));

    const view = await buildSettlementView(local);

    expect(view.stats).toBeNull();
    expect(view.skin?.id).toBe(42);
  });

  it('没认到皮肤 → 不去查目录', async () => {
    const noSkin: LocalSettlement = {
      ...local,
      usedSkin: { riotSkinId: 0, displayName: null, source: null }
    };

    const view = await buildSettlementView(noSkin);

    expect(view.skin).toBeNull();
    expect(catalogMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/__tests__/settlement.test.ts
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写实现**

`src/main/match/settlement.ts`：

```ts
import { getStoredUserId } from '../auth';
import { fetchCatalogSkinBySkinId } from '../catalog';
import { fetchMyRating, fetchSkinRatingStats } from '../rating';
import type { LocalSettlement, SettlementView } from '../../shared/settlement';

/**
 * 把「本地事实」补成「渲染进程要的那份」。
 *
 * 三步都**允许缺**:
 *   - 皮肤不在目录里 → skin = null
 *   - 后端没评分 / 挂了 → stats = null
 *   - 没登录 → myRating = null、loggedIn = false
 *
 * 缺的那块界面上整块不显示 —— **不编**。
 */

/** 跑一步,失败就退到 fallback —— 结算卡不能因为一个接口挂了就整个开不出来。 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function buildSettlementView(local: LocalSettlement): Promise<SettlementView> {
  const userId = getStoredUserId();
  const loggedIn = userId !== null;

  const catalogSkin = local.usedSkin.riotSkinId
    ? await safe(() => fetchCatalogSkinBySkinId(local.usedSkin.riotSkinId), null)
    : null;
  const skinId = catalogSkin?.id ?? null;

  const stats =
    skinId !== null ? await safe(() => fetchSkinRatingStats(skinId), null) : null;
  const myRating =
    skinId !== null && userId !== null
      ? await safe(() => fetchMyRating(skinId, userId), null)
      : null;

  return {
    ...local,
    skin: catalogSkin
      ? {
          id: catalogSkin.id,
          skinId: catalogSkin.skinId,
          name: catalogSkin.name,
          nameEn: catalogSkin.nameEn,
          rarity: catalogSkin.rarity,
          iconUrl: catalogSkin.iconUrl,
          splashUrl: catalogSkin.splashUrl
        }
      : null,
    stats,
    myRating,
    loggedIn
  };
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```powershell
npm test -- src/main/__tests__/settlement.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/main/match/settlement.ts src/main/__tests__/settlement.test.ts
git commit -m "feat(match): 组装结算视图"
```

---

## Task 14：桌面端 —— IPC 通道 + preload

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 先写失败的测试**

`src/main/__tests__/ipc.test.ts`：

**(a)** 把 `'registers all 27 ipc channels on call to registerIpcHandlers'` 改成 `'registers all 29 ipc channels on call to registerIpcHandlers'`，并把期望数组改成：

```ts
      'match:get-recommendation',
      'match:recommend',
      'match:get-settlement',
      'rating:submit',
      'llm:get-status',
```

**(b)** 新增两个用例：

```ts
  it('match:get-settlement 没有结算时返回 null', async () => {
    await expect(invoke('match:get-settlement')).resolves.toBeNull();
  });

  it('rating:submit 缺参数时抛错', async () => {
    await expect(invoke('rating:submit', { skinId: 42 })).rejects.toThrow();
  });
```

（`invoke` 是这个测试文件里已有的 helper。）

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: FAIL —— 通道数对不上（实际还是 27）。

- [ ] **Step 3: `src/main/ipc.ts` 加通道**

import 加上：

```ts
import { buildSettlementView } from './match/settlement';
import { submitSkinRating } from './rating';
import { SETTLEMENT_CHANNEL } from '../shared/settlement';
```

⚠️ **别新开一行 `import { Notification } from 'electron'`** —— `ipc.ts` 顶部已经有
`import { BrowserWindow, clipboard, ipcMain } from 'electron';`，改成：

```ts
import { BrowserWindow, Notification, clipboard, ipcMain } from 'electron';
```

在 `registerIpcHandlers()` 里，`match:recommend` 那个 handler 之后加：

```ts
  // ---- 局末结算 ------------------------------------------------------------

  /**
   * 局末结算:主进程检测到「这一局结束了」就推一条。
   *
   * 推的是**本地事实**(不含站内 id / 现有评分)—— 渲染进程收到后自己再去
   * `match:get-settlement` 拿完整的那份(那边要发三个后端请求,不能阻塞推送)。
   */
  matchPoller.subscribeSettlement((local) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(SETTLEMENT_CHANNEL, local);
    }
    notifySettlement(local);
  });

  /** 取完整的那份结算(本地事实 + 站内皮肤 + 现有评分 + 我打过的分)。 */
  ipcMain.handle('match:get-settlement', async () => {
    const local = matchPoller.getSettlement();
    if (!local) return null;
    return await buildSettlementView(local);
  });

  /** 提交评分。 */
  ipcMain.handle('rating:submit', async (_event, payload: SubmitRatingPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (!Number.isFinite(payload.skinId)) throw new Error('invalid skinId');
    for (const key of ['handFeel', 'artwork', 'model', 'mockery'] as const) {
      const value = payload[key];
      if (!Number.isFinite(value) || value < 1 || value > 5) throw new Error(`invalid ${key}`);
    }
    const stats = await submitSkinRating({
      skinId: payload.skinId,
      handFeel: payload.handFeel,
      artwork: payload.artwork,
      model: payload.model,
      mockery: payload.mockery
    });
    return { ok: true as const, stats };
  });
```

文件里加类型与通知函数：

```ts
interface SubmitRatingPayload {
  skinId: number;
  handFeel: number;
  artwork: number;
  model: number;
  mockery: number;
}

/**
 * 窗口不在眼前时发一条系统通知。
 *
 * 窗口可见且有焦点时不发 —— 应用内的弹窗已经出来了,再弹一条系统通知是打扰。
 */
function notifySettlement(local: LocalSettlement): void {
  if (!Notification.isSupported()) return;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return;
  const notification = new Notification({
    title: '本局结算',
    body: local.championName
      ? `${local.championName} 这一局结束了,皮肤评分已就绪`
      : '这一局结束了,皮肤评分已就绪'
  });
  notification.on('click', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  notification.show();
}
```

`LocalSettlement` 类型的 import 加上 `import type { LocalSettlement } from '../shared/settlement';`

> ⚠️ **`ipc.test.ts` 的 mock 必须一起补,否则整个文件会挂** —— `registerIpcHandlers()`
> 一跑就调 `matchPoller.subscribeSettlement(...)`,mock 里没这个方法就是 TypeError,
> **所有用例全挂**。照下面这份清单改:
>
> **(a) `vi.hoisted` 的 mocks 里加这几个:**
>
> ```ts
>     matchPollerSubscribeSettlement: vi.fn(),
>     matchPollerGetSettlement: vi.fn(),
>     getStoredUserId: vi.fn(),
>     submitSkinRating: vi.fn(),
>     buildSettlementView: vi.fn(),
>     fetchCatalogSkinBySkinId: vi.fn(),
> ```
>
> **(b) `vi.mock('electron', ...)` 里补 `Notification` 和 `ipcRenderer.on`:**
>
> ```ts
> vi.mock('electron', () => ({
>   ipcMain: { handle: mocks.ipcMainHandle },
>   // preload 的 onSettlement 要用 on / removeListener
>   ipcRenderer: {
>     invoke: mocks.ipcRendererInvoke,
>     on: vi.fn(),
>     removeListener: vi.fn()
>   },
>   contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
>   BrowserWindow: {
>     getFocusedWindow: mocks.getFocusedWindow,
>     getAllWindows: mocks.getAllWindows
>   },
>   clipboard: { writeText: mocks.clipboardWriteText },
>   // 系统通知 —— isSupported 返回 false,测试里不发通知
>   Notification: { isSupported: vi.fn(() => false) }
> }));
> ```
>
> **(c) `vi.mock('../auth', ...)` 里加 `getStoredUserId`:**
>
> ```ts
>   getStoredToken: mocks.getStoredToken,
>   getStoredUserId: mocks.getStoredUserId
> ```
>
> **(d) `vi.mock('../catalog', ...)` 里加 `fetchCatalogSkinBySkinId`:**
>
> ```ts
>   fetchCatalog: mocks.fetchCatalog,
>   fetchMyOwned: mocks.fetchMyOwned,
>   fetchCatalogSkinBySkinId: mocks.fetchCatalogSkinBySkinId
> ```
>
> **(e) `vi.mock('../match/poller', ...)` 里加两个方法:**
>
> ```ts
>     subscribeSettlement: mocks.matchPollerSubscribeSettlement,
>     getSettlement: mocks.matchPollerGetSettlement
> ```
>
> **(f) 新增两个模块的 mock:**
>
> ```ts
> vi.mock('../rating', () => ({
>   submitSkinRating: mocks.submitSkinRating
> }));
>
> vi.mock('../match/settlement', () => ({
>   buildSettlementView: mocks.buildSettlementView
> }));
> ```
>
> **(g) `beforeEach` 里补默认值:**
>
> ```ts
>     mocks.matchPollerSubscribeSettlement.mockReset();
>     mocks.matchPollerGetSettlement.mockReset();
>     mocks.getStoredUserId.mockReset();
>     mocks.submitSkinRating.mockReset();
>     mocks.buildSettlementView.mockReset();
>     mocks.fetchCatalogSkinBySkinId.mockReset();
>     mocks.matchPollerSubscribeSettlement.mockReturnValue(() => undefined);
>     mocks.matchPollerGetSettlement.mockReturnValue(null);
> ```
>
> ⚠️ `buildSettlementView` 被 mock 掉是有意的 —— 它会去打后端,
> IPC 这一层只关心「有没有把本地事实转交出去」。

- [ ] **Step 4: `src/preload/index.ts` 加方法**

import 加上：

```ts
import { SETTLEMENT_CHANNEL } from '../shared/settlement';
import type {
  LocalSettlement,
  MyRating,
  SettlementView,
  SkinRatingStats
} from '../shared/settlement';
```

`api` 对象里加：

```ts
  // ---- 局末结算 ------------------------------------------------------------
  /** 取完整的那份结算;null = 还没打过一局 */
  getSettlement: (): Promise<SettlementView | null> => invoke('match:get-settlement'),
  /** 提交皮肤评分 */
  submitRating: (payload: {
    skinId: number;
    handFeel: number;
    artwork: number;
    model: number;
    mockery: number;
  }): Promise<{ ok: true; stats: SkinRatingStats | null }> => invoke('rating:submit', payload),
  /** 订阅主进程推来的局末结算,返回取消订阅的函数 */
  onSettlement: (cb: (settlement: LocalSettlement) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, settlement: LocalSettlement): void => {
      cb(settlement);
    };
    ipcRenderer.on(SETTLEMENT_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(SETTLEMENT_CHANNEL, listener);
    };
  },
```

同时把类型导出块补上：

```ts
export type {
  LocalSettlement,
  LiveScore,
  MatchScore,
  MyRating,
  SettlementSkin,
  SettlementView,
  SkinRatingStats,
  UsedSkin
} from '../shared/settlement';
```

- [ ] **Step 5: 跑测试，确认全绿**

```powershell
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: PASS —— 通道数 29。

- [ ] **Step 6: 提交**

```powershell
git add src/main/ipc.ts src/preload/index.ts src/main/__tests__/ipc.test.ts
git commit -m "feat(ipc): 局末结算通道"
```

---

## Task 15：桌面端 —— 结算卡弹窗

**Files:**
- Create: `src/renderer/src/components/match/SkinRatingDialog.vue`

- [ ] **Step 1: 写组件**

`src/renderer/src/components/match/SkinRatingDialog.vue`：

```vue
<template>
  <el-dialog
    :model-value="modelValue"
    class="hx-dialog settlement-dialog"
    width="520px"
    align-center
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="dialog-head">
        <span class="hx-diamond" />
        <span class="hx-label">本局结算</span>
        <span v-if="championName" class="champ-name">{{ championName }}</span>
      </div>
    </template>

    <div v-if="view" class="settlement">
      <!-- 皮肤 -->
      <div class="skin-block">
        <div class="skin-art">
          <img v-if="skinImage && !imageBroken" :src="skinImage" :alt="skinName" @error="onImageError" />
          <span v-else class="skin-art--empty">无图</span>
        </div>
        <div class="skin-meta">
          <span class="skin-name">{{ skinName }}</span>
          <span v-if="rarity" class="skin-rarity">{{ rarity }}</span>
          <span v-if="!view.usedSkin.riotSkinId" class="skin-unknown">
            未识别到具体皮肤 —— 这一局用的哪款皮肤没读出来
          </span>
          <span v-else-if="!view.skin" class="skin-unknown">
            这款皮肤还不在皮肤鉴赏目录里
          </span>
        </div>
      </div>

      <!-- 本局战绩 -->
      <div v-if="battleLine" class="battle">
        <span class="hx-label">本局</span>
        <span class="battle-text">{{ battleLine }}</span>
      </div>

      <!-- 现有评分 -->
      <div class="section">
        <div class="section-head">
          <span class="hx-label">现有评分</span>
          <span v-if="view.stats" class="stat-count">{{ view.stats.totalCount }} 人评过</span>
        </div>
        <div v-if="view.stats" class="stat-block">
          <div class="stat-total">
            <span class="stat-score">{{ totalTen }}</span>
            <span class="stat-tier" :style="{ color: tierColor }">{{ tierLabel }}</span>
          </div>
          <div class="stat-dims">
            <span v-for="dim in avgDims" :key="dim.key" class="stat-dim">
              <span class="dim-label">{{ dim.label }}</span>
              <span class="dim-value">{{ dim.value }}</span>
            </span>
          </div>
        </div>
        <p v-else class="empty-text">还没有人评分</p>
      </div>

      <!-- 打分 -->
      <div v-if="canRate" class="section">
        <div class="section-head">
          <span class="hx-label">给它打分</span>
          <span v-if="view.myRating" class="rated-hint">你已打过,再提交会覆盖</span>
        </div>
        <div class="rate-list">
          <div v-for="dim in RATING_DIMENSIONS" :key="dim.key" class="rate-row">
            <span class="rate-label">{{ dim.label }}</span>
            <el-rate
              v-model="ratings[dim.key]"
              :max="5"
              :allow-half="false"
              :disabled="submitting"
              class="rate-stars"
            />
          </div>
        </div>
        <p v-if="submitError" class="submit-error">{{ submitError }}</p>
        <div class="actions">
          <el-button class="later-btn" text @click="emit('update:modelValue', false)">
            稍后再评
          </el-button>
          <el-button class="submit-btn" type="primary" :loading="submitting" @click="onSubmit">
            提交评分
          </el-button>
        </div>
      </div>

      <p v-else class="blocked-text">{{ blockedReason }}</p>
    </div>

    <p v-else class="empty-text">这一局的信息还没取到</p>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  RATING_DIMENSIONS,
  RATING_TIERS,
  scoreToTier,
  toTen,
  type RatingDimensionKey
} from '../../../../shared/ratingTier';
import type { SettlementView } from '../../../../shared/settlement';

const props = defineProps<{
  modelValue: boolean;
  view: SettlementView | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

/** 四维星级。1~5 整数 —— 小程序就是整数星,半星会破坏口径对齐。 */
const ratings = ref<Record<RatingDimensionKey, number>>({
  handFeel: 0,
  artwork: 0,
  model: 0,
  mockery: 0
});

const submitting = ref(false);
const submitError = ref('');
/** 图片降级链:图标 → 原画 → 占位符(抄小程序 skin-drawer) */
const imageBroken = ref(false);
const imageStage = ref<'icon' | 'splash'>('icon');

watch(
  () => props.view,
  (view) => {
    imageBroken.value = false;
    imageStage.value = 'icon';
    submitError.value = '';
    if (!view) return;
    ratings.value = {
      handFeel: view.myRating?.handFeel ?? 0,
      artwork: view.myRating?.artwork ?? 0,
      model: view.myRating?.model ?? 0,
      mockery: view.myRating?.mockery ?? 0
    };
  },
  { immediate: true }
);

const skinName = computed<string>(() => {
  const skin = props.view?.skin;
  if (skin?.name) return skin.name;
  if (skin?.nameEn) return skin.nameEn;
  return '未知皮肤';
});

const rarity = computed<string>(() => props.view?.skin?.rarity ?? '');

const championName = computed<string>(() => props.view?.championName ?? '');

/** 皮肤图:图标优先,挂了退到原画。 */
const skinImage = computed<string>(() => {
  const skin = props.view?.skin;
  if (!skin) return '';
  if (imageStage.value === 'icon') return skin.iconUrl ?? '';
  return skin.splashUrl ?? '';
});

function onImageError(): void {
  if (imageStage.value === 'icon') {
    imageStage.value = 'splash';
    return;
  }
  imageBroken.value = true;
}

const totalTen = computed<string>(() => {
  const score = props.view?.stats?.avgScore;
  const ten = toTen(score);
  return ten === null ? '—' : ten.toFixed(1);
});

/**
 * 段位 —— 吃的是 **10 分制** 的总分。
 *
 * ⚠️ 后端给的 `avgScore` 是 **1~5 分制**,得先 `toTen` 换算。
 * 小程序 `pages/skin-detail/index.js:119-120` 就是这么做的:
 * `const total = toTen(vo.avgScore); const tierKey = scoreToTier(total);`
 * 直接把 `avgScore` 丢给 `scoreToTier` 会把 4.2 分算成「拉完了」。
 */
const tier = computed<string>(() => scoreToTier(toTen(props.view?.stats?.avgScore ?? null)));
const tierLabel = computed<string>(() => RATING_TIERS[tier.value].label);
const tierColor = computed<string>(() => RATING_TIERS[tier.value].color);

const avgDims = computed<{ key: string; label: string; value: string }[]>(() => {
  const stats = props.view?.stats;
  if (!stats) return [];
  const raw: { key: RatingDimensionKey; value: number | null }[] = [
    { key: 'handFeel', value: stats.avgHandFeel },
    { key: 'artwork', value: stats.avgArtwork },
    { key: 'model', value: stats.avgModel },
    { key: 'mockery', value: stats.avgMockery }
  ];
  return raw.map((item) => {
    const label = RATING_DIMENSIONS.find((d) => d.key === item.key)?.label ?? item.key;
    const ten = toTen(item.value);
    return { key: item.key, label, value: ten === null ? '—' : ten.toFixed(1) };
  });
});

/** 本局战绩那一行。哪一项缺就整项不显示,不写 0。 */
const battleLine = computed<string>(() => {
  const view = props.view;
  if (!view) return '';
  const parts: string[] = [];

  const score = view.match ?? view.live;
  if (score) {
    parts.push(`${score.kills}/${score.deaths}/${score.assists}`);
  }
  if (view.match) {
    const lane = view.match.roleBoundItemName || view.match.lane;
    if (lane) parts.push(lane);
    parts.push(view.match.win ? '胜利' : '失败');
    if (view.match.durationS > 0) {
      const m = Math.floor(view.match.durationS / 60);
      const s = view.match.durationS % 60;
      parts.push(`${m}:${String(s).padStart(2, '0')}`);
    }
  }
  if (parts.length === 0) return '';
  return parts.join(' · ');
});

/** 能不能打分。 */
const canRate = computed<boolean>(() => {
  const view = props.view;
  if (!view) return false;
  if (!view.loggedIn) return false;
  if (!view.skin) return false;
  if (!view.usedSkin.riotSkinId) return false;
  return true;
});

const blockedReason = computed<string>(() => {
  const view = props.view;
  if (!view) return '';
  if (!view.loggedIn) return '用同步码登录后才能打分';
  if (!view.usedSkin.riotSkinId) return '没识别到具体皮肤,这一局没法打分';
  if (!view.skin) return '这款皮肤还不在皮肤鉴赏目录里';
  return '';
});

async function onSubmit(): Promise<void> {
  const view = props.view;
  if (!view?.skin) return;
  const values = Object.values(ratings.value);
  if (values.some((v) => v <= 0)) {
    submitError.value = '四个维度都要打分';
    return;
  }
  submitting.value = true;
  submitError.value = '';
  try {
    await window.api.submitRating({
      skinId: view.skin.id,
      handFeel: ratings.value.handFeel,
      artwork: ratings.value.artwork,
      model: ratings.value.model,
      mockery: ratings.value.mockery
    });
    emit('update:modelValue', false);
  } catch (e: unknown) {
    submitError.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.dialog-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.champ-name {
  font-size: 11px;
  color: var(--hx-text-faint);
  letter-spacing: 0.1em;
}
.settlement {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.skin-block {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.skin-art {
  width: 76px;
  height: 76px;
  flex-shrink: 0;
  border: 1px solid var(--hx-line);
  background: var(--hx-panel-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.skin-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.skin-art--empty {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.skin-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.skin-name {
  font-size: 16px;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.skin-rarity {
  font-size: 11px;
  color: var(--hx-text-dim);
}
.skin-unknown {
  font-size: 11px;
  color: var(--hx-text-faint);
  line-height: 1.6;
}
.battle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.battle-text {
  font-size: 13px;
  color: var(--hx-text-regular);
}
.section {
  border-top: 1px solid var(--hx-line);
  padding-top: 12px;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.stat-count {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.stat-block {
  padding: 10px 12px;
  background: var(--hx-panel-2);
  border: 1px solid var(--hx-line);
}
.stat-total {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.stat-score {
  font-size: 24px;
  color: var(--hx-gold);
  letter-spacing: 0.04em;
}
.stat-tier {
  font-size: 13px;
}
.stat-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 8px;
}
.stat-dim {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.dim-label {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.dim-value {
  font-size: 13px;
  color: var(--hx-text-regular);
}
.rate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.rate-label {
  font-size: 13px;
  color: var(--hx-text-dim);
  width: 66px;
  flex-shrink: 0;
}
.rate-stars {
  --el-rate-fill-color: var(--hx-gold);
  --el-rate-icon-color: var(--hx-text-disabled);
}
.rated-hint {
  font-size: 11px;
  color: var(--hx-text-faint);
}
.submit-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--hx-danger);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
/* 核心操作 = 魔法蓝;次级操作 = 金色文字 */
.submit-btn {
  --el-button-bg-color: var(--hx-blue);
  --el-button-border-color: var(--hx-blue);
  --el-button-hover-bg-color: var(--hx-blue-bright);
  --el-button-hover-border-color: var(--hx-blue-bright);
}
.later-btn {
  color: var(--hx-gold);
}
.empty-text {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.blocked-text {
  font-size: 12px;
  color: var(--hx-text-faint);
  border-top: 1px solid var(--hx-line);
  padding-top: 12px;
}
</style>
```

- [ ] **Step 2: 确认能编译**

```powershell
npm run typecheck
```

Expected: 无新报错。

- [ ] **Step 3: 提交**

```powershell
git add src/renderer/src/components/match/SkinRatingDialog.vue
git commit -m "feat(ui): 局末皮肤评分结算卡"
```

---

## Task 16：桌面端 —— 应用里挂上弹窗 + 启动轮询器

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/main/index.ts`

- [ ] **Step 1: `App.vue` 挂弹窗**

template 里 `<DevConsole />` 之前加：

```vue
    <SkinRatingDialog v-model="settlementOpen" :view="settlementView" />
```

script 里加 import 和逻辑：

```ts
import SkinRatingDialog from './components/match/SkinRatingDialog.vue';
import type { SettlementView } from '../../shared/settlement';
```

⚠️ **`App.vue` 顶部已经有 `import { computed, onMounted, ref, watch } from 'vue';`** ——
别新开一行 import，改成：

```ts
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
```

```ts
/** 局末结算。shallowRef —— 换一次就是换一次,不需要深层响应式。 */
const settlementView = shallowRef<SettlementView | null>(null);
const settlementOpen = ref(false);
/** 已经处理过的结算键 —— 同一局不重复弹 */
let handledSettlementKey = '';

/**
 * 主进程推来一条结算。
 *
 * 同一局的补齐段会再推一次(带上了胜负/位置)—— 那时候弹窗已经开着,
 * 就地更新,不再弹一次。
 */
async function onSettlement(local: { key: string }): Promise<void> {
  if (local.key === handledSettlementKey && settlementOpen.value) {
    await refreshSettlement();
    return;
  }
  handledSettlementKey = local.key;
  await refreshSettlement();
  settlementOpen.value = settlementView.value !== null;
}

async function refreshSettlement(): Promise<void> {
  try {
    settlementView.value = await window.api.getSettlement();
  } catch (e: unknown) {
    console.warn('get settlement failed', e);
  }
}

let unsubscribeSettlement: (() => void) | null = null;

onMounted(async () => {
  await auth.refresh();
  await refreshLcu();
  unsubscribeSettlement = window.api.onSettlement((local) => {
    void onSettlement(local);
  });
});

onBeforeUnmount(() => {
  unsubscribeSettlement?.();
});
```

> ⚠️ `App.vue` 现有的 `onMounted` 回调要**合并**进上面那一个 —— 别留两个 `onMounted`（Vue 允许，但读着乱；合并成一个更清楚）。

- [ ] **Step 2: `src/main/index.ts` 启动轮询器**

import 加上 `import { matchPoller } from './match/poller';`

在 `app.whenReady()` 里，`registerIpcHandlers();` 之后加：

```ts
  // 局末结算要在**任何页面**都能弹出来 —— 轮询器不能等用户打开对局页才启动。
  // (代价:游戏客户端没开时,凭据解析会每 10 秒重试一次 —— 那是既有行为。)
  matchPoller.start();
```

- [ ] **Step 3: 跑全量检查**

```powershell
npm run typecheck
npm test
npm run lint -- --quiet
```

Expected: 三条全绿。

- [ ] **Step 4: 提交**

```powershell
git add src/renderer/src/App.vue src/main/index.ts
git commit -m "feat(app): 局末自动弹结算卡"
```

---

## Task 17：升版本号 + 联调

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 升版本号**

`package.json`：`"version": "0.34.0"` → `"version": "0.35.0"`

- [ ] **Step 2: 跑全量检查**

```powershell
npm run typecheck
npm test
npm run lint -- --quiet
```

Expected: 三条全绿。lint 只看 `--quiet`（只报 error）—— 存量 warning 是基线，别去动。

- [ ] **Step 3: 提交**

```powershell
git add package.json
git commit -m "chore: 0.35.0"
```

- [ ] **Step 4: 联调（要真实打一局）**

1. 后端先部署（Task 1 + Task 2 的改动）。
2. `npm run dev` 起桌面端。
3. 进一局 → 选人阶段确认「选了哪款皮肤」（看开发者日志里有没有记下 skinId）。
4. 打完 → 结算卡应该弹出来。
5. 在结算卡里打四维星 → 提交 → 小程序上这款皮肤的总分应该变了。

**联调要核对的口径**（跟 spec 一致）：

| 现象 | 说明 |
|---|---|
| 弹窗里没有皮肤名字 | 「没识别到具体皮肤」—— 兜底链没生效，回看探测 1 的结论 |
| 弹窗里没有「现有评分」 | 后端 `/api/ratings/skin-stats` 没这条皮肤，或者它零评分 |
| 提交报 403 | 后端还没部署 `@AllowsDesktopToken` 那半边 |
| 提交报 401 | 桌面端 token 过期了，用同步码重新登录 |
| 胜负/时长那块空着 | match history 还没落库，或者 Task 0.2 的结论是「永远补不上」 |

- [ ] **Step 5: 提交（联调修的东西）**

```powershell
git add -A
git commit -m "fix: 局末结算联调修的问题"
```

---

## 附：完成后要记下来的东西

这些**不要**写进代码注释 —— 写进 `docs/superpowers/plans/2026-11-18-game-end-skin-rating.md` 末尾的「实施记录」小节：

- 探测 1 的结论（选人会话里有没有 `skinId`、什么形态）
- 探测 2 的结论（match history 的 participant 有没有 skin 字段；刚打完那局落库快不快）
- 探测 3 的结论（`t_skin.skin_id` 跟 LCU 皮肤 id 是不是同一个数）
- 联调时实际出现的现象跟上面的对照表对不对得上

---

## 实施记录

> 代码写完了，**但一条命令都没跑成** —— 会话期间 Bash 的安全分类器
> （`claude-sonnet-4-6 is temporarily unavailable`）把 `npm run typecheck` /
> `vitest` 这类命令全拦了。所以下面「验证」一节全是待办，
> 需要在你自己的终端里跑一遍。

### 一、探测结论

**三个探测都还没做** —— 它们都要「人在游戏里」才跑得出来：

- [ ] Task 0.1 选人会话里有没有 `skinId`（`node scripts\dump-lcu-champselect.mjs`）
- [ ] Task 0.2 match history 的 participant 有没有 skin 字段（`node scripts\dump-lcu-match-history.mjs`）
- [ ] Task 0.3 `t_skin.skin_id` 跟 LCU 的皮肤 id 是不是同一个数

代码里凡是标了「⚠️ 还没实测」的地方，结论出来后要回来改。

### 二、跟计划的偏差

| 计划 | 实际 | 为什么 |
|---|---|---|
| Task 6 写 `parseChampSelectSkinId` / `parseLiveClientSkinName` 两个解析器 | **删了** | `champSelect.ts` 已经认得出「本地玩家那条」并给出 `mySkinId`；`liveClient.ts` 也已经在解析 `skinName`。再写一份就是两份同义实现，行为还可能对不上。皮肤来源的**优先级**留在 `usedSkin.ts` 的 `resolveUsedSkin` 里，四条来源的**提取**各归各的文件。 |
| 轮询器用单个 `usedSkin` 字段存「本局皮肤」 | 改成**三条候选**（`champSelectSkinId` / `gameflowSkinId` / `liveClientSkinName`），结算时由 `resolveUsedSkin` 合成 | 单字段存不下「后到的、但更可靠」的那条 —— 原来 gameflow 的皮肤 id 只有在 `usedSkin` 还是空的时候才收得上。 |
| match history 的皮肤 id 也存成字段 | **不存成字段** | 它是**局后**才查得到的，而且只属于那一局。存成字段会把上一局的编号带进下一局（连着两局玩同一个英雄时最容易踩）。补齐段直接改结算快照本身，不回写候选。 |
| 补齐段用 `this.currentChampionId` 找那一局 | 改用 `settlement.championId` | 打完立刻排下一局时，`this.currentChampionId` 已经是下一局的了 —— 会去匹配错的一局。 |
| 结算后候选不清空 | 结算快照生成后**清空**候选 | 同上：不清的话下一局没读到皮肤时会拿上一局的编号顶上。 |
| gameflow 的 `teamOne/teamTwo` 无条件收 | 「空闲 / 大厅」阶段**不收** | 那两个阶段的 `gameData` 还是上一局的残留。 |
| 界面上的段位直接吃 `avgScore` | 先 `toTen` 再 `scoreToTier` | 后端的 `avgScore` 是 **1~5 分制**。直接吃会把 4.2 分算成「拉完了」。跟小程序 `pages/skin-detail/index.js` 一个口径。 |

### 三、还没验证的

```powershell
npm run typecheck
npm test
npm run lint -- --quiet
```

后端（`all_function_api`，pom 默认 skip 测试，必须显式打开）：

```powershell
mvn -pl skin -am install -DskipTests
mvn -pl skin test -Dmaven.test.skip=false
```

### 四、联调要核对的

见 Task 17 Step 4 的对照表。特别注意两条：

- **后端要先上线** —— `@AllowsDesktopToken`（放行桌面端 token）和
  `/api/skins/list?skinId=` 都得部署了，弹窗才能认出皮肤、才能提交评分。
- **轮询器改成应用启动就跑**（`src/main/index.ts`）—— 局末结算要在任何页面都能弹出来。
  代价：游戏客户端没开时，凭据解析会每 10 秒重试一次（既有行为，不是这次引入的）。

### 五、2026-11-19 校正：国服客户端给的是**皮肤序号**，不是皮肤 id

用户报障：局末结算弹窗里皮肤显示「未知皮肤」、提示「未识别到具体皮肤」，
英雄名还显示成占位符「解锁者」，本局战绩那一行也是空的。

回头核代码才发现 —— **四条来源里有三条读的是国服客户端压根不存在的字段**：

| 来源 | 国际服给的字段 | 国服(腾讯)客户端实测 |
|---|---|---|
| 选人会话 | `myTeam[].skinId` | **没有** `skinId` |
| gameflow 队伍条目 | `skinId` | **没有** `skinId`,给的是 **`lastSelectedSkinIndex`**(皮肤序号) |
| match history participant | `skinId` | **没有** skin 字段 |
| Live Client 2999 | `allPlayers[].skin` | 有,但只给英文资源名;而且 `summonerName` 常为空,得走 Riot ID(`riotIdGameName` + `riotIdTagLine`)才认得出「我」 |

所以四条来源全部落空 → `riotSkinId === 0` → 界面走「未知皮肤」分支。

**改法**（`src/main/match/usedSkin.ts` + `poller.ts`）：

1. **皮肤序号 → 皮肤 id**:Riot 的编号规则是 `皮肤 id = 英雄编号 × 1000 + 皮肤序号`,
   序号 0 是默认皮肤。国服客户端自己的数据佐证这条规则:安妮的一款皮肤是
   `1001`(1×1000+1)、Aatrox 的一款皮肤是 `266001`(266×1000+1)。
2. **序号必须跟英雄编号成对记**(`gameflowSkinIndex` + `gameflowSkinChampionId`)——
   英雄编号在两局之间**不重置**,序号却要重置;不成对就会算出上一局英雄的皮肤。
3. **只在「确实是当前这一局」的阶段收序号**(对局中/等待结算/对局结束)——
   大厅和选人阶段 `gameData` 里还是上一局的人,收了会把上一局的皮肤算到这一局头上。
4. **认皮肤要严认**:只有 `teamOwner === true` 或 puuid 对上才算「我」。
   认错人就会把队友的皮肤当成自己的 —— 那比「没认出来」糟糕得多
   (「没认出来」只是没法打分,认错了是**给别人的皮肤打分**)。
5. **英雄名按英雄编号从静态数据取**,不信 Live Client —— 国服客户端局末会把
   `activePlayer` 换成占位数据,那儿的英雄名是「解锁者」这种鬼话。
6. **Live Client 认「我」那条改成按 Riot ID 匹配** —— 顺带修好了空着的「本局」战绩行
   (即时战绩也只挂在「我」那条上)。

另外补了一条**兜底**:事件流(WS)漏掉那一次 gameflow 更新时,结算补齐段会直接
再问一次客户端的 gameflow(限流 20 秒一次),把队伍条目里的皮肤线索捞回来。

`UsedSkin.source` 多了 `'gameflow-index'` 这一档,用来在日志/诊断里区分
「客户端直接给了皮肤 id」和「客户端给了序号、我们换算出来的」。

