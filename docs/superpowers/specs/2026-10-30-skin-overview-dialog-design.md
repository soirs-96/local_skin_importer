# 桌面端「皮肤总览」弹窗 — 设计文档

- 日期: 2026-10-30
- 涉及仓库: `D:\Code\Front_Project\all\local_skin_importer`(Electron 桌面端)、`D:\Code\Front_Project\all\all_function_api`(后端)
- 状态: 已确认设计 + 自评审修订,待实施

---

## 1. 目标

在桌面端新增一个「皮肤总览」弹窗:

1. 从后端拉取**全量皮肤目录**(约 1.2 万条,`t_skin` 中 `is_active = 1`)
2. 与**本地 LCU 拉到的已拥有皮肤**做比对
3. 已拥有的皮肤显示**原图彩色**;未拥有的皮肤预览图加**灰度遮罩层**

用户动机: 想一眼看清"我有什么 / 缺什么",为收集进度提供可视化。

### 非目标

- 不做皮肤的评分、收藏、评论等社交功能
- 不做皮肤的购买/获取入口
- 不改动现有「同步到后端」链路的语义,只新增一条只读目录查询链路

---

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 匹配口径 | 后端 `SkinVO` 增加 `skinId` 字段(= 游戏内皮肤 ID,与 LCU `itemId` 同口径) |
| 展示形态 | 全局网格 + 顶部筛选栏 + 无限滚动 |
| 网格用图 | `iconUrl` 方形小图,点击卡片在二级层看 `splashUrl` 原画 |
| 「已拥有」来源 | 实时 LCU;失败降级到后端已同步数据;再失败则明确提示 |
| 入口 | Sync 页加按钮 → 弹窗(不新增路由) |
| 渲染策略 | 全量拉取 + 前端本地筛选 + 自实现固定行高虚拟滚动 |

---

## 3. 后端契约改动(`all_function_api`)

### 3.1 `SkinVO` 新增字段

文件: `skin/src/main/java/com/lolskin/skin/vo/SkinVO.java`

```java
/**
 * 游戏内皮肤ID(与 LCU itemId 同口径)
 */
private Integer skinId;
```

`Skin` 实体(`@TableName("t_skin")`)已存在 `private Integer skinId;`,且 `SkinServiceImpl.convertToVO` 使用 `BeanUtils.copyProperties(skin, vo)`,因此**无需修改任何映射代码**,加字段即生效。

Spring Boot 的 Jackson 默认序列化 null 字段,因此新后端返回的每条记录都会带 `"skinId": null` 或 `"skinId": 161013`;旧后端的响应里**完全没有 `skinId` 这个 key**。这是 §4.3 版本检测的依据。

### 3.2 消除 `convertToVO` 的 N+1

现状(`SkinServiceImpl.convertToVO`):每条皮肤都执行一次 `heroMapper.selectById(skin.getHeroId())`。全量拉取 1.2 万条 → 1.2 万次单行查询,响应时间不可接受。

改法:新增批量转换方法,一次 `selectBatchIds` 取回全部英雄,建 Map 后复用。

```java
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

`listSkins` 中的转换调用改为:

```java
List<SkinVO> records = convertToVOList(skinPage.getRecords());
```

`getSkinDetail` 走单条路径,保留原有 `convertToDetailVO` 实现不变。

### 3.3 后端接口现状(无需改动,仅确认)

| 接口 | 鉴权 | 返回 | 用途 |
|---|---|---|---|
| `GET /api/skins/list?current&size&heroId&rarity&keyword` | 公开 | `Result<PageResult<SkinVO>>` | 拉全量目录 |
| `GET /api/skins/my-owned` | 需要 `Authorization: Bearer <userToken>` | `Result<PlayerSkinStatusVO>` | 降级路径取已拥有集合 |

- `RoleInterceptor` 只对带 `@RequiresRole` 的方法生效,`SkinController.listSkins` 无该注解 → `/skins/list` 公开可访问。
- `/skins/my-owned` 通过 `Authorization` 头里的用户 JWT 取 `userId`,桌面端已有该 token(`auth:login` 兑换码登录后存入主进程,`src/main/auth.ts` 的 `getStoredToken()`)。
- `Result` 信封字段为 `{ code, message, data, timestamp }`。
- `PageResult` 结构为 `{ current, size, total, pages, records[] }`。
- `MybatisPlusConfig` 注册了 `PaginationInnerInterceptor(DbType.MYSQL)` 且**未设 `maxLimit`**,所以 `size=20000` 不会被拦截器截断。

### 3.4 皮肤 ID 口径(已验证,不是风险)

`PlayerSkinStatusAssembler.assemble` 里,已拥有集合 `ownedIds` 直接与 `t_skin.skin_id` 比对:

```java
Map<Integer, Skin> skinMap = allActive.stream()
        .collect(Collectors.toMap(Skin::getSkinId, s -> s, (a, b) -> a));
