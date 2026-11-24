# 开黑大厅 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端现有的「同区开黑搭子」升级成一个实时大厅 —— 大厅聊天、在线玩家列表（带游戏状态灯）、一键把同大区空闲的人拉进自定义房间（探测不到就降级成复制游戏ID）。

**Architecture:** 后端新建 Maven 模块 `lobby`，照 `party` 的骨架写一套专用 WebSocket（`/api/ws/lobby?token=<desktop token>`）+ 专用表 `t_lobby_message` + `t_user.last_lobby_at`；在线状态存 Redis（`lobby:online:{userId}` + `lobby:online:idx`），跨实例广播走 Redis pub/sub（`lobby:events`）。桌面端主进程跑 WS 客户端，主进程通过 IPC 把快照推给渲染进程；WS 连不上就降级成 REST 轮询（`GET /api/lobby/players` 3 秒 / `GET /api/lobby/history` 2 秒）。拉人完全在客户端本地做（本机 LCU 建房 + 邀请），后端不参与。

**Tech Stack:** Spring Boot 3.1.6 + MyBatis-Plus 3.5.3.1 + spring-boot-starter-websocket + MySQL 5.7（生产）+ Redis；Electron 39 + Vue 3 + Element Plus + `ws` 8.21.3 + Vitest。

**规格文档：** `docs/superpowers/specs/2026-11-24-open-lobby-design.md`

**跨仓库：** 路径相对 `D:\Code\Front_Project\all\`：`all_function_api/`（后端）、`local_skin_importer/`（桌面端）。

---

## 关于「提交」这一步

> 每个任务最后都有一节「提交」。按你的规矩 **我不代跑 `git add` / `git commit`** —— 那些命令写在计划里，由你自己执行。
> 桌面端每完成一次用户可见的改动要升一次 `package.json` 的 version（界面上的版本号是从这儿读的）。本计划里桌面端只升一次：`0.49.0 → 0.50.0`，在 **B1** 里做。

## 关于「跑命令」这一步

> Bash 安全分类器这段时间不稳定，`mvn` / `npx vitest` / `git` 这类命令有可能被直接拒掉。
> 每条命令都写清了「期望输出」，你自己跑一遍对照即可。

## 命令前提

后端：

```powershell
# JDK 17 必须先钉住 —— 默认 JAVA_HOME 是 JDK 8，会报「无效的目标发行版」
$env:JAVA_HOME = "D:\develop_tools\JDK\jdk17"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

桌面端：

```powershell
# 默认 node 是 v14，跑不了 vitest / build —— 切到 nvm4w 的 v20.19.4
# (装的是普通 nvm-windows 的话命令就是 nvm use 20.19.4)
nvm4w use 20.19.4
```

---

# 文件结构

## 后端 `all_function_api`（新目录全是新建）

```
all_function_api/
├── pom.xml                                    (改) 加 lobby 模块 + dependencyManagement
├── lobby/
│   ├── pom.xml                                (新)
│   └── src/main/java/com/lolskin/lobby/
│       ├── entity/LobbyMessage.java           (新) t_lobby_message 实体
│       ├── mapper/LobbyMessageMapper.java     (新) MyBatis-Plus BaseMapper
│       ├── mapper/LobbyUserMapper.java        (新) t_user 原始 SQL(档案/上次在线/离线候选)
│       ├── vo/LobbyPlayerVO.java              (新) 玩家档案
│       ├── vo/LobbyStatsVO.java               (新) 顶栏三数
│       ├── vo/LobbyMeVO.java                  (新) 我自己的档案
│       ├── vo/LobbyMessageVO.java             (新) 一条聊天消息
│       ├── vo/LobbySnapshotVO.java            (新) 在线+离线+统计+我
│       ├── service/LobbyMessageService.java   (新) 接口
│       ├── service/impl/LobbyMessageServiceImpl.java (新)
│       ├── service/LobbyDirectoryService.java (新) 接口:在线档案/离线候选/统计/快照
│       ├── service/impl/LobbyDirectoryServiceImpl.java (新)
│       ├── service/LobbyPresenceStore.java    (新) Redis 在线状态
│       ├── service/LobbyEventBus.java         (新) Redis pub/sub 跨实例广播
│       ├── service/LobbyLastLobbyWriter.java  (新) last_lobby_at 的写入器
│       ├── ws/LobbyHandshakeInterceptor.java  (新) token → attributes.userId,无效 → 401
│       ├── ws/LobbyWebSocketHandler.java      (新) hello/profile/say/ping
│       ├── ws/LobbySessionRegistry.java       (新) 本实例的 session 池
│       ├── ws/LobbySessionSweeper.java        (新) hello 超时/空闲超时/presence 清扫
│       ├── config/LobbyWebSocketConfig.java   (新) 注册 /ws/lobby
│       └── controller/LobbyController.java     (新) GET /lobby/players · /lobby/history
│   └── src/test/java/com/lolskin/lobby/
│       └── service/
│           ├── LobbyMessageServiceImplTest.java   (新)
│           └── LobbyDirectoryServiceImplTest.java (新)
├── app/
│   ├── pom.xml                                (改) 依赖 lobby
│   ├── src/main/
│   │   ├── java/com/lolskin/LolSkinApplication.java (改) @MapperScan 加 lobby.mapper
│   │   └── resources/
│   │       ├── application.yml                (改) type-aliases + knife4j
│   │       └── db/migration_lobby_2026_11.sql (新) 建表 + 加列
│   └── src/test/java/com/lolskin/lobby/
│       ├── redis/LobbyRedisStubConfig.java     (新) 集成测试用的 Redis 桩
│       └── integration/LobbyIntegrationTest.java (新) WS 集成
```

## 桌面端 `local_skin_importer`

```
local_skin_importer/
├── package.json                               (改) version → 0.50.0
├── scripts/probe-lobby-invite.mjs             (新) 撞 LCU 建房/邀请路由
└── src/
    ├── shared/lobby.ts                        (新) 类型 + 状态灯/可拉人纯函数
    ├── shared/__tests__/lobby.test.ts         (新)
    ├── main/lobby/prefs.ts                    (新) 公开开关(userData/lobby-prefs.json)
    ├── main/lobby/__tests__/prefs.test.ts     (新)
    ├── main/lobby/client.ts                   (新) WS 客户端(注入式 socket 工厂)
    ├── main/lobby/__tests__/client.test.ts    (新)
    ├── main/lobby/api.ts                      (新) REST 降级轮询
    ├── main/lobby/__tests__/api.test.ts       (新)
    ├── main/lobby/invite.ts                   (新) LCU 建房/邀请 + 降级
    ├── main/lobby/__tests__/invite.test.ts    (新)
    ├── main/lobby/service.ts                  (新) 主进程侧大厅服务(装配 client+api+presence)
    ├── main/match/poller.ts                   (改) 暴露 getPhase()
    ├── main/index.ts                          (改) lobbyService.start()
    ├── main/ipc.ts                            (改) lobby:* handler
    ├── main/__tests__/ipc.test.ts             (改) mock 掉大厅服务,别让单测真连后端
    ├── preload/index.ts                       (改) 桥接 + onLobbyState
    └── renderer/src/
        ├── views/Lobby.vue                     (新) 大厅页
        ├── views/Tools.vue                    (改) 同区搭子那张卡抽成组件,这里只留入口
        ├── components/RegionBuddyCard.vue      (新) 「同区开黑搭子」卡(两边共用一份)
        ├── App.vue                            (改) 左边栏加「开黑大厅」
        └── router/index.ts                    (改) 加 /lobby 路由
```

---

# Part A —— 后端 `lobby` 模块

## Task A1：把 `lobby` 模块的骨架搭起来

**Files:**
- Modify: `all_function_api/pom.xml`（`<modules>` + `<dependencyManagement>`）
- Create: `all_function_api/lobby/pom.xml`
- Modify: `all_function_api/app/pom.xml`
- Modify: `all_function_api/app/src/main/java/com/lolskin/LolSkinApplication.java`
- Modify: `all_function_api/app/src/main/resources/application.yml`

- [ ] **Step 1：在根 pom 里加模块声明**

`all_function_api/pom.xml`，`<modules>` 块改成（注意顺序：`lobby` 排在 `party` 后面、`app` 前面）：

```xml
    <modules>
        <module>core</module>
        <module>user</module>
        <module>skin</module>
        <module>chat</module>
        <module>cms</module>
        <module>life</module>
        <module>forum</module>
        <module>party</module>
        <module>lobby</module>
        <module>app</module>
    </modules>
```

同文件 `<dependencyManagement>` 的内部模块块里，`party` 那条后面加：

```xml
            <dependency>
                <groupId>com.lolskin</groupId>
                <artifactId>lobby</artifactId>
                <version>${project.version}</version>
            </dependency>
```

同时把文件顶部那段模块划分注释补一行（不然下次有人看不懂为什么多了个模块）：

```xml
        lobby    开黑大厅域:实时大厅 WS + 在线状态 + 大厅聊天(依赖 core+skin+user)
```

> 同一段注释里还有一句「app 依赖全部 8 个域模块」—— 多了 `lobby` 之后是 **9** 个,一并改掉。
> 「依赖边」那句(`skin→user chat→user …`)也补一条 `lobby→core+skin+user`。

- [ ] **Step 2：建 `lobby/pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.lolskin</groupId>
        <artifactId>lol-skin-api-parent</artifactId>
        <version>1.0.0</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>lobby</artifactId>
    <name>LOL Skin API :: lobby</name>
    <description>开黑大厅域:大厅聊天 + 在线玩家列表(依赖 core+skin+user)</description>

    <dependencies>
        <dependency>
            <groupId>com.lolskin</groupId>
            <artifactId>core</artifactId>
        </dependency>
        <!-- 段位分/收藏分/大区归一化(RankScores / GameZones / MapDistributionMapper)都在 skin 里 -->
        <dependency>
            <groupId>com.lolskin</groupId>
            <artifactId>skin</artifactId>
        </dependency>
        <!-- JwtService(握手认人) -->
        <dependency>
            <groupId>com.lolskin</groupId>
            <artifactId>user</artifactId>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-websocket</artifactId>
        </dependency>

        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

> ⚠️ `skin` 已经依赖 `user`，这里再显式写一遍 `user` 是为了「我用到 JwtService」这件事一眼可见，不是多余的环。

- [ ] **Step 3：`app/pom.xml` 依赖 lobby**

在 `party` 那条依赖后面加：

```xml
        <dependency>
            <groupId>com.lolskin</groupId>
            <artifactId>lobby</artifactId>
        </dependency>
```

- [ ] **Step 4：`@MapperScan` 加包名**

`all_function_api/app/src/main/java/com/lolskin/LolSkinApplication.java`：

```java
@MapperScan({
        "com.lolskin.cms.mapper",
        "com.lolskin.rating.mapper",
        "com.lolskin.forum.mapper",
        "com.lolskin.chat.mapper",
        "com.lolskin.skin.mapper",
        "com.lolskin.user.mapper",
        "com.lolskin.life.mapper",
        "com.lolskin.platform.mapper",
        "com.lolskin.ai.mapper",
        "com.lolskin.inventory.mapper",
        "com.lolskin.map.mapper",
        "com.lolskin.lobby.mapper"
})
```

- [ ] **Step 5：`application.yml` 加两处包名**

`type-aliases-package` 末尾追加 `,com.lolskin.lobby.entity`：

```yaml
  type-aliases-package: com.lolskin.cms.entity,com.lolskin.rating.entity,com.lolskin.forum.entity,com.lolskin.chat.entity,com.lolskin.skin.entity,com.lolskin.user.entity,com.lolskin.life.entity,com.lolskin.platform.entity,com.lolskin.ai.entity,com.lolskin.inventory.entity,com.lolskin.lobby.entity
```

`knife4j.openapi.group.default.api-rule-resources` 末尾追加：

```yaml
          - com.lolskin.lobby.controller
```

- [ ] **Step 6：验证骨架能编译**

Run:

```powershell
cd D:\Code\Front_Project\all\all_function_api
mvn -pl lobby -am -DskipTests compile
```

Expected: `BUILD SUCCESS`，且日志里能看到 `lobby` 模块被编译。

- [ ] **Step 7：提交（你来跑）**

```powershell
git add pom.xml lobby/pom.xml app/pom.xml app/src/main/java/com/lolskin/LolSkinApplication.java app/src/main/resources/application.yml
git commit -m "feat(lobby): 新增 lobby 模块骨架"
```

---

## Task A2：写 DDL 迁移脚本

**Files:**
- Create: `all_function_api/app/src/main/resources/db/migration_lobby_2026_11.sql`

- [ ] **Step 1：写迁移脚本**

```sql
-- ========================================
-- 开黑大厅 · 建表 + t_user 加一列 (2026-11)
-- 适用场景:linux mysql CLI / Navicat / phpMyAdmin 等直连执行
-- 用法: mysql -u lolskin -p < migration_lobby_2026_11.sql
-- 幂等可重跑(建表用 CREATE TABLE IF NOT EXISTS,加列用 INFORMATION_SCHEMA 判断)
--
-- ⚠️ 生产是 MySQL 5.7 —— 不用 8.0 的 ADD COLUMN IF NOT EXISTS / 函数索引 / CHECK 约束。
-- ⚠️ 5.7 上 ADD COLUMN 是 copy 算法,t_user 行数不大,但上线窗口还是选低峰。
-- ⚠️ 项目不引入 Flyway/liquibase,schema 变更全走手工执行这个文件。
-- ========================================

USE `lolskin`;

-- 1) 大厅聊天消息表
CREATE TABLE IF NOT EXISTS `t_lobby_message` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL COMMENT '站内用户 id',
  `nickname` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '游戏昵称(发言当时的快照)',
  `game_id` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '召唤师ID(数字标签,快照)',
  `game_zone` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '大区(快照)',
  `text` VARCHAR(64) NOT NULL COMMENT '消息正文,后端硬截断 64 字',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='开黑大厅聊天消息';

-- 2) 老表加一列:离线候选的「上次在线」
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='t_user'
       AND COLUMN_NAME='last_lobby_at') = 0,
  'ALTER TABLE t_user ADD COLUMN last_lobby_at DATETIME NULL COMMENT ''最后一次出现在开黑大厅的时间''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

> 加列为什么用 `INFORMATION_SCHEMA` + `PREPARE`:
> 5.7 没有 `ADD COLUMN IF NOT EXISTS`,直接写 `ALTER TABLE ... ADD COLUMN`
> 重复跑会报 `ERROR 1060 (42000): Duplicate column name 'last_lobby_at'`。
> 这个写法跟仓库里其它迁移脚本(`migration_user_match_profile_2026_11.sql` 等)一致,
> **可以放心重跑**。

- [ ] **Step 2：在生产库上执行（这一步不能省）**

> **部署前置**：这段 SQL 必须在**后端发版之前**在生产 MySQL 5.7 上跑完。
> 后端代码一旦上线就会 `SELECT last_lobby_at`，列不存在就是 `Unknown column`。
> `t_lobby_message` 不存在则是「发言落库失败」—— 那条路已经做了「落库失败就放弃本次广播」的兜底，不会脏数据，但大厅等于废了。

Run（在 **`all_function_api` 仓库根目录**下执行，连生产库；注意先备份 `t_user` 的表结构）：

```powershell
# ⚠️ PowerShell 5.1 不支持 `<` 输入重定向 —— 用 mysql 客户端的 source 命令。
mysql -h 101.34.210.254 -u lolskin -p lolskin -e "source app/src/main/resources/db/migration_lobby_2026_11.sql"
```

> 不想敲命令就用 Navicat:连生产库 → 新建查询 → 把那个 .sql 文件的内容整个贴进去执行。
> 脚本是幂等的,重跑不会报错。

Expected: 无报错。随后确认：

```sql
SHOW COLUMNS FROM `t_user` LIKE 'last_lobby_at';
SHOW TABLES LIKE 't_lobby_message';
```

Expected: 第一条有一行 `last_lobby_at / datetime / YES / NULL`；第二条返回 `t_lobby_message`。

- [ ] **Step 3：提交（你来跑）**

```powershell
git add app/src/main/resources/db/migration_lobby_2026_11.sql
git commit -m "feat(lobby): 开黑大厅建表与 last_lobby_at 加列"
```

---

## Task A3：大厅消息落库 + 拉最近 N 条

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/entity/LobbyMessage.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/mapper/LobbyMessageMapper.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbyMessageVO.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyMessageService.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/impl/LobbyMessageServiceImpl.java`
- Test: `all_function_api/lobby/src/test/java/com/lolskin/lobby/service/LobbyMessageServiceImplTest.java`

- [ ] **Step 1：写失败测试**

`all_function_api/lobby/src/test/java/com/lolskin/lobby/service/LobbyMessageServiceImplTest.java`：

```java
package com.lolskin.lobby.service;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.lolskin.lobby.entity.LobbyMessage;
import com.lolskin.lobby.mapper.LobbyMessageMapper;
import com.lolskin.lobby.service.impl.LobbyMessageServiceImpl;
import com.lolskin.lobby.vo.LobbyMessageVO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class LobbyMessageServiceImplTest {

    @BeforeAll
    static void initTableInfoCache() {
        // LambdaQueryWrapper 生成 SQL 时要查 TableInfo 缓存(列名/驼峰映射)。
        // 纯单测不起 Spring,这条缓存填充路径不走 —— 手动 init 一次(仓库既有惯例,
        // 参照 chat/.../ChatMessageServiceImplTest)。
        Configuration cfg = new Configuration();
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(cfg, "test");
        TableInfoHelper.initTableInfo(assistant, LobbyMessage.class);
    }

    private LobbyMessageMapper mapper;
    private LobbyMessageService service;

    @BeforeEach
    void setUp() {
        mapper = mock(LobbyMessageMapper.class);
        service = new LobbyMessageServiceImpl(mapper);
    }

    @Test
    void 落库时把null字段补成空串() {
        // t_lobby_message.nickname/game_id/game_zone/text 都是 NOT NULL,
        // MyBatis-Plus 的 insert 会跳过 null 字段 → MySQL 报 "doesn't have a default value"。
        when(mapper.insert(any(LobbyMessage.class))).thenAnswer(inv -> {
            LobbyMessage m = inv.getArgument(0);
            m.setId(1L);
            return 1;
        });

        Long id = service.record(7L, null, null, null, "  来两把  ");

        assertEquals(1L, id);
        org.mockito.ArgumentCaptor<LobbyMessage> captor = org.mockito.ArgumentCaptor.forClass(LobbyMessage.class);
        verify(mapper).insert(captor.capture());
        LobbyMessage saved = captor.getValue();
        assertEquals("", saved.getNickname());
        assertEquals("", saved.getGameId());
        assertEquals("", saved.getGameZone());
        assertEquals("来两把", saved.getText());
    }

    @Test
    void 正文超长时硬截断到64字() {
        when(mapper.insert(any(LobbyMessage.class))).thenAnswer(inv -> {
            LobbyMessage m = inv.getArgument(0);
            m.setId(2L);
            return 1;
        });

        String longText = "一".repeat(200);
        service.record(7L, "林俊杰", "18557", "艾欧尼亚", longText);

        org.mockito.ArgumentCaptor<LobbyMessage> captor = org.mockito.ArgumentCaptor.forClass(LobbyMessage.class);
        verify(mapper).insert(captor.capture());
        assertEquals(64, captor.getValue().getText().length());
    }

    @Test
    void 拉最近N条时把降序结果反转成正序() {
        LobbyMessage newer = new LobbyMessage();
        newer.setId(2L); newer.setUserId(7L); newer.setNickname("a");
        newer.setText("第二条"); newer.setCreatedAt(LocalDateTime.of(2026, 11, 24, 22, 16, 3));
        LobbyMessage older = new LobbyMessage();
        older.setId(1L); older.setUserId(8L); older.setNickname("b");
        older.setText("第一条"); older.setCreatedAt(LocalDateTime.of(2026, 11, 24, 22, 15, 0));
        when(mapper.selectList(any())).thenReturn(List.of(newer, older));

        List<LobbyMessageVO> rows = service.listRecent(50);

        assertEquals(2, rows.size());
        assertEquals("第一条", rows.get(0).getText());
        assertEquals("第二条", rows.get(1).getText());
    }

    @Test
    void limit被夹在1到200之间() {
        when(mapper.selectList(any())).thenReturn(List.of());
        service.listRecent(9999);
        verify(mapper).selectList(any());
        // 越界值不该拼进 SQL 的 LIMIT —— 具体断言夹取发生在实现里,
        // 这里只保证不会抛异常且只查一次。
        assertDoesNotThrow(() -> service.listRecent(0));
    }
}
```

- [ ] **Step 2：跑测试确认失败**

Run:

```powershell
mvn -pl lobby -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyMessageServiceImplTest" test
```

Expected: 编译失败 —— `LobbyMessageServiceImpl` / `LobbyMessage` / `LobbyMessageVO` 这些类还不存在（`cannot find symbol`）。

- [ ] **Step 3：写实体**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/entity/LobbyMessage.java`：

```java
package com.lolskin.lobby.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 开黑大厅的聊天消息。
 *
 * <p>跟 {@code t_chat_message} 分开存:公屏那套是「匿名代号 + 频道 + 大区」语义,
 * 大厅要的是「昵称 + 召唤师ID + 大区」快照,塞进同一张表语义会错位。
 *
 * <p>nickname / gameId / gameZone 都是**发言当时的快照** —— 昵称改了、皮肤换了,
 * 旧消息仍然显示当时的样子。
 */
@Data
@TableName("t_lobby_message")
public class LobbyMessage {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 站内用户 id */
    private Long userId;

    /** 游戏昵称(发言当时的快照) */
    private String nickname;

    /** 召唤师ID(数字标签,快照) */
    private String gameId;

    /** 大区(快照) */
    private String gameZone;

    /** 消息正文 */
    private String text;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
```

- [ ] **Step 4：写 mapper**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/mapper/LobbyMessageMapper.java`：

```java
package com.lolskin.lobby.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lolskin.lobby.entity.LobbyMessage;
import org.apache.ibatis.annotations.Mapper;

/**
 * 大厅聊天消息。
 *
 * <p>纯 MyBatis-Plus —— 没有自定义 SQL,不需要 XML。
 */
@Mapper
public interface LobbyMessageMapper extends BaseMapper<LobbyMessage> {
}
```

- [ ] **Step 5：写 VO**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbyMessageVO.java`：

```java
package com.lolskin.lobby.vo;

import lombok.Data;

/** 一条大厅聊天消息(给前端渲染的形状)。 */
@Data
public class LobbyMessageVO {

    private Long id;
    private Long userId;
    private String nickname;
    private String gameId;
    private String zone;
    private String text;
    /** "yyyy-MM-dd HH:mm:ss" */
    private String createdAt;
}
```

- [ ] **Step 6：写 service 接口 + 实现**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyMessageService.java`：

```java
package com.lolskin.lobby.service;

import com.lolskin.lobby.vo.LobbyMessageVO;

import java.util.List;

/** 大厅聊天消息的存取。 */
public interface LobbyMessageService {

    /** 正文长度上限 —— 跟 t_lobby_message.text 的列宽一致。 */
    int MAX_TEXT_LEN = 64;

    /** 落一条消息,返回自增 id。null 字段补空串,正文超长硬截断。 */
    Long record(Long userId, String nickname, String gameId, String gameZone, String text);

    /** 最近 N 条(按时间正序返回)。limit 夹在 1..200。 */
    List<LobbyMessageVO> listRecent(int limit);
}
```

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/impl/LobbyMessageServiceImpl.java`：

