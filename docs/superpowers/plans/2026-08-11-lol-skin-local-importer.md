# LOL Skin Local Importer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop helper that reads the user's owned League of Legends skins from the local LCU API and syncs them to the existing Spring Boot backend under their Mini-Program/H5 account.

**Architecture:** Electron main process owns LCU credentials (lockfile + self-signed Basic Auth); Vue 3 renderer drives a dark-themed UI; safeStorage encrypts the JWT; new `/api/skins/sync-user-skins` backend endpoint receives the PUUID + skin IDs, binds the PUUID on first sync, and UPSERTs rows idempotently. JWT is the sole identity source; no LCU traffic on the backend.

**Tech Stack:**
- **Electron side:** Electron 30+, electron-vite, Vue 3, TypeScript, Element Plus, axios, vitest, Playwright (e2e only).
- **Backend side:** Spring Boot 3.1.6, MyBatis-Plus 3.5.3.1, Java 17, Lombok, JUnit 5 + Mockito + MockMvc (standaloneSetup pattern).

**Spec:** `docs/superpowers/specs/2026-08-11-lol-skin-local-importer-design.md` — read this first.

**Two repositories touched:**
- New: `D:\Front_Project\all\local_skin_importer` — Electron app (own git repo at `github.com/soirs-96/local_skin_importer`).
- Existing: `D:\Front_Project\all\all_function_api` — Spring Boot backend (separate git repo; subagent should not commit on the user's behalf — see Task 16).

---

## Conventions used throughout

- **Backend testing mvn command** — `mvn test` is a silent no-op by default (pom sets `<maven.test.skip>true</maven.test.skip>`). Always pass `-Dmaven.test.skip=false`. See project memory `all-function-api-maven-test-skip-default`.
- **JDK for backend** — use `jdk17` at `D:\develop_tools\JDK\jdk17`. javac is pinned via `fork` in `maven-compiler-plugin`.
- **Spring Controller Mapping** — controller annotations MUST NOT include `/api` (context-path handles it). See project memory `spring-controller-mapping.md`.
- **Forbidden = 403, Unauthorized = 401, RateLimited = 429** — `GlobalExceptionHandler` already maps these. New code uses the existing exception classes.
- **`SimpleRateLimiter` reuse** — the existing `inventorySyncLimiter` bean is reused (10 s min interval, 5 / 60 s window). New endpoint keys its `acquireOrThrow("skin-sync:" + userId)` against it. Do NOT add a fourth bean.
- **Constructor injection for `SimpleRateLimiter`** — manual constructor with `@Qualifier("inventorySyncLimiter")` on the parameter. Lombok `@RequiredArgsConstructor` does not propagate `@Qualifier`. See `LolInventoryController.java:33-44`.
- **Avoid `BaseMapper` on `UserAccount`** — entity lacks a `deleted` field today, but `application.yml:80` globally sets `logic-delete-field: deleted`. Use `@Select` / `@Update` annotated methods to bypass the inheritance (mirror `updatePasswordById` at `UserAccountMapper.java:39-40`).
- **PUID format** — Riot PUUID is 32-char lowercase hex. `@Size(min=32, max=64)` validates the wire format.
- **MySQL migration convention** — project uses `INFORMATION_SCHEMA` + prepared statement pattern (see `migration_mortgage_2026_06_add_principal_updated_at.sql`), NOT `IF NOT EXISTS`. The latter requires MySQL 8.0.29+. Dev MySQL version is unknown, so follow the project's portable idiom.
- **`SkinSyncService` is taken — use `PlayerSkinSyncService`** — an admin-side `SkinSyncService` (Tencent inventory sync, used by `SkinSyncTask`'s 4 AM cron + admin manual trigger, plus `HeroSyncServiceImpl`) already exists in `com.lolskin.service` and `com.lolskin.task`. The new Local Importer sync uses `PlayerSkinSyncService` / `PlayerSkinSyncServiceImpl` to avoid collision. The controller stays named `SkinSyncController` (no admin controller of that name exists, and `/skins/sync-user-skins` is a fresh URL).

---

## Task Index

**Backend (`D:\Front_Project\all\all_function_api`)**
1. Database migration: `t_user_skin` table + `t_user_account.puuid` column.
2. `UserAccountMapper` additions: `selectPuuidById`, `updatePuuid`.
3. `UserSkinMapper` + XML: `batchUpsert`, `listSkinIdsByUserId`.
4. `SyncUserSkinsDTO`, `SyncResultVO`.
5. `PlayerSkinSyncService` interface + `PlayerSkinSyncServiceImpl` (rate limit + Redis lock + PUID binding + UPSERT + Java Set diff).
6. `SkinSyncController` (manual constructor + `@Qualifier("inventorySyncLimiter")`, `extractUserId`, `@PostMapping("/sync-user-skins")`).
7. `SkinSyncControllerTest` (MockMvc standaloneSetup; cover 200, 401, 403, 429, validation 400).
8. `PlayerSkinSyncServiceImplTest` (Mockito unit; cover PUID bind/verify, Redis lock collision, Set diff arithmetic).
10. Manual backend smoke test against dev MySQL.

**Electron (`D:\Front_Project\all\local_skin_importer`)**
11. Scaffold electron-vite project + dependencies.
12. `lcu.ts` (lockfile reader, axios with rejectUnauthorized=false, getCurrentSummoner, getOwnedSkinIds) + unit tests.
13. `auth.ts` (login, saveToken, getStoredToken via safeStorage, clearStoredToken, getAuthStatus) + unit tests.
14. `backend.ts` (axios POST to `/api/skins/sync-user-skins`, retry/backoff) + unit tests.
15. `preload/index.ts` (contextBridge) + `main/ipc.ts` (handler registry).
16. `renderer/views/Login.vue` + `views/Sync.vue` + `components/StatusDot.vue` + `components/LogPanel.vue` + `composables/useLcuStatus.ts` + `styles/theme.css`.
17. E2E happy-path Playwright test.

**Note on commit policy:** Tasks 1–10 are in `all_function_api` (separate repo). The user handles those commits. Tasks 11–17 are in `local_skin_importer` (this repo). Subagents implement; user reviews/commits.

---

## Task 1: Database migration — `t_user_skin` + `t_user_account.puuid`

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\main\resources\db\migration_user_skin_2026_08.sql`

- [ ] **Step 1: Create the migration file**

Use the project's portable `INFORMATION_SCHEMA` + prepared-statement idiom (NOT `IF NOT EXISTS`, which requires MySQL 8.0.29+). See `migration_mortgage_2026_06_add_principal_updated_at.sql` for the canonical example.

```sql
-- migration_user_skin_2026_08.sql
-- Created 2026-08-11 for LOL Skin Local Importer.
--
-- Portable pattern: INFORMATION_SCHEMA + prepared statement. Project convention;
-- MySQL 8.0.29+ `IF NOT EXISTS` syntax is NOT used here because the target
-- deployment's MySQL version is unknown.

-- 1) Create t_user_skin if missing.
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='t_user_skin') = 0,
  'CREATE TABLE t_user_skin (
     id            BIGINT       NOT NULL AUTO_INCREMENT,
     user_id       BIGINT       NOT NULL,
     skin_id       INT          NOT NULL,
     first_seen_at DATETIME     NOT NULL,
     last_seen_at  DATETIME     NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_user_skin (user_id, skin_id)
   )',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Add t_user_account.puuid if missing.
-- One-way bind: first sync''s PUUID wins.
-- Do NOT add `deleted` to UserAccount; yml globally enables logic-delete-field,
-- and adding the column would silently inject WHERE deleted=0 into every
-- BaseMapper query on this entity.
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='t_user_account'
       AND COLUMN_NAME='puuid') = 0,
  'ALTER TABLE t_user_account ADD COLUMN puuid VARCHAR(64) NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

