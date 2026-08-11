# LOL Skin Local Importer — Design Spec

**Date:** 2026-08-11
**Project:** `D:\Front_Project\all\local_skin_importer`
**Backend (modified):** `D:\Front_Project\all\all_function_api`
**Stack:** Electron + Vite + Vue 3 + TypeScript (renderer) / Spring Boot 3 + MyBatis-Plus (backend)

---

## 1. Goal & Success Criteria

Build a lightweight Electron desktop helper that:

1. **Detects** the running League of Legends client on the user's machine via the `lockfile` written to `%LocalAppData%\Riot Games\League of Legends\`.
2. **Reads** the current summoner's owned skin IDs from the LCU REST API.
3. **Syncs** the list to the existing Spring Boot backend (which powers the WeChat Mini-Program skin rating community) under the logged-in user's account.

**Success criteria:**

- User logs in with their existing Mini-Program **account/password** (the same `t_user_account` users as the H5), JWT is encrypted with Electron `safeStorage` and persisted across restarts.
- LOL client running → status indicator turns green within 5 s, owned-skin count appears automatically.
- One click uploads the list to the backend; backend verifies the PUUID against the user's **first-time bound PUUID** — wrong PUUID under the same JWT is rejected with HTTP 403.
- Re-sync after restart does not duplicate rows (idempotent `INSERT ... ON DUPLICATE KEY UPDATE` by `(user_id, skin_id)`).

---

## 2. Out of Scope

- macOS / Linux support (Windows-first; lockfile path is Windows-specific).
- Auto-launch with Windows boot.
- Skin-by-skin rating UI (handled by the existing Mini-Program).
- Multi-account switching inside the Electron app (one JWT at a time; logout to switch).
- PUID rebinding flow (a user wishing to switch to a different LOL account must be done out-of-band for v1; the bound PUID is treated as immutable).
- Internationalization beyond zh-CN.
- The backend does NOT need access to the user's LCU client — the PUID-binding approach does not depend on it.

---

## 3. Architecture

```
┌─────────────────┐    HTTPS 127.0.0.1:<port>    ┌─────────────────────────┐
│  LOL Client     │◀──────────────────────────▶│  Electron Main Process  │
│  LeagueClientUx │   Basic Auth riot:<token>   │  src/main/              │
│  + lockfile     │                              │   ├─ lcu.ts (LCU)       │
└─────────────────┘                              │   ├─ auth.ts (JWT)     │
                                                │   ├─ backend.ts (HTTP) │
                                                │   └─ ipc.ts            │
                                                └────────────┬────────────┘
                                                             │ ipc.invoke
                                                             ▼
                                                ┌─────────────────────────┐
                                                │  Electron Renderer      │
                                                │  src/renderer/          │
                                                │   Vue 3 + Element Plus  │
                                                │   Login / Sync views    │
                                                └────────────┬────────────┘
                                                             │ axios
                                                             ▼  Bearer JWT
                                                ┌─────────────────────────┐
                                                │  Spring Boot backend    │
                                                │  POST /user/login       │  (existing)
                                                │  POST /skins/sync-      │
                                                │    user-skins           │  (new)
                                                │   ├─ JWT auth           │
                                                │   ├─ PUID binding check │
                                                │   ├─ Redis SETNX 锁     │
                                                │   └─ t_user_skin UPSERT │
                                                └─────────────────────────┘
```

Three execution contexts with strict boundaries: **LCU credentials** are confined to the Electron main process; **JWT** stays inside the main process via `safeStorage` (the renderer only ever sees a truncated token prefix); **the backend has no LCU integration at all** — it trusts JWT for user identity and the first-seen PUID for that user as a one-time binding.

---

## 4. Data Flow

1. App starts → main process reads `lockfile` → constructs LCU axios instance (self-signed cert, Basic Auth).
2. Renderer calls `window.api.checkLcu()` → IPC → returns `{connected, summonerName, puuid, port}`.
3. While `!connected`, renderer polls every 5 s. On connect, automatically calls `fetchSkins()`.
4. User logs in: renderer calls `window.api.login(username, password)` → IPC → main process POSTs `/api/user/login` (existing `EarnedSalaryController.login`) → stores JWT via `safeStorage`.
5. User clicks "同步到云端" → renderer calls `window.api.sync(ownedSkinIds)` with the freshly-fetched PUID and skin IDs.
6. Backend (`SkinSyncController.sync`):
   1. Parses JWT → `userId`.
   2. Acquires `skin:sync:locked:<userId>` Redis SETNX lock (TTL 30 s); rejects 429 on collision.
   3. **PUID binding check** — reads `t_user_account.puuid` (a new column) for this `userId`. If null → bind the incoming PUID (first sync). If non-null → assert `existing === dto.puuid`; mismatch → release lock, throw 403.
   4. UPSERT `t_user_skin (user_id, skin_id, first_seen_at, last_seen_at)` using `INSERT ... ON DUPLICATE KEY UPDATE last_seen_at = NOW()`. The unique key `(user_id, skin_id)` guarantees idempotency even if the lock is bypassed.
   5. Release the Redis lock (try/finally).
   6. Return `{added, updated, totalOwned}`.