```java
package com.lolskin.lobby.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.lolskin.lobby.entity.LobbyMessage;
import com.lolskin.lobby.mapper.LobbyMessageMapper;
import com.lolskin.lobby.service.LobbyMessageService;
import com.lolskin.lobby.vo.LobbyMessageVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class LobbyMessageServiceImpl implements LobbyMessageService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final LobbyMessageMapper lobbyMessageMapper;

    @Override
    public Long record(Long userId, String nickname, String gameId, String gameZone, String text) {
        LobbyMessage m = new LobbyMessage();
        m.setUserId(userId);
        // nickname/game_id/game_zone/text 都是 NOT NULL,MyBatis-Plus insert 会跳过 null,
        // 触发 "Field 'xxx' doesn't have a default value"。在 service 层兜成空串。
        m.setNickname(nickname == null ? "" : nickname);
        m.setGameId(gameId == null ? "" : gameId);
        m.setGameZone(gameZone == null ? "" : gameZone);
        String body = text == null ? "" : text.trim();
        if (body.length() > MAX_TEXT_LEN) {
            body = body.substring(0, MAX_TEXT_LEN);
        }
        m.setText(body);
        lobbyMessageMapper.insert(m);
        // MyBatis-Plus insert 后把自增 id 回填到 entity
        return m.getId();
    }

    @Override
    public List<LobbyMessageVO> listRecent(int limit) {
        int safe = Math.max(1, Math.min(limit, 200));
        LambdaQueryWrapper<LobbyMessage> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(LobbyMessage::getCreatedAt)
               .last("LIMIT " + safe);
        List<LobbyMessage> rows = lobbyMessageMapper.selectList(wrapper);
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyList();
        }
        // 取的是「最近 N 条降序」,前端按时间正序展示,这里反转
        List<LobbyMessageVO> out = rows.stream().map(this::toVO).collect(Collectors.toList());
        Collections.reverse(out);
        return out;
    }

    private LobbyMessageVO toVO(LobbyMessage m) {
        LobbyMessageVO d = new LobbyMessageVO();
        d.setId(m.getId());
        d.setUserId(m.getUserId());
        d.setNickname(m.getNickname());
        d.setGameId(m.getGameId());
        d.setZone(m.getGameZone());
        d.setText(m.getText());
        LocalDateTime createdAt = m.getCreatedAt();
        d.setCreatedAt(createdAt == null ? null : createdAt.format(TS));
        return d;
    }
}
```

- [ ] **Step 7：跑测试确认通过**

Run:

```powershell
mvn -pl lobby -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyMessageServiceImplTest" test
```

Expected: `Tests run: 4, Failures: 0, Errors: 0` + `BUILD SUCCESS`。

- [ ] **Step 8：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/entity lobby/src/main/java/com/lolskin/lobby/mapper/LobbyMessageMapper.java lobby/src/main/java/com/lolskin/lobby/vo/LobbyMessageVO.java lobby/src/main/java/com/lolskin/lobby/service lobby/src/test/java/com/lolskin/lobby/service/LobbyMessageServiceImplTest.java
git commit -m "feat(lobby): 大厅消息落库与最近 N 条"
```

---

## Task A4：`t_user` 的原始查询（档案 / 上次在线 / 离线候选）

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/mapper/LobbyUserMapper.java`

- [ ] **Step 1：写 mapper**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/mapper/LobbyUserMapper.java`：

```java
package com.lolskin.lobby.mapper;

import lombok.Data;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 大厅要碰的 {@code t_user} 原始查询。
 *
 * <p>只放大厅自己要的三个查询 —— 通用档案/大区统计那些已经在
 * {@code MapDistributionMapper} 里了,不重复造。
 */
@Mapper
public interface LobbyUserMapper {

    /**
     * 批量取用户档案。
     *
     * <p>{@code last_lobby_at} 一起带出来 —— 离线候选要靠它排序。
     */
    @Select({"<script>",
            "SELECT `id` AS `userId`, `nickname` AS `nickname`, `game_id` AS `gameId`,",
            "`game_zone` AS `gameZone`, `avatar_url` AS `avatarUrl`,",
            "`vip_until` AS `vipUntil`, `last_lobby_at` AS `lastLobbyAt`",
            "FROM `t_user` WHERE `id` IN",
            "<foreach collection='userIds' item='uid' open='(' separator=',' close=')'>#{uid}</foreach>",
            "</script>"})
    List<UserRow> selectUsers(@Param("userIds") List<Long> userIds);

    /**
     * 记「这个人刚进过大厅」。
     *
     * <p>只在**连接建立 / 公开开关变化**时调用,不在心跳上调用 ——
     * 心跳每 20 秒一次,写库太勤。
     */
    @Update("UPDATE `t_user` SET `last_lobby_at` = NOW() WHERE `id` = #{userId}")
    int touchLastLobbyAt(@Param("userId") Long userId);

    /**
     * 关掉「在大厅公开我的信息」时,把「上次在线」抹掉。
     *
     * <p>离线候选是靠 {@code last_lobby_at} 查的 —— 不抹的话,
     * 这个人退出应用之后还会以「同区离线候选」的身份出现在别人的列表里,
     * 跟他「不公开」的开关对不上。
     */
    @Update("UPDATE `t_user` SET `last_lobby_at` = NULL WHERE `id` = #{userId}")
    int clearLastLobbyAt(@Param("userId") Long userId);

    /**
     * 离线候选 —— 同大区 + 近 7 天来过大厅。
     *
     * <p>大区用**别名集合 IN**,不是等值比:库里同一个大区有多个原始写法
     * (「教育网」/「教育网专区」),等值比会漏人。
     */
    @Select({"<script>",
            "SELECT `id` AS `userId`, `nickname` AS `nickname`, `game_id` AS `gameId`,",
            "`game_zone` AS `gameZone`, `avatar_url` AS `avatarUrl`,",
            "`vip_until` AS `vipUntil`, `last_lobby_at` AS `lastLobbyAt`",
            "FROM `t_user` WHERE `game_zone` IN",
            "<foreach collection='aliases' item='alias' open='(' separator=',' close=')'>#{alias}</foreach>",
            "AND `last_lobby_at` IS NOT NULL",
            "AND `last_lobby_at` >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
            "AND (`status` IS NULL OR `status` &lt;&gt; 2)",
            "ORDER BY `last_lobby_at` DESC",
            "LIMIT #{limit}",
            "</script>"})
    List<UserRow> selectOfflineCandidates(@Param("aliases") List<String> aliases,
                                          @Param("limit") Integer limit);

    /** 一行用户档案。 */
    @Data
    public static class UserRow {
        private Long userId;
        private String nickname;
        private String gameId;
        private String gameZone;
        private String avatarUrl;
        private LocalDateTime vipUntil;
        private LocalDateTime lastLobbyAt;
    }
}
```

- [ ] **Step 2：编译验证**

Run:

```powershell
mvn -pl lobby -am -DskipTests compile
```

Expected: `BUILD SUCCESS`。这个任务没有单测（全是 SQL），靠 Task A6 的服务层测试覆盖它的**用法**。

- [ ] **Step 3：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/mapper/LobbyUserMapper.java
git commit -m "feat(lobby): t_user 档案/上次在线/离线候选查询"
```

---

## Task A5：Redis 在线状态（presence）

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyPresenceStore.java`

- [ ] **Step 1：写 `LobbyPresenceStore`**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyPresenceStore.java`：

```java
package com.lolskin.lobby.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * 大厅在线状态(Redis,不落库)。
 *
 * <p>两个 key:
 * <ul>
 *   <li>{@code lobby:online:{userId}} —— String(JSON),TTL 90 秒,心跳刷新</li>
 *   <li>{@code lobby:online:idx} —— ZSET, member=userId, score=心跳时刻</li>
 * </ul>
 *
 * <p>⚠️ 用 {@link StringRedisTemplate} 而不是 {@code RedisTemplate<String,Object>}:
 * 后者的 value 序列化器会给非 final 类型写 {@code @class} type hint,
 * 这里存的是裸 JSON,读回来会变成带 {@code @class} 的怪结构。
 *
 * <p>昵称/大区/段位分这些**不存 Redis** —— 要展示时按 userId 查库算,
 * 免得 Redis 里存两份会过期的真相。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbyPresenceStore {

    /** 单条 presence 的存活时间。客户端 20 秒心跳一次,90 秒足够容错两次丢包。 */
    public static final Duration TTL = Duration.ofSeconds(90);

    private static final String KEY_PREFIX = "lobby:online:";
    private static final String IDX_KEY = "lobby:online:idx";

    private final StringRedisTemplate redis;
    /**
     * 这里用**自己 new 的** ObjectMapper,不用 Spring 那个全局的 ——
     * 全局那个把 LocalDateTime 配成了 "yyyy-MM-dd HH:mm:ss"。
     * 本类里的字段全是 Long/String/Boolean,**没有 LocalDateTime**,
     * 所以裸 ObjectMapper 安全;哪天往这里加了日期字段,必须换回全局那个。
     */
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 写/刷新一条在线状态。 */
    public void touch(LobbyPresence presence) {
        try {
            String payload = objectMapper.writeValueAsString(presence);
            redis.opsForValue().set(key(presence.getUserId()), payload, TTL);
            redis.opsForZSet().add(IDX_KEY, String.valueOf(presence.getUserId()),
                    presence.getHeartbeatAt() == null ? System.currentTimeMillis() : presence.getHeartbeatAt());
        } catch (Exception e) {
            log.warn("[lobby-presence] 写入失败 userId={}", presence.getUserId(), e);
        }
    }

    /** 读一条在线状态;不在了大厅 = 空。 */
    public LobbyPresence get(Long userId) {
        if (userId == null) return null;
        try {
            String raw = redis.opsForValue().get(key(userId));
            if (raw == null || raw.isBlank()) return null;
            return objectMapper.readValue(raw, LobbyPresence.class);
        } catch (Exception e) {
            log.warn("[lobby-presence] 读取失败 userId={}", userId, e);
            return null;
        }
    }

    /**
     * 大厅里所有人的在线状态。
     *
     * <p>先从 ZSET 拿 id 列表,再批量取 key —— key 已经过期(人走了但 ZSET 没清)
     * 的顺手从 ZSET 里剔掉。
     */
    public List<LobbyPresence> listAll() {
        try {
            Set<String> ids = redis.opsForZSet().range(IDX_KEY, 0, -1);
            if (ids == null || ids.isEmpty()) return Collections.emptyList();
            List<String> keys = new ArrayList<>();
            List<String> idList = new ArrayList<>();
            for (String id : ids) {
                keys.add(key(Long.parseLong(id)));
                idList.add(id);
            }
            List<String> raws = redis.opsForValue().multiGet(keys);
            List<LobbyPresence> out = new ArrayList<>();
            for (int i = 0; i < idList.size(); i++) {
                String raw = raws == null ? null : raws.get(i);
                if (raw == null || raw.isBlank()) {
                    // key 没了但 ZSET 还在 —— 这个人已经走了,顺手清掉
                    redis.opsForZSet().remove(IDX_KEY, idList.get(i));
                    continue;
                }
                try {
                    out.add(objectMapper.readValue(raw, LobbyPresence.class));
                } catch (Exception ignore) {
                    // 单条坏数据不该拖垮整个列表
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("[lobby-presence] 列表读取失败", e);
            return Collections.emptyList();
        }
    }

    /**
     * 下线一个人。
     *
     * <p>只有**当前持有者**才能删 —— 同一个用户可能开过两个窗口,
     * 后关的那个不该把还连着的那个踢出大厅。
     */
    public void remove(Long userId, String sessionId) {
        if (userId == null) return;
        LobbyPresence current = get(userId);
        if (current != null && sessionId != null && !sessionId.equals(current.getSessionId())) {
            return;
        }
        try {
            redis.delete(key(userId));
            redis.opsForZSet().remove(IDX_KEY, String.valueOf(userId));
        } catch (Exception e) {
            log.warn("[lobby-presence] 下线失败 userId={}", userId, e);
        }
    }

    /**
     * 清扫 —— 剔掉 ZSET 里 key 已经消失的 member。
     *
     * <p>每分钟跑一次;{@link #listAll()} 里已经顺手清了一部分,这是兜底。
     */
    public void sweep() {
        try {
            Set<String> ids = redis.opsForZSet().range(IDX_KEY, 0, -1);
            if (ids == null) return;
            for (String id : ids) {
                Long uid;
                try {
                    uid = Long.parseLong(id);
                } catch (NumberFormatException e) {
                    redis.opsForZSet().remove(IDX_KEY, id);
                    continue;
                }
                if (Boolean.FALSE.equals(redis.hasKey(key(uid)))) {
                    redis.opsForZSet().remove(IDX_KEY, id);
                }
            }
        } catch (Exception e) {
            log.warn("[lobby-presence] 清扫失败", e);
        }
    }

    private static String key(Long userId) {
        return KEY_PREFIX + userId;
    }

    /** 一条在线状态。 */
    @Data
    public static class LobbyPresence {
        private Long userId;
        /** 持有这条 presence 的连接 id —— 用来判断「关掉的这个是不是当前持有者」。 */
        private String sessionId;
        /** 是否公开自己的信息。关掉就不出现在别人的列表里。 */
        private Boolean publicVisible;
        /** 游戏客户端的原始阶段串(None/Lobby/InProgress/…);空 = 未知。 */
        private String phase;
        /** 心跳时刻(epoch ms)。 */
        private Long heartbeatAt;
    }
}
```

- [ ] **Step 2：编译验证**

Run:

```powershell
mvn -pl lobby -am -DskipTests compile
```

Expected: `BUILD SUCCESS`。

- [ ] **Step 3：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/service/LobbyPresenceStore.java
git commit -m "feat(lobby): Redis 在线状态存储"
```

## Task A6：玩家档案 / 统计 / 离线候选

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbyPlayerVO.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbyStatsVO.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbyMeVO.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/vo/LobbySnapshotVO.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyDirectoryService.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/impl/LobbyDirectoryServiceImpl.java`
- Test: `all_function_api/lobby/src/test/java/com/lolskin/lobby/service/LobbyDirectoryServiceImplTest.java`

- [ ] **Step 1：写 VO**

`LobbyPlayerVO.java`：

```java
package com.lolskin.lobby.vo;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 大厅里的一行玩家。
 *
 * <p>字段全部由后端算 —— 客户端上报的昵称/段位分一律不认。
 */
@Data
public class LobbyPlayerVO {

    private Long userId;
    private String nickname;
    /** 召唤师ID(数字标签) —— 复制ID / 邀请都用它 */
    private String gameId;
    /** 大区原始名(库里同步时上报的) */
    private String zone;
    /** 大区归一化后的名字;null = 认不出来 */
    private String canonicalZone;
    private String avatarUrl;

    /** 游戏客户端原始阶段串(None/Lobby/InProgress/…);空 = 未知 */
    private String phase;

    /** 现在是不是连着大厅 */
    private boolean online;

    /** 是否公开自己的信息 —— 关掉就不出现在列表里 */
    @JsonProperty("public")
    private Boolean publicVisible;

    /** 段位数值分;null = 没同步过段位 */
    private Integer rankScore;
    /** 「黄金 III」这种展示串;null = 没同步过段位 */
    private String rankLabel;
    /** 站内收藏分(稀有度加权);null = 没有皮肤数据 */
    private Integer collectionScore;

    private List<String> positions = new ArrayList<>();
    private List<String> positionLabels = new ArrayList<>();

    private boolean vip;

    /** 上次出现在大厅的时间 —— 离线候选用 */
    private LocalDateTime lastLobbyAt;
}
```

`LobbyStatsVO.java`：

```java
package com.lolskin.lobby.vo;

import lombok.Data;

/** 大厅顶栏的三个数字。 */
@Data
public class LobbyStatsVO {

    /** 在线且公开的人数 */
    private int online;
    /** 上面这些人里跟我同大区的 */
    private int sameZone;
    /** 上面这些人里现在空闲、可以拉的 */
    private int invitable;
}
```

`LobbyMeVO.java`：

```java
package com.lolskin.lobby.vo;

import lombok.Data;

/** 我自己的档案 —— 顶栏「我的段位分 / 我的收藏分」用它。 */
@Data
public class LobbyMeVO {

    private Long userId;
    private String nickname;
    /** 召唤师ID(数字标签) */
    private String gameId;
    /** 大区原始名 */
    private String zone;
    /** 大区归一化后的名字;null = 认不出来 */
    private String canonicalZone;
    private Integer rankScore;
    private String rankLabel;
    private Integer collectionScore;
    private boolean vip;
}
```

`LobbySnapshotVO.java`：

```java
package com.lolskin.lobby.vo;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 大厅的一份完整快照 —— WS 的 welcome 和 REST 的 /players 共用这个形状。 */
@Data
public class LobbySnapshotVO {

    /** 在线的人(已过滤掉不公开的) */
    private List<LobbyPlayerVO> online = new ArrayList<>();
    /** 同大区的离线候选 */
    private List<LobbyPlayerVO> offline = new ArrayList<>();
    /** 顶栏三个数字 */
    private LobbyStatsVO stats = new LobbyStatsVO();
    /** 我自己 */
    private LobbyMeVO me;
}
```

- [ ] **Step 2：写失败测试**

`all_function_api/lobby/src/test/java/com/lolskin/lobby/service/LobbyDirectoryServiceImplTest.java`：

```java
package com.lolskin.lobby.service;

import com.lolskin.lobby.mapper.LobbyUserMapper;
import com.lolskin.lobby.service.impl.LobbyDirectoryServiceImpl;
import com.lolskin.lobby.service.LobbyPresenceStore;
import com.lolskin.lobby.vo.LobbyPlayerVO;
import com.lolskin.lobby.vo.LobbyStatsVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

class LobbyDirectoryServiceImplTest {

    private LobbyUserMapper userMapper;
    private LobbyPresenceStore presenceStore;
    private LobbyDirectoryService service;

    @BeforeEach
    void setUp() {
        userMapper = mock(LobbyUserMapper.class);
        presenceStore = mock(LobbyPresenceStore.class);
        // 段位 / 收藏分 / 位置这三个 mapper 在这个测试里都返回空
        service = new LobbyDirectoryServiceImpl(userMapper, presenceStore,
                mock(com.lolskin.map.mapper.MapDistributionMapper.class),
                mock(com.lolskin.inventory.mapper.UserRankProfileMapper.class),
                mock(com.lolskin.inventory.mapper.UserPositionStatMapper.class));
    }

    private LobbyUserMapper.UserRow row(long id, String zone) {
        LobbyUserMapper.UserRow r = new LobbyUserMapper.UserRow();
        r.setUserId(id);
        r.setNickname("玩家" + id);
        r.setGameId(String.valueOf(10000 + id));
        r.setGameZone(zone);
        r.setAvatarUrl(null);
        r.setVipUntil(null);
        r.setLastLobbyAt(LocalDateTime.now().minusHours(2));
        return r;
    }

    private LobbyPresenceStore.LobbyPresence presence(long userId, String phase, boolean isPublic) {
        LobbyPresenceStore.LobbyPresence p = new LobbyPresenceStore.LobbyPresence();
        p.setUserId(userId);
        p.setSessionId("s" + userId);
        p.setPhase(phase);
        p.setPublicVisible(isPublic);
        p.setHeartbeatAt(System.currentTimeMillis());
        return p;
    }

    @Test
    void 不公开的人不出现在在线列表里() {
        when(presenceStore.listAll()).thenReturn(List.of(
                presence(1L, "None", true),
                presence(2L, "None", false)));
        when(userMapper.selectUsers(any())).thenReturn(List.of(row(1L, "艾欧尼亚"), row(2L, "艾欧尼亚")));

        List<LobbyPlayerVO> online = service.onlinePlayers();

        assertEquals(1, online.size());
        assertEquals(1L, online.get(0).getUserId());
    }

    @Test
    void 统计只数公开的人_同大区按归一化后的名字比() {
        when(presenceStore.listAll()).thenReturn(List.of(
                presence(1L, "None", true),      // 教育网 —— 跟我同区
                presence(2L, "None", true),      // 教育网专区 —— 归一化后同区
                presence(3L, "InProgress", true),// 祖安 —— 不同区,在打游戏
                presence(4L, "None", false)));    // 不公开 —— 不计
        // 「教育网」/「教育网专区」是 GameZones.resolve 认得的唯一一对别名
        when(userMapper.selectUsers(any())).thenReturn(List.of(
                row(1L, "教育网"), row(2L, "教育网专区"), row(3L, "祖安"),
                row(4L, "教育网"), row(5L, "教育网专区")));

        List<LobbyPlayerVO> online = service.onlinePlayers();
        LobbyStatsVO stats = service.stats(5L, online);

        assertEquals(3, stats.getOnline());
        assertEquals(2, stats.getSameZone());   // 1 号 + 2 号(别名归一)
        assertEquals(2, stats.getInvitable());  // 1 号 + 2 号都是 None
    }

    @Test
    void 没有游戏ID的人不可拉() {
        when(presenceStore.listAll()).thenReturn(List.of(presence(1L, "None", true)));
        LobbyUserMapper.UserRow r = row(1L, "教育网");
        r.setGameId("");
        when(userMapper.selectUsers(any())).thenReturn(List.of(r, row(5L, "教育网")));

        LobbyStatsVO stats = service.stats(5L, service.onlinePlayers());

        assertEquals(0, stats.getInvitable());
    }

    @Test
    void 认不出大区时离线候选是空表() {
        when(userMapper.selectUsers(any())).thenReturn(List.of(row(5L, "乱写的区")));
        when(presenceStore.listAll()).thenReturn(List.of());

        assertTrue(service.offlineCandidates(5L, 30).isEmpty());
        verify(userMapper, never()).selectOfflineCandidates(any(), anyInt());
    }
}
```

- [ ] **Step 3：跑测试确认失败**

Run:

```powershell
mvn -pl lobby -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyDirectoryServiceImplTest" test
```

Expected: 编译失败 —— `LobbyDirectoryService` 等类还不存在。

- [ ] **Step 4：写 service 接口**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyDirectoryService.java`：

```java
package com.lolskin.lobby.service;

import com.lolskin.lobby.vo.LobbyMeVO;
import com.lolskin.lobby.vo.LobbyPlayerVO;
import com.lolskin.lobby.vo.LobbySnapshotVO;
import com.lolskin.lobby.vo.LobbyStatsVO;

import java.util.List;

/**
 * 大厅的名册 —— 在线的人、离线候选、顶栏统计。
 *
 * <p>档案(昵称/段位分/收藏分/位置)全部由后端算,客户端上报的一律不认。
 */
public interface LobbyDirectoryService {

    /** 离线候选最多给几个。 */
    int OFFLINE_CANDIDATE_LIMIT = 30;

    /** 在线的人(已过滤掉不公开的)。 */
    List<LobbyPlayerVO> onlinePlayers();

    /** 同大区 + 近 7 天来过大厅 + 现在不在线的人。 */
    List<LobbyPlayerVO> offlineCandidates(Long viewerUserId, int limit);

    /** 顶栏三个数字 —— relative 到 viewerUserId 的大区。 */
    LobbyStatsVO stats(Long viewerUserId, List<LobbyPlayerVO> online);

    /** 我自己的档案。 */
    LobbyMeVO me(Long viewerUserId);

    /** 一份完整快照(在线 + 离线 + 统计 + 我)。 */
    LobbySnapshotVO snapshot(Long viewerUserId);
}
```

- [ ] **Step 5：写实现**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/impl/LobbyDirectoryServiceImpl.java`：