- [ ] **Step 2: Confirm the file lands in the right location**

Run: `ls "D:/Front_Project/all/all_function_api/src/main/resources/db/migration_user_skin_2026_08.sql"`
Expected: file exists, single file, no output beyond the path.

- [ ] **Step 3: Hand off to the user for commit and execution**

The user manually runs this SQL on the dev MySQL instance (`lolskin` database, host `101.34.210.254:3306`). Verify with:

```sql
SHOW TABLES LIKE 't_user_skin';
DESCRIBE t_user_account;
```

Both should show the new structure (the second should now have a `puuid VARCHAR(64) NULL` column).

> **STOP — do not commit on the user's behalf.** This file is in `all_function_api` (separate repo). Tell the user the file is ready; they will commit + apply.

---

## Task 2: `UserAccountMapper` — PUID queries

**Files:**
- Modify: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\mapper\UserAccountMapper.java`

- [ ] **Step 1: Open the file and read its current content**

Read: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\mapper\UserAccountMapper.java`

You should see: a `BaseMapper<UserAccount>` interface with existing methods `selectLevelByIdsRaw`, `updateLevelExpTitle`, `updatePasswordById`. The last uses `@Update("...")` as our reference style.

- [ ] **Step 2: Add the two PUID methods**

Insert before the closing `}` of the interface:

```java
    /**
     * Read only the puuid column. Bypasses BaseMapper to avoid any future
     * logic-delete-field surprise (UserAccount has no deleted column today,
     * but yml:80 globally enables it).
     */
    @Select("SELECT puuid FROM t_user_account WHERE id = #{userId}")
    String selectPuuidById(@Param("userId") Long userId);

    /**
     * First-time PUID bind. Idempotent: subsequent calls overwrite, but the
     * service layer guards against re-binding under the same user.
     */
    @Update("UPDATE t_user_account SET puuid = #{puuid}, updated_at = NOW() WHERE id = #{userId}")
    int updatePuuid(@Param("userId") Long userId, @Param("puuid") String puuid);
```

The imports `org.apache.ibatis.annotations.Select` and `org.apache.ibatis.annotations.Update` already exist at the top of the file.

- [ ] **Step 3: Compile to confirm**

Run (use the jdk17 path on Windows):
```bash
"D:\develop_tools\JDK\jdk17\bin\java.exe" -version
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=true compile
```

Expected: BUILD SUCCESS, no compile errors. If you see a "cannot find symbol Select/Update" — the import is missing; add `import org.apache.ibatis.annotations.Select;` at the top.

- [ ] **Step 4: Hand off**

Tell the user the file is ready. They will commit on `all_function_api`.

---

## Task 3: `UserSkinMapper` + XML

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\entity\UserSkin.java`
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\mapper\UserSkinMapper.java`
- Create: `D:\Front_Project\all\all_function_api\src\main\resources\mapper\UserSkinMapper.xml`

- [ ] **Step 1: Create the entity**

`D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\entity\UserSkin.java`:

```java
package com.lolskin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("t_user_skin")
public class UserSkin {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private Integer skinId;
    private LocalDateTime firstSeenAt;
    private LocalDateTime lastSeenAt;
}
```

- [ ] **Step 2: Create the XML mapper file**

`D:\Front_Project\all\all_function_api\src\main\resources\mapper\UserSkinMapper.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"? ?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.lolskin.mapper.UserSkinMapper">

    <insert id="batchUpsert" useGeneratedKeys="false">
        INSERT INTO t_user_skin (user_id, skin_id, first_seen_at, last_seen_at)
        VALUES
        <foreach collection="skinIds" item="skinId" separator=",">
            (#{userId}, #{skinId}, NOW(), NOW())
        </foreach>
        ON DUPLICATE KEY UPDATE last_seen_at = NOW()
    </insert>

    <select id="listSkinIdsByUserId" resultType="java.lang.Integer">
        SELECT skin_id FROM t_user_skin WHERE user_id = #{userId}
    </select>

</mapper>
```

- [ ] **Step 3: Create the mapper Java file**

`D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\mapper\UserSkinMapper.java`:

```java
package com.lolskin.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lolskin.entity.UserSkin;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface UserSkinMapper extends BaseMapper<UserSkin> {

    /**
     * Batch UPSERT via MySQL ON DUPLICATE KEY UPDATE.
     * Idempotent on (user_id, skin_id); the unique key in the migration
     * guarantees row-level dedup even if the Redis lock is bypassed.
     *
     * @return affected rows (1 per INSERT, 2 per UPDATE, 0 per no-op)
     */
    int batchUpsert(@Param("userId") Long userId, @Param("skinIds") List<Integer> skinIds);

    /**
     * Read the user's existing skin IDs as a flat list. The service layer
     * wraps as Set<Integer> for diff arithmetic.
     */
    List<Integer> listSkinIdsByUserId(@Param("userId") Long userId);
}
```

- [ ] **Step 4: Compile to confirm**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=true compile
```

Expected: BUILD SUCCESS.

> **STOP — do not commit on the user's behalf.**

---

## Task 4: DTOs and VO

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\dto\SyncUserSkinsDTO.java`
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\vo\SyncResultVO.java`

- [ ] **Step 1: Create the DTO**

```java
package com.lolskin.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

@Data
public class SyncUserSkinsDTO {

    /**
     * Riot PUUID. Canonical form is 32-char lowercase hex; we accept
     * 32..64 chars to be lenient about historical encodings.
     */
    @NotBlank
    @Size(min = 32, max = 64)
    private String puuid;

    /** Optional. Used for log correlation and the renderer's display name. */
    @Size(max = 64)
    private String summonerName;

    /** Cannot be empty; capped at 2000 to prevent abuse. */
    @NotEmpty
    @Size(max = 2000)
    private List<Integer> ownedSkinIds;
}
```

- [ ] **Step 2: Create the VO**

```java
package com.lolskin.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SyncResultVO {
    private int added;
    private int updated;
    private int totalOwned;
}
```

- [ ] **Step 3: Compile**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=true compile
```

Expected: BUILD SUCCESS.

> **STOP — do not commit on the user's behalf.**

---

## Task 5: `PlayerSkinSyncService` interface + impl

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\service\PlayerSkinSyncService.java`
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\service\impl\PlayerSkinSyncServiceImpl.java`

- [ ] **Step 1: Create the interface**

```java
package com.lolskin.service;

import com.lolskin.dto.SyncUserSkinsDTO;
import com.lolskin.vo.SyncResultVO;

public interface PlayerSkinSyncService {
    SyncResultVO sync(SyncUserSkinsDTO dto, Long userId);
}
```

- [ ] **Step 2: Create the implementation**

