# 皮肤总览弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端加一个「皮肤总览」弹窗,拉全量皮肤目录,与本地 LCU 已拥有皮肤比对,已拥有显示原图彩色,未拥有加灰度遮罩。

**Architecture:** 后端 `SkinVO` 加 `skinId` 字段并把 `convertToVO` 的 N+1 改成批量查英雄;桌面端主进程新增 `catalog.ts` 拉目录和已拥有快照,经 preload 桥暴露给渲染层;渲染层用 `skinCatalogLogic.ts` 里的纯函数(去重 / 拥有判定 / 筛选 / 虚拟滚动区间 / 统计)加一个固定行高的虚拟滚动网格,承载 1.2 万条皮肤。

**Tech Stack:** Electron 39 + electron-vite 3 + Vue 3.5 + TypeScript 5.9 + Element Plus 2.14 + vitest 3.2(jsdom)/@vue/test-utils;后端 Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + JUnit 5 + Mockito。

**Spec:** `docs/superpowers/specs/2026-10-30-skin-overview-dialog-design.md`

> **执行状态(2026-10-30):Task 1~11 的代码已全部写完并落在工作区,未提交。**
> 由于 Claude Code 的 Bash 安全分类器(`claude-sonnet-4-6`)全程宕机,
> **测试 / typecheck / build / mvn 一条都没跑过** —— 下面所有「运行测试 → 期望输出」的步骤都还是待验证状态。
> 下一步:先跑 Task 11 的验证命令,再按 Task 11 的手工验收清单走一遍,最后自己提交。
>
> **2026-10-30 补充(用户实测后):** 线上部署后「皮肤总览」弹窗 2138 条皮肤**全部没有缩略图**,
> 根因是渲染层 CSP 的 `img-src 'self' data:` 把远程图片全拦了(已改,见偏离 4)。
> 改完**必须重新 build + pack**,否则装出来的包还是旧的。
> 另外「未能获取已拥有皮肤,当前全部按未拥有显示」是 `ownedSource === 'none'` 的正常兜底:
> 游戏客户端没开(拿不到 LCU)且桌面端未登录/没同步过到后端。要看到真实的已拥有高亮,
> 至少要满足其中一条:① 开着游戏客户端,或 ② 在桌面端登录后先 Sync now 一次。

---

## 执行须知

- **仓库与分支**
  - 桌面端 `D:\Code\Front_Project\all\local_skin_importer`,分支 `main`
  - 后端 `D:\Code\Front_Project\all\all_function_api`,分支 `feature/origin_项目结构重构打包`
- **提交约定**:用户有「不要替我 commit」的既定偏好。每个任务末尾的 **Step: 提交** 只列出精确命令,**执行者(尤其是子代理)不要自动运行**,等用户自己提交。
- **后端测试默认被跳过**:根 `pom.xml` 里 `<maven.test.skip>true</maven.test.skip>`,跑测试必须加 `-Dmaven.test.skip=false`。
- **后端编译器有硬编码 JDK**:`pom.xml` 的 `maven-compiler-plugin` 里 `<fork>true</fork><executable>D:\develop_tools\JDK\jdk17\bin\javac.exe</executable>`,换机器要改这里。
- **两份代码库、两种包管理**:桌面端 `npm`(vitest),后端 `mvn`。

---

## 文件结构

### 后端 `all_function_api`(必须先上线)

| 文件 | 动作 | 职责 |
|---|---|---|
| `skin/src/main/java/com/lolskin/skin/vo/SkinVO.java` | 修改 | 加 `skinId` 字段 |
| `skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java` | 修改 | `convertToVOList` 批量查英雄,替换 N+1 |
| `skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java` | **新建** | skinId 透传 + 批量查询断言 |