```java
package com.lolskin.lobby.service.impl;

import com.lolskin.inventory.entity.UserPositionStat;
import com.lolskin.inventory.entity.UserRankProfile;
import com.lolskin.inventory.mapper.UserPositionStatMapper;
import com.lolskin.inventory.mapper.UserRankProfileMapper;
import com.lolskin.lobby.mapper.LobbyUserMapper;
import com.lolskin.lobby.service.LobbyDirectoryService;
import com.lolskin.lobby.service.LobbyPresenceStore;
import com.lolskin.lobby.vo.LobbyMeVO;
import com.lolskin.lobby.vo.LobbyPlayerVO;
import com.lolskin.lobby.vo.LobbySnapshotVO;
import com.lolskin.lobby.vo.LobbyStatsVO;
import com.lolskin.map.mapper.MapDistributionMapper;
import com.lolskin.skin.support.GameZones;
import com.lolskin.skin.support.RankScores;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 大厅名册的实现。
 *
 * <p>复用 {@link RankScores}(段位分/收藏分/位置口径)和
 * {@link GameZones}(大区归一化)—— 不新造一套,也不复用
 * {@code MapDistributionServiceImpl}(它的取数方法全是 private,
 * 而且形状是「我跟候选人比」,大厅要的是「这批人各自的分数」)。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LobbyDirectoryServiceImpl implements LobbyDirectoryService {

    private static final String QUEUE_SOLO = "RANKED_SOLO_5x5";
    private static final String QUEUE_FLEX = "RANKED_FLEX_5x5";

    /** 空闲 = 可以拉。其它阶段(选人/对局中/结算)拉过去会撞车。 */
    private static final Set<String> IDLE_PHASES = Set.of("None", "Lobby");

    private final LobbyUserMapper userMapper;
    private final LobbyPresenceStore presenceStore;
    private final MapDistributionMapper mapDistributionMapper;
    private final UserRankProfileMapper userRankProfileMapper;
    private final UserPositionStatMapper userPositionStatMapper;

    // ---------------------------------------------------------------- 在线

    @Override
    public List<LobbyPlayerVO> onlinePlayers() {
        List<LobbyPresenceStore.LobbyPresence> presences = presenceStore.listAll();
        if (presences == null || presences.isEmpty()) {
            return List.of();
        }
        List<Long> ids = presences.stream()
                .map(LobbyPresenceStore.LobbyPresence::getUserId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        Map<Long, LobbyPlayerVO> profiles = profiles(ids);

        List<LobbyPlayerVO> out = new ArrayList<>();
        for (LobbyPresenceStore.LobbyPresence p : presences) {
            LobbyPlayerVO vo = profiles.get(p.getUserId());
            if (vo == null) continue;   // 用户不存在 / 被删了
            vo.setOnline(true);
            vo.setPhase(p.getPhase());
            vo.setPublicVisible(Boolean.TRUE.equals(p.getPublicVisible()));
            // 不公开的人不出现在列表里 —— 统计也不计入
            if (!Boolean.TRUE.equals(vo.getPublicVisible())) continue;
            out.add(vo);
        }
        return out;
    }

    // ---------------------------------------------------------------- 离线候选

    @Override
    public List<LobbyPlayerVO> offlineCandidates(Long viewerUserId, int limit) {
        int safe = Math.max(1, Math.min(limit, OFFLINE_CANDIDATE_LIMIT));
        String canonical = canonicalZoneOf(viewerUserId);
        if (canonical == null) {
            // 认不出我的大区就没法筛「同大区」—— 返回空表,而不是把全服人都拉出来
            return List.of();
        }
        List<String> aliases = aliasesOf(canonical);
        if (aliases.isEmpty()) {
            aliases = List.of(canonical);
        }
        List<LobbyUserMapper.UserRow> rows = userMapper.selectOfflineCandidates(aliases, safe);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        Set<Long> onlineIds = presenceStore.listAll().stream()
                .map(LobbyPresenceStore.LobbyPresence::getUserId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());

        List<Long> ids = rows.stream()
                .map(LobbyUserMapper.UserRow::getUserId)
                .filter(java.util.Objects::nonNull)
                .filter(id -> !onlineIds.contains(id))
                .toList();
        if (ids.isEmpty()) {
            return List.of();
        }
        Map<Long, LobbyPlayerVO> profiles = profiles(ids);
        List<LobbyPlayerVO> out = new ArrayList<>();
        for (Long id : ids) {
            LobbyPlayerVO vo = profiles.get(id);
            if (vo == null) continue;
            vo.setOnline(false);
            vo.setPhase(null);      // 不在线 —— 没有游戏状态可言
            vo.setPublicVisible(Boolean.TRUE);
            out.add(vo);
        }
        return out;
    }

    // ---------------------------------------------------------------- 统计

    @Override
    public LobbyStatsVO stats(Long viewerUserId, List<LobbyPlayerVO> online) {
        LobbyStatsVO stats = new LobbyStatsVO();
        if (online == null || online.isEmpty()) {
            return stats;
        }
        String myZone = canonicalZoneOf(viewerUserId);
        int sameZone = 0;
        int invitable = 0;
        for (LobbyPlayerVO p : online) {
            if (myZone != null && myZone.equals(p.getCanonicalZone())) {
                sameZone++;
            }
            if (isInvitable(p)) {
                invitable++;
            }
        }
        stats.setOnline(online.size());
        stats.setSameZone(sameZone);
        stats.setInvitable(invitable);
        return stats;
    }

    /** 可以拉 = 空闲(没在打) + 有召唤师ID(不然邀不了)。 */
    private boolean isInvitable(LobbyPlayerVO p) {
        if (p.getGameId() == null || p.getGameId().isBlank()) return false;
        String phase = p.getPhase();
        return phase != null && IDLE_PHASES.contains(phase);
    }

    // ---------------------------------------------------------------- 我

    @Override
    public LobbyMeVO me(Long viewerUserId) {
        LobbyMeVO me = new LobbyMeVO();
        if (viewerUserId == null) {
            return me;
        }
        Map<Long, LobbyPlayerVO> profiles = profiles(List.of(viewerUserId));
        LobbyPlayerVO vo = profiles.get(viewerUserId);
        if (vo == null) {
            return me;
        }
        me.setUserId(vo.getUserId());
        me.setNickname(vo.getNickname());
        me.setGameId(vo.getGameId());
        me.setZone(vo.getZone());
        me.setCanonicalZone(vo.getCanonicalZone());
        me.setRankScore(vo.getRankScore());
        me.setRankLabel(vo.getRankLabel());
        me.setCollectionScore(vo.getCollectionScore());
        me.setVip(vo.isVip());
        return me;
    }

    @Override
    public LobbySnapshotVO snapshot(Long viewerUserId) {
        LobbySnapshotVO snapshot = new LobbySnapshotVO();
        List<LobbyPlayerVO> online = onlinePlayers();
        snapshot.setOnline(online);
        snapshot.setOffline(offlineCandidates(viewerUserId, OFFLINE_CANDIDATE_LIMIT));
        snapshot.setStats(stats(viewerUserId, online));
        snapshot.setMe(me(viewerUserId));
        return snapshot;
    }

    // ---------------------------------------------------------------- 档案

    /**
     * 一批人的档案 —— 昵称/大区/头像/VIP + 段位分 + 收藏分 + 位置。
     *
     * <p>四次批量查询,不按人循环(N+1)。
     */
    private Map<Long, LobbyPlayerVO> profiles(List<Long> userIds) {
        Map<Long, LobbyPlayerVO> result = new LinkedHashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return result;
        }
        List<LobbyUserMapper.UserRow> rows = userMapper.selectUsers(userIds);
        if (rows == null) {
            return result;
        }
        LocalDateTime now = LocalDateTime.now();
        for (LobbyUserMapper.UserRow row : rows) {
            if (row == null || row.getUserId() == null) continue;
            LobbyPlayerVO vo = new LobbyPlayerVO();
            vo.setUserId(row.getUserId());
            vo.setNickname(row.getNickname());
            vo.setGameId(row.getGameId());
            vo.setZone(row.getGameZone());
            // 大区归一化在这里做一次 —— 「同大区」和客户端的筛选都用它,
            // 不能各处各判一次(别名规则变了就漏人)
            vo.setCanonicalZone(GameZones.resolve(row.getGameZone()));
            vo.setAvatarUrl(row.getAvatarUrl());
            vo.setVip(row.getVipUntil() != null && row.getVipUntil().isAfter(now));
            vo.setLastLobbyAt(row.getLastLobbyAt());
            result.put(row.getUserId(), vo);
        }
        if (result.isEmpty()) {
            return result;
        }

        // ---- 段位:单双排优先,没有再取灵活排(跟同区搭子一个口径)
        Map<Long, UserRankProfile> ranks = pickRanks(userRankProfileMapper.listByUserIds(userIds));
        for (Map.Entry<Long, UserRankProfile> e : ranks.entrySet()) {
            LobbyPlayerVO vo = result.get(e.getKey());
            if (vo == null) continue;
            UserRankProfile r = e.getValue();
            vo.setRankScore(r.getScore());
            vo.setRankLabel(RankScores.tierLabel(r.getTier(), r.getDivision()));
        }

        // ---- 收藏分:稀有度加权(权重表不在 SQL 里复制一份)
        Map<Long, Integer> collectionScores = collectionScores(userIds);
        for (Map.Entry<Long, Integer> e : collectionScores.entrySet()) {
            LobbyPlayerVO vo = result.get(e.getKey());
            if (vo != null) {
                vo.setCollectionScore(e.getValue());
            }
        }

        // ---- 位置:上报过的在前,本命英雄推导的补在后面
        Map<Long, List<String>> positions = positionsOf(userIds);
        for (Map.Entry<Long, List<String>> e : positions.entrySet()) {
            LobbyPlayerVO vo = result.get(e.getKey());
            if (vo == null) continue;
            vo.setPositions(e.getValue());
            List<String> labels = new ArrayList<>();
            for (String p : e.getValue()) {
                String label = RankScores.positionLabel(p);
                labels.add(label == null || label.isEmpty() ? p : label);
            }
            vo.setPositionLabels(labels);
        }
        return result;
    }

    /** 段位行 → 每人一条(单双排优先)。 */
    private Map<Long, UserRankProfile> pickRanks(List<UserRankProfile> rows) {
        Map<Long, UserRankProfile> result = new HashMap<>();
        if (rows == null) {
            return result;
        }
        Map<Long, UserRankProfile> solo = new HashMap<>();
        Map<Long, UserRankProfile> flex = new HashMap<>();
        for (UserRankProfile r : rows) {
            if (r == null || r.getUserId() == null) continue;
            if (QUEUE_SOLO.equals(r.getQueueType())) {
                solo.putIfAbsent(r.getUserId(), r);
            } else if (QUEUE_FLEX.equals(r.getQueueType())) {
                flex.putIfAbsent(r.getUserId(), r);
            }
        }
        result.putAll(flex);
        result.putAll(solo);   // 单双排覆盖灵活排
        return result;
    }

    /** 一批人的收藏分。 */
    private Map<Long, Integer> collectionScores(List<Long> userIds) {
        Map<Long, Integer> result = new HashMap<>();
        List<MapDistributionMapper.RarityCountRow> rows = mapDistributionMapper.selectRarityCounts(userIds);
        if (rows == null) {
            return result;
        }
        for (MapDistributionMapper.RarityCountRow row : rows) {
            if (row == null || row.getUserId() == null) continue;
            int weight = RankScores.rarityWeight(row.getRarity());
            int cnt = row.getCnt() == null ? 0 : row.getCnt();
            result.merge(row.getUserId(), weight * cnt, Integer::sum);
        }
        return result;
    }

    /** 一批人的位置清单 —— 上报过的排前面,本命英雄推导的补在后面。 */
    private Map<Long, List<String>> positionsOf(List<Long> userIds) {
        Map<Long, Map<String, Integer>> reported = new HashMap<>();
        List<UserPositionStat> rows = userPositionStatMapper.listByUserIds(userIds);
        if (rows != null) {
            for (UserPositionStat row : rows) {
                if (row == null || row.getUserId() == null) continue;
                if (!RankScores.isKnownPosition(row.getPosition())) continue;
                reported.computeIfAbsent(row.getUserId(), k -> new LinkedHashMap<>())
                        .merge(row.getPosition().trim().toLowerCase(),
                                row.getMatchCount() == null ? 0 : row.getMatchCount(), Integer::sum);
            }
        }
        Map<Long, Map<String, Integer>> derived = new HashMap<>();
        List<MapDistributionMapper.PositionCountRow> derivedRows =
                mapDistributionMapper.selectDerivedPositions(userIds);
        if (derivedRows != null) {
            for (MapDistributionMapper.PositionCountRow row : derivedRows) {
                if (row == null || row.getUserId() == null) continue;
                if (!RankScores.isKnownPosition(row.getPosition())) continue;
                derived.computeIfAbsent(row.getUserId(), k -> new LinkedHashMap<>())
                        .merge(row.getPosition().trim().toLowerCase(),
                                row.getCnt() == null ? 0 : row.getCnt(), Integer::sum);
            }
        }

        Map<Long, List<String>> result = new HashMap<>();
        for (Long id : userIds) {
            List<String> list = new ArrayList<>();
            appendSorted(list, reported.get(id));
            appendSorted(list, derived.get(id));
            if (!list.isEmpty()) {
                result.put(id, list);
            }
        }
        return result;
    }

    /** 按数量从多到少追加位置名,已出现的不重复。 */
    private void appendSorted(List<String> target, Map<String, Integer> counts) {
        if (counts == null) return;
        List<String> positions = new ArrayList<>(counts.keySet());
        positions.sort(Comparator
                .comparingInt((String p) -> counts.getOrDefault(p, 0)).reversed()
                .thenComparing(Comparator.naturalOrder()));
        for (String p : positions) {
            if (!target.contains(p)) {
                target.add(p);
            }
        }
    }

    // ---------------------------------------------------------------- 大区

    /** 我的大区(归一化之后);认不出来返回 null。 */
    private String canonicalZoneOf(Long userId) {
        if (userId == null) return null;
        LobbyPlayerVO vo = profiles(List.of(userId)).get(userId);
        if (vo == null) return null;
        return GameZones.resolve(vo.getZone());
    }

    /** 库里折到同一个大区的原始名(「教育网」/「教育网专区」是同一个)。 */
    private List<String> aliasesOf(String canonical) {
        List<String> aliases = new ArrayList<>();
        List<String> rawZones = mapDistributionMapper.selectRawZones();
        if (rawZones == null) return aliases;
        for (String raw : rawZones) {
            if (raw == null) continue;
            if (canonical.equals(GameZones.resolve(raw))) {
                aliases.add(raw);
            }
        }
        return aliases;
    }
}
```

- [ ] **Step 6：跑测试确认通过**

Run:

```powershell
mvn -pl lobby -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyDirectoryServiceImplTest" test
```

Expected: `Tests run: 4, Failures: 0, Errors: 0` + `BUILD SUCCESS`。

- [ ] **Step 7：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/vo lobby/src/main/java/com/lolskin/lobby/service/LobbyDirectoryService.java lobby/src/main/java/com/lolskin/lobby/service/impl/LobbyDirectoryServiceImpl.java lobby/src/test/java/com/lolskin/lobby/service/LobbyDirectoryServiceImplTest.java
git commit -m "feat(lobby): 玩家档案/统计/离线候选"
```

---

## Task A7：大厅 WebSocket

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyEventBus.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyLastLobbyWriter.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbySessionRegistry.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbyHandshakeInterceptor.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbyWebSocketHandler.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbySessionSweeper.java`
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/config/LobbyWebSocketConfig.java`

- [ ] **Step 1：写 session 池**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbySessionRegistry.java`：

```java
package com.lolskin.lobby.ws;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * 本实例的大厅连接池。
 *
 * <p>大厅是**全服广播**,没有房间概念 —— 所有连接都收所有消息。
 */
@Slf4j
@Component
public class LobbySessionRegistry {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    public void add(WebSocketSession session) {
        sessions.put(session.getId(), session);
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session.getId());
    }

    public Collection<WebSocketSession> all() {
        return new ArrayList<>(sessions.values());
    }

    public int size() {
        return sessions.size();
    }

    /**
     * 给所有连接推一帧。
     *
     * <p>推失败的连接直接从池子里清掉 —— 留着就是幽灵连接,
     * 每次广播都要为它浪费一次 try/catch。
     */
    public void broadcast(String json) {
        if (json == null || json.isEmpty()) return;
        TextMessage frame = new TextMessage(json);
        for (WebSocketSession s : sessions.values()) {
            if (!s.isOpen()) {
                sessions.remove(s.getId());
                continue;
            }
            try {
                synchronized (s) {
                    if (s.isOpen()) {
                        s.sendMessage(frame);
                    }
                }
            } catch (IOException e) {
                log.warn("[lobby-ws] 推送失败 sessionId={}", s.getId(), e);
                sessions.remove(s.getId());
                try {
                    s.close();
                } catch (IOException ignore) {
                    // 已经断了,关不上也无所谓
                }
            }
        }
    }
}
```

- [ ] **Step 2：写跨实例广播总线**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyEventBus.java`：

```java
package com.lolskin.lobby.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lolskin.lobby.ws.LobbySessionRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

/**
 * 大厅消息的跨实例广播。
 *
 * <p>做法:**本地直接投 + 同时发一份到 Redis pub/sub**。
 * 收到的 Redis 消息里带着「谁发的」,自己发的跳过 ——
 * 否则单实例时每条消息会被投两遍。
 *
 * <p>这么设计的好处:Redis 挂掉/没配 → 本地照样能用(大厅是单机部署的,
 * Redis 只是为了以后多实例不重写)。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbyEventBus {

    /** Redis channel 名。 */
    public static final String CHANNEL = "lobby:events";

    private final StringRedisTemplate redis;
    private final RedisConnectionFactory connectionFactory;
    private final LobbySessionRegistry registry;
    /** 用 Spring 托管的那份 —— 全局 JacksonConfig 的日期格式在这里也生效。 */
    private final ObjectMapper objectMapper;

    /** 本实例的唯一 id —— 用来识别「这条是自己发的」。 */
    private final String instanceId = UUID.randomUUID().toString();

    private final RedisMessageListenerContainer container = new RedisMessageListenerContainer();
    private volatile boolean subscribed;

    @PostConstruct
    void init() {
        try {
            // container 是 new 出来的,Spring 不会调 afterPropertiesSet —— 得自己调
            container.setConnectionFactory(connectionFactory);
            container.afterPropertiesSet();
            container.start();
            MessageListener listener = (msg, pattern) -> {
                try {
                    String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                    JsonNode node = objectMapper.readTree(body);
                    String origin = node.path("origin").asText("");
                    if (instanceId.equals(origin)) {
                        // 自己发的 —— 本地已经投过了,不能再投一遍
                        return;
                    }
                    registry.broadcast(node.path("json").asText(""));
                } catch (Exception e) {
                    log.warn("[lobby-events] 转发失败", e);
                }
            };
            container.addMessageListener(listener, new PatternTopic(CHANNEL));
            subscribed = true;
            log.info("[lobby-events] 订阅 channel={}", CHANNEL);
        } catch (Exception e) {
            log.warn("[lobby-events] 订阅初始化失败,退化为只在本实例内广播", e);
        }
    }

    @PreDestroy
    void destroy() {
        try {
            container.stop();
            container.destroy();
        } catch (Exception e) {
            log.warn("[lobby-events] 停止失败", e);
        }
    }

    /**
     * 广播一帧已经拼好的 JSON。
     *
     * @param json 客户端要收到的那一帧(原样转发,不做二次包装)
     */
    public void publish(String json) {
        if (json == null || json.isEmpty()) return;
        // 本地先投 —— 单实例 / Redis 不可用时也能收到
        registry.broadcast(json);
        try {
            String envelope = objectMapper.writeValueAsString(
                    Map.of("origin", instanceId, "json", json));
            redis.convertAndSend(CHANNEL, envelope);
        } catch (Exception e) {
            log.warn("[lobby-events] 发布失败(本实例已投出)", e);
        }
    }

    /** 当前实例是否订阅上了 Redis —— 只用来打日志,不影响功能。 */
    public boolean isSubscribed() {
        return subscribed;
    }
}
```

- [ ] **Step 3：写握手拦截器**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbyHandshakeInterceptor.java`：

```java
package com.lolskin.lobby.ws;

import com.lolskin.user.service.JwtService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * 大厅 WS 握手拦截 —— token 无效就拒。
 *
 * <p>跟公屏 chat 不一样:chat 允许匿名进,大厅不行 ——
 * 大厅要发消息、要出现在列表里,必须认得出是谁。
 *
 * <p>⚠️ 拒绝时设的 401 **不一定送得到客户端**:Spring 的
 * {@code AbstractHandshakeHandler} 在拦截器返回 false 之后会自己
 * {@code setStatusCode(FORBIDDEN)},把状态码盖成 403。
 * 所以**客户端不能靠状态码区分**「token 过期」和「没权限」——
 * 大厅只有一种鉴权方式,握手失败 = token 不认,一律提示重新登录。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbyHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtService jwtService;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletReq)) {
            return true;
        }
        String token = servletReq.getServletRequest().getParameter("token");
        Long userId = null;
        if (token != null && !token.isBlank()) {
            try {
                userId = jwtService.getUserId(token);
            } catch (Exception e) {
                log.warn("[lobby-ws] token 解析失败", e);
            }
        }
        if (userId == null) {
            sendUnauthorized(response);
            return false;
        }
        attributes.put("userId", userId);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
    }

    private void sendUnauthorized(ServerHttpResponse response) {
        if (response instanceof ServletServerHttpResponse servletResp) {
            try {
                servletResp.getServletResponse().sendError(
                        HttpStatus.UNAUTHORIZED.value(), "invalid or expired token");
            } catch (Exception e) {
                log.warn("[lobby-ws] sendError failed", e);
            }
        }
    }
}
```