```

`ownedIds` 的来源正是桌面端上传的 LCU `itemId`。生产小程序「拥有/未拥有」功能依赖这条链路,说明两个 ID 空间一致。

### 3.5 目录中存在重复 `skinId`(必须在桌面端去重)

上一段代码里的 `(a, b) -> a` 合并函数说明:`t_skin` 中同一个 `skin_id` 可能有**多行**(如同一皮肤出现在多个系列下)。这带来两个后果:

1. 网格里会出现重复卡片
2. 「已拥有数量」会被重复计数

处理:桌面端在建立目录索引时按 `skinId` 去重(见 §4.3),后端**不做**去重(去重是展示层职责,后端保持原样返回,不影响既有调用方)。

---

## 4. 桌面端架构

### 4.1 目录与职责

```
src/main/catalog.ts                              主进程:拉全量目录 + 拉后端已拥有快照
src/main/ipc.ts                                  新增 IPC channel: catalog:fetch-all / catalog:fetch-owned
src/preload/index.ts                             新增类型化桥接: fetchCatalog() / fetchMyOwned()
src/renderer/src/composables/useSkinCatalog.ts   拉数据 + 建索引 + 已拥有集合(三级降级) + 目录模块级缓存
src/renderer/src/components/SkinOverviewDialog.vue  弹窗容器:数据加载 + 筛选状态 + 布局
src/renderer/src/components/SkinGrid.vue          虚拟滚动网格(纯展示)
src/renderer/src/components/SkinCard.vue          单个皮肤卡片
src/renderer/src/components/SkinDetailDialog.vue  原画详情层
src/renderer/src/views/Sync.vue                  新增入口卡片 + 按钮
```

沿用现有分层约定:**所有 HTTP 走主进程 axios**(`src/main/backend.ts` 已有 `BACKEND_BASE_URL = 'http://101.34.210.254'`),渲染层只通过 preload 的 `contextBridge` 桥调用。

### 4.2 主进程

`src/main/catalog.ts`:

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
  /** 响应里是否存在 `skinId` 这个 key。false = 后端未升级,无法比对已拥有状态 */
  skinIdFieldPresent: boolean;
}
```

`fetchCatalog()` 实现要点:

1. GET `${BACKEND_BASE_URL}/api/skins/list?current=1&size=20000`,timeout 60s
2. 解析 `Result` 信封:`code !== 200` 时把 `message` 抛成 `Error`
3. **在映射成 `CatalogSkin` 之前**,检查原始 JSON 的第一条记录是否含 `skinId` key:
   ```ts
   const raw = data.data.records as Record<string, unknown>[];
   const skinIdFieldPresent = raw.length > 0
     && Object.prototype.hasOwnProperty.call(raw[0], 'skinId');
   ```
   (取第一条即可:新旧版本对所有记录的字段处理一致)
4. **完整性校验**:若 `records.length < total`,说明后端截断了结果 → 用 `size=2000` 分页补拉剩余页并合并。正常情况下 12,670 < 20,000,不会触发。

`fetchMyOwned()` 实现要点:

- 从 `src/main/auth.ts` 的 `getStoredToken()` 取 token
- **无 token 时直接抛错**,不发请求(渲染层据此进入第 3 级降级)
- GET `${BACKEND_BASE_URL}/api/skins/my-owned`,带 `Authorization: Bearer <token>`,timeout 30s
- 返回 `PlayerSkinStatusVO` 的精简形状:
  ```ts
  export interface OwnedSnapshot {
    /** 已同步到后端的已拥有总数(含目录未收录的) */
    totalOwnedCount: number;
    /** 已拥有且目录里有对应行的 skinId 列表 */
    ownedSkinIds: number[];
  }
  ```