### 桌面端 `local_skin_importer`

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/main/catalog.ts` | 新建 | 拉全量目录 / 拉后端已拥有快照 |
| `src/main/__tests__/catalog.test.ts` | 新建 | catalog 单测 |
| `src/main/ipc.ts` | 修改 | 注册 `catalog:fetch-all` / `catalog:fetch-owned` |
| `src/preload/index.ts` | 修改 | 暴露 `fetchCatalog()` / `fetchMyOwned()` + 类型 |
| `src/main/__tests__/ipc.test.ts` | 修改 | 现有断言写死了「6 个 channel」,必须同步改 |
| `src/renderer/src/composables/skinCatalogLogic.ts` | 新建 | 纯函数(去重/判定/筛选/滚动区间/统计) |
| `src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts` | 新建 | 纯函数单测 |
| `src/renderer/src/composables/useSkinCatalog.ts` | 新建 | 加载编排:三级降级 / 缓存 / 统计 |
| `src/renderer/src/composables/__tests__/useSkinCatalog.test.ts` | 新建 | 降级与缓存单测 |
| `src/renderer/src/components/SkinCard.vue` | 新建 | 单张卡片(彩色/置灰) |
| `src/renderer/src/components/__tests__/SkinCard.test.ts` | 新建 | 卡片两态单测 |
| `src/renderer/src/components/SkinGrid.vue` | 新建 | 固定行高虚拟滚动网格 |
| `src/renderer/src/components/SkinDetailDialog.vue` | 新建 | 原画详情层 |
| `src/renderer/src/components/SkinOverviewDialog.vue` | 新建 | 弹窗容器:统计条 + 筛选栏 + 提示条 |
| `src/renderer/src/views/Sync.vue` | 修改 | 加入口卡片 + 按钮 |
| `src/renderer/index.html` | 修改 | 放开 CSP `img-src`,否则远程皮肤图标全被拦掉 |

### 与 spec 的四处偏离(有意为之)

1. **spec §4.1 把纯函数和数据层放一个文件,这里拆成 `skinCatalogLogic.ts` + `useSkinCatalog.ts`。** 理由:纯函数不依赖 Vue,可以脱离组件直接测,也能被 `SkinGrid` / `SkinOverviewDialog` 复用而不引入循环依赖。
2. **spec §4.4 提到的 `IntersectionObserver` 图片懒加载取消。** 理由:虚拟滚动已经把 DOM 限制在可见切片内,渲染出来的卡片本来就在视口附近(±2 行 overscan),再套一层观察器是多余开销。`SkinCard` 保留 `visible` prop 但网格恒传 `true`。
3. **网格行高改用 `grid-auto-rows` 定死(实现期新增)。** 卡片的真实高度由字体行高决定(约 167px),如果只按 `CARD_H + GAP` 算 offsetY,行距和常量对不上,滚远之后切片会整体偏移。所以 `.skin-grid-slice` 上加 `grid-auto-rows: ${CARD_H}px`,让布局行高和虚拟滚动的行距严格相等。
4. **放开了渲染层的 CSP `img-src`(实现期新增)。** 原 `src/renderer/index.html` 写的是 `img-src 'self' data:`,把后端返回的远程皮肤图标全部拦掉,表现为「2138 条皮肤全都没有缩略图」。皮肤图标的来源不固定(腾讯 CDN `game.gtimg.cn`、站点 `sxdtaz.cn`、图片服务器 `101.34.210.254`),硬编码主机名单太脆,改成 `img-src 'self' data: http: https:`。`script-src` 仍然锁死 `'self'`,不影响脚本注入防护。

---

## Task 1: 后端 — `SkinVO.skinId` + 修 N+1

**Files:**
- Modify: `all_function_api/skin/src/main/java/com/lolskin/skin/vo/SkinVO.java`
- Modify: `all_function_api/skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java`
- Create: `all_function_api/skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java`

- [ ] **Step 1: 写失败测试**

新建 `all_function_api/skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java`:

```java
package com.lolskin.skin.service.impl;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lolskin.skin.entity.Hero;
import com.lolskin.skin.entity.Skin;
import com.lolskin.skin.mapper.HeroMapper;
import com.lolskin.skin.mapper.SkinMapper;
import com.lolskin.skin.vo.SkinVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SkinServiceImplTest {

    private SkinMapper skinMapper;
    private HeroMapper heroMapper;
    private SkinServiceImpl service;

    @BeforeEach
    void setUp() {
        skinMapper = mock(SkinMapper.class);
        heroMapper = mock(HeroMapper.class);
        service = new SkinServiceImpl(skinMapper, heroMapper);
    }

    private Skin skin(long id, int skinId, long heroId) {
        Skin s = new Skin();
        s.setId(id);
        s.setSkinId(skinId);
        s.setHeroId(heroId);
        s.setName("skin-" + skinId);
        s.setIsActive(true);
        return s;
    }

    private void stubPage(List<Skin> skins) {
        Page<Skin> page = new Page<>(1, 20);
        page.setRecords(skins);
        page.setTotal(skins.size());
        when(skinMapper.selectPage(
                ArgumentMatchers.<Page<Skin>>any(),
                ArgumentMatchers.<Wrapper<Skin>>any()))
            .thenReturn(page);
    }

    @Test
    void listSkins_copiesSkinIdToVo() {
        stubPage(List.of(skin(1L, 161013, 7L)));
        when(heroMapper.selectBatchIds(any())).thenReturn(List.of());

        List<SkinVO> records = service.listSkins(1L, 20L, null, null, null).getRecords();

        assertEquals(1, records.size());
        assertEquals(161013, records.get(0).getSkinId().intValue());
    }

    @Test
    void listSkins_batchesHeroLookupIntoOneQuery() {
        List<Skin> skins = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            skins.add(skin(i + 1L, 161000 + i, 7L));
        }
        stubPage(skins);
        when(heroMapper.selectBatchIds(any())).thenReturn(List.of());

        service.listSkins(1L, 20L, null, null, null);

        verify(heroMapper, times(1)).selectBatchIds(any());
        verify(heroMapper, never()).selectById(any());
    }

    @Test
    void listSkins_fillsHeroNameFromBatchedHero() {
        stubPage(List.of(skin(1L, 161013, 7L)));
        Hero hero = new Hero();
        hero.setId(7L);
        hero.setName("暗裔剑魔");
        when(heroMapper.selectBatchIds(any())).thenReturn(List.of(hero));

        List<SkinVO> records = service.listSkins(1L, 20L, null, null, null).getRecords();

        assertEquals("暗裔剑魔", records.get(0).getHeroName());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am -Dmaven.test.skip=false -Dtest=SkinServiceImplTest test
```

Expected: FAIL —— 编译期报 `cannot find symbol: method getSkinId()`(SkinVO 还没有这个字段)。

- [ ] **Step 3: 给 `SkinVO` 加字段**

`all_function_api/skin/src/main/java/com/lolskin/skin/vo/SkinVO.java`,在 `private Long id;` 后面加:

```java
    /**
     * 游戏内皮肤ID(与 LCU itemId 同口径)
     */
    private Integer skinId;
```

`Skin` 实体已有 `private Integer skinId;`,`BeanUtils.copyProperties` 会自动拷贝,不需要写映射代码。

- [ ] **Step 4: 改 `SkinServiceImpl` 消掉 N+1**

`all_function_api/skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java`

4a. 补 import(文件当前没有任何 `java.util` import):

```java
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
```

4b. 把 `listSkins` 里的转换调用:

```java
        voPage.setRecords(skinPage.getRecords().stream()
                .map(this::convertToVO)
                .toList());
```

改成:

```java
        voPage.setRecords(convertToVOList(skinPage.getRecords()));
```

4c. 把原来的 `convertToVO(Skin skin)` 整个方法替换成两个方法:

```java
    /**
     * 批量转换。英雄一次查完再建 Map ——
     * 逐条 selectById 在全量 1.2 万条时会产生 1.2 万次查询。
     */
    private List<SkinVO> convertToVOList(List<Skin> skins) {
        if (skins.isEmpty()) {
            return List.of();
        }
        Set<Long> heroIds = skins.stream()
                .map(Skin::getHeroId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, Hero> heroMap = heroIds.isEmpty()
                ? Map.of()
                : heroMapper.selectBatchIds(heroIds).stream()
                        .collect(Collectors.toMap(Hero::getId, h -> h, (a, b) -> a));
        return skins.stream().map(s -> toVO(s, heroMap)).toList();
    }

    private SkinVO toVO(Skin skin, Map<Long, Hero> heroMap) {
        SkinVO vo = new SkinVO();
        BeanUtils.copyProperties(skin, vo);
        Hero hero = skin.getHeroId() == null ? null : heroMap.get(skin.getHeroId());
        if (hero != null) {
            vo.setHeroName(hero.getName());
        }
        return vo;
    }
```

`getSkinDetail` 用的 `convertToDetailVO` 保持不动。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am -Dmaven.test.skip=false -Dtest=SkinServiceImplTest test
```

Expected: `Tests run: 3, Failures: 0, Errors: 0` + `BUILD SUCCESS`。

- [ ] **Step 6: 跑整个 skin 模块的测试确认没打破别的**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am -Dmaven.test.skip=false test
```

Expected: BUILD SUCCESS。如果 `SkinSyncControllerTest` / `PlayerSkinSyncServiceImplTest` 之类挂了,先看是不是本来就红的存量问题。

- [ ] **Step 7: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/all_function_api
git add skin/src/main/java/com/lolskin/skin/vo/SkinVO.java skin/src/main/java/com/lolskin/skin/service/impl/SkinServiceImpl.java skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java
git commit -m "feat(skin): 皮肤列表接口返回 skinId 并批量查询英雄"
```

- [ ] **Step 8: 部署后端**

部署完用下面的命令确认线上已经带上 `skinId` 字段:

```bash
curl -s "http://101.34.210.254/api/skins/list?current=1&size=1"
```

Expected: 返回的 `data.records[0]` 里**有** `"skinId"` 这个 key(值可以是 null,key 必须存在)。后端没部署的话这里完全没有这个 key,桌面端会弹「服务端版本过低」。

---

## Task 2: 桌面端主进程 — `catalog.ts`

**Files:**
- Create: `local_skin_importer/src/main/catalog.ts`
- Create: `local_skin_importer/src/main/__tests__/catalog.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `local_skin_importer/src/main/__tests__/catalog.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getStoredToken } from '../auth';
import { fetchCatalog, fetchMyOwned } from '../catalog';

vi.mock('axios');
vi.mock('../auth');
// catalog.ts → ./auth → electron. Mock electron too so the transitive
// import doesn't try to load the real `electron` package from node_modules.
// (Same reason backend.test.ts does this.)
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

function ok(data: unknown) {
  return { data: { code: 200, data } };
}

function rawSkin(id: number, skinId: number | null): Record<string, unknown> {
  return {
    id,
    skinId,
    heroId: 7,
    heroName: '暗裔剑魔',
    name: `skin-${id}`,
    nameEn: `Skin ${id}`,
    rarity: '传说',
    priceRp: 3250,
    splashUrl: `splash-${id}.jpg`,
    iconUrl: `icon-${id}.jpg`
  };
}

describe('catalog.fetchCatalog', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('maps records and detects the skinId field', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        current: 1,
        size: 20000,
        total: 2,
        pages: 1,
        records: [rawSkin(1, 161013), rawSkin(2, null)]
      })
    );

    const result = await fetchCatalog();

    expect(result.total).toBe(2);
    expect(result.skinIdFieldPresent).toBe(true);
    expect(result.records[0].skinId).toBe(161013);
    expect(result.records[1].skinId).toBeNull();
    expect(result.records[0].heroName).toBe('暗裔剑魔');
    expect(result.records[0].iconUrl).toBe('icon-1.jpg');
  });

  it('reports skinIdFieldPresent=false when the backend omits the field', async () => {
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        current: 1,
        size: 20000,
        total: 1,
        pages: 1,
        records: [{ id: 1, heroId: 7, heroName: '暗裔剑魔', name: 'x' }]
      })
    );

    const result = await fetchCatalog();

    expect(result.skinIdFieldPresent).toBe(false);
  });

  it('throws with the backend message when the envelope code is not 200', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 500, message: '数据库炸了' } });

    await expect(fetchCatalog()).rejects.toThrow('数据库炸了');
  });

  it('re-paginates with 2000 per page when the first page was truncated', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => rawSkin(i + 1, i + 1));
    const page2 = Array.from({ length: 1500 }, (_, i) => rawSkin(i + 1001, i + 1001));
    vi.mocked(axios.get)
      .mockResolvedValueOnce(
        ok({ current: 1, size: 20000, total: 2500, pages: 1, records: [rawSkin(1, 1)] })
      )
      .mockResolvedValueOnce(ok({ current: 1, size: 2000, total: 2500, pages: 2, records: page1 }))
      .mockResolvedValueOnce(ok({ current: 2, size: 2000, total: 2500, pages: 2, records: page2 }));

    const result = await fetchCatalog();

    expect(result.total).toBe(2500);
    expect(result.records).toHaveLength(2500);
    expect(axios.get).toHaveBeenCalledTimes(3);
  });
});