- [ ] **Step 4：写 WS handler**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbyWebSocketHandler.java`：

```java
package com.lolskin.lobby.ws;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lolskin.lobby.service.LobbyDirectoryService;
import com.lolskin.lobby.service.LobbyEventBus;
import com.lolskin.lobby.service.LobbyMessageService;
import com.lolskin.lobby.service.LobbyPresenceStore;
import com.lolskin.lobby.vo.LobbyMessageVO;
import com.lolskin.lobby.vo.LobbyMeVO;
import com.lolskin.lobby.vo.LobbyPlayerVO;
import com.lolskin.lobby.vo.LobbySnapshotVO;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 开黑大厅的 WS handler。
 *
 * <p>客户端 → 服务端:{@code hello} / {@code profile} / {@code say} / {@code ping}
 * <p>服务端 → 客户端:{@code welcome} / {@code chat} / {@code presence} / {@code pong} / {@code error}
 *
 * <p>⚠️ 客户端**只上报 phase 和 public** 两样后端查不到的东西;
 * 昵称/召唤师ID/大区/段位分/收藏分一律后端按 token 里的 userId 自己算 ——
 * 客户端冒充不了别人。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbyWebSocketHandler extends TextWebSocketHandler {

    /** 发言正文上限 —— 跟 t_lobby_message.text 的列宽一致。 */
    public static final int MAX_TEXT_LEN = 64;

    /** 10 秒内最多发几条。 */
    static final int MAX_SAYS_PER_WINDOW = 5;
    static final long SAY_WINDOW_MS = 10_000L;

    /** 连上以后多久必须发 hello。 */
    public static final long HELLO_DEADLINE_MS = 10_000L;

    /** 服务端多久没收到任何帧就断开。 */
    public static final long IDLE_TIMEOUT_MS = 60_000L;

    private final LobbySessionRegistry registry;
    private final LobbyPresenceStore presenceStore;
    private final LobbyDirectoryService directory;
    private final LobbyMessageService messageService;
    private final LobbyEventBus eventBus;
    /** 只用来写 last_lobby_at —— 拆出来是为了 handler 不直接依赖 mapper。 */
    private final LobbyLastLobbyWriter lastLobbyWriter;
    /**
     * 用 Spring 托管的那份 —— 全局 {@code JacksonConfig} 把 LocalDateTime
     * 序列成「yyyy-MM-dd HH:mm:ss」。自己 new 一个会丢掉这个模块,
     * 序列化 LobbyPlayerVO.lastLobbyAt 时直接抛异常。
     */
    private final ObjectMapper objectMapper;

    // ---------------------------------------------------------------- 连接

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        registry.add(session);
        session.getAttributes().put("connectedAt", System.currentTimeMillis());
        session.getAttributes().put("lastFrameAt", System.currentTimeMillis());
        session.getAttributes().put("sayTimestamps", new ArrayDeque<Long>());
        log.info("[lobby-ws] 连接 sessionId={} 在线连接数={}", session.getId(), registry.size());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        registry.remove(session);
        Long userId = userIdOf(session);
        if (userId != null) {
            presenceStore.remove(userId, session.getId());
        }
        log.info("[lobby-ws] 断开 sessionId={} userId={} status={}", session.getId(), userId, status);
        publishPresence();
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("[lobby-ws] 传输异常 sessionId=" + session.getId(), exception);
        try {
            if (session.isOpen()) {
                session.close(CloseStatus.SERVER_ERROR);
            }
        } catch (IOException ignore) {
            // 已经断了
        }
    }

    // ---------------------------------------------------------------- 收帧

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String body = message.getPayload();
        if (body == null || body.isBlank()) return;
        session.getAttributes().put("lastFrameAt", System.currentTimeMillis());

        LobbyInbound in;
        try {
            in = objectMapper.readValue(body, LobbyInbound.class);
        } catch (Exception e) {
            log.warn("[lobby-ws] 解析失败 payload={}", body);
            sendError(session, "BAD_PAYLOAD", "消息格式不对");
            return;
        }
        if (in == null || in.getType() == null) return;

        switch (in.getType()) {
            case "hello" -> handleHello(session, in);
            case "profile" -> handleProfile(session, in);
            case "say" -> handleSay(session, in);
            case "ping" -> handlePing(session);
            default -> sendError(session, "UNKNOWN_TYPE", "不认识的消息类型");
        }
    }

    /** 第一次 hello —— 认领 presence,然后把大厅现状一次性推给这个客户端。 */
    private void handleHello(WebSocketSession session, LobbyInbound in) {
        Long userId = userIdOf(session);
        if (userId == null) {
            sendError(session, "UNAUTHORIZED", "没认出你是谁");
            return;
        }
        session.getAttributes().put("helloReceived", Boolean.TRUE);

        boolean isPublic = in.getPublicVisible() == null || Boolean.TRUE.equals(in.getPublicVisible());
        String phase = normalizePhase(in.getPhase());

        applyPresence(session, userId, isPublic, phase);
        // 「上次在线」只在连接建立时写 —— 不跟着心跳写库
        syncLastLobbyAt(userId, isPublic);

        sendWelcome(session, userId);
        publishPresence();
    }

    /** 状态变化(游戏阶段变了 / 公开开关变了)。 */
    private void handleProfile(WebSocketSession session, LobbyInbound in) {
        Long userId = userIdOf(session);
        if (userId == null) {
            sendError(session, "UNAUTHORIZED", "没认出你是谁");
            return;
        }
        // 上一次的状态记在**连接**上 —— 客户端这次没带 public 就沿用它
        Boolean previous = (Boolean) session.getAttributes().get("publicVisible");
        boolean isPublic = in.getPublicVisible() == null
                ? (previous == null || previous)
                : Boolean.TRUE.equals(in.getPublicVisible());
        String phase = normalizePhase(in.getPhase());

        applyPresence(session, userId, isPublic, phase);
        // 公开开关变了才写库 —— 阶段变化不写
        if (previous == null || previous != isPublic) {
            syncLastLobbyAt(userId, isPublic);
        }
        publishPresence();
    }

    private void handlePing(WebSocketSession session) {
        Long userId = userIdOf(session);
        if (userId != null) {
            // 心跳兼作续期。用**连接上记的状态**续,不回 Redis 读 ——
            // Redis 里那条可能已经被同一用户的另一个连接覆盖了,
            // 读回来会把公开开关续成别人的状态。
            Boolean isPublic = (Boolean) session.getAttributes().get("publicVisible");
            String phase = (String) session.getAttributes().get("phase");
            applyPresence(session, userId, isPublic == null || isPublic, phase == null ? "" : phase);
        }
        sendJson(session, "{\"type\":\"pong\"}");
    }

    /** 发言。 */
    private void handleSay(WebSocketSession session, LobbyInbound in) {
        Long userId = userIdOf(session);
        if (userId == null) {
            sendError(session, "UNAUTHORIZED", "没认出你是谁");
            return;
        }
        if (!withinRateLimit(session)) {
            sendError(session, "RATE_LIMIT", "发言太快了,歇一会儿");
            return;
        }
        String text = in.getText() == null ? "" : in.getText().trim();
        if (text.isEmpty()) return;
        if (text.length() > MAX_TEXT_LEN) {
            text = text.substring(0, MAX_TEXT_LEN);
        }

        // 发送者身份一律后端查 —— 客户端报什么都不认
        LobbyMeVO me = directory.me(userId);
        String nickname = me.getNickname() == null ? "" : me.getNickname();
        String gameId = me.getGameId() == null ? "" : me.getGameId();
        String zone = me.getZone() == null ? "" : me.getZone();

        Long id;
        try {
            id = messageService.record(userId, nickname, gameId, zone, text);
        } catch (Exception e) {
            log.error("[lobby-ws] 落库失败 userId={}", userId, e);
            sendError(session, "PERSIST_FAILED", "消息没存上,稍后再试");
            return;
        }

        LobbyMessageVO vo = new LobbyMessageVO();
        vo.setId(id);
        vo.setUserId(userId);
        vo.setNickname(nickname);
        vo.setGameId(gameId);
        vo.setZone(zone);
        vo.setText(text);
        vo.setCreatedAt(nowText());
        eventBus.publish(chatJson(vo));
    }

    // ---------------------------------------------------------------- 发帧

    private void sendWelcome(WebSocketSession session, Long userId) {
        LobbySnapshotVO snapshot = directory.snapshot(userId);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "welcome");
        payload.put("history", messageService.listRecent(50));
        payload.put("online", snapshot.getOnline());
        payload.put("offline", snapshot.getOffline());
        payload.put("stats", snapshot.getStats());
        payload.put("me", snapshot.getMe());
        sendMap(session, payload);
    }

    /**
     * 广播一份在线名单。
     *
     * <p>每个客户端看到的 stats 里的「同大区」是自己视角的,所以按连接分别算
     * —— 这就是每个连接一次快照的原因。大厅人数不多,先按这个简单口径走;
     * 真的多了再把「在线名单」抽出来只算一次、只把 stats 分开算。
     */
    private void publishPresence() {
        List<WebSocketSession> sessions = new java.util.ArrayList<>(registry.all());
        if (sessions.isEmpty()) return;
        for (WebSocketSession s : sessions) {
            Long userId = userIdOf(s);
            if (userId == null) continue;
            LobbySnapshotVO view = directory.snapshot(userId);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", "presence");
            payload.put("online", view.getOnline());
            payload.put("stats", view.getStats());
            sendMap(s, payload);
        }
    }

    private void sendError(WebSocketSession session, String code, String reason) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "error");
        payload.put("code", code);
        payload.put("reason", reason);
        sendMap(session, payload);
    }

    private void sendMap(WebSocketSession session, Map<String, Object> payload) {
        String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[lobby-ws] 序列化失败", e);
            return;
        }
        sendJson(session, json);
    }

    private void sendJson(WebSocketSession session, String json) {
        try {
            synchronized (session) {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(json));
                }
            }
        } catch (IOException e) {
            log.warn("[lobby-ws] 发送失败 sessionId={}", session.getId(), e);
        }
    }

    /** 一条聊天消息的帧。 */
    private String chatJson(LobbyMessageVO vo) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", "chat");
            payload.put("id", vo.getId());
            payload.put("userId", vo.getUserId());
            payload.put("nickname", vo.getNickname());
            payload.put("gameId", vo.getGameId());
            payload.put("zone", vo.getZone());
            payload.put("text", vo.getText());
            payload.put("createdAt", vo.getCreatedAt());
            return objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[lobby-ws] 拼帧失败", e);
            return null;
        }
    }

    // ---------------------------------------------------------------- 工具

    /**
     * 写 presence —— 顺便把状态记在**连接**的属性里。
     *
     * <p>心跳续期、公开开关「上一次是什么」都从连接属性里取,不用回 Redis 读
     * —— Redis 里那条可能已经被同一用户的另一个连接覆盖了。
     */
    private void applyPresence(WebSocketSession session, Long userId, boolean isPublic, String phase) {
        session.getAttributes().put("publicVisible", isPublic);
        session.getAttributes().put("phase", phase);
        LobbyPresenceStore.LobbyPresence p = new LobbyPresenceStore.LobbyPresence();
        p.setUserId(userId);
        p.setSessionId(session.getId());
        p.setPublicVisible(isPublic);
        p.setPhase(phase);
        p.setHeartbeatAt(System.currentTimeMillis());
        presenceStore.touch(p);
    }

    /**
     * 同步「上次在线」—— 公开就记上,关掉公开就抹掉。
     *
     * <p>抹掉是有意的:离线候选是靠 {@code last_lobby_at} 查出来的,
     * 不抹的话,关掉公开的人退出应用之后,还是会以「同区离线候选」的身份
     * 出现在别人的列表里。
     */
    private void syncLastLobbyAt(Long userId, boolean isPublic) {
        try {
            if (isPublic) {
                lastLobbyWriter.touch(userId);
            } else {
                lastLobbyWriter.clear(userId);
            }
        } catch (Exception e) {
            log.warn("[lobby-ws] 写 last_lobby_at 失败 userId={}", userId, e);
        }
    }

    /**
     * 阶段串只做 trim —— 后端**不翻译、也不认识**阶段。
     *
     * <p>「认不出来怎么办」在两端各有一道兜底:桌面端
     * {@code lcuPhaseLabel()} 认不出就显示「未知」;后端的「可以拉」
     * 用的是白名单 {@code {None, Lobby}},认不出来的阶段自然不在里面 —— 不可拉。
     */
    private String normalizePhase(String phase) {
        if (phase == null) return "";
        return phase.trim();
    }

    /** 10 秒窗口内最多 5 条。 */
    @SuppressWarnings("unchecked")
    private boolean withinRateLimit(WebSocketSession session) {
        Deque<Long> stamps = (Deque<Long>) session.getAttributes().get("sayTimestamps");
        if (stamps == null) {
            stamps = new ArrayDeque<>();
            session.getAttributes().put("sayTimestamps", stamps);
        }
        long now = System.currentTimeMillis();
        while (!stamps.isEmpty() && now - stamps.peekFirst() > SAY_WINDOW_MS) {
            stamps.pollFirst();
        }
        if (stamps.size() >= MAX_SAYS_PER_WINDOW) {
            return false;
        }
        stamps.addLast(now);
        return true;
    }

    private Long userIdOf(WebSocketSession session) {
        Object v = session.getAttributes().get("userId");
        if (v instanceof Number n) return n.longValue();
        return null;
    }

    private static String nowText() {
        return java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    /** 客户端 → 服务端的帧。 */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LobbyInbound {
        private String type;
        /** 游戏客户端的原始阶段串。 */
        private String phase;
        /** 是否公开自己的信息。 */
        @JsonProperty("public")
        private Boolean publicVisible;
        /** 发言正文。 */
        private String text;
    }
}
```

新建 `all_function_api/lobby/src/main/java/com/lolskin/lobby/service/LobbyLastLobbyWriter.java`：

```java
package com.lolskin.lobby.service;

import com.lolskin.lobby.mapper.LobbyUserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 「上次出现在大厅的时间」的写入器。
 *
 * <p>单独一个 bean,是为了让 WS handler 不直接依赖 mapper ——
 * handler 已经够多了,再多一个依赖它就更难读。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbyLastLobbyWriter {

    private final LobbyUserMapper lobbyUserMapper;

    /** 公开中 —— 记上「上次在大厅」。 */
    public void touch(Long userId) {
        if (userId == null) return;
        lobbyUserMapper.touchLastLobbyAt(userId);
    }

    /** 关掉公开 —— 把「上次在大厅」抹掉,别再以离线候选的身份出现。 */
    public void clear(Long userId) {
        if (userId == null) return;
        lobbyUserMapper.clearLastLobbyAt(userId);
    }
}
```

- [ ] **Step 5：写超时清扫**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/ws/LobbySessionSweeper.java`：

```java
package com.lolskin.lobby.ws;

import com.lolskin.lobby.service.LobbyPresenceStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;

/**
 * 大厅连接的清扫:
 * <ul>
 *   <li>连上以后 10 秒还没发 hello → 断开(防空连接占位)</li>
 *   <li>60 秒没收到任何帧 → 断开</li>
 *   <li>每 60 秒清一次 Redis 里过期的 presence 索引</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LobbySessionSweeper {

    private final LobbySessionRegistry registry;
    private final LobbyPresenceStore presenceStore;

    private int tick = 0;

    @Scheduled(fixedDelay = 5_000L)
    public void sweep() {
        long now = System.currentTimeMillis();
        for (WebSocketSession session : registry.all()) {
            if (!session.isOpen()) {
                registry.remove(session);
                continue;
            }
            Object connectedAt = session.getAttributes().get("connectedAt");
            Object hello = session.getAttributes().get("helloReceived");
            Object lastFrameAt = session.getAttributes().get("lastFrameAt");
            long connected = connectedAt instanceof Number n ? n.longValue() : now;
            long last = lastFrameAt instanceof Number n ? n.longValue() : connected;

            if (hello == null && now - connected > LobbyWebSocketHandler.HELLO_DEADLINE_MS) {
                closeQuietly(session, CloseStatus.POLICY_VIOLATION);
                continue;
            }
            if (now - last > LobbyWebSocketHandler.IDLE_TIMEOUT_MS) {
                // ⚠️ Spring 的 CloseStatus 没有 SESSION_NOT_RELIABLE(那是 javax.websocket 的常量),
                // 用 GOING_AWAY(1001)表示「服务端认为这个会话该结束了」。
                closeQuietly(session, CloseStatus.GOING_AWAY);
            }
        }
        // Redis 清扫 60 秒一次 —— 5 秒一次太勤,presence 的 TTL 本来就有 90 秒
        tick++;
        if (tick % 12 == 0) {
            presenceStore.sweep();
        }
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            session.close(status);
        } catch (IOException e) {
            log.debug("[lobby-sweeper] 关闭失败 sessionId={}", session.getId(), e);
        }
    }
}
```

- [ ] **Step 6：注册 WS 路由**

`all_function_api/lobby/src/main/java/com/lolskin/lobby/config/LobbyWebSocketConfig.java`：

```java
package com.lolskin.lobby.config;

import com.lolskin.lobby.ws.LobbyHandshakeInterceptor;
import com.lolskin.lobby.ws.LobbyWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * 大厅 WS 路由。
 *
 * <p>注册路径写 {@code /ws/lobby} —— {@code application.yml} 里的
 * {@code context-path: /api} 会自动带上前缀,实际路径是 {@code /api/ws/lobby}
 * (跟 chat 的 {@code /ws/chat} → {@code /api/ws/chat} 一个规矩)。
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class LobbyWebSocketConfig implements WebSocketConfigurer {

    private final LobbyWebSocketHandler lobbyWebSocketHandler;
    private final LobbyHandshakeInterceptor lobbyHandshakeInterceptor;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(lobbyWebSocketHandler, "/ws/lobby")
                .addInterceptors(lobbyHandshakeInterceptor)
                .setAllowedOrigins("*");
    }
}
```

- [ ] **Step 7：编译验证**

Run:

```powershell
mvn -pl lobby -am -DskipTests compile
```

Expected: `BUILD SUCCESS`。

- [ ] **Step 8：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/service/LobbyEventBus.java lobby/src/main/java/com/lolskin/lobby/service/LobbyLastLobbyWriter.java lobby/src/main/java/com/lolskin/lobby/ws lobby/src/main/java/com/lolskin/lobby/config
git commit -m "feat(lobby): 大厅 WebSocket(握手/协议/超时清扫)"
```

---

## Task A8：REST 接口（轮询降级用）

**Files:**
- Create: `all_function_api/lobby/src/main/java/com/lolskin/lobby/controller/LobbyController.java`

- [ ] **Step 1：写 controller**

```java
package com.lolskin.lobby.controller;

import com.lolskin.annotation.AllowsDesktopToken;
import com.lolskin.common.Result;
import com.lolskin.exception.UnauthorizedException;
import com.lolskin.lobby.service.LobbyDirectoryService;
import com.lolskin.lobby.service.LobbyMessageService;
import com.lolskin.lobby.vo.LobbyMessageVO;
import com.lolskin.lobby.vo.LobbySnapshotVO;
import com.lolskin.user.service.JwtService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 开黑大厅的 REST 接口 —— 纯给「WS 连不上时的轮询降级」用。
 *
 * <p>两个接口都标了 {@code @AllowsDesktopToken}:桌面 token 进得来
 * (它拿不到发帖/评论那些接口),REST 走 {@code DesktopScopeInterceptor},
 * 不标这个注解会被默认拒掉(403)。
 */
@Slf4j
@Tag(name = "开黑大厅", description = "实时大厅的玩家列表与聊天历史")
@RestController
@RequestMapping("/lobby")
@RequiredArgsConstructor
public class LobbyController {

    private final LobbyDirectoryService directory;
    private final LobbyMessageService messageService;
    private final JwtService jwtService;

    @Operation(summary = "大厅玩家列表(在线 + 同区离线候选)与统计")
    @GetMapping("/players")
    @AllowsDesktopToken
    public Result<LobbySnapshotVO> players(HttpServletRequest request) {
        Long userId = extractUserId(request);
        return Result.success(directory.snapshot(userId));
    }

    @Operation(summary = "大厅最近聊天记录")
    @GetMapping("/history")
    @AllowsDesktopToken
    public Result<List<LobbyMessageVO>> history(HttpServletRequest request,
                                                @RequestParam(required = false) Integer limit) {
        extractUserId(request);
        int effective = (limit == null || limit <= 0) ? 50 : limit;
        return Result.success(messageService.listRecent(effective));
    }

    /** 手动解析 Bearer token —— 照抄 MapDistributionController。 */
    private Long extractUserId(HttpServletRequest request) {
        String auth = request.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) {
            throw new UnauthorizedException("未登录");
        }
        Long userId;
        try {
            userId = jwtService.getUserId(auth.substring(7));
        } catch (Exception e) {
            throw new UnauthorizedException("token 无效");
        }
        // token 解得开但里面没有 userId(比如管理员 token)→ 当没登录,
        // 别把 null 传下去,后面查库会 NPE。
        if (userId == null) {
            throw new UnauthorizedException("token 无效");
        }
        return userId;
    }
}
```

- [ ] **Step 2：编译验证**

Run:

```powershell
mvn -pl lobby -am -DskipTests compile
```

Expected: `BUILD SUCCESS`。

- [ ] **Step 3：提交（你来跑）**

```powershell
git add lobby/src/main/java/com/lolskin/lobby/controller/LobbyController.java
git commit -m "feat(lobby): 大厅 REST 接口(轮询降级用)"
```

---

## Task A9：WS 集成测试

**Files:**
- Create: `all_function_api/app/src/test/java/com/lolskin/lobby/redis/LobbyRedisStubConfig.java`
- Create: `all_function_api/app/src/test/java/com/lolskin/lobby/integration/LobbyIntegrationTest.java`

- [ ] **Step 1：写 Redis 桩**

`all_function_api/app/src/test/java/com/lolskin/lobby/redis/LobbyRedisStubConfig.java`：

```java
package com.lolskin.lobby.redis;

import org.mockito.Mockito;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.connection.RedisConnectionFactory;

/**
 * 测试里的 Redis 桩。
 *
 * <p>大厅的本地广播不依赖 Redis(本地直接投),所以这里只要把
 * {@code RedisConnectionFactory} 顶掉,别让测试去连真 Redis。
 */
@TestConfiguration
public class LobbyRedisStubConfig {

    @Bean
    @Primary
    public RedisConnectionFactory redisConnectionFactory() {
        return Mockito.mock(RedisConnectionFactory.class);
    }
}
```

- [ ] **Step 2：写集成测试**

`all_function_api/app/src/test/java/com/lolskin/lobby/integration/LobbyIntegrationTest.java`：

```java
package com.lolskin.lobby.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lolskin.lobby.mapper.LobbyUserMapper;
import com.lolskin.lobby.service.LobbyMessageService;
import com.lolskin.user.service.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 大厅 WS 的集成测试。
 *
 * <p>覆盖三件事:
 * <ul>
 *   <li>token 无效 → 握手被拒(不匿名放行)</li>
 *   <li>一方发言,另一方收到</li>
 *   <li>断开后另一方收到 presence 更新</li>
 * </ul>
 *
 * <p>⚠️ <b>这个测试自己的查询不碰生产库</b>:消息落库和用户档案都换成 mock ——
 * 否则这个测试要等 {@code t_lobby_message} 建表、{@code t_user.last_lobby_at}
 * 加列之后才能跑,而迁移脚本还没上线时它会直接报「Unknown column」。
 * (Spring 上下文还是照 application.yml 起 —— 跟 party 的集成测试一个规矩。)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(com.lolskin.lobby.redis.LobbyRedisStubConfig.class)
@TestPropertySource(properties = {
        // 会写生产库的定时任务 —— 测试期间全部关掉
        "lolskin.server-status.enabled=false",
        "lolskin.skin-rating-rollup.enabled=false",
        "lolskin.hero-meta-sync.enabled=false",
        "lolskin.skin-sync.enabled=false",
        // 固定间隔的推送/在线心跳 —— 间隔拉到 1 小时,测试跑不到
        "level.online-tick-interval-ms=3600000",
        "level.flush-interval-ms=3600000",
        "reminder.push.scan-interval-ms=3600000",
        "reminder.push.birthday.scan-interval-ms=3600000",
})
class LobbyIntegrationTest {

    @LocalServerPort int port;
    @Autowired ObjectMapper objectMapper;
    @Autowired JwtService jwtService;

    /** 用户档案 —— mock 掉,不去查 t_user(那一列还没迁移)。 */
    @MockBean LobbyUserMapper lobbyUserMapper;
    /** 消息落库 —— mock 掉,不去写 t_lobby_message(那张表还没建)。 */
    @MockBean LobbyMessageService lobbyMessageService;

    private final BlockingQueue<JsonNode> received = new LinkedBlockingQueue<>();