`src/main/ipc.ts` 新增两个 channel:

```ts
ipcMain.handle('catalog:fetch-all', async (): Promise<CatalogResult> => fetchCatalog());
ipcMain.handle('catalog:fetch-owned', async (): Promise<OwnedSnapshot> => fetchMyOwned());
```

`src/preload/index.ts` 新增 `fetchCatalog()` / `fetchMyOwned()` 并挂到 `window.api`。

### 4.3 渲染层数据层 `useSkinCatalog.ts`

职责:并发拉「目录」和「已拥有集合」,产出可直接渲染的视图模型。

```ts
export type OwnedSource = 'lcu' | 'backend' | 'none';

export interface SkinCatalogState {
  loading: boolean;
  error: string | null;
  catalogSize: number;            // 去重后的目录条数 = 界面上的分母
  backendTotal: number;           // 后端返回的 total,仅用于校验结果是否被截断
  skins: CatalogSkin[];           // 目录(已按 skinId 去重)
  ownedIds: Set<number>;          // 已拥有的游戏内皮肤ID
  ownedSource: OwnedSource;
  ownedMatched: number;           // 目录中实际被标为「已拥有」的皮肤件数(去重后)
  ownedReported: number;          // LCU / 后端报告的已拥有总数
  ownedMissingFromCatalog: number;
  skinIdFieldPresent: boolean;    // 后端是否返回了 skinId 字段
  skinIdCoverage: number;         // 去重后目录中 skinId 非空的比例,0~1
}
```

**分母口径**:界面上「已拥有 X / Y」的 **Y 必须用 `catalogSize`(去重后的目录条数)**,不能用后端的 `total`。`total` 是去重前的行数(§3.5 说同一 `skin_id` 可能有多行),用它做分母会出现「Y 比网格里实际能看到的卡片多」的不一致。`backendTotal` 只在主进程里用于校验 `records.length < total` 时分页补拉,不进界面。

**目录去重**(§3.5):

```ts
export function dedupeBySkinId(records: CatalogSkin[]): CatalogSkin[] {
  const seen = new Set<number>();
  const out: CatalogSkin[] = [];
  for (const r of records) {
    if (r.skinId == null) { out.push(r); continue; }  // 无 ID 的行无法去重,原样保留
    if (seen.has(r.skinId)) continue;
    seen.add(r.skinId);
    out.push(r);
  }
  return out;
}
```

**已拥有集合的三级降级**:

| 级别 | 来源 | `ownedSource` | `ownedReported` | `ownedIds` |
|---|---|---|---|---|
| 1 | `window.api.fetchSkins()` → LCU `ownedSkinIds` | `'lcu'` | `ownedSkinIds.length` | LCU 全集 |
| 2 | `window.api.fetchMyOwned()` → `GET /skins/my-owned` | `'backend'` | `totalOwnedCount` | `ownedSkinIds`(仅目录内收录的) |
| 3 | 都失败 | `'none'` | `0` | 空集 |

第 1 级的 `ownedSkinIds.length` 是全部已拥有(含目录未收录的),直接作为 `ownedReported`。

第 2 级的两个数来自不同字段,不能混用:`totalOwnedCount` 是 `t_user_skin` 里的总数(含目录未收录的),`ownedSkinIds` 是其中**目录里有对应行**的部分。混用会让界面上标彩色的数量和「已拥有」总数对不上。

第 2 级进入前先查 `window.api.getAuthStatus()`:`loggedIn === false` 就**直接跳到第 3 级**,不发起 `fetchMyOwned` 调用(主进程 `fetchMyOwned` 在 `getStoredToken()` 返回 null 时也会直接抛错,双保险)。

**统计口径**(保证界面上没有一个数字跟另一个打架):

```ts
ownedMatched = new Set(
  skins.filter(s => s.skinId != null && ownedIds.has(s.skinId)).map(s => s.skinId)
).size;
```

去重后 `ownedMatched` 是**皮肤件数**,不是目录行数,因此 `ownedMatched <= ownedReported` 恒成立(第 1、2 级均是 `ownedIds ⊆ 已拥有全集`)。