describe('catalog.fetchMyOwned', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('throws without sending a request when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);

    await expect(fetchMyOwned()).rejects.toThrow('未登录');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns the total count and the owned skin ids', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({
        totalOwnedCount: 87,
        ownedSkins: [{ skinId: 161013 }, { skinId: 1001 }]
      })
    );

    const result = await fetchMyOwned();

    expect(result).toEqual({ totalOwnedCount: 87, ownedSkinIds: [161013, 1001] });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/my-owned'),
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-abc' } })
    );
  });

  it('drops non-numeric skin ids', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(
      ok({ totalOwnedCount: 2, ownedSkins: [{ skinId: 161013 }, { skinId: null }] })
    );

    const result = await fetchMyOwned();

    expect(result.ownedSkinIds).toEqual([161013]);
  });

  it('falls back to the id count when totalOwnedCount is absent', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue(ok({ ownedSkins: [{ skinId: 1 }, { skinId: 2 }] }));

    const result = await fetchMyOwned();

    expect(result.totalOwnedCount).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/main/__tests__/catalog.test.ts
```

Expected: FAIL —— `Failed to resolve import "../catalog"`。

- [ ] **Step 3: 实现 `src/main/catalog.ts`**

```ts
import axios from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const CATALOG_TIMEOUT_MS = 60_000;
const OWNED_TIMEOUT_MS = 30_000;
/** 补拉时的分页大小 */
const CATALOG_PAGE_SIZE = 2000;
/** 首次请求的「大页」,正常一次就能拿完 1.2 万条 */
const CATALOG_FIRST_PAGE_SIZE = 20000;

export interface CatalogSkin {
  id: number;
  skinId: number | null;
  heroId: number | null;
  heroName: string | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  priceRp: number | null;
  splashUrl: string | null;
  iconUrl: string | null;
}

export interface CatalogResult {
  total: number;
  records: CatalogSkin[];
  /**
   * 响应里是否存在 `skinId` 这个 key。
   * false = 后端未升级,无法比对已拥有状态。
   */
  skinIdFieldPresent: boolean;
}

export interface OwnedSnapshot {
  /** 已同步到后端的已拥有总数(含目录未收录的) */
  totalOwnedCount: number;
  /** 已拥有且目录里有对应行的 skinId 列表 */
  ownedSkinIds: number[];
}

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

interface CatalogPage {
  current: number;
  size: number;
  total: number;
  pages: number;
  records: Record<string, unknown>[];
}

interface OwnedPayload {
  totalOwnedCount?: number;
  ownedSkins?: { skinId?: number | null }[];
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toCatalogSkin(raw: Record<string, unknown>): CatalogSkin {
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    skinId: numOrNull(raw.skinId),
    heroId: numOrNull(raw.heroId),
    heroName: strOrNull(raw.heroName),
    name: strOrNull(raw.name),
    nameEn: strOrNull(raw.nameEn),
    rarity: strOrNull(raw.rarity),
    priceRp: numOrNull(raw.priceRp),
    splashUrl: strOrNull(raw.splashUrl),
    iconUrl: strOrNull(raw.iconUrl)
  };
}

async function fetchCatalogPage(current: number, size: number): Promise<CatalogPage> {
  const url = `${BACKEND_BASE_URL}/api/skins/list?current=${current}&size=${size}`;
  const { data } = await axios.get<BackendEnvelope<CatalogPage>>(url, {
    timeout: CATALOG_TIMEOUT_MS
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(data.message ?? '获取皮肤目录失败');
  }
  return data.data;
}

export async function fetchCatalog(): Promise<CatalogResult> {
  const first = await fetchCatalogPage(1, CATALOG_FIRST_PAGE_SIZE);
  let raw = first.records;

  // 后端把结果截断了(理论上不会:1.2 万 < 2 万),按 2000/页补拉。
  if (raw.length < first.total) {
    const pages = Math.ceil(first.total / CATALOG_PAGE_SIZE);
    raw = [];
    for (let current = 1; current <= pages; current++) {
      const page = await fetchCatalogPage(current, CATALOG_PAGE_SIZE);
      raw.push(...page.records);
    }
  }

  // 老后端的响应里根本没有 `skinId` 这个 key;新后端会带(值可能是 null)。
  const skinIdFieldPresent =
    raw.length > 0 && Object.prototype.hasOwnProperty.call(raw[0], 'skinId');

  return {
    total: first.total,
    records: raw.map(toCatalogSkin),
    skinIdFieldPresent
  };
}

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
  const ownedSkinIds = (data.data.ownedSkins ?? [])
    .map((s) => s.skinId)
    .filter((v): v is number => typeof v === 'number');
  return {
    totalOwnedCount: data.data.totalOwnedCount ?? ownedSkinIds.length,
    ownedSkinIds
  };
}
```

> `BACKEND_BASE_URL` 在 `backend.ts` / `auth.ts` 里各有一份本地常量,这里保持同样的写法,不做跨文件重构。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/main/__tests__/catalog.test.ts
```

Expected: 8 passed。

- [ ] **Step 5: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/main/catalog.ts src/main/__tests__/catalog.test.ts
git commit -m "feat: 新增皮肤目录与已拥有快照的主进程拉取"
```

---

## Task 3: 桌面端 — IPC channel + preload 桥

**Files:**
- Modify: `local_skin_importer/src/main/ipc.ts`
- Modify: `local_skin_importer/src/preload/index.ts`
- Modify: `local_skin_importer/src/main/__tests__/ipc.test.ts`

> ⚠️ 现有 `ipc.test.ts` 里有两条断言**写死了 6 个 channel 和 6 个 renderer 方法**,加 channel 必然打破它们。必须同步改,否则 `npm run test` 直接红。

- [ ] **Step 1: 先改测试让它失败**

在 `src/main/__tests__/ipc.test.ts` 里:

1. `mocks` 对象里加两项:
```ts
    fetchCatalog: vi.fn(),
    fetchMyOwned: vi.fn()
```

2. 加上 mock:
```ts
vi.mock('../catalog', () => ({
  fetchCatalog: mocks.fetchCatalog,
  fetchMyOwned: mocks.fetchMyOwned
}));
```

3. `beforeEach` 里加两行重置:
```ts
    mocks.fetchCatalog.mockReset();
    mocks.fetchMyOwned.mockReset();
```

4. `ExposedApi` 类型补两个方法:
```ts
type ExposedApi = {
  checkLcu: () => unknown;
  fetchSkins: () => unknown;
  redeemCode: (code: string) => unknown;
  logout: () => unknown;
  getAuthStatus: () => unknown;
  sync: (payload: { puuid: string; summonerName: string; ownedSkinIds: number[] }) => unknown;
  fetchCatalog: () => unknown;
  fetchMyOwned: () => unknown;
};
```

5. 「exposes all renderer methods through contextBridge」用例里,调用和断言都加上新方法:
```ts
    api.fetchCatalog();
    api.fetchMyOwned();
```
断言数组改成:
```ts
    expect(mocks.ipcRendererInvoke.mock.calls).toEqual([
      ['lcu:check-status'],
      ['lcu:fetch-skins'],
      ['auth:login', { code: '482931' }],
      ['auth:logout'],
      ['auth:get-status'],
      ['backend:sync', { puuid: 'p', summonerName: 'Alice', ownedSkinIds: [1, 2] }],
      ['catalog:fetch-all'],
      ['catalog:fetch-owned']
    ]);
```

6. 「registers all 6 ipc channels」改成「registers all 8 ipc channels」,期望数组加两项:
```ts
    expect(mocks.ipcMainHandle.mock.calls.map(([channel]) => channel)).toEqual([
      'lcu:check-status',
      'lcu:fetch-skins',
      'auth:login',
      'auth:logout',
      'auth:get-status',
      'backend:sync',
      'catalog:fetch-all',
      'catalog:fetch-owned'
    ]);
```

7. 新增两个用例:
```ts
  it('catalog:fetch-all delegates to fetchCatalog', async () => {
    const result = { total: 1, records: [], skinIdFieldPresent: true };
    mocks.fetchCatalog.mockResolvedValue(result);

    await expect(invoke('catalog:fetch-all')).resolves.toBe(result);
    expect(mocks.fetchCatalog).toHaveBeenCalledOnce();
  });

  it('catalog:fetch-owned delegates to fetchMyOwned', async () => {
    const result = { totalOwnedCount: 87, ownedSkinIds: [1, 2] };
    mocks.fetchMyOwned.mockResolvedValue(result);

    await expect(invoke('catalog:fetch-owned')).resolves.toBe(result);
    expect(mocks.fetchMyOwned).toHaveBeenCalledOnce();
  });

  it('catalog:fetch-all surfaces failures as a real Error', async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error('服务端响应超时'));

    const err = await invoke('catalog:fetch-all').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('服务端响应超时');
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/main/__tests__/ipc.test.ts
```

Expected: FAIL —— `No handler registered for catalog:fetch-all`,且「registers all 8」断言不匹配。

- [ ] **Step 3: 在 `src/main/ipc.ts` 注册 channel**

加 import:
```ts
import { fetchCatalog, fetchMyOwned } from './catalog';
```

在 `registerIpcHandlers()` 里,`backend:sync` 之后加:
```ts
  ipcMain.handle('catalog:fetch-all', async () => {
    try {
      return await fetchCatalog();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });

  ipcMain.handle('catalog:fetch-owned', async () => {
    try {
      return await fetchMyOwned();
    } catch (e) {
      throw normalizeSyncError(e);
    }
  });
```

- [ ] **Step 4: 在 `src/preload/index.ts` 暴露桥**

加类型:
```ts
export interface CatalogSkin {
  id: number;
  skinId: number | null;
  heroId: number | null;
  heroName: string | null;
  name: string | null;
  nameEn: string | null;
  rarity: string | null;
  priceRp: number | null;
  splashUrl: string | null;
  iconUrl: string | null;
}

export interface CatalogResult {
  total: number;
  records: CatalogSkin[];
  skinIdFieldPresent: boolean;
}

export interface OwnedSnapshot {
  totalOwnedCount: number;
  ownedSkinIds: number[];
}
```

在 `api` 对象里加两项:
```ts
  fetchCatalog: (): Promise<CatalogResult> => invoke('catalog:fetch-all'),
  fetchMyOwned: (): Promise<OwnedSnapshot> => invoke('catalog:fetch-owned')
```

`window.api` 的类型是 `ExposedApi = typeof api`,所以 `global.d.ts` 不用改。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/main/__tests__/ipc.test.ts
```

Expected: 全部 passed(通道数断言现在是 8)。

- [ ] **Step 6: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/main/ipc.ts src/preload/index.ts src/main/__tests__/ipc.test.ts
git commit -m "feat: 暴露皮肤目录与已拥有快照的 IPC 通道"
```

---

## Task 4: 桌面端渲染层 — 纯函数

**Files:**
- Create: `local_skin_importer/src/renderer/src/composables/skinCatalogLogic.ts`
- Create: `local_skin_importer/src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `local_skin_importer/src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CatalogSkin } from '../../../../preload/index';
import {
  computeStats,
  computeVisibleRange,
  dedupeBySkinId,
  filterSkins,
  isOwned
} from '../skinCatalogLogic';

function skin(partial: Partial<CatalogSkin> & { skinId: number | null }): CatalogSkin {
  return {
    id: 0,
    heroId: 7,
    heroName: '暗裔剑魔',
    name: '皮肤',
    nameEn: 'Skin',
    rarity: '传说',
    priceRp: 3250,
    splashUrl: 's.jpg',
    iconUrl: 'i.jpg',
    ...partial
  };
}

describe('isOwned', () => {
  it('returns true when the skin id is in the owned set', () => {
    expect(isOwned(skin({ skinId: 161013 }), new Set([161013]))).toBe(true);
  });

  it('returns false when the skin id is not owned', () => {
    expect(isOwned(skin({ skinId: 161013 }), new Set([1]))).toBe(false);
  });

  it('returns false when the skin has no id', () => {
    expect(isOwned(skin({ skinId: null }), new Set([1]))).toBe(false);
  });
});

describe('dedupeBySkinId', () => {
  it('keeps only the first row for a duplicated skin id', () => {
    const rows = [
      skin({ id: 1, skinId: 100 }),
      skin({ id: 2, skinId: 100, name: '重复' }),
      skin({ id: 3, skinId: 200 })
    ];

    const result = dedupeBySkinId(rows);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].skinId).toBe(200);
  });

  it('keeps every row that has no skin id', () => {
    const rows = [skin({ id: 1, skinId: null }), skin({ id: 2, skinId: null })];

    expect(dedupeBySkinId(rows)).toHaveLength(2);
  });
});

describe('filterSkins', () => {
  const rows = [
    // nameEn 不能带 "night" —— Knight 里就含 night,子串匹配会把它也捞进来
    skin({ id: 1, skinId: 100, name: '冠军猩红', nameEn: 'Crimson Warden', heroName: '暗裔剑魔', heroId: 7, rarity: '传说' }),
    skin({ id: 2, skinId: 200, name: '暗夜之刃', nameEn: 'Night Blade', heroName: '暗裔剑魔', heroId: 7, rarity: '史诗' }),
    skin({ id: 3, skinId: 300, name: '冰霜女巫', nameEn: 'Frost Witch', heroName: '冰霜女巫', heroId: 9, rarity: '传说' })
  ];
  const owned = new Set([100]);

  it('returns everything when no filter is set', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: null, onlyUnowned: false })
    ).toHaveLength(3);
  });

  it('matches the keyword against name, nameEn and heroName, case-insensitively', () => {
    const byName = filterSkins(rows, owned, {
      keyword: '冠军',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byName.map((s) => s.id)).toEqual([1]);

    const byEn = filterSkins(rows, owned, {
      keyword: 'night',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byEn.map((s) => s.id)).toEqual([2]);

    const byHero = filterSkins(rows, owned, {
      keyword: '冰霜女巫',
      heroId: null,
      rarity: null,
      onlyUnowned: false
    });
    expect(byHero.map((s) => s.id)).toEqual([3]);
  });

  it('filters by hero and by rarity', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: 9, rarity: null, onlyUnowned: false }).map(
        (s) => s.id
      )
    ).toEqual([3]);

    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: '史诗', onlyUnowned: false }).map(
        (s) => s.id
      )
    ).toEqual([2]);
  });

  it('keeps only unowned skins when onlyUnowned is on', () => {
    expect(
      filterSkins(rows, owned, { keyword: '', heroId: null, rarity: null, onlyUnowned: true }).map(
        (s) => s.id
      )
    ).toEqual([2, 3]);
  });

  it('keeps skins without an id in the only-unowned view', () => {
    const withNull = [...rows, skin({ id: 4, skinId: null })];

    expect(
      filterSkins(withNull, owned, {
        keyword: '',
        heroId: null,
        rarity: null,
        onlyUnowned: true
      }).map((s) => s.id)
    ).toEqual([2, 3, 4]);
  });
});

describe('computeVisibleRange', () => {
  it('returns an empty range for an empty list', () => {
    expect(computeVisibleRange(0, 600, 188, 6, 0)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('returns an empty range when cols is zero', () => {
    expect(computeVisibleRange(0, 600, 188, 0, 100)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('starts at the first row on the first screen', () => {
    const range = computeVisibleRange(0, 600, 188, 6, 100);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBeGreaterThan(0);
  });

  it('advances with the scroll position and stays on a column boundary', () => {
    const range = computeVisibleRange(188 * 10, 600, 188, 6, 600);
    expect(range.startIndex % 6).toBe(0);
    expect(range.startIndex).toBeGreaterThan(0);
    expect(range.endIndex).toBeGreaterThan(range.startIndex);
  });

  it('never exceeds the item count at the bottom', () => {
    const range = computeVisibleRange(188 * 1000, 600, 188, 6, 30);
    expect(range.endIndex).toBe(30);
    expect(range.startIndex).toBeLessThanOrEqual(30);
  });

  it('includes the overscan rows', () => {
    const tight = computeVisibleRange(188 * 10, 188, 188, 6, 600, 0);
    const loose = computeVisibleRange(188 * 10, 188, 188, 6, 600, 2);
    expect(loose.startIndex).toBeLessThan(tight.startIndex);
    expect(loose.endIndex).toBeGreaterThan(tight.endIndex);
  });
});

describe('computeStats', () => {
  it('counts matched owned skins without double counting duplicates', () => {
    const rows = [
      skin({ id: 1, skinId: 100 }),
      skin({ id: 2, skinId: 100 }),
      skin({ id: 3, skinId: 200 }),
      skin({ id: 4, skinId: null })
    ];

    const stats = computeStats(rows, new Set([100]), 87);

    expect(stats.ownedMatched).toBe(1);
    expect(stats.ownedReported).toBe(87);
    expect(stats.ownedMissingFromCatalog).toBe(86);
  });

  it('reports the skin id coverage', () => {
    const rows = [skin({ id: 1, skinId: 100 }), skin({ id: 2, skinId: null })];

    expect(computeStats(rows, new Set(), 0).skinIdCoverage).toBe(0.5);
  });

  it('reports zero coverage for an empty catalog', () => {
    expect(computeStats([], new Set(), 0).skinIdCoverage).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts
```

Expected: FAIL —— `Failed to resolve import "../skinCatalogLogic"`。

- [ ] **Step 3: 实现 `src/renderer/src/composables/skinCatalogLogic.ts`**

```ts
// composables 目录在 src/renderer/src/ 下,往上三层才是 src/
import type { CatalogSkin } from '../../../preload/index';

export function isOwned(skin: CatalogSkin, ownedIds: Set<number>): boolean {
  return skin.skinId != null && ownedIds.has(skin.skinId);
}

/**
 * t_skin 里同一个 skin_id 可能有多行(不同系列),网格里会出现重复卡片,
 * 「已拥有」也会被重复计数。这里按 skinId 去重,保留第一条。
 * 没有 skinId 的行无法去重,原样保留。
 */
export function dedupeBySkinId(records: CatalogSkin[]): CatalogSkin[] {
  const seen = new Set<number>();
  const out: CatalogSkin[] = [];
  for (const r of records) {
    if (r.skinId == null) {
      out.push(r);
      continue;
    }
    if (seen.has(r.skinId)) continue;
    seen.add(r.skinId);
    out.push(r);
  }
  return out;
}

export interface CatalogFilters {
  keyword: string;
  heroId: number | null;
  rarity: string | null;
  onlyUnowned: boolean;
}

export function filterSkins(
  skins: CatalogSkin[],
  ownedIds: Set<number>,
  filters: CatalogFilters
): CatalogSkin[] {
  const kw = filters.keyword.trim().toLowerCase();
  return skins.filter((s) => {
    if (filters.heroId != null && s.heroId !== filters.heroId) return false;
    if (filters.rarity && s.rarity !== filters.rarity) return false;
    if (filters.onlyUnowned && isOwned(s, ownedIds)) return false;
    if (kw) {
      const hay = `${s.name ?? ''} ${s.nameEn ?? ''} ${s.heroName ?? ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export interface VisibleRange {
  startIndex: number;
  endIndex: number;
}

export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  cols: number,
  totalItems: number,
  overscanRows = 2
): VisibleRange {
  if (totalItems <= 0 || cols <= 0) return { startIndex: 0, endIndex: 0 };
  const rows = Math.ceil(totalItems / cols);
  // firstRow 必须夹到 rows-1:否则滚过头时 startIndex 会大于 totalItems,
  // slice(startIndex, endIndex) 变成空数组,网格底部整片空白。
  const firstRow = Math.max(
    0,
    Math.min(rows - 1, Math.floor(scrollTop / rowHeight) - overscanRows)
  );
  const lastRow = Math.min(
    rows - 1,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows
  );
  return {
    startIndex: firstRow * cols,
    endIndex: Math.min(totalItems, (lastRow + 1) * cols)
  };
}

export interface OwnedStats {
  /** 目录中实际被标为「已拥有」的皮肤件数(去重后) */
  ownedMatched: number;
  /** LCU / 后端报告的已拥有总数 */
  ownedReported: number;
  /** 报告了但目录里没有的件数 */
  ownedMissingFromCatalog: number;
  /** 目录中 skinId 非空的比例,0~1 */
  skinIdCoverage: number;
}

export function computeStats(
  skins: CatalogSkin[],
  ownedIds: Set<number>,
  ownedReported: number
): OwnedStats {
  const matched = new Set<number>();
  let withId = 0;
  for (const s of skins) {
    if (s.skinId == null) continue;
    withId += 1;
    if (ownedIds.has(s.skinId)) matched.add(s.skinId);
  }
  return {
    ownedMatched: matched.size,
    ownedReported,
    ownedMissingFromCatalog: Math.max(0, ownedReported - matched.size),
    skinIdCoverage: skins.length ? withId / skins.length : 0
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts
```

Expected: 全部 passed。

- [ ] **Step 5: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/composables/skinCatalogLogic.ts src/renderer/src/composables/__tests__/skinCatalogLogic.test.ts
git commit -m "feat: 皮肤目录的纯函数逻辑(去重/筛选/虚拟滚动区间/统计)"
```

---

## Task 5: 桌面端渲染层 — 数据加载编排

**Files:**
- Create: `local_skin_importer/src/renderer/src/composables/useSkinCatalog.ts`
- Create: `local_skin_importer/src/renderer/src/composables/__tests__/useSkinCatalog.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `local_skin_importer/src/renderer/src/composables/__tests__/useSkinCatalog.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCatalogCache, useSkinCatalog } from '../useSkinCatalog';

const api = {
  fetchSkins: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchMyOwned: vi.fn(),
  getAuthStatus: vi.fn()
};

function installApi(): void {
  (window as unknown as { api: unknown }).api = api;
}

function catalogResult(records: unknown[], skinIdFieldPresent = true) {
  return { total: records.length, records, skinIdFieldPresent };
}

const record = (id: number, skinId: number | null) => ({
  id,
  skinId,
  heroId: 7,
  heroName: '暗裔剑魔',
  name: `skin-${id}`,
  nameEn: `Skin ${id}`,
  rarity: '传说',
  priceRp: 3250,
  splashUrl: `splash-${id}.jpg`,
  iconUrl: `icon-${id}.jpg`
});

describe('useSkinCatalog', () => {
  beforeEach(() => {
    // 目录缓存是模块级的,用例之间必须清掉,否则第 N 个用例会命中第 1 个用例的缓存
    resetCatalogCache();
    installApi();
    api.fetchSkins.mockReset();
    api.fetchCatalog.mockReset();
    api.fetchMyOwned.mockReset();
    api.getAuthStatus.mockReset();
  });

  it('uses the live LCU list as the owned set', async () => {
    api.fetchSkins.mockResolvedValue({ summoner: { displayName: 'A', puuid: 'p' }, ownedSkinIds: [100, 200] });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100), record(2, 200), record(3, 300)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('lcu');
    expect(catalog.ownedReported.value).toBe(2);
    expect(catalog.stats.value.ownedMatched).toBe(2);
    expect(catalog.catalogSize.value).toBe(3);
  });

  it('falls back to the backend snapshot when the LCU is unavailable', async () => {
    api.fetchSkins.mockRejectedValue(new Error('League client is not running'));
    api.getAuthStatus.mockResolvedValue({ loggedIn: true, tokenPreview: 'jwt...' });
    api.fetchMyOwned.mockResolvedValue({ totalOwnedCount: 87, ownedSkinIds: [100] });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100), record(2, 200)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('backend');
    expect(catalog.ownedReported.value).toBe(87);
    expect(catalog.stats.value.ownedMatched).toBe(1);
    expect(catalog.stats.value.ownedMissingFromCatalog).toBe(86);
  });

  it('skips the backend call when the user is not logged in', async () => {
    api.fetchSkins.mockRejectedValue(new Error('League client is not running'));
    api.getAuthStatus.mockResolvedValue({ loggedIn: false, tokenPreview: null });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('none');
    expect(api.fetchMyOwned).not.toHaveBeenCalled();
    expect(catalog.ownedIds.value.size).toBe(0);
  });

  it('ends up with an empty owned set when every source fails', async () => {
    api.fetchSkins.mockRejectedValue(new Error('nope'));
    api.getAuthStatus.mockRejectedValue(new Error('nope'));
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.ownedSource.value).toBe('none');
    expect(catalog.ownedIds.value.size).toBe(0);
  });

  it('surfaces the catalog error and keeps the message', async () => {
    api.fetchSkins.mockResolvedValue({ summoner: { displayName: 'A', puuid: 'p' }, ownedSkinIds: [] });
    api.fetchCatalog.mockRejectedValue(new Error('服务端响应超时'));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.error.value).toBe('服务端响应超时');
  });

  it('deduplicates the catalog by skin id', async () => {
    api.fetchSkins.mockResolvedValue({ summoner: { displayName: 'A', puuid: 'p' }, ownedSkinIds: [100] });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, 100), record(2, 100), record(3, null)]));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.catalogSize.value).toBe(2);
  });

  it('exposes whether the backend returned the skinId field', async () => {
    api.fetchSkins.mockResolvedValue({ summoner: { displayName: 'A', puuid: 'p' }, ownedSkinIds: [] });
    api.fetchCatalog.mockResolvedValue(catalogResult([record(1, null)], false));

    const catalog = useSkinCatalog();
    await catalog.load();

    expect(catalog.skinIdFieldPresent.value).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/composables/__tests__/useSkinCatalog.test.ts
```

Expected: FAIL —— `Failed to resolve import "../useSkinCatalog"`。

- [ ] **Step 3: 实现 `src/renderer/src/composables/useSkinCatalog.ts`**

```ts
import { computed, ref, shallowRef } from 'vue';
import type { CatalogResult, CatalogSkin, OwnedSnapshot } from '../../../preload/index';
import { computeStats, dedupeBySkinId } from './skinCatalogLogic';

export type OwnedSource = 'lcu' | 'backend' | 'none';

interface CachedCatalog {
  total: number;
  records: CatalogSkin[];
  skinIdFieldPresent: boolean;
}

/** 目录在会话内缓存:1.2 万条 JSON 有几 MB,每次开弹窗重拉太浪费。 */
let catalogCache: CachedCatalog | null = null;

/** 清掉模块级缓存。测试用它隔离用例之间;线上目前没有调用点。 */
export function resetCatalogCache(): void {
  catalogCache = null;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useSkinCatalog() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const skins = shallowRef<CatalogSkin[]>([]);
  const ownedIds = shallowRef<Set<number>>(new Set());
  const ownedSource = ref<OwnedSource>('none');
  const ownedReported = ref(0);
  const skinIdFieldPresent = ref(true);

  const catalogSize = computed(() => skins.value.length);
  const stats = computed(() =>
    computeStats(skins.value, ownedIds.value, ownedReported.value)
  );

  function applyCatalog(result: CatalogResult): void {
    catalogCache = {
      total: result.total,
      records: result.records,
      skinIdFieldPresent: result.skinIdFieldPresent
    };
    skins.value = dedupeBySkinId(result.records);
    skinIdFieldPresent.value = result.skinIdFieldPresent;
  }

  /** 三级降级:实时 LCU → 后端已同步快照 → 空集。 */
  async function loadOwned(): Promise<void> {
    try {
      const r = await window.api.fetchSkins();
      ownedIds.value = new Set(r.ownedSkinIds);
      ownedReported.value = r.ownedSkinIds.length;
      ownedSource.value = 'lcu';
      return;
    } catch {
      // 继续降级
    }

    try {
      const status = await window.api.getAuthStatus();
      if (!status.loggedIn) throw new Error('未登录');
      const snap: OwnedSnapshot = await window.api.fetchMyOwned();
      ownedIds.value = new Set(snap.ownedSkinIds);
      ownedReported.value = snap.totalOwnedCount;
      ownedSource.value = 'backend';
      return;
    } catch {
      // 继续降级
    }

    ownedIds.value = new Set();
    ownedReported.value = 0;
    ownedSource.value = 'none';
  }

  /** 后台静默刷新:失败保留旧数据,不报错。 */
  async function refreshCatalog(): Promise<void> {
    try {
      applyCatalog(await window.api.fetchCatalog());
    } catch {
      // 静默失败
    }
  }

  async function load(opts: { force?: boolean } = {}): Promise<void> {
    const force = opts.force === true;
    error.value = null;

    const cached = catalogCache;
    if (cached && !force) {
      applyCatalog(cached);
    } else {
      loading.value = true;
    }

    const catalogPromise =
      force || !cached
        ? window.api
            .fetchCatalog()
            .then((r) => {
              applyCatalog(r);
            })
            .catch((e: unknown) => {
              error.value = describeError(e);
            })
        : refreshCatalog();

    await Promise.all([loadOwned(), catalogPromise]);
    loading.value = false;
  }

  return {
    loading,
    error,
    skins,
    ownedIds,
    ownedSource,
    ownedReported,
    skinIdFieldPresent,
    catalogSize,
    stats,
    load
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/composables/__tests__/useSkinCatalog.test.ts
```

Expected: 全部 passed。

- [ ] **Step 5: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/composables/useSkinCatalog.ts src/renderer/src/composables/__tests__/useSkinCatalog.test.ts
git commit -m "feat: 皮肤目录数据层(实时 LCU + 后端快照降级 + 会话缓存)"
```

---

## Task 6: 桌面端 — `SkinCard.vue`

**Files:**
- Create: `local_skin_importer/src/renderer/src/components/SkinCard.vue`
- Create: `local_skin_importer/src/renderer/src/components/__tests__/SkinCard.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `local_skin_importer/src/renderer/src/components/__tests__/SkinCard.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SkinCard from '../SkinCard.vue';
import type { CatalogSkin } from '../../../../preload/index';

const skin: CatalogSkin = {
  id: 1,
  skinId: 161013,
  heroId: 7,
  heroName: '暗裔剑魔',
  name: '冠军猩红',
  nameEn: 'Ashen Knight',
  rarity: '传说',
  priceRp: 3250,
  splashUrl: 'splash.jpg',
  iconUrl: 'icon.jpg'
};

describe('SkinCard', () => {
  it('renders the owned skin without a mask', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    expect(wrapper.classes()).toContain('is-owned');
    expect(wrapper.find('.mask').exists()).toBe(false);
    expect(wrapper.find('.lock-badge').exists()).toBe(false);
  });

  it('renders the unowned skin with a grayscale mask and a badge', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: false, visible: true }
    });

    expect(wrapper.classes()).toContain('is-locked');
    expect(wrapper.find('.mask').exists()).toBe(true);
    expect(wrapper.find('.lock-badge').exists()).toBe(true);
  });

  it('shows the skin name, hero and rarity', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    expect(wrapper.find('.name').text()).toBe('冠军猩红');
    expect(wrapper.find('.sub').text()).toContain('暗裔剑魔');
    expect(wrapper.find('.sub').text()).toContain('传说');
  });

  it('does not load the image until it becomes visible', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: false }
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.thumb-placeholder').exists()).toBe(true);
  });

  it('emits select when clicked', async () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    await wrapper.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([skin]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/components/__tests__/SkinCard.test.ts
```

Expected: FAIL —— `Failed to resolve import "../SkinCard.vue"`。

- [ ] **Step 3: 实现 `src/renderer/src/components/SkinCard.vue`**

```vue
<template>
  <div
    class="skin-card"
    :class="owned ? 'is-owned' : 'is-locked'"
    role="button"
    tabindex="0"
    @click="emit('select', skin)"
  >
    <div class="thumb">
      <img
        v-if="visible && iconSrc && !imgFailed"
        :src="iconSrc"
        alt=""
        @error="imgFailed = true"
      />
      <div v-else class="thumb-placeholder" />
      <div v-if="!owned" class="mask" />
      <span v-if="!owned" class="lock-badge">未拥有</span>
    </div>
    <div class="meta">
      <div class="name" :title="skin.name ?? ''">{{ skin.name ?? '—' }}</div>
      <div class="sub">{{ skin.heroName ?? '未知英雄' }} · {{ skin.rarity ?? '—' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CatalogSkin } from '../../../preload/index';

const props = defineProps<{
  skin: CatalogSkin;
  owned: boolean;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', skin: CatalogSkin): void;
}>();

// 收敛成 string,模板里就不用再处理 null
const iconSrc = computed(() => props.skin.iconUrl ?? '');

const imgFailed = ref(false);

watch(
  () => props.skin.iconUrl,
  () => {
    imgFailed.value = false;
  }
);
</script>

<style scoped>
.skin-card {
  width: 132px;
  cursor: pointer;
  user-select: none;
}
.thumb {
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: 6px;
  overflow: hidden;
  background: #2b2b31;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-placeholder {
  width: 100%;
  height: 100%;
  background: #2b2b31;
}
.is-locked .thumb img {
  filter: grayscale(1) brightness(0.55);
}
.mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}
.lock-badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}
.meta {
  padding-top: 4px;
}
.name {
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npx vitest run src/renderer/src/components/__tests__/SkinCard.test.ts
```

Expected: 全部 passed。

- [ ] **Step 5: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/components/SkinCard.vue src/renderer/src/components/__tests__/SkinCard.test.ts
git commit -m "feat: 皮肤卡片(已拥有彩色 / 未拥有灰度遮罩)"
```

---

## Task 7: 桌面端 — `SkinGrid.vue` 虚拟滚动网格

**Files:**
- Create: `local_skin_importer/src/renderer/src/components/SkinGrid.vue`

> 这一步没有单独的纯函数要测(区间计算在 Task 4 已经测过),组件本身是薄壳,所以直接实现 + 靠 Task 11 的手工验收验证。

- [ ] **Step 1: 实现 `src/renderer/src/components/SkinGrid.vue`**

```vue
<template>
  <div ref="viewportRef" class="skin-grid-viewport" @scroll="onScroll">
    <div class="skin-grid-spacer" :style="{ height: `${totalHeight}px` }">
      <div
        class="skin-grid-slice"
        :style="{
          gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`,
          transform: `translateY(${offsetY}px)`
        }"
      >
        <SkinCard
          v-for="item in visibleItems"
          :key="item.key"
          :skin="item.skin"
          :owned="item.owned"
          :visible="true"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import SkinCard from './SkinCard.vue';
import type { CatalogSkin } from '../../../preload/index';
import { computeVisibleRange } from '../composables/skinCatalogLogic';

const CARD_W = 132;
const CARD_H = 176;
const GAP = 12;
const ROW_H = CARD_H + GAP;

const props = defineProps<{
  skins: CatalogSkin[];
  ownedIds: Set<number>;
}>();

const emit = defineEmits<{
  (e: 'select', skin: CatalogSkin): void;
}>();

const viewportRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const containerWidth = ref(0);

const cols = computed(() =>
  Math.max(1, Math.floor((containerWidth.value + GAP) / (CARD_W + GAP)))
);
const totalHeight = computed(
  () => Math.ceil(props.skins.length / cols.value) * ROW_H
);
const range = computed(() =>
  computeVisibleRange(
    scrollTop.value,
    viewportHeight.value,
    ROW_H,
    cols.value,
    props.skins.length
  )
);
const offsetY = computed(() => Math.floor(range.value.startIndex / cols.value) * ROW_H);

const visibleItems = computed(() =>
  props.skins.slice(range.value.startIndex, range.value.endIndex).map((skin) => ({
    key: `${skin.id}-${skin.skinId ?? 'x'}`,
    skin,
    owned: skin.skinId != null && props.ownedIds.has(skin.skinId)
  }))
);

function onScroll(e: Event): void {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}

function onSelect(skin: CatalogSkin): void {
  emit('select', skin);
}

let resizeObserver: ResizeObserver | null = null;

function measure(): void {
  const el = viewportRef.value;
  if (!el) return;
  containerWidth.value = el.clientWidth;
  viewportHeight.value = el.clientHeight;
}

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(() => measure());
  if (viewportRef.value) resizeObserver.observe(viewportRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.skin-grid-viewport {
  height: 100%;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}
.skin-grid-spacer {
  position: relative;
  width: 100%;
}
.skin-grid-slice {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  /* 列模板由内联 style 提供:repeat() 的计数参数不接受 var(),
     写成 repeat(var(--cols), 132px) 会让整条声明失效、网格塌成一列 */
  gap: 12px;
  justify-content: start;
}
</style>
```

关键点:
- 列宽**固定 132px**(不是 `1fr`),否则图片高度会随宽度变化,固定行高的虚拟滚动就失效了
- `offsetY` 用 `Math.floor(startIndex / cols) * ROW_H`,保证切片第一张卡落在第 0 列
- `visible` 恒传 `true`:虚拟滚动已经把 DOM 限制在可见切片内,不需要额外的图片懒加载观察器

- [ ] **Step 2: typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run typecheck
```

Expected: 无报错。

- [ ] **Step 3: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/components/SkinGrid.vue
git commit -m "feat: 固定行高虚拟滚动皮肤网格"
```

---

## Task 8: 桌面端 — `SkinDetailDialog.vue`

**Files:**
- Create: `local_skin_importer/src/renderer/src/components/SkinDetailDialog.vue`

- [ ] **Step 1: 实现 `src/renderer/src/components/SkinDetailDialog.vue`**

```vue
<template>
  <el-dialog
    :model-value="modelValue"
    title="皮肤详情"
    width="520px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="skin" class="skin-detail">
      <div class="detail-art">
        <img :src="artUrl" alt="" class="art-img" :class="{ 'is-locked': !owned }" />
        <div v-if="!owned" class="art-mask" />
      </div>
      <div class="detail-meta">
        <div class="detail-name">{{ skin.name ?? '—' }}</div>
        <div class="detail-en">{{ skin.nameEn ?? '—' }}</div>
        <div class="detail-row">
          <span class="detail-label">英雄</span>
          <span>{{ skin.heroName ?? '未知英雄' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">稀有度</span>
          <span>{{ skin.rarity ?? '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">价格</span>
          <span>{{ skin.priceRp != null ? `${skin.priceRp} RP` : '—' }}</span>
        </div>
        <el-tag :type="owned ? 'success' : 'info'" class="detail-tag">
          {{ owned ? '已拥有' : '未拥有' }}
        </el-tag>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogSkin } from '../../../preload/index';

const props = defineProps<{
  modelValue: boolean;
  skin: CatalogSkin | null;
  owned: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const artUrl = computed(() => props.skin?.splashUrl ?? props.skin?.iconUrl ?? '');
</script>

<style scoped>
.skin-detail {
  display: flex;
  gap: 16px;
}
.detail-art {
  position: relative;
  width: 240px;
  height: 320px;
  border-radius: 6px;
  overflow: hidden;
  background: #2b2b31;
  flex-shrink: 0;
}
.art-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.art-img.is-locked {
  filter: grayscale(1) brightness(0.55);
}
.art-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}
.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
}
.detail-en {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.detail-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
}
.detail-label {
  width: 40px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.detail-tag {
  align-self: flex-start;
  margin-top: 8px;
}
</style>
```

- [ ] **Step 2: typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run typecheck
```

Expected: 无报错。

- [ ] **Step 3: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/components/SkinDetailDialog.vue
git commit -m "feat: 皮肤原画详情弹层"
```

---

## Task 9: 桌面端 — `SkinOverviewDialog.vue` 容器

**Files:**
- Create: `local_skin_importer/src/renderer/src/components/SkinOverviewDialog.vue`

- [ ] **Step 1: 实现 `src/renderer/src/components/SkinOverviewDialog.vue`**

```vue
<template>
  <el-dialog
    v-model="visible"
    title="皮肤总览"
    width="94%"
    top="3vh"
    destroy-on-close
    class="skin-overview-dialog"
    @open="onOpen"
  >
    <div class="overview">
      <div class="overview-header">
        <div class="overview-stats">
          <span class="stat-main">
            已拥有 {{ stats.ownedMatched }} / {{ catalogSize }}
          </span>
          <span class="stat-sub">{{ ownedSourceText }}</span>
          <span v-if="stats.ownedMissingFromCatalog > 0" class="stat-sub">
            {{ stats.ownedMissingFromCatalog }} 件目录未收录
          </span>
        </div>
        <div class="overview-filters">
          <el-input
            v-model="filters.keyword"
            placeholder="搜索皮肤名 / 英雄名"
            clearable
            class="filter-search"
          />
          <el-select v-model="filters.heroId" placeholder="全部英雄" clearable class="filter-select">
            <el-option v-for="h in heroOptions" :key="h.heroId" :label="h.heroName" :value="h.heroId" />
          </el-select>
          <el-select v-model="filters.rarity" placeholder="全部稀有度" clearable class="filter-select">
            <el-option v-for="r in rarityOptions" :key="r" :label="r" :value="r" />
          </el-select>
          <el-checkbox v-model="filters.onlyUnowned">只看未拥有</el-checkbox>
        </div>
      </div>

      <el-alert
        v-if="!skinIdFieldPresent"
        type="error"
        show-icon
        :closable="false"
        title="服务端版本过低,未返回皮肤 ID,无法比对已拥有状态"
        class="overview-alert"
      />
      <el-alert
        v-else-if="stats.skinIdCoverage < 0.5"
        type="warning"
        show-icon
        :closable="false"
        :title="`部分皮肤缺少 ID(覆盖率 ${Math.round(stats.skinIdCoverage * 100)}%),这些皮肤无法比对拥有状态`"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'none'"
        type="warning"
        show-icon
        :closable="false"
        title="未能获取已拥有皮肤,当前全部按未拥有显示"
        class="overview-alert"
      />
      <el-alert
        v-else-if="ownedSource === 'backend'"
        type="info"
        show-icon
        :closable="false"
        title="数据来自上次同步"
        class="overview-alert"
      />

      <div v-if="loading && catalogSize === 0" class="overview-loading">正在加载皮肤目录…</div>
      <div v-else-if="error" class="overview-error">
        <p>{{ error }}</p>
        <el-button type="primary" @click="reload">重试</el-button>
      </div>
      <SkinGrid
        v-else
        :skins="filteredSkins"
        :owned-ids="ownedIds"
        class="overview-grid"
        @select="openDetail"
      />

      <div class="overview-footer">
        <el-button size="small" :loading="loading" @click="reload">刷新目录</el-button>
        <span class="footer-count">共 {{ filteredSkins.length }} 件</span>
      </div>
    </div>

    <SkinDetailDialog v-model="detailVisible" :skin="selectedSkin" :owned="selectedOwned" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue';
import SkinDetailDialog from './SkinDetailDialog.vue';
import SkinGrid from './SkinGrid.vue';
import type { CatalogSkin } from '../../../preload/index';
import { filterSkins, isOwned } from '../composables/skinCatalogLogic';
import { useSkinCatalog } from '../composables/useSkinCatalog';

const visible = ref(false);
const detailVisible = ref(false);
const selectedSkin = shallowRef<CatalogSkin | null>(null);

const filters = reactive({
  keyword: '',
  heroId: null as number | null,
  rarity: null as string | null,
  onlyUnowned: false
});

const {
  loading,
  error,
  skins,
  ownedIds,
  ownedSource,
  skinIdFieldPresent,
  catalogSize,
  stats,
  load
} = useSkinCatalog();

const filteredSkins = computed(() =>
  filterSkins(skins.value, ownedIds.value, {
    keyword: filters.keyword,
    heroId: filters.heroId,
    rarity: filters.rarity,
    onlyUnowned: filters.onlyUnowned
  })
);

const heroOptions = computed(() => {
  const map = new Map<number, string>();
  for (const s of skins.value) {
    if (s.heroId != null && !map.has(s.heroId)) map.set(s.heroId, s.heroName ?? '未知英雄');
  }
  return [...map.entries()].map(([heroId, heroName]) => ({ heroId, heroName }));
});

const rarityOptions = computed(() => {
  const set = new Set<string>();
  for (const s of skins.value) {
    if (s.rarity) set.add(s.rarity);
  }
  return [...set].sort();
});

const ownedSourceText = computed(() => {
  if (ownedSource.value === 'lcu') return 'LCU 实时数据';
  if (ownedSource.value === 'backend') return '数据来自上次同步';
  return '未能获取已拥有皮肤';
});

const selectedOwned = computed(() =>
  selectedSkin.value ? isOwned(selectedSkin.value, ownedIds.value) : false
);

async function onOpen(): Promise<void> {
  await load();
}

async function reload(): Promise<void> {
  filters.keyword = '';
  filters.heroId = null;
  filters.rarity = null;
  filters.onlyUnowned = false;
  await load({ force: true });
}

function openDetail(skin: CatalogSkin): void {
  selectedSkin.value = skin;
  detailVisible.value = true;
}

function open(): void {
  visible.value = true;
}

defineExpose({ open });
</script>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(94vh - 200px);
}
.overview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.overview-stats {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.stat-main {
  font-size: 18px;
  font-weight: 600;
}
.stat-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.overview-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.filter-search {
  width: 220px;
}
.filter-select {
  width: 150px;
}
.overview-alert {
  margin: 0;
}
.overview-loading,
.overview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
}
.overview-grid {
  flex: 1;
  min-height: 0;
}
.overview-footer {
  display: flex;
  align-items: center;
  gap: 12px;
}
.footer-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

<style>
/* el-dialog 的 body 默认 overflow:auto,会和网格的内层滚动区打架(双滚动条) */
.skin-overview-dialog .el-dialog__body {
  overflow: hidden;
  padding: 12px 16px;
}
</style>
```

> 最后那段是**非 scoped** 的全局样式,必须写在一个独立的 `<style>` 块里(scoped 的话选择器命中不了 `el-dialog` 挂在 body 下的弹层)。

- [ ] **Step 2: typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run typecheck
```

Expected: 无报错。

- [ ] **Step 3: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/components/SkinOverviewDialog.vue
git commit -m "feat: 皮肤总览弹窗(统计条/筛选栏/虚拟网格/降级提示)"
```

---

## Task 10: 桌面端 — `Sync.vue` 加入口

**Files:**
- Modify: `local_skin_importer/src/renderer/src/views/Sync.vue`

- [ ] **Step 1: 改模板**

在 `Owned skins` 那张 `el-card` 之后、同步卡片之前插入:

```vue
    <el-card class="overview-card" shadow="never">
      <div class="overview-row">
        <div class="overview-info">
          <span class="overview-label">皮肤总览</span>
          <span class="overview-meta">查看全量皮肤目录,已拥有的高亮显示,未拥有的置灰</span>
        </div>
        <div class="overview-actions">
          <el-button type="primary" plain @click="openOverview">打开皮肤总览</el-button>
        </div>
      </div>
    </el-card>
```

- [ ] **Step 2: 改 script**

加 import:

```ts
import SkinOverviewDialog from '../components/SkinOverviewDialog.vue';
```

在 `<script setup>` 里加:

```ts
const overviewRef = ref<InstanceType<typeof SkinOverviewDialog> | null>(null);

function openOverview(): void {
  overviewRef.value?.open();
}
```

在模板的 `</div>` 之前(`</template>` 之内)加:

```vue
    <SkinOverviewDialog ref="overviewRef" />
```

> `SkinOverviewDialog` 内部自己管 `visible`,通过 `defineExpose({ open })` 暴露打开方法(Task 9 已实现)。父组件用 `ref` 调 `open()`,不要写 `v-model` —— 弹窗没有 `modelValue` prop,`v-model` 会不生效。

- [ ] **Step 3: 加样式**

在 `Sync.vue` 的 `<style scoped>` 里加:

```css
.overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.overview-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.overview-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.overview-meta {
  font-size: 14px;
}
```

- [ ] **Step 4: typecheck + 跑全部测试**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run typecheck
npm run test
```

Expected: 全部通过。

- [ ] **Step 5: 提交(建议由你手动执行)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
git add src/renderer/src/views/Sync.vue
git commit -m "feat: Sync 页新增皮肤总览入口"
```

---

## Task 11: 全量校验与打包

**Files:** 无(只跑命令)

- [ ] **Step 1: 桌面端跑全部单测**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run test
```

Expected: 全部 passed,0 failed。

- [ ] **Step 2: 桌面端 typecheck**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run typecheck
```

Expected: 无报错。

- [ ] **Step 3: 桌面端构建**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run build
```

Expected: 三个 bundle(main / preload / renderer)都产出,无 error。

- [ ] **Step 4: 后端跑 skin 模块测试**

```bash
cd D:/Code/Front_Project/all/all_function_api
mvn -pl skin -am -Dmaven.test.skip=false test
```

Expected: BUILD SUCCESS。

- [ ] **Step 5: 手工验收(开发模式)**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run dev
```

逐条确认:

| # | 操作 | 期望 |
|---|---|---|
| 1 | 打开「皮肤总览」 | 首次有 loading,几秒后出网格;顶部显示「已拥有 N / 12,xxx」 |
| 2 | 滚动网格 | 一直能滚到底,网格区 DOM 节点数稳定在百级(DevTools 里数 `.skin-card`) |
| 3 | 网格里已拥有的皮肤 | 彩色,无遮罩无角标 |
| 4 | 网格里未拥有的皮肤 | 灰度 + 半透明黑遮罩 + 「未拥有」角标 |
| 5 | 点一张卡片 | 弹出详情层,原画正常,已拥有彩色 / 未拥有置灰 |
| 6 | 搜「暗裔剑魔」 | 只剩该英雄的皮肤 |
| 7 | 勾「只看未拥有」 | 只剩没拥有的 |
| 8 | 改完筛选再滚 | 网格回到顶部,没有空白区 |
| 9 | 关掉游戏客户端再开弹窗 | 顶部提示「数据来自上次同步」(已登录)或「未能获取已拥有皮肤」(未登录) |
| 10 | 退出登录再开弹窗 | 顶部黄条提示,没有请求发出 |

- [ ] **Step 6: 验证「服务端版本过低」分支**

不用真去找一个旧后端。临时把 `src/main/catalog.ts` 里这行:

```ts
  const skinIdFieldPresent =
    raw.length > 0 && Object.prototype.hasOwnProperty.call(raw[0], 'skinId');
```

改成硬编码 `false`,重启 `npm run dev`,打开弹窗。

Expected: 顶部**红条**「服务端版本过低,未返回皮肤 ID,无法比对已拥有状态」,网格照常展示但全部按未拥有渲染。

验证完**必须改回来**(这行是临时的,不要提交)。

- [ ] **Step 7: 打包**

```bash
cd D:/Code/Front_Project/all/local_skin_importer
npm run pack
```

Expected: `release/0.1.0/LOL Skin Importer-0.1.0-x64.exe` 产出。

> 国内网络下 electron 二进制可能拉不动,先设镜像:
> ```bash
> export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> npm run pack
> ```
> PowerShell 用 `$env:ELECTRON_MIRROR="..."`。

---

## 完成标准

- [ ] 后端 `SkinVO` 有 `skinId`,`listSkins` 返回的 VO 带该字段,`convertToVOList` 只查一次英雄
- [ ] 后端 `SkinServiceImplTest` 3 个用例通过
- [ ] 桌面端 `catalog.ts` 的 8 个用例通过
- [ ] `ipc.test.ts` 更新为 8 个 channel 且全绿
- [ ] `skinCatalogLogic` 的 19 个用例通过
- [ ] `useSkinCatalog` 的 7 个用例通过
- [ ] `SkinCard` 的 5 个用例通过
- [ ] `npm run test` / `npm run typecheck` / `npm run build` 全绿
- [ ] 手工验收表 10 条全部符合
- [ ] 打包产出 exe