---

## 5. Components & Modules

### 5.1 Electron — `src/main/`

**`lcu.ts`** — sole module that talks to the LOL client.

- `readLockfile()` — reads `%LocalAppData%\Riot Games\League of Legends\lockfile`, parses `pid:port:token:protocol`, returns `{port, token}`.
- `createLcuClient(port, token)` — axios instance with `https.Agent({rejectUnauthorized: false})`, Basic Auth header `riot:<token>`.
- `getCurrentSummoner()` — `GET /lol-summoner/v1/current-summoner` → `{displayName, puuid}`.
- `getOwnedSkinIds()` — `GET /lol-champions/v1/inventories/local-player/skin-minimal`, filters items where `ownership?.owned === true`, maps to `number[]`.
- All functions throw typed errors (`LcuNotRunningError`, `LcuAuthError`) so the renderer can show meaningful messages.

**`auth.ts`** — JWT lifecycle.

- `login(username, password)` — POST `/api/user/login` (existing `EarnedSalaryController.login` accepts `UserLoginDTO {username, password}`), returns JWT.
- `saveToken(jwt)` — `safeStorage.encryptString(jwt)` → write to `app.getPath('userData')/auth.bin`.
- `getStoredToken()` — read + decrypt; returns `null` if not available.
- `clearStoredToken()` — delete the file.
- `getAuthStatus()` — returns `{loggedIn: boolean, tokenPreview: string | null}` (truncated to first 12 chars + `...`).
- JWT is always persisted; there is no "remember-me" toggle.

**`backend.ts`** — Spring Boot client.

- `syncOwnedSkins(puuid, summonerName, ownedSkinIds: number[])` — axios POST with `Bearer <token>` from `auth.ts`, returns `Result<SyncResultVO>`.
- 3x exponential-backoff retry on network errors (5xx, ECONNRESET). 4xx passes through immediately.

**`ipc.ts`** — IPC handlers.

| Channel | Args | Returns |
| --- | --- | --- |
| `lcu:check-status` | — | `{connected, summonerName?, puuid?, port?}` |
| `lcu:fetch-skins` | — | `number[]` |
| `auth:login` | `{username, password}` | `{ok: boolean, message?: string}` |
| `auth:get-status` | — | `{loggedIn, tokenPreview}` |
| `auth:logout` | — | `void` |
| `backend:sync` | `{puuid, summonerName, ownedSkinIds: number[]}` | `{added, updated, totalOwned}` |

**`index.ts`** — `app.whenReady()`, creates `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, `preload: <path>`, registers IPC handlers from `ipc.ts`. Preload acts as a thin `contextBridge` wrapper; the main process validates all incoming IPC arguments before they touch anything.

### 5.2 Electron — `src/preload/`

**`index.ts`** — `contextBridge.exposeInMainWorld('api', { checkLcu, fetchSkins, login, logout, getAuthStatus, sync })`. Each is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.

### 5.3 Electron — `src/renderer/`

- **`App.vue`** — top bar with logo + status dot + user avatar; switches between `<LoginView />` and `<SyncView />` based on `getAuthStatus()`.
- **`views/Login.vue`** — Element Plus `el-form` with username/password; calls `window.api.login`. No "remember-me" checkbox (token is always persisted).
- **`views/Sync.vue`** — three sections:
  - Summoner card (avatar placeholder, displayName, truncated PUUID, "重新检测" button)
  - Stats card (large number "245 个已拥有皮肤", last-sync timestamp)
  - Action bar ("同步到云端" primary button + "登出" secondary)
  - Log panel (black-bg scrollable area, INFO/WARN/ERROR levels)
- **`composables/useLcuStatus.ts`** — owns the polling loop (5 s while `!connected`), exposes `{status, ownedSkinIds, refresh, isLoading}`. All IPC calls wrapped in `try/catch` → `ElMessage.error`.
- **Theme:** dark, primary `#7ab8ff`, bg `#0d1424`, card `#1a2942`. Matches the LOL client aesthetic.