- 顶部主指标:「已拥有 {ownedMatched} / {catalogSize}」
- 副标题:「{ownedReported - ownedMatched} 件目录未收录」(>0 时才显示)

**服务端版本检测**(判据是**字段是否存在**,不是非空比例):

| 条件 | 判定 | 界面表现 |
|---|---|---|
| `skinIdFieldPresent === false` | 后端未升级 | 顶部红条:「服务端版本过低,未返回皮肤 ID,无法比对已拥有状态」;所有皮肤按未拥有渲染 |
| `skinIdFieldPresent === true` 且 `skinIdCoverage < 0.5` | 后端已升级但库里大量 `skin_id` 为 NULL | 顶部黄条:「部分皮肤缺少 ID(覆盖率 {xx}%),这些皮肤无法比对拥有状态」;**不阻塞浏览** |

两者必须分开:用「非空比例」一个判据会在这两种完全不同的故障下给出同一条误导性提示。

**目录缓存**:模块级变量持有上次拉到的目录。

- 首次打开弹窗:显示 loading 遮罩,拉全量
- 再次打开:直接用内存缓存渲染(秒开),同时在后台静默刷新;刷新完成后更新网格
- 弹窗底部提供「刷新目录」按钮,手动重拉(强制走 loading)

**已拥有数据每次打开都重拉**:它很轻(一次 LCU 请求),且用户明确要「实时」。

### 4.4 虚拟滚动网格 `SkinGrid.vue`

固定行高的网格虚拟滚动,DOM 节点数恒定。

**几何参数**

- 卡片宽度 `CARD_W = 132px`,卡片高度 `CARD_H = 176px`(1:1 图片 132 + 文字区 44),间距 `GAP = 12px`
- 列数 `cols = max(1, floor((containerWidth + GAP) / (CARD_W + GAP)))`
- 行高 `rowH = CARD_H + GAP`
- 总行数 `rows = ceil(items.length / cols)`
- 滚动容器高度 `containerHeight = rows * rowH`

**`containerWidth` 来源**:用 `ResizeObserver` 观察滚动容器,宽度变化时重算 `cols` 并重算可见区间。列数变化会改变每行放几张卡,必须重算而不是沿用旧值。

**可见区间**(纯函数,便于测试):

```ts
export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  cols: number,
  totalItems: number,
  overscanRows = 2
): { startIndex: number; endIndex: number } {
  if (totalItems <= 0 || cols <= 0) return { startIndex: 0, endIndex: 0 };
  const rows = Math.ceil(totalItems / cols);
  const firstRow = Math.max(0, Math.min(rows - 1, Math.floor(scrollTop / rowHeight) - overscanRows));
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
  return {
    startIndex: firstRow * cols,
    endIndex: Math.min(totalItems, (lastRow + 1) * cols)
  };
}
```

渲染时的 DOM 结构:外层是**固定高度**的滚动容器(`overflow-y: auto`,高度 = 视口高度),内层是一个 `height = containerHeight` 的撑高占位层,可视切片以 `position: absolute; top: 0; transform: translateY(startRow * rowH)` 定位在占位层里。因为 `startIndex = firstRow * cols` 一定是 `cols` 的整数倍,切片的第一张卡自然落在第 0 列。

> 注意别写成「外层容器高度 = containerHeight」——那样就没有滚动区了。视口高度是固定的,`containerHeight` 是**内层撑高**用的。

**筛选变化必须重置滚动位置**:筛选条件变化 → `scrollTop = 0` + 重算可见区间。否则内容变短时 `scrollTop` 仍停在旧位置,滚动区会留出一片空白。

**图片懒加载**:`IntersectionObserver` 观察每个卡片的缩略图,进入视口才把 `iconUrl` 塞进 `<img src>`,未进入的用灰色占位块。因为虚拟滚动已经把 DOM 限制在可见切片内,`IntersectionObserver` 在这里主要兜住 overscan 区(上下各 2 行)刚好在视口外的卡片。

### 4.5 卡片 `SkinCard.vue`