```java
package com.lolskin.service.impl;

import com.lolskin.dto.SyncUserSkinsDTO;
import com.lolskin.exception.ForbiddenException;
import com.lolskin.exception.RateLimitedException;
import com.lolskin.mapper.UserAccountMapper;
import com.lolskin.mapper.UserSkinMapper;
import com.lolskin.ratelimit.SimpleRateLimiter;
import com.lolskin.service.PlayerSkinSyncService;
import com.lolskin.vo.SyncResultVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Sync orchestration:
 *   1) per-user rate limit (reuses the existing inventorySyncLimiter bean)
 *   2) Redis SETNX lock keyed by userId, released in finally
 *   3) PUID binding (first sync binds; subsequent syncs must match)
 *   4) UPSERT via MySQL ON DUPLICATE KEY UPDATE
 *   5) Compute added/updated in Java via Set diff (single round-trip)
 */
@Slf4j
@Service
public class PlayerSkinSyncServiceImpl implements PlayerSkinSyncService {

    private static final Duration LOCK_TTL = Duration.ofSeconds(30);
    private static final String LOCK_KEY_PREFIX = "skin:sync:locked:";
    private static final String RATE_KEY_PREFIX = "skin-sync:";

    // @Qualifier on field + Lombok @RequiredArgsConstructor works here
    // because there are 3 SimpleRateLimiter beans and we want to pick one by name.
    // (Project memory: rate-limiter-must-be-per-key.md — keyed by userId.)
    @Qualifier("inventorySyncLimiter")
    private final SimpleRateLimiter rateLimiter;
    private final StringRedisTemplate redis;
    private final UserAccountMapper userAccountMapper;
    private final UserSkinMapper userSkinMapper;

    public PlayerSkinSyncServiceImpl(@Qualifier("inventorySyncLimiter") SimpleRateLimiter rateLimiter,
                                StringRedisTemplate redis,
                                UserAccountMapper userAccountMapper,
                                UserSkinMapper userSkinMapper) {
        this.rateLimiter = rateLimiter;
        this.redis = redis;
        this.userAccountMapper = userAccountMapper;
        this.userSkinMapper = userSkinMapper;
    }

    @Override
    public SyncResultVO sync(SyncUserSkinsDTO dto, Long userId) {
        rateLimiter.acquireOrThrow(RATE_KEY_PREFIX + userId);

        String lockKey = LOCK_KEY_PREFIX + userId;
        Boolean acquired = redis.opsForValue().setIfAbsent(lockKey, "1", LOCK_TTL);
        if (!Boolean.TRUE.equals(acquired)) {
            throw new RateLimitedException("已有同步在进行中,请稍后再试");
        }

        try {
            // 1) PUID binding
            String existing = userAccountMapper.selectPuuidById(userId);
            if (existing == null) {
                userAccountMapper.updatePuuid(userId, dto.getPuuid());
            } else if (!existing.equals(dto.getPuuid())) {
                throw new ForbiddenException(
                    "账号已绑定其他 LOL 账号,如需更换请联系管理员");
            }

            // 2) Read existing skin IDs as a Set for diff
            Set<Integer> dbSet = new HashSet<>(userSkinMapper.listSkinIdsByUserId(userId));

            // 3) UPSERT (idempotent on the unique key)
            userSkinMapper.batchUpsert(userId, dto.getOwnedSkinIds());

            // 4) Compute counts in Java via Set diff
            Set<Integer> incoming = new HashSet<>(dto.getOwnedSkinIds());
            int intersect = 0;
            for (Integer s : incoming) {
                if (dbSet.contains(s)) intersect++;
            }
            int added = incoming.size() - intersect;
            int updated = intersect;

            if (added + updated != dto.getOwnedSkinIds().size()) {
                log.warn("sync count mismatch userId={} dtoSize={} added={} updated={}",
                    userId, dto.getOwnedSkinIds().size(), added, updated);
            }

            return SyncResultVO.builder()
                .added(added)
                .updated(updated)
                .totalOwned(incoming.size())
                .build();
        } finally {
            redis.delete(lockKey);
        }
    }
}
```

- [ ] **Step 3: Compile**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=true compile
```

Expected: BUILD SUCCESS.

> **STOP — do not commit on the user's behalf.**

---

## Task 6: `SkinSyncController`

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\main\java\com\lolskin\controller\SkinSyncController.java`

- [ ] **Step 1: Create the controller**

```java
package com.lolskin.controller;

import com.lolskin.common.Result;
import com.lolskin.dto.SyncUserSkinsDTO;
import com.lolskin.exception.UnauthorizedException;
import com.lolskin.service.JwtService;
import com.lolskin.service.PlayerSkinSyncService;
import com.lolskin.vo.SyncResultVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Player skin sync — Electron importer uploads PUUID + skin IDs.
 * Real URL: context-path /api + /skins/sync-user-skins.
 * No @RequiresRole — RoleInterceptor passes through (interceptor only acts on annotated methods).
 */
@Slf4j
@Tag(name = "玩家皮肤同步", description = "Electron 桌面端上传本地已拥有皮肤")
@RestController
@RequestMapping("/skins")
@RequiredArgsConstructor
public class SkinSyncController {

    private final PlayerSkinSyncService skinSyncService;
    private final JwtService jwtService;

    @Operation(summary = "同步用户已拥有皮肤(PUID 一次性绑定)")
    @PostMapping("/sync-user-skins")
    public Result<SyncResultVO> sync(
            @Valid @RequestBody SyncUserSkinsDTO dto,
            HttpServletRequest request) {
        Long userId = extractUserId(request);
        return Result.success(skinSyncService.sync(dto, userId));
    }

    private Long extractUserId(HttpServletRequest request) {
        String auth = request.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) {
            throw new UnauthorizedException("未登录");
        }
        try {
            return jwtService.getUserId(auth.substring(7));
        } catch (Exception e) {
            throw new UnauthorizedException("token 无效");
        }
    }
}
```

> **Why `@RequiredArgsConstructor` is fine here** — no `@Qualifier` needed because the only `PlayerSkinSyncService` and `JwtService` beans are unambiguous. If the rate limiter were injected at the controller layer, you'd need the manual constructor pattern from `LolInventoryController.java:33-44` (Lombok's `@RequiredArgsConstructor` does not copy `@Qualifier`). The rate limiter is consumed inside `PlayerSkinSyncServiceImpl`, so this controller stays simple.

- [ ] **Step 2: Compile**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=true compile
```

Expected: BUILD SUCCESS.

- [ ] **Step 3: Verify the URL resolves correctly**

Run a quick `mvn spring-boot:run` smoke test (optional but valuable): start the app, hit `http://localhost:8080/api/skins/sync-user-skins` with a wrong method (e.g. GET). Should return 401/405, not 404. If you see 404, you accidentally included `/api` in `@RequestMapping`.

> **STOP — do not commit on the user's behalf.**

---

## Task 7: `SkinSyncControllerTest` (MockMvc standaloneSetup)

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\test\java\com\lolskin\controller\SkinSyncControllerTest.java`

- [ ] **Step 1: Create the test file**

```java
package com.lolskin.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.lolskin.dto.SyncUserSkinsDTO;
import com.lolskin.exception.ForbiddenException;
import com.lolskin.exception.GlobalExceptionHandler;
import com.lolskin.exception.RateLimitedException;
import com.lolskin.exception.UnauthorizedException;
import com.lolskin.service.JwtService;
import com.lolskin.service.PlayerSkinSyncService;
import com.lolskin.vo.SyncResultVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller unit test — MockMvcBuilders.standaloneSetup skips the full Spring context.
 * Mirror of LolInventoryControllerTest pattern (avoids @WebMvcTest which triggers
 * MapperFactoryBean registration failure on this project).
 */
class SkinSyncControllerTest {

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

    private SyncUserSkinsDTO validDto() {
        SyncUserSkinsDTO dto = new SyncUserSkinsDTO();
        dto.setPuuid("0123456789abcdef0123456789abcdef"); // 32-char hex
        dto.setSummonerName("TestSummoner");
        dto.setOwnedSkinIds(List.of(1001, 1002, 2005));
        return dto;
    }