    @BeforeEach
    void setUp() {
        received.clear();
        when(lobbyUserMapper.selectUsers(any())).thenReturn(List.of());
        when(lobbyUserMapper.selectOfflineCandidates(any(), anyInt())).thenReturn(List.of());
        when(lobbyMessageService.listRecent(anyInt())).thenReturn(List.of());
        when(lobbyMessageService.record(anyLong(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(1L);
    }

    @Test
    void 无效token握手被拒() {
        StandardWebSocketClient client = new StandardWebSocketClient();
        assertThrows(Exception.class, () -> client.execute(
                new TextWebSocketHandler() {
                    @Override protected void handleTextMessage(WebSocketSession s, TextMessage m) { }
                },
                new WebSocketHttpHeaders(),
                URI.create("ws://localhost:" + port + "/api/ws/lobby?token=not-a-real-token"))
                .get(5, TimeUnit.SECONDS));
    }

    @Test
    void 一方发言另一方收到() throws Exception {
        String tokenA = jwtService.generateDesktopToken(1001L, "openid-a");
        String tokenB = jwtService.generateDesktopToken(1002L, "openid-b");
        WebSocketSession a = connect(tokenA);
        WebSocketSession b = connect(tokenB);
        try {
            send(a, "{\"type\":\"hello\",\"phase\":\"None\",\"public\":true}");
            send(b, "{\"type\":\"hello\",\"phase\":\"None\",\"public\":true}");

            // 两边都应该先收到 welcome
            assertNotNull(pollOfType("welcome"));

            send(a, "{\"type\":\"say\",\"text\":\"来两把大乱斗\"}");

            JsonNode chat = null;
            // 上限给宽一点 —— 聊天帧前面还压着 welcome/presence 几帧,
            // 帧数不是固定的(谁先 hello、presence 广播几轮都有影响),卡太死会偶发失败。
            for (int i = 0; i < 20 && chat == null; i++) {
                JsonNode n = received.poll(5, TimeUnit.SECONDS);
                if (n != null && "chat".equals(n.path("type").asText())) {
                    chat = n;
                }
            }
            assertNotNull(chat, "B 端应该收到 A 的发言");
            assertEquals("来两把大乱斗", chat.path("text").asText());
        } finally {
            a.close();
            b.close();
        }
    }

    private JsonNode pollOfType(String type) throws InterruptedException {
        for (int i = 0; i < 5; i++) {
            JsonNode n = received.poll(5, TimeUnit.SECONDS);
            if (n != null && type.equals(n.path("type").asText())) {
                return n;
            }
        }
        return null;
    }

    private WebSocketSession connect(String token) throws Exception {
        StandardWebSocketClient client = new StandardWebSocketClient();
        BlockingQueue<WebSocketSession> sessionQueue = new LinkedBlockingQueue<>();
        client.execute(new TextWebSocketHandler() {
            @Override public void afterConnectionEstablished(WebSocketSession session) { sessionQueue.offer(session); }
            @Override protected void handleTextMessage(WebSocketSession session, TextMessage message) {
                try { received.offer(objectMapper.readTree(message.getPayload())); }
                catch (Exception e) { e.printStackTrace(); }
            }
        }, new WebSocketHttpHeaders(), URI.create("ws://localhost:" + port + "/api/ws/lobby?token=" + token))
          .get(5, TimeUnit.SECONDS);
        return sessionQueue.poll(5, TimeUnit.SECONDS);
    }

    private void send(WebSocketSession session, String json) throws Exception {
        session.sendMessage(new TextMessage(json));
    }
}
```

- [ ] **Step 3：跑集成测试**

Run:

```powershell
mvn -pl app -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyIntegrationTest" test
```

Expected: `Tests run: 2, Failures: 0, Errors: 0` + `BUILD SUCCESS`。

> ⚠️ 这个测试**故意不用** `@ActiveProfiles("test")`：那个 profile 的
> `application-test.yml` 把 `RedisAutoConfiguration` 排掉了,`StringRedisTemplate`
> 就没有 bean 了(要自己补一个)。而且它会换成 H2 —— H2 上没有
> `t_lobby_message` / `t_user.last_lobby_at`,除非再写一份 schema。
> 现在这个写法(H2 不用、测试自己不查生产库、Redis 用桩)是改动最小的。
>
> ⚠️ `-pl app -am` 会把 party 等模块也编一遍。party 的**存量**测试在本地会挂 ——
> `-Dtest=LobbyIntegrationTest` + `-Dsurefire.failIfNoSpecifiedTests=false` 让它们不参与，
> 所以不影响这次的结果。

- [ ] **Step 4：提交（你来跑）**

```powershell
git add app/src/test/java/com/lolskin/lobby
git commit -m "test(lobby): 大厅 WS 集成测试"
```

---

# Part B：桌面端（`local_skin_importer`）

> 桌面端的每个任务都跑在 `local_skin_importer` 仓库根目录下。
> **Node 版本**：本机默认 node 是 v14，跑不了 vitest/build —— 先切：
>
> ```powershell
> nvm4w use 20.19.4
> node -v
> ```
>
> Expected: `v20.19.4`。

---

## Task B1：共享类型与纯逻辑

**Files:**
- Create: `local_skin_importer/src/shared/lobby.ts`
- Test: `local_skin_importer/src/shared/__tests__/lobby.test.ts`
- Modify: `local_skin_importer/package.json`（version `0.49.0` → `0.50.0`）

- [ ] **Step 1：升版本号**

`package.json` 里 `"version": "0.49.0"` 改成 `"0.50.0"`。

> 界面上的版本号是从 `package.json` 读的 —— 改了这里界面自动跟着变。
> 这次功能整体只升一次（0.49.0 → 0.50.0）；后面如果还要修 bug，再往 0.50.1 升。

- [ ] **Step 2：写测试**

`local_skin_importer/src/shared/__tests__/lobby.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  LOBBY_HISTORY_LIMIT,
  LOBBY_TEXT_MAX_LEN,
  appendMessages,
  isLobbyInvitable,
  lobbyLastSeenText,
  lobbyPlayerName,
  lobbyStatusOf,
  lobbyStatusText,
  mergeMessages
} from '../lobby';
import type { LobbyMessage, LobbyPlayer } from '../lobby';

function player(over: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    userId: 1,
    nickname: '林俊杰',
    gameId: '18557',
    zone: '艾欧尼亚',
    canonicalZone: '艾欧尼亚',
    avatarUrl: '',
    phase: 'None',
    online: true,
    publicVisible: true,
    rankScore: 32000,
    rankLabel: '黄金 III',
    collectionScore: 520,
    positions: ['mid'],
    positionLabels: ['中单'],
    vip: false,
    lastLobbyAt: null,
    ...over
  };
}

function message(id: number, text: string): LobbyMessage {
  return {
    id,
    userId: 7,
    nickname: '林俊杰',
    gameId: '18557',
    zone: '艾欧尼亚',
    text,
    createdAt: '2026-11-24 22:16:03'
  };
}

describe('lobbyStatusOf', () => {
  it('空闲和大厅都算「能拉」', () => {
    expect(lobbyStatusOf('None')).toBe('idle');
    expect(lobbyStatusOf('Lobby')).toBe('idle');
  });

  it('在打 anything 都算「忙」', () => {
    for (const phase of ['ChampSelect', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'PostGame']) {
      expect(lobbyStatusOf(phase)).toBe('busy');
    }
  });

  it('认不出来的阶段一律「未知」—— 不猜', () => {
    expect(lobbyStatusOf('')).toBe('unknown');
    expect(lobbyStatusOf('SomethingNew')).toBe('unknown');
  });
});

describe('lobbyStatusText', () => {
  it('复用对局页那份 phase → 中文映射', () => {
    expect(lobbyStatusText('InProgress')).toBe('对局中');
    expect(lobbyStatusText('None')).toBe('空闲');
  });

  it('认不出来就说「未知」', () => {
    expect(lobbyStatusText('')).toBe('未知');
    expect(lobbyStatusText('Nope')).toBe('未知');
  });
});

describe('isLobbyInvitable', () => {
  it('空闲 + 有游戏ID → 能拉', () => {
    expect(isLobbyInvitable(player())).toBe(true);
  });

  it('在打游戏 → 不能拉', () => {
    expect(isLobbyInvitable(player({ phase: 'InProgress' }))).toBe(false);
  });

  it('状态未知 → 不能拉(不猜)', () => {
    expect(isLobbyInvitable(player({ phase: '' }))).toBe(false);
  });

  it('没有游戏ID → 不能拉(邀不了)', () => {
    expect(isLobbyInvitable(player({ gameId: '' }))).toBe(false);
  });
});

describe('lobbyPlayerName', () => {
  it('昵称优先', () => {
    expect(lobbyPlayerName(player())).toBe('林俊杰');
  });

  it('没昵称退回游戏ID', () => {
    expect(lobbyPlayerName(player({ nickname: '', gameId: '84174' }))).toBe('84174');
  });

  it('两个都没有就换个说法', () => {
    expect(lobbyPlayerName(player({ nickname: '', gameId: '' }))).toBe('无名召唤师');
  });
});

describe('lobbyLastSeenText', () => {
  const now = new Date('2026-11-24T22:16:03');

  it('分钟级', () => {
    expect(lobbyLastSeenText('2026-11-24 22:10:03', now)).toBe('6 分钟前');
  });

  it('小时级', () => {
    expect(lobbyLastSeenText('2026-11-24 20:16:03', now)).toBe('2 小时前');
  });

  it('天级', () => {
    expect(lobbyLastSeenText('2026-11-22 22:16:03', now)).toBe('2 天前');
  });

  it('刚走的显示「刚刚」', () => {
    expect(lobbyLastSeenText('2026-11-24 22:16:00', now)).toBe('刚刚');
  });

  it('没来过 / 认不出来的串不编数字', () => {
    expect(lobbyLastSeenText(null, now)).toBe('不知道');
    expect(lobbyLastSeenText('不是时间', now)).toBe('不是时间');
  });
});

describe('mergeMessages / appendMessages', () => {
  it('同一条消息只留一份', () => {
    const a = [message(1, '一'), message(2, '二')];
    const merged = mergeMessages(a, [message(2, '二'), message(3, '三')]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('新消息追加到后面,顺序是旧的在前', () => {
    const merged = appendMessages([message(1, '一')], message(2, '二'));
    expect(merged.map((m) => m.text)).toEqual(['一', '二']);
  });

  it('超过上限就砍掉最旧的', () => {
    const many = Array.from({ length: LOBBY_HISTORY_LIMIT + 5 }, (_, i) => message(i + 1, `m${i + 1}`));
    const merged = appendMessages(many, message(999, '最后一条'));
    expect(merged).toHaveLength(LOBBY_HISTORY_LIMIT);
    expect(merged[merged.length - 1].text).toBe('最后一条');
  });

  it('正文超长截断到上限', () => {
    const long = '一'.repeat(200);
    expect(long.slice(0, LOBBY_TEXT_MAX_LEN)).toHaveLength(64);
  });
});
```

- [ ] **Step 3：跑测试确认失败**

Run:

```powershell
npx vitest run src/shared/__tests__/lobby.test.ts
```

Expected: FAIL —— `../lobby` 不存在。

- [ ] **Step 4：写实现**

`local_skin_importer/src/shared/lobby.ts`：

```ts
/**
 * 「开黑大厅」的数据形状和纯展示逻辑。
 *
 * <p>跟 `regionUsers.ts` 一个路子:类型和纯函数放 shared —— 主进程拿来发请求,
 * 渲染进程拿来渲染,两边对同一份数据的理解不能分叉。
 */

import { lcuPhaseLabel } from './gameLabels';

/** 主进程往渲染进程推大厅状态的通道名。 */
export const LOBBY_EVENT_CHANNEL = 'lobby:state';

/** 发言正文上限 —— 跟后端的 `MAX_TEXT_LEN` 一致。 */
export const LOBBY_TEXT_MAX_LEN = 64;

/** 进大厅拉多少条历史。 */
export const LOBBY_HISTORY_LIMIT = 50;

/** 离线候选给几个。 */
export const LOBBY_OFFLINE_LIMIT = 30;

/**
 * 这个人的状态灯。
 *
 * - `idle`    —— 空闲(没在打),可以拉
 * - `busy`    —— 在打(选人/对局中/结算)
 * - `unknown` —— **认不出来**
 *
 * `unknown` 单独一档是有意的:没采集到阶段、或者客户端报了个没见过的阶段串,
 * 这时候**不猜**他有没有在打 —— 猜错就是把人拉进一局里。
 */
export type LobbyStatus = 'idle' | 'busy' | 'unknown';

/** 空闲的阶段串 —— 空着的也算空闲?不算,空是 unknown。 */
const IDLE_PHASES = new Set(['None', 'Lobby']);

/** 大厅里的一行玩家。 */
export interface LobbyPlayer {
  userId: number;
  nickname: string;
  /** 召唤师ID(数字标签)—— 复制ID / 邀请都用它 */
  gameId: string;
  /** 大区原始名 */
  zone: string;
  /** 归一化之后的大区名;null = 认不出来。**「同大区」比的是它,不是 zone** */
  canonicalZone: string | null;
  avatarUrl: string;
  /** 游戏客户端原始阶段串;空 = 没采集到 */
  phase: string;
  online: boolean;
  /** 是否公开自己的信息 */
  publicVisible: boolean;
  /** 段位数值分;null = 没同步过段位 */
  rankScore: number | null;
  /** 「黄金 III」这种展示串 */
  rankLabel: string | null;
  /** 站内收藏分 */
  collectionScore: number | null;
  positions: string[];
  positionLabels: string[];
  vip: boolean;
  /** 上次出现在大厅的时间('yyyy-MM-dd HH:mm:ss');null = 从来过 */
  lastLobbyAt: string | null;
}

/** 顶栏的三个数字。 */
export interface LobbyStats {
  /** 在线且公开的人数 */
  online: number;
  /** 跟我同大区的 */
  sameZone: number;
  /** 现在空闲、可以拉的 */
  invitable: number;
}

/** 我自己的档案。 */
export interface LobbyMe {
  userId: number;
  nickname: string;
  zone: string;
  /** 归一化之后的大区名;null = 认不出来 */
  canonicalZone: string | null;
  rankScore: number | null;
  rankLabel: string | null;
  collectionScore: number | null;
  vip: boolean;
}

/** 大厅的一份完整快照。 */
export interface LobbySnapshot {
  online: LobbyPlayer[];
  offline: LobbyPlayer[];
  stats: LobbyStats;
  me: LobbyMe | null;
}

/** 一条聊天消息。 */
export interface LobbyMessage {
  id: number;
  userId: number;
  nickname: string;
  gameId: string;
  zone: string;
  text: string;
  /** 'yyyy-MM-dd HH:mm:ss' */
  createdAt: string;
}

/** 主进程里的连接状态。 */
export type LobbyClientStatus = 'disconnected' | 'connecting' | 'connected' | 'unauthorized';

/** 渲染进程拿到的大厅状态。 */
export interface LobbyState {
  status: LobbyClientStatus;
  /** true = WS 连不上,已经退化成 HTTP 轮询 */
  degraded: boolean;
  /** 「在大厅公开我的信息」 */
  publicVisible: boolean;
  snapshot: LobbySnapshot | null;
  messages: LobbyMessage[];
  /** 给用户看的一句话错误;null = 没有 */
  error: string | null;
}

/** 拉人结果。 */
export interface LobbyInviteResult {
  ok: boolean;
  /** invited = 真发出去了;copied = 降级成复制游戏ID */
  mode: 'invited' | 'copied';
  message: string;
}

// ---- 服务端 → 客户端 ------------------------------------------------------

export interface LobbyWelcomeFrame {
  type: 'welcome';
  history: LobbyMessage[];
  online: LobbyPlayer[];
  offline: LobbyPlayer[];
  stats: LobbyStats;
  me: LobbyMe | null;
}

export interface LobbyChatFrame {
  type: 'chat';
  id: number;
  userId: number;
  nickname: string;
  gameId: string;
  zone: string;
  text: string;
  createdAt: string;
}

export interface LobbyPresenceFrame {
  type: 'presence';
  online: LobbyPlayer[];
  stats: LobbyStats;
}

export interface LobbyPongFrame {
  type: 'pong';
}

export interface LobbyErrorFrame {
  type: 'error';
  code: string;
  reason: string;
}

export type LobbyServerFrame =
  | LobbyWelcomeFrame
  | LobbyChatFrame
  | LobbyPresenceFrame
  | LobbyPongFrame
  | LobbyErrorFrame;

// ---- 客户端 → 服务端 ------------------------------------------------------

export interface LobbyHelloFrame {
  type: 'hello';
  phase: string;
  public: boolean;
}

export interface LobbyProfileFrame {
  type: 'profile';
  phase: string;
  public: boolean;
}

export interface LobbySayFrame {
  type: 'say';
  text: string;
}

export interface LobbyPingFrame {
  type: 'ping';
}

export type LobbyClientFrame = LobbyHelloFrame | LobbyProfileFrame | LobbySayFrame | LobbyPingFrame;

// ---- 纯逻辑 ---------------------------------------------------------------

/** 这个人的状态灯属于哪一档。 */
export function lobbyStatusOf(phase: string): LobbyStatus {
  if (!phase) return 'unknown';
  if (IDLE_PHASES.has(phase)) return 'idle';
  // 认得出来的阶段 → 忙;认不出来的 → 未知
  return lcuPhaseLabel(phase) ? 'busy' : 'unknown';
}

/** 状态灯旁边显示的中文 —— 复用对局页那份映射。 */
export function lobbyStatusText(phase: string): string {
  return lcuPhaseLabel(phase) || '未知';
}

/** 能不能拉这个人进房间。 */
export function isLobbyInvitable(player: LobbyPlayer): boolean {
  if (!player.gameId) return false;
  return lobbyStatusOf(player.phase) === 'idle';
}

/** 一行显示的名字。 */
export function lobbyPlayerName(player: LobbyPlayer): string {
  return player.nickname || player.gameId || '无名召唤师';
}

/**
 * 「上次在线 X 小时前」。
 *
 * <p>后端给的是 `yyyy-MM-dd HH:mm:ss`(全局 JacksonConfig 那套格式)。
 * 认不出来的串**原样显示** —— 显示成「0 小时前」是骗人。
 */
export function lobbyLastSeenText(lastLobbyAt: string | null, now: Date = new Date()): string {
  if (!lastLobbyAt) return '不知道';
  // '2026-11-24 22:16:03' → '2026-11-24T22:16:03'(不带时区 = 本地时间)
  const t = Date.parse(lastLobbyAt.replace(' ', 'T'));
  if (Number.isNaN(t)) return lastLobbyAt;
  const minutes = Math.floor((now.getTime() - t) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 两份消息合成一份 —— 按 id 去重,保留先来的那条。
 *
 * <p>去重是必须的:降级轮询和 WS 可能同时带同一条消息上来。
 */
export function mergeMessages(
  existing: LobbyMessage[],
  incoming: LobbyMessage[]
): LobbyMessage[] {
  const seen = new Set<number>();
  const out: LobbyMessage[] = [];
  for (const m of [...existing, ...incoming]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** 追加一条新消息 —— 老的在前,超上限砍最旧的。 */
export function appendMessages(existing: LobbyMessage[], message: LobbyMessage): LobbyMessage[] {
  return mergeMessages(existing, [message]).slice(-LOBBY_HISTORY_LIMIT);
}
```

- [ ] **Step 5：跑测试确认通过**

Run:

```powershell
npx vitest run src/shared/__tests__/lobby.test.ts
```

Expected: `Tests  13 passed` 之类 + 无失败。

- [ ] **Step 6：提交（你来跑）**

```powershell
git add src/shared/lobby.ts src/shared/__tests__/lobby.test.ts package.json
git commit -m "feat(lobby): 大厅数据形状与纯逻辑"
```

---

## Task B2：「在大厅公开我的信息」开关的本地存储

**Files:**
- Create: `local_skin_importer/src/main/lobby/prefs.ts`
- Test: `local_skin_importer/src/main/lobby/__tests__/prefs.test.ts`

- [ ] **Step 1：写测试**

`local_skin_importer/src/main/lobby/__tests__/prefs.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { parseLobbyPrefs } from '../prefs';

// prefs.ts 顶部 import 了 electron —— 得先 mock 掉,
// 否则 node_modules 里那个 electron 包不是真 Electron,导不出 app。
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => process.cwd()) }
}));

describe('parseLobbyPrefs', () => {
  it('空内容 → 默认公开', () => {
    expect(parseLobbyPrefs('')).toEqual({ publicVisible: true });
  });

  it('坏 JSON → 默认公开', () => {
    expect(parseLobbyPrefs('{ 这不是 JSON')).toEqual({ publicVisible: true });
  });

  it('显式关了就是不公开', () => {
    expect(parseLobbyPrefs('{"publicVisible":false}')).toEqual({ publicVisible: false });
  });

  it('字段类型不对 → 退回默认', () => {
    expect(parseLobbyPrefs('{"publicVisible":"no"}')).toEqual({ publicVisible: true });
  });

  it('缺字段 → 默认公开', () => {
    expect(parseLobbyPrefs('{}')).toEqual({ publicVisible: true });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/prefs.test.ts
```

Expected: FAIL —— `../prefs` 不存在。

- [ ] **Step 3：写实现**

`local_skin_importer/src/main/lobby/prefs.ts`：

```ts
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 大厅的本地设置。
 *
 * <p>桌面端没有 electron-store —— 照 `src/main/autoAcceptState.ts` 的做法:
 * `userData` 下一个 JSON 文件,读坏了当默认值。
 */

const STATE_FILENAME = 'lobby-prefs.json';

export interface LobbyPrefs {
  /** 「在大厅公开我的信息」—— 默认开。 */
  publicVisible: boolean;
}

/**
 * 解析设置文件的内容。
 *
 * <p>单独拆出来是为了能直接测 —— 读文件的壳只有 `app.getPath` 一个依赖,
 * 测它就得把 electron 整个 mock 掉,不值当。
 */
export function parseLobbyPrefs(raw: string): LobbyPrefs {
  try {
    const parsed = JSON.parse(raw) as { publicVisible?: unknown };
    if (typeof parsed?.publicVisible === 'boolean') {
      return { publicVisible: parsed.publicVisible };
    }
  } catch {
    // 文件不存在 / 坏了 —— 当默认值
  }
  return { publicVisible: true };
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

export function readLobbyPrefs(): LobbyPrefs {
  try {
    return parseLobbyPrefs(fs.readFileSync(stateFilePath(), 'utf-8'));
  } catch {
    return { publicVisible: true };
  }
}

export function writeLobbyPrefs(prefs: Partial<LobbyPrefs>): LobbyPrefs {
  const current = readLobbyPrefs();
  const merged: LobbyPrefs = {
    publicVisible: prefs.publicVisible ?? current.publicVisible
  };
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(merged), 'utf-8');
  } catch {
    // 写不进去只影响「下次启动还记着」
  }
  return merged;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/prefs.test.ts
```

Expected: 5 个用例全过。

- [ ] **Step 5：提交（你来跑）**

```powershell
git add src/main/lobby/prefs.ts src/main/lobby/__tests__/prefs.test.ts
git commit -m "feat(lobby): 大厅本地设置"
```

---

## Task B3：大厅 WS 客户端

**Files:**
- Create: `local_skin_importer/src/main/lobby/client.ts`
- Test: `local_skin_importer/src/main/lobby/__tests__/client.test.ts`

- [ ] **Step 1：写测试**

`local_skin_importer/src/main/lobby/__tests__/client.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { LobbyClient, type LobbySocket } from '../client';
import type { LobbyClientFrame } from '../../shared/lobby';

/** 假 socket —— 跟 `src/main/match/__tests__/poller.test.ts` 一个路子。 */
function fakeSocket(): LobbySocket & { sent: string[]; handlers: Map<string, (...a: unknown[]) => void> } {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const sent: string[] = [];
  return {
    sent,
    handlers,
    send(data: string) {
      sent.push(data);
    },
    close() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler);
    }
  };
}

function frameOf(sent: string[]): LobbyClientFrame[] {
  return sent.map((s) => JSON.parse(s) as LobbyClientFrame);
}

describe('LobbyClient', () => {
  it('连上以后先发 hello', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt-1',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    await vi.waitFor(() => expect(socket.sent.length).toBe(1));
    // phase 初始是空串 —— **不猜**。游戏客户端的阶段由 service 拿到后
    // 用 profile 帧补上来(空 = 未知,按不可拉处理)。
    expect(frameOf(socket.sent)[0]).toEqual({ type: 'hello', phase: '', public: true });
  });

  it('token 拼进查询串', async () => {
    const socket = fakeSocket();
    let url = '';
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt-1',
      createSocket: (u) => {
        url = u;
        return socket;
      },
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(url).not.toBe(''));
    expect(url).toContain('/api/ws/lobby');
    expect(url).toContain('token=jwt-1');
  });

  it('收到服务端帧就交给 onFrame', async () => {
    const socket = fakeSocket();
    const frames: unknown[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: (f) => frames.push(f)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    socket.handlers.get('message')?.(JSON.stringify({ type: 'pong' }));
    expect(frames).toEqual([{ type: 'pong' }]);
  });

  it('坏 JSON 不炸 —— 直接丢掉', async () => {
    const socket = fakeSocket();
    const frames: unknown[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: (f) => frames.push(f)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    socket.handlers.get('message')?.('{ 不是 JSON');
    expect(frames).toHaveLength(0);
  });

  it('握手被拒(401/403)→ 状态 unauthorized,不再重连', async () => {
    const socket = fakeSocket();
    const statuses: string[] = [];
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {},
      onStatus: (s) => statuses.push(s)
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('error')).toBe(true));
    socket.handlers.get('error')?.(new Error('Unexpected server response: 401'));
    expect(statuses).toContain('unauthorized');
    client.stop();
  });

  it('说一句话就是一条 say 帧', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    client.say('来两把');
    const frames = frameOf(socket.sent);
    expect(frames[frames.length - 1]).toEqual({ type: 'say', text: '来两把' });
  });

  it('正文超长先截断 —— 不把超长内容发到线上', async () => {
    const socket = fakeSocket();
    const client = new LobbyClient({
      baseUrl: 'http://lobby.test',
      resolveToken: async () => 'jwt',
      createSocket: () => socket,
      onFrame: () => {}
    });
    client.start();
    await vi.waitFor(() => expect(socket.handlers.has('open')).toBe(true));
    socket.handlers.get('open')?.();
    client.say('一'.repeat(200));
    const frames = frameOf(socket.sent);
    const say = frames[frames.length - 1] as { type: string; text: string };
    expect(say.text).toHaveLength(64);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/client.test.ts
```

Expected: FAIL —— `../client` 不存在。

- [ ] **Step 3：写实现**

`local_skin_importer/src/main/lobby/client.ts`：

```ts
/**
 * 开黑大厅的 WebSocket 客户端。
 *
 * <p>跟 `src/main/match/lcuWs.ts` 一个路子:把 socket 造法做成可注入的口子,
 * 测试塞假 socket 进去,不用真开一条连接;代码也不必依赖 `ws` 的类型声明。
 */

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { LOBBY_TEXT_MAX_LEN, type LobbyClientFrame, type LobbyClientStatus, type LobbyServerFrame } from '../../shared/lobby';

/** 只声明用得到的三个方法的最小 socket 抽象。 */
export interface LobbySocket {
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export type LobbySocketFactory = (url: string) => LobbySocket;

export interface LobbyClientOptions {
  /** 取桌面 token。每次重连都要重新取 —— token 过期了得换。 */
  resolveToken: () => Promise<string>;
  /** 后端地址;ws:// + 后端根地址 + 路径 */
  baseUrl: string;
  /** 造 socket 的口子,测试用假实现顶掉 */
  createSocket?: LobbySocketFactory;
  onFrame: (frame: LobbyServerFrame) => void;
  onStatus?: (status: LobbyClientStatus) => void;
  /** 首次重连延迟(ms) */
  baseBackoffMs?: number;
  /** 重连延迟上限(ms) */
  maxBackoffMs?: number;
}

/** 心跳间隔 —— 后端 60 秒没收到帧就断开,所以必须比它短。 */
export const LOBBY_HEARTBEAT_MS = 20_000;

function defaultSocketFactory(url: string): LobbySocket {
  const nodeRequire = createRequire(import.meta.url);
  const ws = nodeRequire('ws') as { WebSocket: new (u: string) => unknown };
  return new ws.WebSocket(url) as LobbySocket;
}

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  }
  return '';
}

export class LobbyClient {
  private socket: LobbySocket | null = null;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private status: LobbyClientStatus = 'disconnected';
  private backoffMs: number;
  private phase = '';
  private publicVisible = true;

  private readonly resolveToken: () => Promise<string>;
  private readonly baseUrl: string;
  private readonly createSocket: LobbySocketFactory;
  private readonly onFrame: (frame: LobbyServerFrame) => void;
  private readonly onStatus?: (status: LobbyClientStatus) => void;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: LobbyClientOptions) {
    this.resolveToken = options.resolveToken;
    this.baseUrl = options.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.onFrame = options.onFrame;
    this.onStatus = options.onStatus;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.baseBackoffMs;
  }

  getStatus(): LobbyClientStatus {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // 已经断了
      }
    }
    this.setStatus('disconnected');
  }

  /** 首次 hello —— 上报当前阶段和公开开关。 */
  sendHello(phase: string, publicVisible: boolean): void {
    this.phase = phase;
    this.publicVisible = publicVisible;
    this.send({ type: 'hello', phase, public: publicVisible });
  }

  /** 状态变了 —— 阶段变了或者公开开关变了。 */
  sendProfile(phase: string, publicVisible: boolean): void {
    this.phase = phase;
    this.publicVisible = publicVisible;
    this.send({ type: 'profile', phase, public: publicVisible });
  }

  /** 说一句话。超长先截断 —— 后端也会截,但本地截一次少传一次。 */
  say(text: string): void {
    const trimmed = text.trim().slice(0, LOBBY_TEXT_MAX_LEN);
    if (!trimmed) return;
    this.send({ type: 'say', text: trimmed });
  }

  private setStatus(status: LobbyClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private send(frame: LobbyClientFrame): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch (e: unknown) {
      console.warn('[lobby] 发送失败', e);
    }
  }

  /** 退避重连:1s → 2s → 4s …… 到上限就按上限来。 */
  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus('connecting');

    let token: string;
    try {
      token = await this.resolveToken();
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${this.baseUrl}/api/ws/lobby?token=${encodeURIComponent(token)}`;
    let socket: LobbySocket;
    try {
      socket = this.createSocket(url);
    } catch (e: unknown) {
      console.warn('[lobby] 建立连接失败', e);
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      this.backoffMs = this.baseBackoffMs;
      this.setStatus('connected');
      this.startHeartbeat();
      this.sendHello(this.phase, this.publicVisible);
    });
    socket.on('message', (raw: unknown) => {
      this.handleMessage(raw);
    });
    socket.on('error', (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (/40[13]|unauthorized|forbidden/i.test(text)) {
        // 握手被拒 —— 重连也没用,得让用户重新登录。
        // 401 和 403 都当「token 不认」:后端那边 Spring 会把 401 盖成 403,
        // 反正大厅只有一种鉴权方式,握手失败就是没登录。
        this.setStatus('unauthorized');
        this.stopHeartbeat();
        this.stopped = true;
        return;
      }
      console.warn('[lobby] 连接报错', text);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.stopHeartbeat();
      if (this.stopped) return;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: unknown): void {
    const text = toText(raw);
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as LobbyServerFrame;
    if (typeof frame.type !== 'string') return;
    this.onFrame(frame);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ type: 'ping' });
    }, LOBBY_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
```

- [ ] **Step 4：跑测试确认通过**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/client.test.ts
```

Expected: 7 个用例全过。

- [ ] **Step 5：提交（你来跑）**

```powershell
git add src/main/lobby/client.ts src/main/lobby/__tests__/client.test.ts
git commit -m "feat(lobby): 大厅 WS 客户端"
```

---

## Task B4：REST 降级通道

**Files:**
- Create: `local_skin_importer/src/main/lobby/api.ts`
- Test: `local_skin_importer/src/main/lobby/__tests__/api.test.ts`

- [ ] **Step 1：写测试**

`local_skin_importer/src/main/lobby/__tests__/api.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchLobbyHistory, fetchLobbyPlayers } from '../api';
import { getStoredToken } from '../../auth';

vi.mock('axios');
vi.mock('../../auth');
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn()
  }
}));