```vue
<div class="skin-card" :class="{ 'is-owned': owned, 'is-locked': !owned }">
  <div class="thumb">
    <img v-if="visible && iconUrl" :src="iconUrl" loading="lazy" @error="onImgError" />
    <div v-else class="thumb-placeholder" />
    <div v-if="!owned" class="mask" />          <!-- 灰度遮罩层 -->
    <span v-if="!owned" class="lock-badge">未拥有</span>
  </div>
  <div class="meta">
    <div class="name" :title="skin.name">{{ skin.name }}</div>
    <div class="sub">{{ skin.heroName }} · {{ skin.rarity }}</div>
  </div>
</div>
```

**未拥有样式**(两层叠加,达到「置灰 + 遮罩」的效果):

```css
.is-locked .thumb img {
  filter: grayscale(1) brightness(0.55);
}
.is-locked .mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}
```

已拥有:图片原样彩色显示,无遮罩、无角标。

### 4.6 弹窗容器 `SkinOverviewDialog.vue`

用 Element Plus `el-dialog`:

```vue
<el-dialog
  v-model="visible"
  title="皮肤总览"
  width="94%"
  top="3vh"
  destroy-on-close
  class="skin-overview-dialog"
>
```

**必须关闭 el-dialog 自身的滚动**:`el-dialog` 的 body 默认 `overflow: auto`,而网格容器是唯一的滚动区。两个都滚会出现双滚动条,且鼠标滚轮在内层滚动到头后会带动外层滚动。做法:

```css
:global(.skin-overview-dialog .el-dialog__body) {
  overflow: hidden;
  padding: 12px 16px;
}
```

网格滚动容器高度设为 `calc(94vh - 200px)`(留出统计条 + 筛选栏 + 底部按钮的高度)。

`destroy-on-close`:关闭时销毁弹窗内容,释放 1.2 万条数组的引用。

**顶部统计条**

```
皮肤总览                          已拥有 85 / 12,670 · 0.7%
                                  LCU 实时数据 / 数据来自上次同步 / 未能获取已拥有皮肤
```

**顶部筛选栏**

| 控件 | 绑定 | 行为 |
|---|---|---|
| 搜索框 | `keyword` | 匹配 `name` / `nameEn` / `heroName`,大小写不敏感 |
| 英雄下拉 | `heroId` | 选项从全量目录 dedupe 出 `heroId → heroName` |
| 稀有度下拉 | `rarity` | 选项从全量目录 dedupe |
| 「只看未拥有」 | `onlyUnowned` | 开关 |

筛选全部在**前端本地**做(数据已全量在内存),改条件零网络延迟。

**筛选纯函数**(便于测试):

```ts
export function filterSkins(
  skins: CatalogSkin[],
  ownedIds: Set<number>,
  filters: { keyword: string; heroId: number | null; rarity: string | null; onlyUnowned: boolean }
): CatalogSkin[] {
  const kw = filters.keyword.trim().toLowerCase();
  return skins.filter(s => {
    if (filters.heroId != null && s.heroId !== filters.heroId) return false;
    if (filters.rarity && s.rarity !== filters.rarity) return false;
    if (filters.onlyUnowned && s.skinId != null && ownedIds.has(s.skinId)) return false;
    if (kw) {
      const hay = `${s.name ?? ''} ${s.nameEn ?? ''} ${s.heroName ?? ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}