    @Test
    void sync_happyPath_returns200WithCounts() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.sync(any(), anyLong()))
            .thenReturn(SyncResultVO.builder().added(2).updated(1).totalOwned(3).build());

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer valid.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(validDto())))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(200))
            .andExpect(jsonPath("$.data.added").value(2))
            .andExpect(jsonPath("$.data.updated").value(1))
            .andExpect(jsonPath("$.data.totalOwned").value(3));
    }

    @Test
    void sync_missingAuth_returns401() throws Exception {
        mvc.perform(post("/skins/sync-user-skins")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(validDto())))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    void sync_invalidToken_returns401() throws Exception {
        when(jwtService.getUserId("bad.token")).thenThrow(new RuntimeException("parse fail"));

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer bad.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(validDto())))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    void sync_emptyOwnedSkinIds_returns400() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);

        SyncUserSkinsDTO dto = validDto();
        dto.setOwnedSkinIds(List.of());

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer valid.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(dto)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void sync_puuidTooShort_returns400() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);

        SyncUserSkinsDTO dto = validDto();
        dto.setPuuid("tooshort"); // 8 chars, < 32 min

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer valid.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(dto)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void sync_puuidMismatch_returns403() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.sync(any(), anyLong()))
            .thenThrow(new ForbiddenException("PUID mismatch"));

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer valid.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(validDto())))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void sync_lockHeld_returns429() throws Exception {
        when(jwtService.getUserId("valid.token")).thenReturn(100L);
        when(skinSyncService.sync(any(), anyLong()))
            .thenThrow(new RateLimitedException("已有同步在进行中"));

        mvc.perform(post("/skins/sync-user-skins")
                .header("Authorization", "Bearer valid.token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(validDto())))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.code").value(429));
    }
}
```

- [ ] **Step 2: Run the tests**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=false -Dtest=SkinSyncControllerTest test
```

Expected: BUILD SUCCESS, 7 tests pass.

> **STOP — do not commit on the user's behalf.**

---

## Task 8: `PlayerSkinSyncServiceImplTest` (Mockito unit)

**Files:**
- Create: `D:\Front_Project\all\all_function_api\src\test\java\com\lolskin\service\impl\PlayerSkinSyncServiceImplTest.java`

- [ ] **Step 1: Create the test file**

```java
package com.lolskin.service.impl;

import com.lolskin.dto.SyncUserSkinsDTO;
import com.lolskin.exception.ForbiddenException;
import com.lolskin.exception.RateLimitedException;
import com.lolskin.mapper.UserAccountMapper;
import com.lolskin.mapper.UserSkinMapper;
import com.lolskin.ratelimit.SimpleRateLimiter;
import com.lolskin.vo.SyncResultVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class PlayerSkinSyncServiceImplTest {

    private SimpleRateLimiter rateLimiter;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private UserAccountMapper userAccountMapper;
    private UserSkinMapper userSkinMapper;
    private PlayerSkinSyncServiceImpl service;

    @BeforeEach
    void setUp() {
        rateLimiter = mock(SimpleRateLimiter.class);
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        userAccountMapper = mock(UserAccountMapper.class);
        userSkinMapper = mock(UserSkinMapper.class);

        service = new PlayerSkinSyncServiceImpl(rateLimiter, redis, userAccountMapper, userSkinMapper);
    }

    private SyncUserSkinsDTO dto(List<Integer> skins) {
        SyncUserSkinsDTO d = new SyncUserSkinsDTO();
        d.setPuuid("0123456789abcdef0123456789abcdef");
        d.setSummonerName("Test");
        d.setOwnedSkinIds(skins);
        return d;
    }

    @Test
    void sync_firstCall_bindsPuuidAndUpsertsAllAsAdded() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(true);
        when(userAccountMapper.selectPuuidById(1L)).thenReturn(null);
        when(userSkinMapper.listSkinIdsByUserId(1L)).thenReturn(List.of());

        SyncResultVO result = service.sync(dto(List.of(1001, 1002, 2005)), 1L);

        assertEquals(3, result.getAdded());
        assertEquals(0, result.getUpdated());
        assertEquals(3, result.getTotalOwned());
        verify(userAccountMapper).updatePuuid(1L, "0123456789abcdef0123456789abcdef");
        verify(userSkinMapper).batchUpsert(eq(1L), eq(List.of(1001, 1002, 2005)));
        verify(redis).delete("skin:sync:locked:1");
    }

    @Test
    void sync_subsequentMatchingPuid_computesAddedAndUpdated() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(true);
        when(userAccountMapper.selectPuuidById(1L))
            .thenReturn("0123456789abcdef0123456789abcdef");
        // DB already has 1001 and 2005; incoming adds 3000.
        when(userSkinMapper.listSkinIdsByUserId(1L)).thenReturn(List.of(1001, 2005));

        SyncResultVO result = service.sync(dto(List.of(1001, 2005, 3000)), 1L);

        assertEquals(1, result.getAdded());
        assertEquals(2, result.getUpdated());
        assertEquals(3, result.getTotalOwned());
        verify(userAccountMapper, never()).updatePuuid(anyLong(), anyString());
    }

    @Test
    void sync_puuidMismatch_throwsForbidden() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(true);
        when(userAccountMapper.selectPuuidById(1L))
            .thenReturn("different-puuid-here-32-chars-min");

        assertThrows(ForbiddenException.class,
            () -> service.sync(dto(List.of(1001)), 1L));

        verify(userSkinMapper, never()).batchUpsert(anyLong(), any());
        verify(redis).delete("skin:sync:locked:1");
    }

    @Test
    void sync_lockHeld_throwsRateLimited() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(false);

        assertThrows(RateLimitedException.class,
            () -> service.sync(dto(List.of(1001)), 1L));

        verify(userAccountMapper, never()).selectPuuidById(anyLong());
        verify(redis, never()).delete(anyString());
    }

    @Test
    void sync_alwaysCallsRateLimiter() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(true);
        when(userAccountMapper.selectPuuidById(1L)).thenReturn(null);

        service.sync(dto(List.of(1001)), 1L);

        verify(rateLimiter).acquireOrThrow("skin-sync:1");
    }

    @Test
    void sync_lockReleasedEvenOnException() {
        when(ops.setIfAbsent(anyString(), anyString(), any())).thenReturn(true);
        when(userAccountMapper.selectPuuidById(1L))
            .thenThrow(new RuntimeException("db down"));

        assertThrows(RuntimeException.class,
            () -> service.sync(dto(List.of(1001)), 1L));

        verify(redis).delete("skin:sync:locked:1");
    }
}
```

- [ ] **Step 2: Run the tests**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -q -Dmaven.test.skip=false -Dtest=PlayerSkinSyncServiceImplTest test
```

Expected: BUILD SUCCESS, 6 tests pass.

> **STOP — do not commit on the user's behalf.**

---

## Task 9: Run all backend tests as a sanity check

**Files:** none

- [ ] **Step 1: Run the full backend test suite**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -Dmaven.test.skip=false -Dtest='SkinSync*Test' test
```

Expected: 13 tests pass (7 controller + 6 service).

- [ ] **Step 2: Confirm no other tests broke**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn -Dmaven.test.skip=false test
```

If this fails on unrelated tests, that's a pre-existing issue (project memory: test suite has some disabled tests). Ignore failures in tests that already existed before this plan.

> **STOP — do not commit on the user's behalf.**

---

## Task 10: Backend manual smoke test against dev MySQL

**Files:** none

- [ ] **Step 1: Boot the backend**

```bash
cd "D:/Front_Project/all/all_function_api" && mvn spring-boot:run
```

Expected: app starts; logs show Tomcat on 8080.

- [ ] **Step 2: Login to get a JWT**

```bash
curl -X POST http://localhost:8080/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<your_test_user>","password":"<password>"}'
```

Expected: `{"code":200,"message":"登录成功","data":{"token":"<jwt>","userId":<id>,"registerOrder":<n>}}`

- [ ] **Step 3: First sync — expect PUID to bind**

```bash
curl -X POST http://localhost:8080/api/skins/sync-user-skins \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "puuid":"0123456789abcdef0123456789abcdef",
    "summonerName":"TestSummoner",
    "ownedSkinIds":[1001,1002,2005]
  }'
```

Expected: `{"code":200,"message":null,"data":{"added":3,"updated":0,"totalOwned":3}}`.

- [ ] **Step 4: Verify rows landed**

```bash
mysql -h 101.34.210.254 -u lolskin -p lolskin -e \
  "SELECT user_id, skin_id, first_seen_at, last_seen_at FROM t_user_skin WHERE user_id=<id>;"