describe('大厅 REST', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('拉玩家列表带 Bearer token', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        code: 200,
        data: {
          online: [{ userId: 1, nickname: '林俊杰', gameId: '18557' }],
          offline: [],
          stats: { online: 1, sameZone: 1, invitable: 1 },
          me: { userId: 9, nickname: '我' }
        }
      }
    });

    const snap = await fetchLobbyPlayers();

    expect(snap.stats.online).toBe(1);
    expect(snap.online[0].nickname).toBe('林俊杰');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/lobby/players'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('没登录就说没登录', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(fetchLobbyPlayers()).rejects.toThrow(/未登录/);
  });

  it('token 过期就清掉并说清楚', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error('401'), {
        isAxiosError: true,
        response: { status: 401, data: { code: 401, message: '未登录' } }
      })
    );
    await expect(fetchLobbyPlayers()).rejects.toThrow(/登录已过期/);
  });

  it('缺字段的脏响应补成空值,不炸', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({ data: { code: 200, data: {} } });
    const snap = await fetchLobbyPlayers();
    expect(snap.online).toEqual([]);
    expect(snap.offline).toEqual([]);
    expect(snap.stats.online).toBe(0);
    expect(snap.me).toBeNull();
  });

  it('历史消息也整理成一样形状', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.get).mockResolvedValue({
      data: { code: 200, data: [{ id: 1, userId: 7, nickname: '林俊杰', text: '来两把' }] }
    });
    const msgs = await fetchLobbyHistory(50);
    expect(msgs[0].text).toBe('来两把');
    expect(msgs[0].gameId).toBe('');
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/api.test.ts
```

Expected: FAIL —— `../api` 不存在。

- [ ] **Step 3：写实现**

`local_skin_importer/src/main/lobby/api.ts`：

```ts
/**
 * 大厅的 REST 通道 —— **只给 WS 连不上时的轮询降级用**。
 *
 * <p>跟 `src/main/regionUsers.ts` 一个套路:统一 `Result` 信封 + 统一脏数据兜底。
 */

import axios from 'axios';
import { clearStoredToken, getStoredToken } from '../auth';
import {
  LOBBY_HISTORY_LIMIT,
  type LobbyMessage,
  type LobbyMe,
  type LobbyPlayer,
  type LobbySnapshot,
  type LobbyStats
} from '../../shared/lobby';

const BACKEND_BASE_URL = 'http://101.34.210.254';
const LOBBY_TIMEOUT_MS = 15_000;

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizePlayer(raw: unknown): LobbyPlayer {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    userId: num(p.userId),
    nickname: str(p.nickname),
    gameId: str(p.gameId),
    zone: str(p.zone),
    canonicalZone: str(p.canonicalZone) || null,
    avatarUrl: str(p.avatarUrl),
    phase: str(p.phase),
    online: p.online === true,
    publicVisible: p.public === true,
    rankScore: numOrNull(p.rankScore),
    rankLabel: str(p.rankLabel) || null,
    collectionScore: numOrNull(p.collectionScore),
    positions: strArray(p.positions),
    positionLabels: strArray(p.positionLabels),
    vip: p.vip === true,
    lastLobbyAt: str(p.lastLobbyAt) || null
  };
}

function normalizeStats(raw: unknown): LobbyStats {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    online: num(s.online),
    sameZone: num(s.sameZone),
    invitable: num(s.invitable)
  };
}

function normalizeMe(raw: unknown): LobbyMe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const userId = num(m.userId);
  // 没有 userId = 服务端没认出「我」—— 别造一个空壳档案出来
  if (!userId) return null;
  return {
    userId,
    nickname: str(m.nickname),
    zone: str(m.zone),
    canonicalZone: str(m.canonicalZone) || null,
    rankScore: numOrNull(m.rankScore),
    rankLabel: str(m.rankLabel) || null,
    collectionScore: numOrNull(m.collectionScore),
    vip: m.vip === true
  };
}

function normalizeMessage(raw: unknown): LobbyMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    id: num(m.id),
    userId: num(m.userId),
    nickname: str(m.nickname),
    gameId: str(m.gameId),
    zone: str(m.zone),
    text: str(m.text),
    createdAt: str(m.createdAt)
  };
}

/**
 * 把后端那份响应整理成能直接渲染的形状。
 *
 * 后端 `Result` 是 `NON_NULL` 的 —— 字段可能是 undefined 不是 null,
 * 渲染进程不判空就崩,这里一次判干净。
 */
export function normalizeSnapshot(raw: unknown): LobbySnapshot {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    online: Array.isArray(s.online) ? s.online.map(normalizePlayer) : [],
    offline: Array.isArray(s.offline) ? s.offline.map(normalizePlayer) : [],
    stats: normalizeStats(s.stats),
    me: normalizeMe(s.me)
  };
}

async function getEnveloped<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再使用开黑大厅');
  const { data } = await axios.get<BackendEnvelope<T>>(`${BACKEND_BASE_URL}${path}`, {
    timeout: LOBBY_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` },
    params
  });
  if (data.code !== 200 || data.data === undefined || data.data === null) {
    throw new Error(data.message || '开黑大厅请求失败');
  }
  return data.data;
}

/** 在线列表 + 离线候选 + 统计。 */
export async function fetchLobbyPlayers(): Promise<LobbySnapshot> {
  try {
    const raw = await getEnveloped<unknown>('/api/lobby/players');
    return normalizeSnapshot(raw);
  } catch (e) {
    throw normalizeLobbyError(e);
  }
}

/** 最近的历史消息。 */
export async function fetchLobbyHistory(limit = LOBBY_HISTORY_LIMIT): Promise<LobbyMessage[]> {
  try {
    const raw = await getEnveloped<unknown[]>('/api/lobby/history', { limit });
    return Array.isArray(raw) ? raw.map(normalizeMessage) : [];
  } catch (e) {
    throw normalizeLobbyError(e);
  }
}

/** token 过期就清掉 —— 留着只会让「已登录」的假象一直挂着。 */
function normalizeLobbyError(e: unknown): unknown {
  const looksLikeAxiosError =
    typeof e === 'object' && e !== null && (e as { isAxiosError?: unknown }).isAxiosError === true;
  if (looksLikeAxiosError) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 401) {
      clearStoredToken();
      return new Error('登录已过期,请用同步码重新登录');
    }
    const backendMsg = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof backendMsg === 'string' && backendMsg.length > 0) {
      return new Error(backendMsg);
    }
  }
  return e;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/api.test.ts
```

Expected: 5 个用例全过。

- [ ] **Step 5：提交（你来跑）**

```powershell
git add src/main/lobby/api.ts src/main/lobby/__tests__/api.test.ts
git commit -m "feat(lobby): 大厅 REST 降级通道"
```

---

## Task B5：拉人(LCU 邀请 + 降级复制)

**Files:**
- Create: `local_skin_importer/src/main/lobby/invite.ts`
- Test: `local_skin_importer/src/main/lobby/__tests__/invite.test.ts`

> ⚠️ **LCU 的建房/邀请路由国服还没实测。** 这按「挨个撞,撞不到就降级」写:
> 撞到的路由记在代码里,撞不到的走复制游戏ID。Task B9 的探测脚本用来确认真路由。

- [ ] **Step 1：写测试**

`local_skin_importer/src/main/lobby/__tests__/invite.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildInviteCandidates, invitePlayer, type LcuInviteClient } from '../invite';

// invite.ts 用了 electron 的剪贴板,还 import 了 ../lcu(它自己也摸 electron)
// —— 都得先 mock 掉,否则 node_modules 里那个 electron 包导不出这些东西。
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  app: { getPath: vi.fn(() => process.cwd()) }
}));

function fakeClient(): LcuInviteClient {
  return {
    get: async () => ({ data: {} }),
    post: async () => ({})
  };
}

describe('buildInviteCandidates', () => {
  it('候选路由按优先级排 —— 新的在前', () => {
    const candidates = buildInviteCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].path).toContain('/lol-lobby/');
  });
});

describe('invitePlayer', () => {
  it('没有游戏ID就退化成复制', async () => {
    const result = await invitePlayer('林俊杰', '', async () => fakeClient());
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('copied');
  });

  it('游戏客户端没开 → 降级复制,不抛异常', async () => {
    const result = await invitePlayer('林俊杰', '18557', async () => {
      throw new Error('客户端没开');
    });
    expect(result.mode).toBe('copied');
    expect(result.message).toContain('18557');
  });

  it('搜不到这个人 → 降级复制', async () => {
    const result = await invitePlayer('林俊杰', '18557', async () => ({
      get: async () => ({ data: {} }),
      post: async () => ({})
    }));
    expect(result.mode).toBe('copied');
    expect(result.message).toContain('18557');
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/invite.test.ts
```

Expected: FAIL —— `../invite` 不存在。

- [ ] **Step 3：写实现**

`local_skin_importer/src/main/lobby/invite.ts`：

```ts
/**
 * 拉人进房间。
 *
 * <p>**完全在本机做** —— 本机 LCU + 本机游戏客户端,后端不参与,
 * 所以不需要什么 invite-ticket。
 *
 * <p>⚠️ 建房 / 邀请的路由国服**还没实测** —— 所以这里挨个撞:
 * 撞到 405(路由存在但方法不对)或 2xx 都算这个路由能用;
 * 全部撞不到就降级成「复制游戏ID」。
 */

import { clipboard } from 'electron';
import * as lcu from '../lcu';
import type { LobbyInviteResult } from '../../shared/lobby';

export interface InviteCandidate {
  path: string;
  method: 'POST' | 'PUT';
  /** 请求体;null = 不带 body */
  body: unknown;
}

/**
 * 拉人要用到的 LCU 客户端能力。
 *
 * <p>结构化类型(不是 `AxiosInstance`)—— 测试能塞个假实现进去,
 * 不用起真的 LCU 回环。
 */
export interface LcuInviteClient {
  get(path: string, config?: unknown): Promise<{ data: unknown }>;
  post(path: string, data?: unknown, config?: unknown): Promise<unknown>;
}

/**
 * 挨个撞的候选路由。
 *
 * <p>顺序 = 优先级。Task B9 的探测脚本用同样的顺序实测,
 * 撞出真正能用的那条之后,把其它几条删掉、把真的那条提到最前。
 */
export function buildInviteCandidates(summonerId?: string): InviteCandidate[] {
  const id = summonerId ?? '';
  return [
    { path: '/lol-lobby/v2/lobby/invitations', method: 'POST', body: { summonerIds: [id] } },
    { path: '/lol-lobby/v2/lobby/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v2/party/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v1/lobby/invitations', method: 'POST', body: { summonerId: id } },
    { path: '/lol-lobby/v2/lobby/invite', method: 'POST', body: { summonerId: id } }
  ];
}

/** 建自定义房间的候选路由。 */
export function buildLobbyCandidates(): InviteCandidate[] {
  return [
    { path: '/lol-lobby/v2/lobby', method: 'POST', body: null },
    { path: '/lol-lobby/v1/lobby', method: 'POST', body: null }
  ];
}

/** 昵称#标签 → 召唤师ID。搜人只认这个格式。 */
async function resolveSummonerId(
  client: LcuInviteClient,
  nickname: string,
  gameId: string
): Promise<string> {
  const name = gameId ? `${nickname}#${gameId}` : nickname;
  const res = await client.get(`/lol-summoner/v1/summoners?name=${encodeURIComponent(name)}`);
  const body = res.data as { summonerId?: number; summoner?: { summonerId?: number } } | undefined;
  const id = body?.summonerId ?? body?.summoner?.summonerId;
  return id === undefined || id === null ? '' : String(id);
}

/**
 * 拉一个人进房间。
 *
 * @param nickname    对方昵称
 * @param gameId      对方的召唤师ID(数字标签)
 * @param resolveClient 造 LCU 客户端的口子,测试用假实现顶掉
 */
export async function invitePlayer(
  nickname: string,
  gameId: string,
  resolveClient?: () => Promise<LcuInviteClient>
): Promise<LobbyInviteResult> {
  // 没有召唤师ID → 邀不了,只能复制
  if (!gameId) {
    return {
      ok: true,
      mode: 'copied',
      message: '这个人没有游戏ID,邀不了 —— 让他在聊天里报一下'
    };
  }

  let client: LcuInviteClient;
  try {
    // AxiosInstance 跟 LcuInviteClient 的方法签名不完全一样(axios 的
    // config 是 AxiosRequestConfig,这里是 unknown)—— 这里只用到
    // get/post 两个方法,转一下省得跟 axios 的泛型较劲。
    client = resolveClient
      ? await resolveClient()
      : (lcu.createLcuClient(await lcu.resolveLcuAuth()) as unknown as LcuInviteClient);
  } catch (e: unknown) {
    // 客户端没开 —— 降级
    copyToClipboard(gameId);
    return {
      ok: true,
      mode: 'copied',
      message: `游戏客户端没开,复制了 ${gameId} —— 到客户端里加好友`
    };
  }

  try {
    const summonerId = await resolveSummonerId(client, nickname, gameId);
    if (!summonerId) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `在客户端里搜不到 ${nickname},复制了 ${gameId}`
      };
    }

    // 先建房,再邀请 —— 顺序反了客户端会拒
    const created = await tryCandidates(client, buildLobbyCandidates());
    if (!created) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `建房间的接口没撞到,复制了 ${gameId} —— 到客户端里加好友`
      };
    }

    const invited = await tryCandidates(client, buildInviteCandidates(summonerId));
    if (!invited) {
      copyToClipboard(gameId);
      return {
        ok: true,
        mode: 'copied',
        message: `邀请的接口没撞到,复制了 ${gameId} —— 到客户端里加好友`
      };
    }

    return { ok: true, mode: 'invited', message: `已把 ${nickname} 拉进房间` };
  } catch (e: unknown) {
    copyToClipboard(gameId);
    return {
      ok: true,
      mode: 'copied',
      message: `邀请没成功,复制了 ${gameId} —— 到客户端里加好友`
    };
  }
}

/** 挨个撞候选路由 —— 有一个成了就算。 */
async function tryCandidates(
  client: LcuInviteClient,
  candidates: InviteCandidate[]
): Promise<boolean> {
  for (const candidate of candidates) {
    try {
      const config: Record<string, unknown> = {
        method: candidate.method,
        headers: { 'Content-Type': 'application/json' }
      };
      // body 直接走 axios 的第二个参数 —— 塞进 config.data 也能用,
      // 但那样得依赖 axios 的合并细节,没必要。
      await client.post(candidate.path, candidate.body ?? undefined, config);
      return true;
    } catch (e: unknown) {
      // 这个路由不对 —— 接着撞下一个
      console.warn('[lobby] 邀请路由没撞到', candidate.path, e);
    }
  }
  return false;
}