```

「只看未拥有」时 `skinId == null` 的皮肤保留在结果里(它无法被判定为已拥有),这样「缺什么」的视图不会漏掉它们。

**拥有判定**(卡片和筛选共用同一个函数,避免两处口径打架):

```ts
export function isOwned(skin: CatalogSkin, ownedIds: Set<number>): boolean {
  return skin.skinId != null && ownedIds.has(skin.skinId);
}
```

**「只看未拥有」时目录未收录的缺口怎么表达**:目录里没有的皮肤无法显示,顶部副标题用「{ownedReported - ownedMatched} 件目录未收录」覆盖这个缺口。

### 4.7 详情层 `SkinDetailDialog.vue`

点击卡片打开,展示:

- `splashUrl` 原画(未拥有时同样置灰 + 遮罩,保持口径一致)
- 皮肤名 / 英文名 / 英雄 / 稀有度 / 点券价格
- 拥有状态标签:「已拥有」(绿)或「未拥有」(灰)

原画优先用 `splashUrl`;该字段缺失时回退到 `iconUrl`。

### 4.8 入口 `Sync.vue`

在现有「Owned skins」卡片下方新增一张卡片:

```
皮肤总览
查看全量皮肤目录,已拥有的高亮显示,未拥有的置灰
[打开皮肤总览]
```

点击 → `skinOverviewVisible = true`。

### 4.9 跨 IPC 的响应式陷阱

`Sync.vue` 已有一条注释:Vue 的深层 `reactive()` 代理不保证可结构化克隆,跨 IPC 传数组会报 "An object could not be cloned"。本设计涉及 1.2 万条记录跨 IPC,必须注意:

- **主进程 → 渲染层**:`ipcMain.handle` 的返回值由 `ipcRenderer.invoke` 结构化克隆,主进程侧必须是**普通对象/数组**(不能是 Vue 代理)。主进程没有 Vue,天然满足。
- **渲染层**:拉回来的数组用 `shallowRef` 持有,不要用 `ref`(深层代理 1.2 万个对象会有可观的开销)。派生的筛选结果用 `computed` 计算即可。

---

## 5. 数据流

```
打开弹窗
   │
   ├─ 目录:内存缓存命中? ──是──→ 直接渲染 + 后台静默刷新
   │              └──否──→ loading 遮罩 → GET /api/skins/list?size=20000
   │                            → 去重(按 skinId)→ 写入模块级缓存
   │
   └─ 已拥有(每次都拉):
          ① LCU fetchSkins()          → ownedSource='lcu'     , ownedReported=LCU 全集长度
          ② 失败 → GET /skins/my-owned → ownedSource='backend', ownedReported=totalOwnedCount
                                                ownedIds=ownedSkinIds(仅目录内)
          ③ 失败 → ownedSource='none'  , ownedIds=∅, 顶部黄条提示
   ↓
ownedIds Set + skinIdFieldPresent + skinIdCoverage
   ↓
本地筛选(filterSkins) ──→ 过滤后的数组;筛选变化时 scrollTop 归零
   ↓
虚拟滚动(SkinGrid)只渲染可见切片
   ↓