```

Expected: 3 rows, one per skin_id.

- [ ] **Step 5: Second sync — expect overlap to count as updated**

Re-run the same curl. Expected: `{"code":200,"data":{"added":0,"updated":3,"totalOwned":3}}`. (No duplicate rows in MySQL — the unique key deduped them, and the Set diff sees all 3 as already in `dbSet`.)

- [ ] **Step 6: PUID mismatch — expect 403**

```bash
curl -X POST http://localhost:8080/api/skins/sync-user-skins \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"puuid":"different-puuid-also-32-chars-long","ownedSkinIds":[1001]}'
```

Expected: HTTP 403, `{"code":403,"message":"账号已绑定其他 LOL 账号..."}`.

- [ ] **Step 7: Stop the backend**

`Ctrl+C` in the terminal.

> **STOP — do not commit on the user's behalf.**

---

## Task 11: Scaffold the Electron project

**Files:**
- Create: many — see `package.json`, configs, and source files below.

- [ ] **Step 1: Initialize package.json**

`D:\Front_Project\all\local_skin_importer\package.json`:

```json
{
  "name": "lol-skin-local-importer",
  "version": "0.1.0",
  "description": "Electron desktop tool to sync owned LOL skins to lol-skin-api.",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder --win",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "element-plus": "^2.8.4",
    "vue": "^3.5.10"
  },
  "devDependencies": {
    "@types/node": "^22.7.5",
    "@vitejs/plugin-vue": "^5.1.4",
    "@vue/test-utils": "^2.4.6",
    "electron": "^32.1.2",
    "electron-builder": "^25.0.5",
    "electron-vite": "^2.3.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.2",
    "vue-tsc": "^2.1.6"
  },
  "build": {
    "appId": "com.lolskin.localimporter",
    "productName": "LOL Skin Importer",
    "files": ["out/**/*"],
    "win": { "target": "nsis" }
  }
}
```

- [ ] **Step 2: Add configs**

`electron.vite.config.ts` (project root):

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
```

`tsconfig.json` (project root — base for tsconfig.node.json + tsconfig.web.json):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "preserve",
    "types": ["vite/client"]
  },
  "include": ["src/renderer/**/*", "src/preload/index.ts"]
}
```

- [ ] **Step 3: Create the renderer entry**

`src/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>LOL Skin Importer</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Install dependencies**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npm install
```

Expected: `node_modules` populated; no fatal errors. If you see a peer-dep warning, ignore it.

- [ ] **Step 5: Sanity check the scaffold compiles**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
```