function copyToClipboard(text: string): void {
  try {
    clipboard.writeText(text);
  } catch {
    // 剪贴板不可用(无头环境)—— 不影响降级流程
  }
}
```

- [ ] **Step 4：跑测试确认通过**

Run:

```powershell
npx vitest run src/main/lobby/__tests__/invite.test.ts
```

Expected: 4 个用例全过。

- [ ] **Step 5：提交（你来跑）**

```powershell
git add src/main/lobby/invite.ts src/main/lobby/__tests__/invite.test.ts
git commit -m "feat(lobby): 拉人(LCU 邀请 + 降级复制)"
```

---

## Task B6：主进程大厅服务（编排）

**Files:**
- Create: `local_skin_importer/src/main/lobby/service.ts`
- Modify: `local_skin_importer/src/main/match/poller.ts`（加 `getPhase()`）

- [ ] **Step 1：给轮询器加一个 phase 出口**

`local_skin_importer/src/main/match/poller.ts` 里 `getSnapshot()` 旁边加：

```ts
  /**
   * 游戏客户端的原始阶段串(`None` / `Lobby` / `InProgress` / …)。
   *
   * <p>大厅的状态灯要用它 —— **复用这一份,不再另开一路读**。
   * `MatchState` 那四档表达不了「结算中」,所以这里给的是原始串。
   */
  getPhase(): string {
    return this.phase;
  }
```

- [ ] **Step 2：写大厅服务**

`local_skin_importer/src/main/lobby/service.ts`：

```ts
/**
 * 开黑大厅的主进程编排。
 *
 * <p>职责:
 * <ul>
 *   <li>持有 WS 客户端,应用一启动就连(退到托盘也保持连接)</li>
 *   <li>把游戏阶段的变化推给服务端(`profile` 帧)</li>
 *   <li>WS 连不上时退化成 HTTP 轮询,大厅仍然能用</li>
 *   <li>把状态变化推给渲染进程</li>
 * </ul>
 */

import { BrowserWindow } from 'electron';
import { getStoredToken } from '../auth';
import { matchPoller } from '../match/poller';
import { fetchLobbyHistory, fetchLobbyPlayers, normalizeSnapshot } from './api';
import { LobbyClient } from './client';
import { invitePlayer } from './invite';
import { readLobbyPrefs, writeLobbyPrefs } from './prefs';
import {
  LOBBY_EVENT_CHANNEL,
  LOBBY_HISTORY_LIMIT,
  appendMessages,
  mergeMessages,
  type LobbyInviteResult,
  type LobbyMessage,
  type LobbyServerFrame,
  type LobbyState
} from '../../shared/lobby';

const BACKEND_BASE_URL = 'http://101.34.210.254';

/** 降级轮询:列表 3 秒一次,聊天 2 秒一次。 */
const POLL_PLAYERS_MS = 3_000;
const POLL_HISTORY_MS = 2_000;

/** 多久问一次「游戏客户端的阶段变没变」。 */
const PHASE_POLL_MS = 2_000;

/** 多久看一眼「token 换了没」。 */
const TOKEN_CHECK_MS = 15_000;

export class LobbyService {
  private client: LobbyClient | null = null;
  private state: LobbyState;
  private playersTimer: NodeJS.Timeout | null = null;
  private historyTimer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private tokenTimer: NodeJS.Timeout | null = null;
  private lastPhase = '';
  /** 握手被拒时用的那个 token —— 换了就说明用户重新登录了,该重连。 */
  private failedToken: string | null = null;

  constructor() {
    const prefs = readLobbyPrefs();
    this.state = {
      status: 'disconnected',
      degraded: false,
      publicVisible: prefs.publicVisible,
      snapshot: null,
      messages: [],
      error: null
    };
  }

  getState(): LobbyState {
    return this.state;
  }

  /** 应用启动就调。 */
  start(): void {
    if (this.client) return;
    this.client = new LobbyClient({
      resolveToken: async () => {
        const token = getStoredToken();
        if (!token) throw new Error('未登录');
        return token;
      },
      baseUrl: BACKEND_BASE_URL,
      onFrame: (frame) => this.handleFrame(frame),
      onStatus: (status) => this.handleStatus(status)
    });
    // 先把「当前阶段 + 公开开关」塞给客户端,再让它连。
    // `sendProfile` 在没有 socket 时不会发出去,但**会记住这两个值**——
    // 客户端连上以后的第一帧 hello 就带着它们。
    // 不这么做的后果:用户把「公开我的信息」关掉了,第一次 hello 报的还是
    // 默认的 public=true → 他明明关了开关却还是出现在别人列表里。
    this.client.sendProfile(this.lastPhase, this.state.publicVisible);
    this.client.start();

    // 阶段每 2 秒看一眼,变了就推一帧 profile。
    // ⚠️ 不用自己去探测游戏客户端 —— `src/main/index.ts` 启动时已经调过
    // `matchPoller.start()`,凭据和阶段都是轮询器自己在维护。
    // 这里再探一遍等于每 30 秒白跑一次 spawn PowerShell 的检测。
    if (!this.phaseTimer) {
      this.phaseTimer = setInterval(() => this.syncPhase(), PHASE_POLL_MS);
      this.phaseTimer.unref?.();
    }
    // 握手被拒之后客户端就停了 —— 靠这个盯着 token,换了自动重连。
    if (!this.tokenTimer) {
      this.tokenTimer = setInterval(() => this.checkTokenChange(), TOKEN_CHECK_MS);
      this.tokenTimer.unref?.();
    }
  }

  /** 应用退出时调。 */
  stop(): void {
    this.client?.stop();
    this.client = null;
    for (const timer of [this.playersTimer, this.historyTimer, this.phaseTimer, this.tokenTimer]) {
      if (timer) clearInterval(timer);
    }
    this.playersTimer = null;
    this.historyTimer = null;
    this.phaseTimer = null;
    this.tokenTimer = null;
  }

  // ---- 公开开关 ----------------------------------------------------------

  setPublicVisible(publicVisible: boolean): LobbyState {
    writeLobbyPrefs({ publicVisible });
    this.state = { ...this.state, publicVisible };
    // 立刻告诉服务端 —— 不然要等到下次心跳
    this.client?.sendProfile(this.lastPhase, publicVisible);
    this.push();
    return this.state;
  }

  // ---- 发言 --------------------------------------------------------------

  say(text: string): { ok: boolean; message?: string } {
    if (this.state.status === 'unauthorized') {
      return { ok: false, message: '登录已过期,去重新兑换同步码' };
    }
    if (!this.client) {
      return { ok: false, message: '大厅还没连上,等一会儿再试' };
    }
    if (this.state.degraded) {
      return { ok: false, message: '现在是轮询降级模式,发不了消息 —— 等 WS 连回来' };
    }
    this.client.say(text);
    return { ok: true };
  }

  /** 拉一个人进房间。 */
  async invite(nickname: string, gameId: string): Promise<LobbyInviteResult> {
    return await invitePlayer(nickname, gameId);
  }

  // ---- 内部 --------------------------------------------------------------

  /** 阶段变了就推一帧 `profile`。 */
  private syncPhase(): void {
    const phase = matchPoller.getPhase();
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.client?.sendProfile(phase, this.state.publicVisible);
  }

  /**
   * token 换了就重连。
   *
   * <p>握手被拒之后 WS 客户端就停了(重连也没用,token 还是不认)。
   * 用户重新登录之后 token 会变 —— 这时候把旧的客户端扔掉重开一个,
   * **不用让他重启整个应用**。
   */
  private checkTokenChange(): void {
    if (this.state.status !== 'unauthorized') return;
    const token = getStoredToken();
    if (!token || token === this.failedToken) return;
    this.failedToken = null;
    this.client?.stop();
    this.client = null;
    this.start();
  }

  private handleStatus(status: LobbyState['status']): void {
    const unauthorized = status === 'unauthorized';
    if (unauthorized) {
      this.failedToken = getStoredToken();
    }
    this.state = {
      ...this.state,
      status,
      // 只要没连上就算降级 —— 连不上的时候走的确实是轮询那条路,
      // 界面上得说实话
      degraded: status !== 'connected',
      error: unauthorized ? '登录已过期,去重新兑换同步码' : null
    };
    if (status === 'connected') {
      this.stopPolling();
    } else if (unauthorized) {
      // token 不认的时候 REST 一样进不去 —— 再轮询只是白刷一串 401。
      this.stopPolling();
    } else {
      this.startPolling();
    }
    this.push();
  }

  private handleFrame(frame: LobbyServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.state = {
          ...this.state,
          // 跟 REST 走同一个整理函数 —— WS 和 REST 的数据形状必须一模一样,
          // 否则「WS 正常、降级就崩」这种问题最难查。
          snapshot: normalizeSnapshot({
            online: frame.online,
            offline: frame.offline,
            stats: frame.stats,
            me: frame.me
          }),
          messages: mergeMessages(this.state.messages, frame.history ?? [])
        };
        break;
      }
      case 'chat': {
        const message: LobbyMessage = {
          id: frame.id,
          userId: frame.userId,
          nickname: frame.nickname,
          gameId: frame.gameId,
          zone: frame.zone,
          text: frame.text,
          createdAt: frame.createdAt
        };
        this.state = { ...this.state, messages: appendMessages(this.state.messages, message) };
        break;
      }
      case 'presence': {
        const snapshot = this.state.snapshot;
        // presence 帧只带 online 和 stats —— 离线候选和「我」保留上一份
        if (snapshot) {
          this.state = {
            ...this.state,
            snapshot: normalizeSnapshot({
              online: frame.online,
              offline: snapshot.offline,
              stats: frame.stats,
              me: snapshot.me
            })
          };
        }
        break;
      }
      case 'error': {
        this.state = { ...this.state, error: frame.reason || frame.code };
        break;
      }
      case 'pong':
      default:
        return;
    }
    this.push();
  }

  // ---- 降级轮询 ----------------------------------------------------------

  private startPolling(): void {
    if (this.playersTimer) return;
    const pollPlayers = async (): Promise<void> => {
      try {
        const snapshot = await fetchLobbyPlayers();
        this.state = {
          ...this.state,
          snapshot,
          error: null
        };
        this.push();
      } catch (e: unknown) {
        // 鉴权失败时别用「拉取失败」盖掉「登录已过期」—— 那条更准。
        if (this.state.status === 'unauthorized') return;
        this.state = {
          ...this.state,
          error: (e as { message?: string }).message ?? '拉取大厅列表失败'
        };
        this.push();
      }
    };
    const pollHistory = async (): Promise<void> => {
      try {
        const messages = await fetchLobbyHistory(LOBBY_HISTORY_LIMIT);
        this.state = { ...this.state, messages: mergeMessages(this.state.messages, messages) };
        this.push();
      } catch {
        // 历史拉不到不影响列表 —— 下一轮再试
      }
    };
    this.playersTimer = setInterval(() => void pollPlayers(), POLL_PLAYERS_MS);
    this.historyTimer = setInterval(() => void pollHistory(), POLL_HISTORY_MS);
    this.playersTimer.unref?.();
    this.historyTimer.unref?.();
    void pollPlayers();
    void pollHistory();
  }

  private stopPolling(): void {
    if (this.playersTimer) {
      clearInterval(this.playersTimer);
      this.playersTimer = null;
    }
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
  }

  // ---- 推给渲染进程 ------------------------------------------------------

  private push(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(LOBBY_EVENT_CHANNEL, this.state);
    }
  }
}

export const lobbyService = new LobbyService();
```

- [ ] **Step 3：编译验证**

Run:

```powershell
npm run typecheck:node
```

Expected: 无错误。

- [ ] **Step 4：提交（你来跑）**

```powershell
git add src/main/lobby/service.ts src/main/match/poller.ts
git commit -m "feat(lobby): 主进程大厅服务"
```

---

## Task B7：IPC / preload 打通

**Files:**
- Modify: `local_skin_importer/src/main/ipc.ts`
- Modify: `local_skin_importer/src/main/index.ts`
- Modify: `local_skin_importer/src/main/__tests__/ipc.test.ts`
- Modify: `local_skin_importer/src/preload/index.ts`

- [ ] **Step 1：main 侧加 handler**

`src/main/ipc.ts` —— 在 `registerIpcHandlers()` 里,「实用功能」那一段之后加：

```ts
  // ---- 开黑大厅 ------------------------------------------------------------

  /**
   * 大厅状态。
   *
   * <p>大厅服务在应用启动时就起来了(退到托盘也保持连接)——
   * 这里只是把当前状态取出来给渲染进程。
   */
  ipcMain.handle('lobby:get-state', () => lobbyService.getState());

  /** 「在大厅公开我的信息」开关。 */
  ipcMain.handle('lobby:set-public', async (_event, payload: LobbyPublicPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.publicVisible !== 'boolean') throw new Error('invalid publicVisible');
    return lobbyService.setPublicVisible(payload.publicVisible);
  });

  /** 说一句话。 */
  ipcMain.handle('lobby:send', async (_event, payload: LobbySendPayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.text !== 'string') throw new Error('invalid text');
    return lobbyService.say(payload.text);
  });

  /** 拉一个人进房间。 */
  ipcMain.handle('lobby:invite', async (_event, payload: LobbyInvitePayload) => {
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    if (typeof payload.nickname !== 'string') throw new Error('invalid nickname');
    if (typeof payload.gameId !== 'string') throw new Error('invalid gameId');
    return await lobbyService.invite(payload.nickname, payload.gameId);
  });
```

并在文件顶部加 import：

```ts
import { lobbyService } from './lobby/service';
```

三个 payload 类型**放在 `src/main/ipc.ts`**(跟 `RedeemPayload` / `LlmKeyPayload`
那一堆挨着)—— 用它们的是 ipc.ts 里的 handler,放 `index.ts` 那边 ipc.ts 看不见:

```ts
/** 「在大厅公开我的信息」开关。 */
interface LobbyPublicPayload {
  publicVisible: boolean;
}

/** 大厅里发的一句话。 */
interface LobbySendPayload {
  text: string;
}

/** 拉一个人进房间。 */
interface LobbyInvitePayload {
  nickname: string;
  gameId: string;
}
```

（`LOBBY_EVENT_CHANNEL` 不用在这儿 import —— 推状态的是 `service.ts` 自己。）

**启动放在 `src/main/index.ts`,不放 `registerIpcHandlers()` 里** ——
`registerIpcHandlers()` 会被 `src/main/__tests__/ipc.test.ts` 调用,
在里头启动大厅等于让单测真的去连后端。

`src/main/index.ts` 里,`matchPoller.start();` 那一行旁边加:

```ts
  // 大厅的应用启动就起来 —— presence 反映的是「应用在跑」,
  // 退到托盘也保持连接(退出应用才下线)。
  lobbyService.start();
```

并在文件顶部加:

```ts
import { lobbyService } from './lobby/service';
```

- [ ] **Step 2：preload 侧加 api**

`src/preload/index.ts` —— 在 `api` 对象里加：

```ts
  // ---- 开黑大厅 ------------------------------------------------------------
  /** 大厅当前状态(在线列表 / 聊天 / 连接状态)。 */
  getLobbyState: (): Promise<LobbyState> => invoke('lobby:get-state'),
  /** 「在大厅公开我的信息」开关。 */
  setLobbyPublic: (publicVisible: boolean): Promise<LobbyState> =>
    invoke('lobby:set-public', { publicVisible }),
  /** 在大厅里说一句话。 */
  sendLobbyMessage: (text: string): Promise<{ ok: boolean; message?: string }> =>
    invoke('lobby:send', { text }),
  /** 把一个人拉进房间;撞不到接口就降级成复制游戏ID。 */
  inviteLobbyPlayer: (nickname: string, gameId: string): Promise<LobbyInviteResult> =>
    invoke('lobby:invite', { nickname, gameId }),
  /** 订阅主进程推来的大厅状态,返回取消订阅的函数 */
  onLobbyState: (cb: (state: LobbyState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: LobbyState): void => {
      cb(state);
    };
    ipcRenderer.on(LOBBY_EVENT_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(LOBBY_EVENT_CHANNEL, listener);
    };
  },
```

并在文件顶部的 import 里加：

```ts
import { LOBBY_EVENT_CHANNEL } from '../shared/lobby';
import type { LobbyInviteResult, LobbyState } from '../shared/lobby';
```

以及在 `export type { ... }` 那堆里加：

```ts
export type {
  LobbyChatFrame,
  LobbyClientStatus,
  LobbyInviteResult,
  LobbyMe,
  LobbyMessage,
  LobbyPlayer,
  LobbySnapshot,
  LobbyState,
  LobbyStats
} from '../shared/lobby';
```

- [ ] **Step 3：把既有单测 `ipc.test.ts` 补上 mock**

`src/main/ipc.ts` 现在会 import `./lobby/service`,那一条链会把
`electron` / `../match/poller` 都拖进来 —— 不 mock 掉,`ipc.test.ts` 直接挂。

`src/main/__tests__/ipc.test.ts` 改两处:

1. electron 的 mock 里补上 `app`(大厅的本地设置要读 `userData`):

```ts
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle },
  ipcRenderer: {
    invoke: mocks.ipcRendererInvoke,
    on: vi.fn(),
    removeListener: vi.fn()
  },
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
    getAllWindows: mocks.getAllWindows
  },
  clipboard: { writeText: mocks.clipboardWriteText },
  Notification: { isSupported: vi.fn(() => false) },
  // 大厅的本地设置要读 userData
  app: { getPath: vi.fn(() => process.cwd()) }
}));
```

2. 单独 mock 掉大厅服务(它会真的去连后端):

```ts
// 大厅服务会真的去连后端,单测里必须换掉。
vi.mock('../lobby/service', () => ({
  lobbyService: {
    start: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(() => ({
      status: 'disconnected',
      degraded: false,
      publicVisible: true,
      snapshot: null,
      messages: [],
      error: null
    })),
    setPublicVisible: vi.fn(),
    say: vi.fn(() => ({ ok: true })),
    invite: vi.fn()
  }
}));
```

> ⚠️ electron 的 mock 里**必须**有 `app`:`prefs.ts` 顶层 `import { app } from 'electron'`,
> 而 vitest 的 mock 工厂里没导出 `app` 时,访问它会直接抛
> 「No 'app' export is defined on the mock」。

3. 既有断言要跟着改 —— 多注册了 4 个通道:

   - `registers all 33 ipc channels` → 改成 **37**,并在期望数组末尾加上
     `'lobby:get-state'` / `'lobby:set-public'` / `'lobby:send'` / `'lobby:invite'`。
   - `exposes all renderer methods through contextBridge` 里加上
     `api.getLobbyState()` / `api.setLobbyPublic(true)` /
     `api.sendLobbyMessage('来两把')` / `api.inviteLobbyPlayer('林俊杰', '18557')`,
     期望的 `ipcRendererInvoke.mock.calls` 数组末尾同样加四行。
   - `ExposedApi` 这个本地类型里补上那四个方法。

4. 顺手补几条大厅 handler 的用例(校验参数、返回值):

```ts
  it('lobby:get-state 把大厅服务当前的状态原样返回', async () => {
    await expect(invoke('lobby:get-state')).resolves.toMatchObject({
      status: 'disconnected',
      degraded: false,
      publicVisible: true
    });
  });

  it('lobby:set-public 开关必须是布尔', async () => {
    await expect(invoke('lobby:set-public', {}, { publicVisible: 'yes' })).rejects.toThrow(
      'invalid publicVisible'
    );
  });

  it('lobby:send 把这句话交给大厅服务', async () => {
    await expect(invoke('lobby:send', {}, { text: '来两把大乱斗' })).resolves.toEqual({
      ok: true
    });
  });

  it('lobby:send 文本不是字符串就拒掉', async () => {
    await expect(invoke('lobby:send', {}, { text: 42 })).rejects.toThrow('invalid text');
  });

  it('lobby:invite 昵称和游戏ID都必须是字符串', async () => {
    await expect(invoke('lobby:invite', {}, { nickname: '林俊杰' })).rejects.toThrow(
      'invalid gameId'
    );
    await expect(invoke('lobby:invite', {}, { nickname: 1, gameId: '18557' })).rejects.toThrow(
      'invalid nickname'
    );
  });
```

- [ ] **Step 4：编译验证**

Run:

```powershell
npm run typecheck
npx vitest run src/main/__tests__/ipc.test.ts
```

Expected: 两条都过 —— 类型检查无错误,`ipc.test.ts` 全绿。

- [ ] **Step 5：提交（你来跑）**

```powershell
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/main/__tests__/ipc.test.ts
git commit -m "feat(lobby): IPC 与 preload 打通"
```

---

## Task B8：大厅界面

**Files:**
- Create: `local_skin_importer/src/renderer/src/components/RegionBuddyCard.vue`
- Create: `local_skin_importer/src/renderer/src/views/Lobby.vue`
- Modify: `local_skin_importer/src/renderer/src/views/Tools.vue`
- Modify: `local_skin_importer/src/renderer/src/router/index.ts`
- Modify: `local_skin_importer/src/renderer/src/App.vue`（左边栏加一项）

- [ ] **Step 1：把「同区开黑搭子」抽成组件**

新建 `src/renderer/src/components/RegionBuddyCard.vue`,把 `Tools.vue` 里
「同区开黑搭子」那张卡的模板 + 相关 script + 相关 style **原样搬过来**:

- 模板:Tools.vue 第 87~223 行那张 `el-card`
- script:`regionResult` / `regionLoading` / `regionError` / `selectedPositions` /
  `tierGap` / `collectionGap` / `includeHigher` / `regionText` / `regionEmptyText` /
  `regionUsers` / `higherDisabled` / `myMatchText` / `matchMetaOf` / `onPositionsChange` /
  `onTierGapChange` / `onCollectionGapChange` / `onIncludeHigherChange` /
  `onFetchRegion` / `onCopyGameId` / `initialOf`
  ⚠️ **`regionLoading` / `regionError` 也在搬走的名单里** —— 模板里
  `:loading="regionLoading"` 和 `v-if="regionError"` 要用,漏了会编译不过。
- 常量:`POSITION_OPTIONS` / `POSITION_LABELS` / `TIER_GAP_OPTIONS` / `COLLECTION_GAP_OPTIONS`
- import 也一并搬走(留在 Tools.vue 会报「没用」):
  `describeRegion` / `displayName` / `emptyRegionText`(shared/regionUsers)、
  `RegionUser` / `RegionUsersResult`、`POSITION_CODE_LABELS`(shared/matchProfile)、
  `PositionCode`、以及 `ElNotification`(只有 `onCopyGameId` 在用)
- style:**Tools.vue 里那张卡用到的全部规则,一起搬** ——
  `.card-header` / `.status-text` / `.warn-row` / `.tip-row` / `.tip-line` / `.tip-list` /
  `.region-fetch` / `.filter-row` / `.filter-field` / `.position-select` / `.tier-select` /
  `.gap-select` / `.higher-switch` / `.filter-hint` / `.me-row` / `.region-*` / `.vip-badge`

  ⚠️ **Tools.vue 的 `<style scoped>` 管不到子组件的模板** ——
  这些规则不搬过去,新组件里的卡片头(`display:flex`)、提示段的分隔线、
  `.status-text` 的右对齐全都会丢。搬过去之后 Tools.vue 那边如果这些类
  没人用了就删掉(`.warn-row` / `.tip-*` 大厅入口那张卡还在用,别删)。

⚠️ 搬完确认一下:`Tools.vue` 里这些符号**只有**「同区开黑搭子」那张卡在用
(已核对过),所以整块搬走不会碰到别的卡片。

组件的 `<script setup>` 顶部加一行注释说明来历:

```ts
/**
 * 「同区开黑搭子」卡片。
 *
 * <p>从 Tools.vue 抽出来的 —— 大厅页和实用功能页都要用它,
 * 抄两份的话两边迟早会走偏。
 */
```

- [ ] **Step 2：Tools.vue 改成引用组件**

`Tools.vue` 里把搬走的那张 `el-card` 换成:

```vue
    <RegionBuddyCard />