卡片按 skinId ∈ ownedIds 决定彩色 / 置灰遮罩
```

---

## 6. 错误处理

| 场景 | 表现 |
|---|---|
| 目录拉取失败(网络/超时/非 200) | 弹窗内错误态 + 「重试」按钮;不进入网格 |
| 目录拉取超时(60s) | 同上,错误信息带「服务端响应超时」 |
| `skinIdFieldPresent === false` | 顶部红条:「服务端版本过低,未返回皮肤 ID,无法比对已拥有状态」;网格正常展示(全部按未拥有渲染) |
| `skinIdFieldPresent === true` 且 `skinIdCoverage < 0.5` | 顶部黄条:「部分皮肤缺少 ID(覆盖率 xx%),这些皮肤无法比对拥有状态」;不阻塞浏览 |
| LCU 不可用 + 未登录 | 顶部黄条:「未能获取已拥有皮肤,当前全部按未拥有显示」;网格正常展示 |
| LCU 不可用 + 已登录 | 顶部黄条:「数据来自上次同步」;用后端 `ownedSkinIds` 判定 |
| `t_skin.skin_id` 为 NULL 的行 | 无法匹配,视为未拥有;计入覆盖率提示,不特殊报错 |
| 图片 404 / 加载失败 | 灰色占位块,不破版 |
| 已拥有数 > 目录收录数 | 顶部副标题:「N 件目录未收录」 |
| 后端截断结果(`records.length < total`) | 主进程自动分页补拉合并,用户无感 |

---

## 7. 测试

### 7.1 后端(`all_function_api`)

`skin/src/test/java/com/lolskin/skin/service/impl/SkinServiceImplTest.java` **目前不存在,需要新建**(参考同目录 `HeroSyncServiceImplTest` 的 JUnit 5 + Mockito 写法)。新增两条用例:

1. `listSkins` 返回的 `SkinVO` 中 `skinId` 与 `Skin.skinId` 一致(透传断言)
2. `convertToVOList` 对 100 条皮肤只调用 **1 次** `heroMapper.selectBatchIds`,不调用 `selectById`
   - `verify(heroMapper, times(1)).selectBatchIds(any())`
   - `verify(heroMapper, never()).selectById(any())`

注意:根 `pom.xml` 里 `<maven.test.skip>true</maven.test.skip>`,跑测试必须显式加 `-Dmaven.test.skip=false`。

### 7.2 桌面端(vitest)

纯函数单测:

- `filterSkins` — 四个维度各自生效;关键字大小写不敏感;`onlyUnowned` 与 ownedIds 的交互;`skinId == null` 的皮肤在 `onlyUnowned` 下保留
- `computeVisibleRange` — 首屏、滚动中、到底部、`totalItems = 0`、`cols = 0`、超出行数时的边界;`overscanRows` 生效;`startIndex` 恒为 `cols` 的整数倍
- `dedupeBySkinId` — 重复 ID 只保留一条;`skinId == null` 的行全部保留
- `isOwned(skin, ownedIds)` — `skinId` 为 null 时返回 false

组件测试:

- `SkinCard` — 已拥有时无 `.is-locked`、无 `.mask`;未拥有时有 `.is-locked`、有 `.mask`

### 7.3 手工验收

- 后端未部署新版本 → 出现「服务端版本过低」红条,而不是全灰无解释
- 后端已部署但库里 `skin_id` 有 NULL → 出现「部分皮肤缺少 ID」黄条,不阻塞浏览
- LCU 关闭 + 已登录 → 出现「数据来自上次同步」,且「已拥有」数字与后端 `totalOwnedCount` 对得上
- LCU 关闭 + 未登录 → 出现「未能获取已拥有皮肤」黄条
- 网格滚动到底 → 12,670 条全部可达,DOM 节点数稳定在百级
- 改筛选条件 → 网格回到顶部,不出现空白区
- 点击卡片 → 原画详情层正常,已拥有彩色 / 未拥有置灰

---

## 8. 风险与上线顺序

1. **后端必须先上线**。桌面端依赖 `SkinVO.skinId`;后端未部署时触发「服务端版本过低」提示,不会崩但功能不可用。
2. **N+1 必须同时修**。不修则全量拉取 1.2 万条要 1.2 万次单行查询,响应时间不可接受(可能 10s+ 甚至超时)。
3. **首次加载有 3~5 MB 传输**(12,670 条 JSON)与几秒等待,必须有 loading 遮罩 + 超时兜底;之后靠内存缓存秒开。
4. **降级路径 `/skins/my-owned` 本身成本不低**:它内部 `selectList` 全量 `t_skin` + 全量 `t_hero`,是一次全表扫描。只在 LCU 不可用时才走这条路,可以接受。
5. **12,670 是估算值**,以接口返回的 `total` 为准。

上线顺序:

1. 改 `all_function_api`(SkinVO + N+1 修复 + 单测) → 提交 → 部署
2. 改 `local_skin_importer`(主进程 + preload + 渲染层 + 单测) → 提交 → 打包

---

## 9. 相关既有代码索引

| 关注点 | 位置 |
|---|---|
| LCU 拉已拥有皮肤 | `local_skin_importer/src/main/lcu.ts` → `getOwnedSkinIds` |
| 主进程 HTTP 基址 | `local_skin_importer/src/main/backend.ts` → `BACKEND_BASE_URL` |
| token 存取 | `local_skin_importer/src/main/auth.ts` → `getStoredToken` |
| IPC 注册 | `local_skin_importer/src/main/ipc.ts` |
| preload 类型化桥 | `local_skin_importer/src/preload/index.ts` |
| 现有唯一页面 | `local_skin_importer/src/renderer/src/views/Sync.vue` |
| 皮肤目录接口 | `all_function_api/skin/.../controller/SkinController.java` → `GET /list` |
| 皮肤 VO | `all_function_api/skin/.../vo/SkinVO.java` |
| N+1 现场 | `all_function_api/skin/.../service/impl/SkinServiceImpl.java` → `convertToVO` |
| 已拥有口径 / 重复 ID 证据 | `all_function_api/skin/.../inventory/assembler/PlayerSkinStatusAssembler.java` |
| 已拥有查询接口 | `all_function_api/skin/.../inventory/controller/SkinSyncController.java` → `GET /my-owned` |
| 分页信封 | `all_function_api/core/.../common/PageResult.java` |
| 统一响应信封 | `all_function_api/core/.../common/Result.java` |
| 分页插件配置 | `all_function_api/core/.../config/MybatisPlusConfig.java` |