Expected: no errors (the renderer tsconfig will complain about missing files until later tasks — that's why we test the two configs separately and the renderer one will need at least an empty `src/renderer/src/main.ts`).

- [ ] **Step 6: Commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add package.json electron.vite.config.ts tsconfig*.json src/renderer/index.html
git commit -m "feat(electron): scaffold project with electron-vite + Vue 3 + Element Plus"
```

---

## Task 12: `lcu.ts` + tests

**Files:**
- Create: `D:\Front_Project\all\local_skin_importer\src\main\lcu.ts`
- Create: `D:\Front_Project\all\local_skin_importer\tests\main\lcu.test.ts`

- [ ] **Step 1: Write the failing test first**

`tests/main/lcu.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { readLockfile, createLcuClient, getCurrentSummoner, getOwnedSkinIds } from '../../src/main/lcu';

vi.mock('axios');

const mockClient = {
  get: vi.fn()
};

describe('lcu', () => {
  beforeEach(() => {
    vi.mocked(axios.create).mockReturnValue(mockClient as any);
    mockClient.get.mockReset();
  });

  describe('readLockfile', () => {
    it('parses the lockfile format pid:port:token:protocol', () => {
      // Test against a fixture file we control.
      // We exercise the parser via a mock fs.readFileSync.
      const fs = require('fs');
      const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue('12345:9999:secret-token-here:https');
      const result = readLockfile();
      expect(result).toEqual({ port: 9999, token: 'secret-token-here' });
      spy.mockRestore();
    });
  });

  describe('createLcuClient', () => {
    it('constructs an https.Agent that ignores self-signed certs', () => {
      const agent = createLcuClient(9999, 'tok');
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://127.0.0.1:9999',
          httpsAgent: expect.objectContaining({ options: expect.objectContaining({ rejectUnauthorized: false }) }),
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic riot:/)
          })
        })
      );
    });
  });

  describe('getCurrentSummoner', () => {
    it('returns displayName and puuid from /lol-summoner/v1/current-summoner', async () => {
      mockClient.get.mockResolvedValue({ data: { displayName: 'Foo', puuid: 'abc' } });
      const result = await getCurrentSummoner(mockClient as any);
      expect(result).toEqual({ displayName: 'Foo', puuid: 'abc' });
      expect(mockClient.get).toHaveBeenCalledWith('/lol-summoner/v1/current-summoner');
    });
  });

  describe('getOwnedSkinIds', () => {
    it('filters items where ownership.owned is true and returns numeric ids', async () => {
      mockClient.get.mockResolvedValue({
        data: [
          { id: '1001', ownership: { owned: true } },
          { id: '1002', ownership: { owned: false } },
          { id: '2005', ownership: { owned: true } }
        ]
      });
      const result = await getOwnedSkinIds(mockClient as any);
      expect(result).toEqual([1001, 2005]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run tests/main/lcu.test.ts
```

Expected: FAIL — `Cannot find module '../../src/main/lcu'`.

- [ ] **Step 3: Implement `lcu.ts`**

`src/main/lcu.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOCKFILE_PATH = path.join(
  os.homedir(),
  'AppData', 'Local', 'Riot Games', 'League of Legends', 'lockfile'
);

export interface LcuAuth {
  port: number;
  token: string;
}

export function readLockfile(): LcuAuth {
  const raw = fs.readFileSync(LOCKFILE_PATH, 'utf8');
  const [pidStr, portStr, token, protocol] = raw.trim().split(':');
  if (!portStr || !token) {
    throw new Error(`Malformed lockfile: ${raw}`);
  }
  return { port: Number(portStr), token };
}

export function createLcuClient(port: number, token: string): AxiosInstance {
  const auth = Buffer.from(`riot:${token}`).toString('base64');
  return axios.create({
    baseURL: `https://127.0.0.1:${port}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { Authorization: `Basic ${auth}` },
    timeout: 5000
  });
}

export async function getCurrentSummoner(client: AxiosInstance) {
  const { data } = await client.get('/lol-summoner/v1/current-summoner');
  return { displayName: data.displayName, puuid: data.puuid };
}

export async function getOwnedSkinIds(client: AxiosInstance): Promise<number[]> {
  const { data } = await client.get('/lol-champions/v1/inventories/local-player/skin-minimal');
  if (!Array.isArray(data)) return [];
  return data
    .filter((s: any) => s?.ownership?.owned === true)
    .map((s: any) => Number(s.id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run tests/main/lcu.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add src/main/lcu.ts tests/main/lcu.test.ts
git commit -m "feat(lcu): lockfile reader, Basic Auth client, summoner + owned skin APIs"
```

---

## Task 13: `auth.ts` (JWT + safeStorage) + tests

**Files:**
- Create: `D:\Front_Project\all\local_skin_importer\src\main\auth.ts`
- Create: `D:\Front_Project\all\local_skin_importer\tests\main\auth.test.ts`

- [ ] **Step 1: Write the failing test**

> **IMPORTANT — test mocking pattern override (added 2026-08-11).**
> The `vi.mock('fs', () => mockFs)` pattern below does NOT work under Vitest ESM: the factory must return a module namespace object with a `default` export key, otherwise interop breaks. Likewise `vi.spyOn(fs, 'readFileSync')` is unusable because Vitest ESM module namespaces are non-configurable. **Use real temp files** via `mkdtempSync` + `writeFileSync` in tests instead, with `app.getPath` mocked to point at the temp dir. This is higher fidelity and matches the approach proven by Task 12 (`lcu.test.ts`). Tests live in `src/main/__tests__/auth.test.ts` (next to source), NOT `tests/main/auth.test.ts`.

`src/main/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, saveToken, getStoredToken, clearStoredToken, getAuthStatus } from '../auth';

vi.mock('axios');

let tmpDir: string;
let tokenPath: string;

const mockSafeStorage = {
  encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
  decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
  isEncryptionAvailable: vi.fn(() => true)
};

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: mockSafeStorage
}));

// Get reference to the mocked getPath after the mock is in place
import { app } from 'electron';
const mockGetPath = vi.mocked(app.getPath);

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
  tokenPath = join(tmpDir, 'auth.bin');
  mockGetPath.mockReturnValue(tmpDir);
  vi.mocked(axios.post).mockReset();
  mockSafeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  mockSafeStorage.decryptString.mockImplementation((buf: Buffer) => buf.toString().replace(/^enc:/, ''));
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('login posts username/password and returns the JWT', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 200, data: { token: 'jwt-xyz' } } });
    const token = await login('alice', 'hunter2');
    expect(token).toBe('jwt-xyz');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/login'),
      { username: 'alice', password: 'hunter2' },
      expect.any(Object)
    );
  });

  it('saveToken encrypts and writes to userData/auth.bin', () => {
    saveToken('jwt-abc');
    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('jwt-abc');
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath).toString()).toBe('enc:jwt-abc');
  });

  it('getStoredToken returns null when file does not exist', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('getStoredToken decrypts and returns the JWT', () => {
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abc'));
    expect(getStoredToken()).toBe('jwt-abc');
  });

  it('clearStoredToken removes the file', () => {
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abc'));
    clearStoredToken();
    expect(existsSync(tokenPath)).toBe(false);
  });

  it('getAuthStatus returns truncated preview when logged in', () => {
    writeFileSync(tokenPath, Buffer.from('enc:jwt-abcdefghij1234567'));
    expect(getAuthStatus()).toEqual({
      loggedIn: true,
      tokenPreview: 'jwt-abcdefghi...'
    });
  });

  it('getAuthStatus returns loggedIn=false when no token', () => {
    expect(getAuthStatus()).toEqual({ loggedIn: false, tokenPreview: null });
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run src/main/__tests__/auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auth.ts`**

`src/main/auth.ts`:

```typescript
import axios from 'axios';
import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_BASE_URL = 'http://124.223.102.20:8080';
const TOKEN_FILENAME = 'auth.bin';

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILENAME);
}

export async function login(username: string, password: string): Promise<string> {
  const { data } = await axios.post(
    `${BACKEND_BASE_URL}/api/user/login`,
    { username, password },
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (data?.code !== 200 || !data?.data?.token) {
    throw new Error(data?.message ?? '登录失败');
  }
  return data.data.token;
}

export function saveToken(jwt: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable; refusing to persist token in plaintext');
  }
  const enc = safeStorage.encryptString(jwt);
  fs.writeFileSync(tokenFilePath(), enc);
}

export function getStoredToken(): string | null {
  const p = tokenFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function clearStoredToken(): void {
  const p = tokenFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function getAuthStatus(): { loggedIn: boolean; tokenPreview: string | null } {
  const t = getStoredToken();
  if (!t) return { loggedIn: false, tokenPreview: null };
  return {
    loggedIn: true,
    tokenPreview: `${t.substring(0, 12)}...`
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run src/main/__tests__/auth.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add src/main/auth.ts src/main/__tests__/auth.test.ts
git commit -m "feat(auth): login, safeStorage-backed token persistence, auth status"
```

---

## Task 14: `backend.ts` (sync HTTP client) + tests

**Files:**
- Create: `D:\Front_Project\all\local_skin_importer\src\main\backend.ts`
- Create: `D:\Front_Project\all\local_skin_importer\tests\main\backend.test.ts`

- [ ] **Step 1: Write the failing test**

> **IMPORTANT — test mocking pattern override (added 2026-08-11).**
> The `vi.mock('../../src/main/auth', () => ({ getStoredToken: vi.fn() }))` pattern below can fail under Vitest ESM with "Cannot find module" or factory-not-called errors because the factory lacks the proper ESM interop wrapper. **Instead, place the test in `src/main/__tests__/backend.test.ts`** and use **`vi.mock('../auth')`** — Vitest's auto-mock for relative paths works reliably with ESM. The `vi.mock('axios')` pattern is fine. Below is the corrected version; same test scenarios, same expectations.

`src/main/__tests__/backend.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { syncOwnedSkins } from '../backend';
import { getStoredToken } from '../auth';

vi.mock('axios');
vi.mock('../auth');

describe('backend.syncOwnedSkins', () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(getStoredToken).mockReset();
  });

  it('sends a POST with Bearer JWT and returns the counts', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt-abc');
    vi.mocked(axios.post).mockResolvedValue({
      data: { code: 200, data: { added: 3, updated: 0, totalOwned: 3 } }
    });

    const result = await syncOwnedSkins('0123456789abcdef0123456789abcdef', 'Foo', [1001, 1002, 2005]);

    expect(result).toEqual({ added: 3, updated: 0, totalOwned: 3 });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/skins/sync-user-skins'),
      expect.objectContaining({
        puuid: '0123456789abcdef0123456789abcdef',
        summonerName: 'Foo',
        ownedSkinIds: [1001, 1002, 2005]
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc' })
      })
    );
  });

  it('throws when no token is stored', async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    await expect(syncOwnedSkins('p', 's', [1])).rejects.toThrow(/未登录/);
  });

  it('retries 3x on ECONNRESET then succeeds', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post)
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValueOnce({ data: { code: 200, data: { added: 1, updated: 0, totalOwned: 1 } } });

    const result = await syncOwnedSkins('p', 's', [1]);
    expect(result.added).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx — passes through the error', async () => {
    vi.mocked(getStoredToken).mockReturnValue('jwt');
    vi.mocked(axios.post).mockRejectedValue({ response: { status: 403, data: { message: 'PUID mismatch' } } });

    await expect(syncOwnedSkins('p', 's', [1])).rejects.toMatchObject({ response: { status: 403 } });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run src/main/__tests__/backend.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `backend.ts`**

`src/main/backend.ts`:

```typescript
import axios, { AxiosError } from 'axios';
import { getStoredToken } from './auth';

const BACKEND_BASE_URL = 'http://124.223.102.20:8080';

export interface SyncResult {
  added: number;
  updated: number;
  totalOwned: number;
}

interface BackendEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function syncOwnedSkins(
  puuid: string,
  summonerName: string,
  ownedSkinIds: number[]
): Promise<SyncResult> {
  const token = getStoredToken();
  if (!token) throw new Error('未登录:请先登录后再同步');

  const url = `${BACKEND_BASE_URL}/api/skins/sync-user-skins`;
  const body = { puuid, summonerName, ownedSkinIds };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await axios.post<BackendEnvelope<SyncResult>>(url, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      if (data.code !== 200 || !data.data) {
        throw new Error(data.message ?? '同步失败');
      }
      return data.data;
    } catch (e) {
      lastErr = e;
      const err = e as AxiosError;
      if (err.response) {
        // 4xx/5xx — pass through, do not retry.
        throw e;
      }
      const code = (e as any).code;
      if (!RETRYABLE_NETWORK_CODES.has(code)) throw e;
      if (attempt < 2) {
        await sleep([200, 800, 3200][attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vitest run src/main/__tests__/backend.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add src/main/backend.ts src/main/__tests__/backend.test.ts
git commit -m "feat(backend): sync POST with Bearer JWT, exponential-backoff retry on network errors"
```

---

## Task 15: `preload/index.ts` + `main/ipc.ts`

**Files:**
- Create: `D:\Front_Project\all\local_skin_importer\src\preload\index.ts`
- Create: `D:\Front_Project\all\local_skin_importer\src\main\ipc.ts`

- [ ] **Step 1: Implement preload**

`src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  checkLcu: () => ipcRenderer.invoke('lcu:check-status'),
  fetchSkins: () => ipcRenderer.invoke('lcu:fetch-skins'),
  login: (username: string, password: string) =>
    ipcRenderer.invoke('auth:login', { username, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  sync: (payload: { puuid: string; summonerName: string; ownedSkinIds: number[] }) =>
    ipcRenderer.invoke('backend:sync', payload)
};

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
```

- [ ] **Step 2: Implement `ipc.ts`**

`src/main/ipc.ts`:

```typescript
import { ipcMain } from 'electron';
import * as lcu from './lcu';
import * as auth from './auth';
import { syncOwnedSkins } from './backend';

export function registerIpcHandlers() {
  ipcMain.handle('lcu:check-status', async () => {
    try {
      const auth = lcu.readLockfile();
      const client = lcu.createLcuClient(auth.port, auth.token);
      const summoner = await lcu.getCurrentSummoner(client);
      return {
        connected: true,
        summonerName: summoner.displayName,
        puuid: summoner.puuid,
        port: auth.port
      };
    } catch {
      return { connected: false };
    }
  });

  ipcMain.handle('lcu:fetch-skins', async () => {
    const a = lcu.readLockfile();
    const client = lcu.createLcuClient(a.port, a.token);
    return await lcu.getOwnedSkinIds(client);
  });

  ipcMain.handle('auth:login', async (_evt, args: { username: string; password: string }) => {
    try {
      const jwt = await auth.login(args.username, args.password);
      auth.saveToken(jwt);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? '登录失败' };
    }
  });

  ipcMain.handle('auth:get-status', async () => auth.getAuthStatus());

  ipcMain.handle('auth:logout', async () => {
    auth.clearStoredToken();
  });

  ipcMain.handle('backend:sync', async (_evt, payload: {
    puuid: string;
    summonerName: string;
    ownedSkinIds: number[];
  }) => {
    return await syncOwnedSkins(payload.puuid, payload.summonerName, payload.ownedSkinIds);
  });
}
```

- [ ] **Step 3: Wire it up in `main/index.ts`**

`src/main/index.ts`:

```typescript
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc';

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 640,
    title: 'LOL Skin Importer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: Compile**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx tsc --noEmit -p tsconfig.node.json
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add src/preload/index.ts src/main/ipc.ts src/main/index.ts
git commit -m "feat(ipc): wire preload contextBridge and main-process handlers"
```

---

## Task 16: Renderer UI — Login, Sync, StatusDot, LogPanel, useLcuStatus

**Files:**
- Create: `src/renderer/src/main.ts`
- Create: `src/renderer/src/App.vue`
- Create: `src/renderer/src/styles/theme.css`
- Create: `src/renderer/src/views/Login.vue`
- Create: `src/renderer/src/views/Sync.vue`
- Create: `src/renderer/src/components/StatusDot.vue`
- Create: `src/renderer/src/components/LogPanel.vue`
- Create: `src/renderer/src/composables/useLcuStatus.ts`
- Create: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Theme styles**

`src/renderer/src/styles/theme.css`:

```css
:root {
  --color-bg: #0d1424;
  --color-card: #1a2942;
  --color-border: #28456b;
  --color-primary: #7ab8ff;
  --color-success: #4ade80;
  --color-warn: #facc15;
  --color-error: #f87171;
  --color-text: #e2e8f0;
  --color-text-muted: #94a3b8;
}

html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

button { cursor: pointer; }
```

- [ ] **Step 2: Main entry**

`src/renderer/src/main.ts`:

```typescript
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import './styles/theme.css';

createApp(App).use(ElementPlus).mount('#app');
```

- [ ] **Step 3: StatusDot component**

`src/renderer/src/components/StatusDot.vue`:

```vue
<template>
  <span class="dot" :class="`dot--${state}`" :title="label" />
</template>

<script setup lang="ts">
defineProps<{ state: 'ok' | 'warn' | 'err'; label: string }>();
</script>

<style scoped>
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 6px;
}
.dot--ok   { background: var(--color-success); box-shadow: 0 0 6px var(--color-success); }
.dot--warn { background: var(--color-warn);    box-shadow: 0 0 6px var(--color-warn); }
.dot--err  { background: var(--color-error);   box-shadow: 0 0 6px var(--color-error); }
</style>
```

- [ ] **Step 4: LogPanel component**

`src/renderer/src/components/LogPanel.vue`:

```vue
<template>
  <div class="log-panel">
    <div v-for="(line, i) in lines" :key="i" :class="`log-log-${line.level}`">
      <span class="ts">{{ line.ts }}</span>
      <span class="level">{{ line.level }}</span>
      <span class="msg">{{ line.msg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  lines: Array<{ ts: string; level: 'INFO' | 'WARN' | 'ERROR'; msg: string }>;
}>();
</script>

<style scoped>
.log-panel {
  background: #000;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
  height: 220px;
  overflow-y: auto;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
.log-log-INFO  { color: #94a3b8; }
.log-log-WARN  { color: var(--color-warn); }
.log-log-ERROR { color: var(--color-error); }
.ts   { color: #64748b; margin-right: 8px; }
.level { display: inline-block; width: 50px; margin-right: 8px; }
</style>
```

- [ ] **Step 5: useLcuStatus composable**

`src/renderer/src/composables/useLcuStatus.ts`:

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

interface LcuStatus {
  connected: boolean;
  summonerName?: string;
  puuid?: string;
  port?: number;
}

export function useLcuStatus() {
  const status = ref<LcuStatus>({ connected: false });
  const ownedSkinIds = ref<number[]>([]);
  const isLoading = ref(false);

  let timer: number | null = null;

  async function refresh() {
    isLoading.value = true;
    try {
      const s = await window.api.checkLcu();
      status.value = s;
      if (s.connected) {
        ownedSkinIds.value = await window.api.fetchSkins();
      }
    } catch (e: any) {
      ElMessage.error(e?.message ?? 'LCU 状态查询失败');
    } finally {
      isLoading.value = false;
    }
  }

  function startPolling() {
    refresh();
    timer = window.setInterval(async () => {
      if (status.value.connected) return; // stop polling once connected
      await refresh();
    }, 5000);
  }

  function stopPolling() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  onMounted(startPolling);
  onUnmounted(stopPolling);

  return { status, ownedSkinIds, isLoading, refresh };
}
```

- [ ] **Step 6: Login view**

`src/renderer/src/views/Login.vue`:

```vue
<template>
  <el-card class="login-card">
    <h2>登录</h2>
    <p class="hint">使用你的 LOL 鉴赏账号登录</p>
    <el-form @submit.prevent="onSubmit">
      <el-form-item>
        <el-input v-model="username" placeholder="账号" autocomplete="username" />
      </el-form-item>
      <el-form-item>
        <el-input
          v-model="password"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          show-password
        />
      </el-form-item>
      <el-button type="primary" :loading="loading" @click="onSubmit" native-type="submit">
        登录
      </el-button>
      <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

const emit = defineEmits<{ (e: 'logged-in'): void }>();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
  error.value = null;
  if (!username.value.trim() || !password.value.trim()) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  try {
    const result = await window.api.login(username.value.trim(), password.value);
    if (result.ok) {
      ElMessage.success('登录成功');
      emit('logged-in');
    } else {
      error.value = result.message ?? '登录失败';
    }
  } catch (e: any) {
    error.value = e?.message ?? '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-card {
  max-width: 380px;
  margin: 80px auto;
  background: var(--color-card);
  border-color: var(--color-border);
}
h2 { margin-top: 0; }
.hint { color: var(--color-text-muted); margin-bottom: 16px; }
</style>
```

- [ ] **Step 7: Sync view**

`src/renderer/src/views/Sync.vue`:

```vue
<template>
  <div class="sync">
    <!-- Summoner card -->
    <el-card class="card">
      <div class="row">
        <div>
          <div class="big">{{ status.summonerName ?? '—' }}</div>
          <div class="muted">PUID: {{ truncate(status.puuid) }}</div>
        </div>
        <el-button @click="refresh" :loading="isLoading">重新检测</el-button>
      </div>
    </el-card>

    <!-- Stats card -->
    <el-card class="card">
      <div class="row">
        <div>
          <div class="big-num">{{ ownedSkinIds.length }}</div>
          <div class="muted">已拥有皮肤(来自本地 LCU)</div>
        </div>
      </div>
    </el-card>

    <!-- Action bar -->
    <el-card class="card">
      <div class="row">
        <el-button type="primary" :loading="syncing" :disabled="!canSync" @click="onSync">
          同步到云端
        </el-button>
        <el-button @click="onLogout">登出</el-button>
      </div>
    </el-card>

    <!-- Log panel -->
    <el-card class="card">
      <LogPanel :lines="logs" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LogPanel from '../components/LogPanel.vue';
import { useLcuStatus } from '../composables/useLcuStatus';

const { status, ownedSkinIds, isLoading, refresh } = useLcuStatus();
const syncing = ref(false);
const logs = ref<Array<{ ts: string; level: 'INFO' | 'WARN' | 'ERROR'; msg: string }>>([]);

const canSync = computed(
  () => status.value.connected && ownedSkinIds.value.length > 0 && !syncing.value
);

function truncate(s?: string) {
  if (!s) return '—';
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string) {
  const ts = new Date().toLocaleTimeString();
  logs.value.push({ ts, level, msg });
  if (logs.value.length > 200) logs.value.shift();
}

async function onSync() {
  if (!status.value.puuid) {
    ElMessage.error('未检测到召唤师');
    return;
  }
  syncing.value = true;
  log('INFO', `开始同步 ${ownedSkinIds.value.length} 个皮肤…`);
  try {
    const result = await window.api.sync({
      puuid: status.value.puuid,
      summonerName: status.value.summonerName ?? '',
      ownedSkinIds: ownedSkinIds.value
    });
    log('INFO', `成功: 新增 ${result.added}, 更新 ${result.updated}, 总计 ${result.totalOwned}`);
    ElMessage.success('同步成功');
  } catch (e: any) {
    const msg = e?.response?.data?.message ?? e?.message ?? '同步失败';
    log('ERROR', msg);
    ElMessage.error(msg);
  } finally {
    syncing.value = false;
  }
}

async function onLogout() {
  await ElMessageBox.confirm('确认登出?', '提示', { type: 'warning' });
  await window.api.logout();
  ElMessage.info('已登出');
  // The parent App.vue watches getAuthStatus and switches view.
}
</script>

<style scoped>
.sync { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.card { background: var(--color-card); border-color: var(--color-border); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.big { font-size: 20px; font-weight: 600; }
.big-num { font-size: 36px; font-weight: 700; color: var(--color-primary); }
.muted { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
</style>
```

- [ ] **Step 8: App shell**

`src/renderer/src/App.vue`:

```vue
<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">LOL Skin Importer</span>
      <span class="spacer" />
      <StatusDot
        :state="lcuState"
        :label="lcuLabel"
      />
      <span class="auth-info" v-if="authStatus.loggedIn">
        {{ authStatus.tokenPreview }}
      </span>
    </header>

    <main>
      <LoginView v-if="!authStatus.loggedIn" @logged-in="refreshAuth" />
      <SyncView v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import StatusDot from './components/StatusDot.vue';
import LoginView from './views/Login.vue';
import SyncView from './views/Sync.vue';

const authStatus = ref<{ loggedIn: boolean; tokenPreview: string | null }>({
  loggedIn: false,
  tokenPreview: null
});

const lcuConnected = ref(false);
async function refreshLcu() {
  try {
    const s = await window.api.checkLcu();
    lcuConnected.value = s.connected;
  } catch {
    lcuConnected.value = false;
  }
}

async function refreshAuth() {
  authStatus.value = await window.api.getAuthStatus();
}

const lcuState = computed<'ok' | 'warn' | 'err'>(() =>
  lcuConnected.value ? 'ok' : 'err'
);
const lcuLabel = computed(() =>
  lcuConnected.value ? 'LOL 客户端已连接' : 'LOL 客户端未启动'
);

onMounted(() => {
  refreshAuth();
  refreshLcu();
  setInterval(refreshLcu, 5000);
});
</script>

<style scoped>
.app { height: 100%; display: flex; flex-direction: column; }
.topbar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}
.brand { font-weight: 600; color: var(--color-primary); }
.spacer { flex: 1; }
.auth-info { color: var(--color-text-muted); font-size: 12px; font-family: monospace; }
main { flex: 1; overflow-y: auto; }
</style>
```

- [ ] **Step 8: Declare `window.api` for TS**

`src/renderer/src/global.d.ts`:

```typescript
import type { ExposedApi } from '../preload/index';
declare global {
  interface Window { api: ExposedApi }
}
export {};
```

Without this, `vue-tsc` errors with "cannot find name 'window'" in any `.vue` file that uses `window.api`.

- [ ] **Step 9: Compile and commit**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npx vue-tsc --noEmit -p tsconfig.web.json
```

Expected: no errors.

```bash
cd "D:/Front_Project/all/local_skin_importer" && git add src/renderer/
git commit -m "feat(ui): dark theme, login + sync views, status dot, log panel"
```

---

## Task 17: E2E happy-path (manual smoke test)

**Files:** none (manual)

> **Why not Playwright:** the electron-builder release path is heavy and the project is Windows-only. The user manually verifies the e2e flow in `npm run dev`. Skip Playwright for v1.

- [ ] **Step 1: Boot the app**

```bash
cd "D:/Front_Project/all/local_skin_importer" && npm run dev
```

Expected: Electron window opens with the dark UI.

- [ ] **Step 2: Verify Login view**

Click into username + password, click 登录. Expected: status dot flips green for auth status, view switches to Sync view.

- [ ] **Step 3: Verify LCU detection**

If LOL is running locally, status dot turns green and skin count appears within 5 s. If not, status dot is red and shows "LOL 客户端未启动".

- [ ] **Step 4: Verify sync**

Click "同步到云端". Expected:
- If first sync: log shows `成功: 新增 N, 更新 0, 总计 N`. Backend DB now has N rows in `t_user_skin` for this user, and `t_user_account.puuid` is set.
- If re-sync: log shows `成功: 新增 0, 更新 N, 总计 N`. No new DB rows.

- [ ] **Step 5: Verify 403 on PUID mismatch**

Log out, manually edit the JWT or use a different LOL account, click sync. Expected: log shows `账号已绑定其他 LOL 账号…` and ElMessage error.

- [ ] **Step 6: Verify logout**

Click 登出, confirm. Expected: view reverts to Login view.

- [ ] **Step 7: Restart the app and verify token persistence**

`Ctrl+C` to stop dev, run `npm run dev` again. Expected: view opens directly on Sync view (token was decrypted from safeStorage).

- [ ] **Step 8: Commit any tweaks**

```bash
cd "D:/Front_Project/all/local_skin_importer" && git status
```

If anything needs committing (typo fixes, etc.), commit them now.

---

## Final handoff checklist

When all 17 tasks are done:

- [ ] Backend repo `all_function_api` has 8 new files + 1 modified mapper. The user must commit those on their own.
- [ ] Electron repo `local_skin_importer` has ~15 new files, 17 commits.
- [ ] Manual e2e verified (Task 17).
- [ ] No remaining tasks in this plan.

Tell the user the implementation is complete and summarize what landed where.