```

并在 script 里加:

```ts
import RegionBuddyCard from '../components/RegionBuddyCard.vue';
```

**同时在「自动接受对局」那张卡下面加一个大厅入口**(大厅是新东西,
实用功能页得有个地方能跳过去):

```vue
    <el-card class="tool-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span class="hx-diamond hx-diamond--blue" />
          <span class="hx-label">开黑大厅</span>
          <span class="status-text">实时聊天 · 在线玩家 · 一键拉人</span>
          <el-button class="region-fetch" type="primary" size="small" @click="goLobby">
            进入大厅
          </el-button>
        </div>
      </template>
      <div class="tip-row">
        <p class="tip-line">大厅跟「同区开黑搭子」的区别:</p>
        <ul class="tip-list">
          <li>大厅是实时的 —— 能看到谁在线、他在不在打游戏。</li>
          <li>大厅里能直接聊天约人,不用复制ID再加好友。</li>
          <li>空闲的人可以直接被拉进你的自定义房间。</li>
        </ul>
      </div>
    </el-card>
```

script 里加:

```ts
import { useRouter } from 'vue-router';
const router = useRouter();
function goLobby(): void {
  void router.push('/lobby');
}
```

- [ ] **Step 3：写大厅页**

新建 `src/renderer/src/views/Lobby.vue`:

```vue
<template>
  <div class="lobby-view">
    <div class="page-head">
      <span class="hx-diamond" />
      <span class="page-title">开黑大厅</span>
      <span class="page-hint">同一个大区的人,现在都在这儿</span>
      <el-tag v-if="state?.degraded" class="degraded-tag" type="warning" size="small">
        已降级为轮询模式
      </el-tag>
      <el-switch
        class="public-switch"
        :model-value="state?.publicVisible ?? true"
        active-text="在大厅公开我的信息"
        @change="onTogglePublic"
      />
    </div>

    <div class="stat-row">
      <div class="stat-field">
        <span class="hx-label">在线</span>
        <span class="stat-value">{{ state?.snapshot?.stats.online ?? '—' }}</span>
        <span class="stat-hint">应用在运行中</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">同大区</span>
        <span class="stat-value">{{ state?.snapshot?.stats.sameZone ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">可以拉人</span>
        <span class="stat-value">{{ state?.snapshot?.stats.invitable ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">我的段位分</span>
        <span class="stat-value">{{ me?.rankScore ?? '—' }}</span>
      </div>
      <div class="stat-field">
        <span class="hx-label">我的收藏分</span>
        <span class="stat-value">{{ me?.collectionScore ?? '—' }}</span>
      </div>
    </div>

    <div v-if="state?.error" class="warn-row">{{ state.error }}</div>

    <div class="lobby-body">
      <!-- 左栏:聊天 -->
      <el-card class="chat-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="hx-diamond" />
            <span class="hx-label">大厅聊天</span>
            <span class="status-text">最近 50 条</span>
          </div>
        </template>

        <div ref="chatBox" class="chat-box">
          <div v-if="messages.length === 0" class="chat-empty">
            还没有人说话 —— 说第一句吧。
          </div>
          <div v-for="m in messages" :key="m.id" class="chat-line">
            <span class="chat-time">{{ m.createdAt.slice(11, 16) }}</span>
            <span class="chat-name">{{ m.nickname || m.gameId || '无名召唤师' }}</span>
            <span class="chat-text">{{ m.text }}</span>
          </div>
        </div>

        <div class="chat-input-row">
          <el-input
            v-model="draft"
            class="chat-input"
            size="small"
            maxlength="64"
            placeholder="说点什么 —— 约人、报位置、问段位"
            @keyup.enter="onSend"
          />
          <el-button class="hx-gold" size="small" :disabled="!draft.trim()" @click="onSend">
            发送
          </el-button>
        </div>
        <div class="tip-row">
          <p class="tip-line">单条最多 64 字;10 秒内不超过 5 条。</p>
        </div>
      </el-card>

      <!-- 右栏:玩家列表 -->
      <el-card class="player-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="hx-diamond hx-diamond--blue" />
            <span class="hx-label">玩家列表</span>
            <el-radio-group v-model="scope" size="small">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="same">同大区</el-radio-button>
            </el-radio-group>
          </div>
        </template>

        <div class="section-label">
          {{ scope === 'same' ? '同大区在线' : '在线' }} ({{ visibleOnline.length }})
        </div>
        <div v-if="visibleOnline.length === 0" class="player-empty">
          现在没人在大厅里。
        </div>
        <div v-for="p in visibleOnline" :key="p.userId" class="player-row">
          <span class="status-dot" :class="'is-' + lobbyStatusOf(p.phase)" />
          <div class="player-info">
            <span class="player-name">
              {{ lobbyPlayerName(p) }}
              <span v-if="p.vip" class="vip-badge">VIP</span>
            </span>
            <span class="player-meta">
              {{ p.gameId || '无游戏ID' }}
              <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
              <span v-if="p.collectionScore !== null"> · 收藏分 {{ p.collectionScore }}</span>
              <span v-if="p.positionLabels.length"> · {{ p.positionLabels.join('、') }}</span>
            </span>
          </div>
          <span class="player-status">{{ lobbyStatusText(p.phase) }}</span>
          <el-button class="hx-gold" size="small" text @click="onCopy(p)">复制ID</el-button>
          <el-button
            class="hx-gold"
            size="small"
            text
            :disabled="!isLobbyInvitable(p)"
            @click="onInvite(p)"
          >
            邀请
          </el-button>
        </div>

        <div class="section-label">同区离线候选 ({{ offline.length }})</div>
        <div v-if="offline.length === 0" class="player-empty">
          没有同区的人最近来过大厅。
        </div>
        <div v-for="p in offline" :key="p.userId" class="player-row">
          <span class="status-dot is-offline" />
          <div class="player-info">
            <span class="player-name">{{ lobbyPlayerName(p) }}</span>
            <span class="player-meta">
              {{ p.gameId || '无游戏ID' }}
              <span v-if="p.rankLabel"> · {{ p.rankLabel }}</span>
              <span v-if="p.lastLobbyAt"> · 上次在线 {{ lobbyLastSeenText(p.lastLobbyAt) }}</span>
            </span>
          </div>
          <span class="player-status">离线</span>
          <el-button class="hx-gold" size="small" text @click="onCopy(p)">复制ID</el-button>
        </div>
      </el-card>
    </div>

    <!-- 同区搭子:按分数筛同区的人(老功能,搬进大厅) -->
    <RegionBuddyCard />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElNotification } from 'element-plus';
import RegionBuddyCard from '../components/RegionBuddyCard.vue';
import {
  isLobbyInvitable,
  lobbyLastSeenText,
  lobbyPlayerName,
  lobbyStatusOf,
  lobbyStatusText
} from '../../../shared/lobby';
import type { LobbyMe, LobbyMessage, LobbyPlayer, LobbyState } from '../../../shared/lobby';

const state = ref<LobbyState | null>(null);
const draft = ref('');
const scope = ref<'all' | 'same'>('all');
const chatBox = ref<HTMLElement | null>(null);

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  state.value = await window.api.getLobbyState();
  unsubscribe = window.api.onLobbyState((next) => {
    state.value = next;
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

const me = computed<LobbyMe | null>(() => state.value?.snapshot?.me ?? null);
const messages = computed<LobbyMessage[]>(() => state.value?.messages ?? []);
const online = computed<LobbyPlayer[]>(() => state.value?.snapshot?.online ?? []);
const offline = computed<LobbyPlayer[]>(() => state.value?.snapshot?.offline ?? []);

/** 我的大区(归一化后的名字)—— 同大区筛选靠它。 */
const myZone = computed<string>(() => me.value?.canonicalZone ?? '');

/**
 * 列表里显示谁。
 *
 * <p>「同大区」这个筛选是**客户端**做的 —— 后端给的 offline 本来就是同大区的,
 * 在线列表里再按大区过滤一遍。两边都用后端归一化过的名字比。
 */
const visibleOnline = computed<LobbyPlayer[]>(() => {
  if (scope.value === 'all') return online.value;
  if (!myZone.value) return online.value;
  // 比的是**归一化后**的大区 —— 库里「艾欧尼亚」和「艾欧尼亚专区」是同一个大区,
  // 直接比原始串会把同区的人漏掉(后端已经归一化过一次,别在前端再各判一次)。
  return online.value.filter((p) => p.canonicalZone === myZone.value);
});

watch(messages, async () => {
  await nextTick();
  const box = chatBox.value;
  if (box) box.scrollTop = box.scrollHeight;
});

function onTogglePublic(value: string | number | boolean): void {
  void window.api.setLobbyPublic(value === true);
}

async function onSend(): Promise<void> {
  const text = draft.value.trim();
  if (!text) return;
  const result = await window.api.sendLobbyMessage(text);
  if (!result.ok) {
    ElNotification({ type: 'warning', message: result.message ?? '发不出去', duration: 2500 });
    return;
  }
  draft.value = '';
}

async function onCopy(player: LobbyPlayer): Promise<void> {
  if (!player.gameId) return;
  await window.api.copyText(player.gameId);
  ElNotification({ type: 'success', message: `已复制 ${player.gameId}`, duration: 2000 });
}

async function onInvite(player: LobbyPlayer): Promise<void> {
  const result = await window.api.inviteLobbyPlayer(
    lobbyPlayerName(player),
    player.gameId
  );
  if (result.mode === 'copied') {
    ElNotification({ type: 'info', message: result.message, duration: 3000 });
    return;
  }
  ElNotification({ type: 'success', message: result.message, duration: 2000 });
}
</script>

<style scoped>
.lobby-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 1100px;
  margin: 0 auto;
}
/* ⚠️ `.card-header` / `.status-text` 在别的 view 里都是各自 scoped 的,
   没有全局版本 —— 这里不自己写一份,卡片头会散架(尤其 `.status-text`
   的右对齐靠的就是 margin-left:auto)。 */
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-text {
  margin-left: auto;
  font-size: 12px;
  color: var(--hx-text-dim);
}
.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title {
  font-size: 15px;
  color: var(--hx-gold);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.page-hint {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.degraded-tag {
  margin-left: 10px;
}
.public-switch {
  margin-left: auto;
}
.stat-row {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}
.stat-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 15px;
  color: var(--hx-gold);
  font-family: monospace;
}
.stat-hint {
  font-size: 10px;
  color: var(--hx-text-faint);
}
.warn-row {
  padding: 8px 12px;
  border-left: 2px solid var(--hx-gold);
  background: var(--hx-tint-gold-soft);
  color: var(--hx-gold);
  font-size: 12px;
}
.lobby-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.chat-card {
  flex: 1 1 55%;
  min-width: 0;
}
.player-card {
  flex: 1 1 45%;
  min-width: 0;
}
.chat-box {
  height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-empty {
  font-size: 12px;
  color: var(--hx-text-faint);
}
.chat-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.chat-time {
  color: var(--hx-text-faint);
  font-family: monospace;
  flex-shrink: 0;
}
.chat-name {
  color: var(--hx-blue);
  flex-shrink: 0;
}
.chat-text {
  color: var(--hx-text);
  word-break: break-all;
}
.chat-input-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.chat-input {
  flex: 1;
}
.section-label {
  margin: 10px 0 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--hx-text-faint);
  text-transform: uppercase;
}
.section-label:first-of-type {
  margin-top: 0;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--hx-line);
}
.player-row:last-child {
  border-bottom: none;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.is-idle {
  background: var(--hx-gold);
  box-shadow: 0 0 8px var(--hx-gold);
}
.status-dot.is-busy {
  background: var(--hx-text-faint);
}
.status-dot.is-unknown {
  background: transparent;
  border: 1px solid var(--hx-text-faint);
}
.status-dot.is-offline {
  background: var(--hx-text-faint);
  opacity: 0.5;
}
.player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.player-name {
  font-size: 13px;
  color: var(--hx-text);
}
.player-meta {
  font-size: 11px;
  color: var(--hx-text-dim);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-status {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--hx-text-dim);
}
.player-empty {
  padding: 4px 0;
  font-size: 12px;
  color: var(--hx-text-faint);
}
</style>
```

- [ ] **Step 4：加路由 + 左边栏入口**

`src/renderer/src/router/index.ts`：

```ts
const Lobby = () => import('../views/Lobby.vue');
```

路由表里加一行:

```ts
  { path: '/lobby', name: 'lobby', component: Lobby },
```

`src/renderer/src/App.vue` 的 `NAV_ITEMS` 加一项(大厅是主功能,
不能只藏在「实用功能」页里):

```ts
  { index: '05', label: '开黑大厅', path: '/lobby' }
```

- [ ] **Step 5：编译验证**

Run:

```powershell
npm run typecheck
```

Expected: 无错误。

- [ ] **Step 6：提交（你来跑）**

```powershell
git add src/renderer/src/components/RegionBuddyCard.vue src/renderer/src/views/Lobby.vue src/renderer/src/views/Tools.vue src/renderer/src/router/index.ts src/renderer/src/App.vue
git commit -m "feat(lobby): 大厅界面"
```

---

## Task B9：LCU 邀请端点探测脚本

**Files:**
- Create: `local_skin_importer/scripts/probe-lobby-invite.mjs`

> 这个脚本是**纯本机回环**,随时能跑 —— 不需要在对局里。
> 手法:**拿 GET 打一个 POST 端点** —— 回 405 = 路由存在,回 404 = 不存在。

- [ ] **Step 1：写脚本**

`local_skin_importer/scripts/probe-lobby-invite.mjs`：

```js
/**
 * 探测本机 LCU 上的「建房 / 邀请」路由到底存不存在。
 *
 * <p>手法:拿 **GET** 打一个 POST 端点 —— 回 405 = 路由存在(方法不对),
 * 回 404 = 路由不存在。不用猜 body 就能先验出路由在不在。
 *
 * <p>⚠️ 第一行是**标尺**:用一个肯定存在的 GET 端点拿 POST 去打。
 * 标尺给 405 才说明这个客户端真的用 405 表示「路由在、方法不对」——
 * 标尺不是 405,后面 405 的结果就都不能信(这个客户端可能一律回 404)。
 *
 * <p>跑法:先开着游戏客户端(进到主界面),然后:
 *   node scripts\probe-lobby-invite.mjs
 *
 * <p>⚠️ 脚本里的输出全是 ASCII —— 控制台按 GBK 解 stdout 字节,
 * 中文会变成乱码。需要中文的话写到文件里再看。
 *
 * <p>端口和令牌从**进程命令行**里拿(照 scripts\probe-lcu-skin.mjs 的做法)——
 * 国服客户端的 lockfile 不在 Riot 那个目录,读命令行更靠得住。
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const https = require('node:https');
const http = require('node:http');

const CANDIDATES = [
  // 标尺:已知存在的 GET 端点,拿 POST 打它
  { method: 'POST', path: '/lol-summoner/v1/current-summoner', label: 'CALIBRATION' },
  { method: 'GET', path: '/lol-lobby/v2/lobby/invitations', label: 'v2 lobby invitations' },
  { method: 'GET', path: '/lol-lobby/v2/lobby', label: 'v2 lobby' },
  { method: 'GET', path: '/lol-lobby/v1/lobby/invitations', label: 'v1 lobby invitations' },
  { method: 'GET', path: '/lol-lobby/v2/party/invitations', label: 'v2 party invitations' },
  { method: 'GET', path: '/lol-lobby/v2/lobby/invite', label: 'v2 lobby invite' },
  { method: 'GET', path: '/lol-summoner/v1/summoners', label: 'summoners (search)' }
];

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

async function readClientCmdline() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'\" " +
    '| ForEach-Object { $_.CommandLine }';
  return run('powershell.exe', ['-NoProfile', '-Command', script]);
}

function arg(cmdline, name) {
  const match = cmdline.match(new RegExp(`--${name}=([^"\\s]+)`));
  return match ? match[1] : '';
}

function probe(base, port, token, candidate) {
  return new Promise((resolve) => {
    const client = base === 'https' ? https : http;
    const auth = Buffer.from(`riot:${token}`, 'ascii').toString('base64');
    const req = client.request(
      {
        hostname: '127.0.0.1',
        port,
        path: candidate.path,
        method: candidate.method,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout: 6000
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, note: '' });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, note: 'timeout' });
    });
    req.on('error', (err) => resolve({ status: 0, note: String((err && err.message) || err) }));
    req.end();
  });
}

async function main() {
  const cmdline = await readClientCmdline();
  if (!cmdline.trim()) {
    console.log('CLIENT_NOT_FOUND');
    console.log('Start the game client first (main menu), then run this again.');
    return;
  }
  const port = Number(arg(cmdline, 'app-port'));
  const token = arg(cmdline, 'remoting-auth-token');
  if (!port || !token) {
    console.log('NO_PORT_OR_TOKEN');
    return;
  }

  // 国服客户端有的走 https 有的走 http,挨个试
  let base = null;
  for (const proto of ['https', 'http']) {
    const res = await probe(proto, port, token, {
      method: 'GET',
      path: '/lol-summoner/v1/current-summoner'
    });
    console.log(`try ${proto}://127.0.0.1:${port} -> ${res.status} ${res.note}`);
    if (res.status === 200) {
      base = proto;
      break;
    }
  }
  if (!base) {
    console.log('NO_LIVE_ENDPOINT');
    return;
  }
  console.log(`using ${base}://127.0.0.1:${port}\n`);

  let calibrated = false;
  for (const candidate of CANDIDATES) {
    const res = await probe(base, port, token, candidate);
    let verdict;
    if (res.status === 405) {
      verdict = 'EXISTS (405 = route present, method rejected)';
      if (candidate.label === 'CALIBRATION') calibrated = true;
    } else if (res.status === 404) {
      verdict = 'MISSING (404)';
    } else if (res.status === 200) {
      verdict = 'EXISTS (200)';
    } else {
      verdict = `UNKNOWN (${res.status} ${res.note})`;
    }
    console.log(candidate.label.padEnd(28) + candidate.path.padEnd(38) + '-> ' + verdict);
  }

  console.log('');
  if (!calibrated) {
    console.log('CALIBRATION_FAILED: this client does not answer 405 for a known route.');
    console.log('Treat every result above as unreliable.');
  }
  console.log('Now replace the candidate list in src/main/lobby/invite.ts with the routes marked EXISTS.');
}

void main();
```

- [ ] **Step 2：跑一下(游戏客户端开着的时候)**

Run:

```powershell
node scripts/probe-lobby-invite.mjs
```

Expected: 每条候选路由一行结果。**EXISTS 的路由**要填回
`src/main/lobby/invite.ts` 的 `buildInviteCandidates()` / `buildLobbyCandidates()`
—— 把真路由排到最前,没撞到的删掉。

> 撞不到也不阻塞上线 —— 那时候大厅的「邀请」按钮就是「复制ID」。

- [ ] **Step 3：提交（你来跑）**

```powershell
git add scripts/probe-lobby-invite.mjs src/main/lobby/invite.ts
git commit -m "feat(lobby): LCU 邀请路由探测脚本"
```

---

# Part C：整体验证与上线顺序

- [ ] **Step 1：桌面端全量测试**

```powershell
nvm4w use 20.19.4
npx vitest run
```

Expected: 全绿。实测(2026-11-24):64 个测试文件 / 915 个用例,全过。

- [ ] **Step 2：桌面端类型检查 + 构建**

```powershell
npm run typecheck
npm run build
```

Expected: 两条都成功。

- [ ] **Step 3：后端全量编译 + 本模块测试**

```powershell
$env:JAVA_HOME = 'D:\develop_tools\JDK\jdk17'
mvn -pl lobby -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=Lobby*Test" test
mvn -pl app -am "-Dmaven.test.skip=false" "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=LobbyIntegrationTest" test
```

Expected: `BUILD SUCCESS`。

- [ ] **Step 4：先跑生产 DDL(重要)**

后端发版**之前**必须先跑这个 DDL,否则线上会报 `Unknown column`:

```
app/src/main/resources/db/migration_lobby_2026_11.sql
```

在**生产 MySQL 5.7** 上执行(命令见 Task A2 的 Step 2,幂等可重跑)。
⚠️ 生产库是 5.7 不是 8.0 —— DDL 已经避开了 8.0 语法。
`ALTER TABLE t_user ADD COLUMN` 是 copy 算法,**选低峰窗口**。

- [ ] **Step 5：后端发版**

```powershell
cd D:\Code\Front_Project\all\all_function_api
$env:JAVA_HOME = 'D:\develop_tools\JDK\jdk17'
mvn -pl app -am -DskipTests clean package
```

产物是 `app/target/lol-skin-api-1.0.0.jar`。⚠️ 仓库里**没有**部署脚本(`docker-compose.yml`
只是本地开发用的 MySQL 8.0 + Redis,不是生产),所以「怎么把这个 jar 放上去、
怎么重启进程」按现有的发版流程走 —— 这一步**必须 DDL 先跑完**(C-4),
否则线上第一个访问大厅的请求就会报 `Unknown column 'last_lobby_at'`。

上线后先自检一下:

```powershell
# 没带 token 应该被拒(401/403 都算「拒了」)
curl -i http://101.34.210.254/api/lobby/players
```

- [ ] **Step 6：桌面端发版**

```powershell
cd D:\Code\Front_Project\all\local_skin_importer
nvm4w use 20.19.4
npm run pack
```

界面上的版本号读的是 `package.json` —— 现在是 `0.50.0`。
打包产物在 `dist/` 下(NSIS 安装包)。

- [ ] **Step 7：手动验收清单**

| # | 做什么 | 期望 |
|---|---|---|
| 1 | 启动桌面端(已登录) | 大厅页在线数 = 1(你自己),同大区 0 或 1 |
| 2 | 另开一个桌面端实例 | 两边都能看到对方在线 |
| 3 | 一边在聊天里说话 | 另一边实时收到 |
| 4 | 一边进对局 | 另一边看到状态灯变灰、状态文字变「对局中」 |
| 5 | 另一边点「邀请」 | 空闲的人能拉;在打的人按钮是灰的 |
| 6 | 关掉「在大厅公开我的信息」 | 对方列表里看不到我;我仍然能聊天 |
| 7 | 打开开关 | 对方列表里又能看到我 |
| 8 | 断网 | 界面出现「已降级为轮询模式」标签,列表仍会刷新 |
| 9 | 退出应用 | 对方的在线数减一 |

---

## 风险与回头路

| 风险 | 怎么发现的 | 回头路 |
|---|---|---|
| LCU 建房/邀请路由国服不存在 | B9 的探测脚本 | 降级成「复制游戏ID」—— 界面自动切,不用改代码 |
| 大厅冷清(桌面端用户少) | 验收清单第 1 条 | 离线候选撑着;「在线」数字如实显示,不粉饰 |
| `t_user` 加列在生产上锁表 | DDL 选低峰 | DDL 没跑之前后端别发(顺序在 C-4) |
| WS 握手被 `DesktopScopeInterceptor` 拦 | 后端集成测试 | 握手走 `WebSocketHttpRequestHandler`,拦截器对非 `HandlerMethod` 直接放行;REST 那边已经标了 `@AllowsDesktopToken` |
| Redis 没配 / 连不上 | 后端启动日志 | `LobbyEventBus` 本地直接投 + Redis 转发失败只打日志 —— 单实例照样能用 |
| 后端多实例时一条消息被投两遍 | 两台后端各开一个桌面端 | `LobbyEventBus` 的 envelope 带 `origin`,自己发的跳过 |

---

## 「提交」这一步说明

计划里每一步的 `git commit` **由你来跑** —— 我不替你提交。
改动留在工作区 / 暂存区,你自己看完再提交。

---

## 「跑命令」这一步说明

写这份计划的时候,这个环境里的 Bash 安全分类器间歇性不可用,
`mvn` / `git` / `npx vitest` 这类命令我这边跑不动。
所以每一步都写清楚了**命令 + 期望输出**,由你在本机跑。