### 5.4 Backend — new code in `all_function_api`

**`controller/SkinSyncController.java`** — placed at `/skins/sync-user-skins`. URL resolves to `/api/skins/sync-user-skins` via the existing `server.servlet.context-path: /api`.

- `@RestController @RequestMapping("/skins")`
- `@PostMapping("/sync-user-skins") public Result<SyncResultVO> sync(@Valid @RequestBody SyncUserSkinsDTO dto, HttpServletRequest request)`
- Extracts `userId` from `Authorization: Bearer <jwt>` via the same pattern as `LolInventoryController.extractUserId` (no new `@AuthUser` annotation).
- Injects `SimpleRateLimiter` named `skinSyncLimiter` (per-key `"skin-sync:" + userId`).
- **No `@RequiresRole` annotation** — `RoleInterceptor` only enforces roles on annotated methods, so the new endpoint is authenticated via JWT but not role-gated.

**`dto/SyncUserSkinsDTO.java`**

```java
@NotBlank private String puuid;
@Size(max = 64) private String summonerName; // optional, for display + logs
@NotEmpty @Size(max = 2000) private List<Integer> ownedSkinIds;
```

**`vo/SyncResultVO.java`** — `{added: int, updated: int, totalOwned: int}`.

**`service/SkinSyncService.java` + `impl/SkinSyncServiceImpl.java`** — orchestration:

1. `skinSyncLimiter.acquireOrThrow("skin-sync:" + userId)`.
2. **Acquire Redis lock** via `StringRedisTemplate.opsForValue().setIfAbsent("skin:sync:locked:" + userId, "1", Duration.ofSeconds(30))`; reject 429 on collision. Wrap the entire body in `try { ... } finally { redis.delete(lockKey) }` so the lock is always released.
3. **PUID binding** — `userAccountMapper.selectById(userId)`, then `puuid` field. If null → set `userAccountMapper.updatePuuid(userId, dto.puuid)` (first-time bind). If non-null and `!existing.equals(dto.puuid)` → throw `ForbiddenException("PUUID mismatch — this account is bound to a different LOL account")`.
4. **UPSERT** — single statement, MySQL native:

   ```sql
   INSERT INTO t_user_skin (user_id, skin_id, first_seen_at, last_seen_at)
   VALUES (?, ?, NOW(), NOW())
   ON DUPLICATE KEY UPDATE last_seen_at = NOW();
   ```

   Executed in a batch via `userSkinMapper.batchUpsert(userId, ownedSkinIds)`. The unique key `(user_id, skin_id)` makes this idempotent even if the Redis lock has somehow expired.

5. `result.added` = rows where `first_seen_at == last_seen_at` (heuristic — return both counts from the SQL via `ROW_COUNT()` semantics; details in plan).
6. `result.totalOwned = userSkinMapper.countByUserId(userId)`.
7. Return `Result.success(result)`.

**`mapper/UserAccountMapper.java`** (in `com.lolskin.mapper`) — adds `updatePuuid(userId, puuid)` method.

**`config/RateLimiterConfig.java`** — add new bean:

```java
@Bean("skinSyncLimiter")
public SimpleRateLimiter skinSyncLimiter() {
    return new SimpleRateLimiter(Duration.ofSeconds(10), Duration.ofSeconds(60), 5);
}
```

(Mirrors `inventorySyncLimiter` — 10 s min interval, 5 per 60 s window. Per-key via `acquireOrThrow("skin-sync:" + userId)`.)

**No new LCU client bean is created in the backend.** The backend does not need to talk to LCU.

### 5.5 Database — migrations

**`migration_user_skin_2026_08.sql`** (placed alongside existing migration files, following the project's flat-name convention):

```sql
-- t_user_skin: per-user owned-skin set populated by the Electron importer.
CREATE TABLE IF NOT EXISTS t_user_skin (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL,
  skin_id       INT          NOT NULL,
  first_seen_at DATETIME     NOT NULL,
  last_seen_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_skin (user_id, skin_id),
  KEY idx_puuid (skin_id)
);

-- t_user_account.puuid: one-way bind to the first LOL PUID this account reports.
-- Existing column added via ALTER TABLE; backfill existing rows with NULL.
ALTER TABLE t_user_account
  ADD COLUMN IF NOT EXISTS puuid VARCHAR(64) NULL AFTER id;
```

**Notes on schema choices:**

- `idx_puuid (skin_id)` supports "how many users own skin X" queries; drop it if no such query exists in v1.
- No `idx_user (user_id)` — `uk_user_skin (user_id, skin_id)` already serves `WHERE user_id = ?` via leftmost-prefix rule.
- `t_user_account.puuid` is single-valued per user. A user wishing to rebind must be done out-of-band for v1 (out of scope).

---

## 6. Security

- **LCU credentials never leave the main process.** Renderer accesses LOL data only through IPC handlers; the underlying `port` and `token` are never serialized to the renderer.
- **JWT encrypted at rest** via Electron `safeStorage` (DPAPI on Windows). Plain-text file is never written.
- **Backend does not see any LCU credential.** The Electron app is the sole LCU client.
- **PUID ownership check via JWT binding** — backend trusts JWT for `userId`, and binds the first-ever reported PUID to that user account. A stolen JWT can upload skins only for the user's bound LOL account; a different LOL account under the same JWT is rejected with 403. The binding is one-way in v1.
- **Rate limit** — `skinSyncLimiter` per-user limit (10 s min interval, 5 / 60 s) prevents enumeration.
- **Redis lock + DB unique key** — defense-in-depth: the Redis SETNX lock prevents two concurrent syncs from racing, and `uk_user_skin (user_id, skin_id)` guarantees the UPSERT is idempotent even if the lock somehow expires mid-write.
- **LCU cert verification disabled only inside the Electron LCU axios instance** — all backend external calls (to `lol-skin-api`, Mini-Program, etc.) remain fully TLS-verified.
- **No logging of LCU token or JWT** in production logs.
- **`RoleInterceptor` is irrelevant here** — the new controller method carries no `@RequiresRole` annotation, so the interceptor passes through after JWT validation inside the method.

---

## 7. Error Handling

| Scenario | Behavior |
| --- | --- |
| LOL not running | `checkLcu` → `{connected: false}`; renderer polls every 5 s; UI shows red dot + "请打开 LOL 客户端". |
| LOL running but `getCurrentSummoner` 401 | UI shows yellow dot + "LCU 鉴权失败,请重启 LOL". |
| Backend not logged in | Sync button disabled with tooltip "请先登录". |
| `/api/user/login` returns 401 | `ElMessage.error('账号或密码错误')`; token store untouched. |
| Network jitter | `backend.ts` retries 3x with exponential backoff (200 ms, 800 ms, 3.2 s); on final failure → `ElMessage.error('同步失败,请检查网络')`. |
| Backend returns 429 | `ElMessage.warning('已有同步在进行中')`; renderer disables button for 30 s. |
| Backend returns 403 (PUID mismatch) | `ElMessage.error('账号已绑定其他 LOL 账号,如需更换请联系管理员')` — clearly surfaced so the user understands. |
| Backend returns 5xx | Same as network jitter. |
| User clicks Sync twice quickly | Button `loading` state disables during request; backend Redis lock + DB unique key prevent duplication regardless. |

---

## 8. Testing Strategy

- **Electron `lcu.ts`** — `vitest` unit tests with mocked `axios` and a fixture lockfile.
- **Electron `auth.ts`** — `vitest` with mocked `safeStorage` (electron exposes a test helper).
- **Electron `backend.ts`** — `vitest` with `nock` for HTTP mocks.
- **Electron `ipc.ts`** — covered transitively via Playwright e2e (one happy-path test: login → fake LCU responses → sync → expect UI shows 245).
- **Backend `SkinSyncService`** — `@MybatisTest` with H2/in-memory schema (note: H2 has limited MySQL `INSERT ... ON DUPLICATE KEY UPDATE` support; either use MySQL testcontainers, or split into `INSERT IGNORE` + `UPDATE` two-statement approach for tests, with the real `ON DUPLICATE KEY UPDATE` in production MySQL mapper XML). Cover: happy path, PUID mismatch (403), Redis lock collision (429), empty list (rejected by `@NotEmpty`), and idempotent re-sync (no duplicate rows).
- **Avoid full `@SpringBootTest`** — the project memory note flags redis stub as painful; follow the same pattern as existing tests.

---

## 9. Project Structure

```
D:\Front_Project\all\local_skin_importer\
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml          # NSIS Windows installer config
├── tsconfig.json                 # base
├── tsconfig.node.json            # main + preload
├── tsconfig.web.json             # renderer
├── index.html                    # renderer entry (electron-vite scaffold)
├── src/
│   ├── main/
│   │   ├── index.ts              # app lifecycle + window
│   │   ├── lcu.ts                # lockfile + axios
│   │   ├── auth.ts               # JWT + safeStorage
│   │   ├── backend.ts            # Spring Boot HTTP client
│   │   └── ipc.ts                # ipcMain.handle registry
│   ├── preload/
│   │   └── index.ts              # contextBridge
│   └── renderer/
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           ├── views/
│           │   ├── Login.vue
│           │   └── Sync.vue
│           ├── components/
│           │   ├── StatusDot.vue
│           │   └── LogPanel.vue
│           ├── composables/
│           │   └── useLcuStatus.ts
│           └── styles/theme.css  # dark theme tokens
└── docs/
    └── superpowers/
        ├── specs/                # this file
        └── plans/                # generated by writing-plans
```

Backend changes (separate repo `all_function_api`):

```
src/main/java/com/lolskin/
├── controller/SkinSyncController.java          # new
├── dto/SyncUserSkinsDTO.java                   # new
├── vo/SyncResultVO.java                        # new
├── service/SkinSyncService.java                # new (interface)
├── service/impl/SkinSyncServiceImpl.java       # new
├── mapper/UserSkinMapper.java                  # new
├── mapper/UserAccountMapper.java               # add updatePuuid(...)
├── entity/UserSkin.java                        # new
└── entity/UserAccount.java                     # add puuid field
src/main/resources/
├── mapper/UserSkinMapper.xml                   # new (ON DUPLICATE KEY UPDATE)
├── mapper/UserAccountMapper.xml                # add updatePuuid
└── db/
    └── migration_user_skin_2026_08.sql         # new (flat name, project convention)
src/test/java/com/lolskin/service/impl/
└── SkinSyncServiceImplTest.java                # new (@MybatisTest)
src/main/java/com/lolskin/config/
└── RateLimiterConfig.java                      # add @Bean("skinSyncLimiter")
```

---

## 10. Open Questions (to resolve in plan phase)

1. Existing migration tool used by `all_function_api` (verify whether files in `src/main/resources/db/` are auto-loaded or require manual execution).
2. Confirm `t_user_account` currently has no `puuid` column (the spec assumes the migration is needed; verify by reading the entity).
3. H2 vs MySQL testcontainers for the `ON DUPLICATE KEY UPDATE` mapper test.
4. Final list of rate-limit thresholds — currently mirroring `inventorySyncLimiter`; confirm acceptable.
6. Whether to ship a code-signing certificate for the Windows installer (out of scope for v1, but flagged for release).

---

## 11. Decisions Log

| Decision | Choice | Why |
| --- | --- | --- |
| Backend sync architecture | New `/api/skins/sync-user-skins` (vs. extending `/api/user/skins/sync`) | Two trust boundaries: Tencent cookie vs. Electron LCU + JWT. Merging them would couple unrelated auth flows. |
| Backend does NOT call LCU | PUID is bound on first sync; subsequent syncs must match | The backend runs at `101.34.210.254` and has no access to the user's local LOL client. JWT-binding is the practical alternative. |
| Auth | Reuse `/api/user/login` (existing `EarnedSalaryController.login`) | Same `t_user_account` users as H5/Mini-Program; no parallel auth system. |
| LCU detection | lockfile file | No `wmic` (deprecated), no command invocation. |
| UI lib | Element Plus | Mature Vue 3 ecosystem, dark theme out of the box. |
| Token storage | `safeStorage` (always persisted) | OS-encrypted; no plaintext on disk. No remember-me toggle. |
| Bundler | `electron-vite` | Official scaffold; HMR + electron-builder zero-config. |
| PUID binding one-way | First-seen wins; rebinding out of scope for v1 | Simpler implementation; full rebind flow can be added later without breaking existing users. |
| No Redis cache for `skin:owned:<userId>` | MySQL `t_user_skin` is the authoritative store | Avoids divergence with existing `lol:inv:owned:<cookieHash>` cache and the Jackson-roundtrip pitfalls noted in project memory. |
| Redis lock TTL = 30 s | TTL is generous; UPSERT idempotency makes lock expiry non-fatal | DB unique key guarantees no duplicates even if the lock is bypassed. |