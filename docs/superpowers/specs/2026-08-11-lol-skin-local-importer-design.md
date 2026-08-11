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

- User logs in with their existing Mini-Program account (account/password), JWT is encrypted with Electron `safeStorage` and persisted across restarts.
- LOL client running → status indicator turns green within 5 s, owned-skin count appears automatically.
- One click uploads the list to the backend; backend verifies the PUUID against the LCU before persisting — spoofed PUUID is rejected with HTTP 403.
- Re-sync after restart does not duplicate rows (idempotent upsert by `(user_id, skin_id)`).

---

## 2. Out of Scope

- macOS / Linux support (Windows-first; lockfile path is Windows-specific).
- Auto-launch with Windows boot.
- Skin-by-skin rating UI (handled by the existing Mini-Program).
- Multi-account switching inside the Electron app (one JWT at a time; logout to switch).
- Internationalization beyond zh-CN (matches existing backend copy).

---

## 3. Architecture

```
┌─────────────────┐    HTTPS 127.0.0.1:<port>    ┌─────────────────────────┐
│  LOL Client     │◀───────────────────────────▶│  Electron Main Process  │
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
                                                │  POST /api/skins/       │
                                                │    sync-user-skins      │
                                                │  (new)                  │
                                                │   ├─ JWT auth           │
                                                │   ├─ LCU 反查 PUUID     │
                                                │   ├─ Redis SETNX 锁     │
                                                │   └─ t_user_skin UPSERT │
                                                └─────────────────────────┘
```

Three execution contexts with strict boundaries: **LCU credentials** are confined to the main process; **JWT** stays inside the main process via `safeStorage` (the renderer only ever sees a truncated token prefix); **the Spring Boot backend never accepts LCU credentials from clients** — it reads them itself from its own lockfile / env so it can independently verify PUUID ownership.

---

## 4. Data Flow

1. App starts → main process reads `lockfile` → constructs LCU axios instance (self-signed cert, Basic Auth).
2. Renderer calls `window.api.checkLcu()` → IPC → returns `{connected, summonerName, puuid, port}`.
3. While `!connected`, renderer polls every 5 s. On connect, automatically calls `fetchSkins()`.
4. User clicks "同步到云端" → renderer calls `window.api.sync(ownedSkinIds)`.
5. Main process reads JWT from `safeStorage`, POSTs to `http://124.223.102.20:8080/api/skins/sync-user-skins` with `Authorization: Bearer <jwt>`.
6. Backend:
   1. Parses JWT → `userId`.
   2. Acquires `skin:sync:locked:<userId>` Redis SETNX lock (TTL 30 s); rejects 429 on collision.
   3. Reads its own LCU lockfile (or env `LCU_PORT`/`LCU_TOKEN`), calls `/lol-summoner/v1/current-summoner`, verifies returned `puuid === dto.puuid`. If mismatch → release lock, return 403.
   4. UPSERT `t_user_skin (user_id, puuid, skin_id, first_seen_at, last_seen_at)`.
   5. Caches `SET skin:owned:<userId>` → JSON list, TTL 30 min.
   6. Returns `{added, updated, totalOwned}`.

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

- `login(account, password)` — POST `/api/auth/login` (existing endpoint, path to be verified during plan), returns JWT.
- `saveToken(jwt)` — `safeStorage.encryptString(jwt)` → write to `app.getPath('userData')/auth.bin`.
- `getStoredToken()` — read + decrypt; returns `null` if not available.
- `clearStoredToken()` — delete the file.
- `getAuthStatus()` — returns `{loggedIn: boolean, tokenPreview: string | null}` (truncated to first 12 chars + `...`).

**`backend.ts`** — Spring Boot client.

- `syncOwnedSkins(ownedSkinIds: number[])` — axios POST with `Bearer <token>` from `auth.ts`, returns `Result<SyncResultVO>`.
- 3x exponential-backoff retry on network errors (5xx, ECONNRESET). 4xx passes through immediately.

**`ipc.ts`** — IPC handlers.

| Channel | Args | Returns |
| --- | --- | --- |
| `lcu:check-status` | — | `{connected, summonerName?, puuid?, port?}` |
| `lcu:fetch-skins` | — | `number[]` |
| `auth:login` | `{account, password}` | `{ok: boolean, message?: string}` |
| `auth:get-status` | — | `{loggedIn, tokenPreview}` |
| `auth:logout` | — | `void` |
| `backend:sync` | `number[]` | `{added, updated, totalOwned}` |

**`index.ts`** — `app.whenReady()`, creates `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, `preload: <path>`, registers IPC handlers from `ipc.ts`.

### 5.2 Electron — `src/preload/`

**`index.ts`** — `contextBridge.exposeInMainWorld('api', { checkLcu, fetchSkins, login, logout, getAuthStatus, sync })`. Each is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.

### 5.3 Electron — `src/renderer/`

- **`App.vue`** — top bar with logo + status dot + user avatar; switches between `<LoginView />` and `<SyncView />` based on `getAuthStatus()`.
- **`views/Login.vue`** — Element Plus `el-form` with account/password/remember-me; calls `window.api.login`.
- **`views/Sync.vue`** — three sections:
  - Summoner card (avatar placeholder, displayName, truncated PUUID, "重新检测" button)
  - Stats card (large number "245 个已拥有皮肤", last-sync timestamp)
  - Action bar ("同步到云端" primary button + "登出" secondary)
  - Log panel (black-bg scrollable area, INFO/WARN/ERROR levels)
- **`composables/useLcuStatus.ts`** — owns the polling loop (5 s while `!connected`), exposes `{status, ownedSkinIds, refresh, isLoading}`. All IPC calls wrapped in `try/catch` → `ElMessage.error`.
- **Theme:** dark, primary `#7ab8ff`, bg `#0d1424`, card `#1a2942`. Matches the LOL client aesthetic.

### 5.4 Backend — new code in `all_function_api`

**`controller/SkinSyncController.java`**

- `@RestController @RequestMapping("/skins")`
- `@PostMapping("/sync-user-skins") public Result<SyncResultVO> sync(@Valid @RequestBody SyncUserSkinsDTO dto, HttpServletRequest request)`
- Extracts `userId` from `Authorization: Bearer <jwt>` via the same pattern as `LolInventoryController.extractUserId` (no new `@AuthUser` annotation).
- Injects `inventorySyncLimiter`-style `SimpleRateLimiter` named `skinSyncLimiter` (per-key `"skin-sync:" + userId`).

**`dto/SyncUserSkinsDTO.java`**

```java
@NotBlank private String puuid;
@NotBlank private String summonerName;
@NotEmpty @Size(max = 2000) private List<Integer> ownedSkinIds;
```

**`vo/SyncResultVO.java`** — `{added: int, updated: int, totalOwned: int}`.

**`service/SkinSyncService.java` + `impl/SkinSyncServiceImpl.java`**

1. `syncRateLimiter.acquireOrThrow("skin-sync:" + userId)`.
2. `Redis SETNX skin:sync:locked:<userId> 1 EX 30`; reject 429 on collision.
3. Backend-side LCU reverse-check: read its own lockfile (or env `LCU_PORT`/`LCU_TOKEN`), call `GET /lol-summoner/v1/current-summoner`, assert returned `puuid === dto.puuid`; on mismatch → release lock, throw `ForbiddenException("PUUID mismatch")`.
4. UPSERT `t_user_skin` (see §5.5).
5. `SET skin:owned:<userId>` → JSON list, TTL 30 min.
6. Return `{added, updated, totalOwned}`.

**`config/LcuBackendConfig.java`** — reads `LCU_PORT` / `LCU_TOKEN` env or falls back to the standard Windows lockfile path. Builds a single shared LCU client bean (so we don't re-read lockfile on every request).

### 5.5 Database — `t_user_skin` migration

```sql
CREATE TABLE IF NOT EXISTS t_user_skin (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL,
  puuid         VARCHAR(64)  NOT NULL,
  skin_id       INT          NOT NULL,
  first_seen_at DATETIME     NOT NULL,
  last_seen_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_skin (user_id, skin_id),
  KEY idx_user (user_id),
  KEY idx_puuid (puuid)
);
```

Place the DDL in `all_function_api/src/main/resources/db/migration/V<next>__create_t_user_skin.sql` (or follow the existing project's migration convention — to be verified during the plan).

---

## 6. Security

- **LCU credentials never leave the main process.** Renderer accesses LOL data only through IPC handlers; the underlying `port` and `token` are never serialized to the renderer.
- **JWT encrypted at rest** via Electron `safeStorage` (OS keychain on macOS, DPAPI on Windows). Plain-text file is never written.
- **Backend never trusts client-claimed PUUID.** It performs its own LCU reverse-check; a mismatched PUUID returns 403 and writes nothing. A client that tries to claim a victim's owned-skin list cannot succeed because they don't have the victim's LCU token.
- **Rate limit** — `inventorySyncLimiter`-style per-user limit (e.g. 5 / hour) prevents enumeration.
- **Redis lock** prevents concurrent syncs from racing.
- **LCU cert verification disabled only inside the Electron and backend LCU axios instances** — backend external calls (to `lol-skin-api`) remain fully TLS-verified.
- **No logging of LCU token or JWT** in production logs.

---

## 7. Error Handling

| Scenario | Behavior |
| --- | --- |
| LOL not running | `checkLcu` → `{connected: false}`; renderer polls every 5 s; UI shows red dot + "请打开 LOL 客户端". |
| LOL running but `getCurrentSummoner` 401 | UI shows yellow dot + "LCU 鉴权失败,请重启 LOL". |
| Backend not logged in | Sync button disabled with tooltip "请先登录". |
| `auth/login` returns 401 | `ElMessage.error('账号或密码错误')`; token store untouched. |
| Network jitter | `backend.ts` retries 3x with exponential backoff (200 ms, 800 ms, 3.2 s); on final failure → `ElMessage.error('同步失败,请检查网络')`. |
| Backend returns 429 | `ElMessage.warning('已有同步在进行中')`; renderer disables button for 30 s. |
| Backend returns 403 (PUUID mismatch) | `ElMessage.error('账号归属校验失败')` — clearly surfaced so they realize LCU is on the wrong user. |
| Backend returns 5xx | Same as network jitter. |
| User clicks Sync twice quickly | Button `loading` state disables during request; backend Redis lock prevents DB-side duplication regardless. |

---

## 8. Testing Strategy

- **Electron `lcu.ts`** — `vitest` unit tests with mocked `axios` and a fixture lockfile.
- **Electron `auth.ts`** — `vitest` with mocked `safeStorage` (electron exposes a test helper).
- **Electron `backend.ts`** — `vitest` with `nock` for HTTP mocks.
- **Electron `ipc.ts`** — covered transitively via Playwright e2e (one happy-path test: login → fake LCU responses → sync → expect UI shows 245).
- **Backend `SkinSyncService`** — `@MybatisTest` with H2/in-memory schema; mock the backend-LCU client; cover: happy path, PUUID mismatch (403), Redis lock collision (429), empty list (rejected by @NotEmpty).
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
├── entity/UserSkin.java                       # new
└── config/LcuBackendConfig.java               # new (LCU client bean)
src/main/resources/
├── mapper/UserSkinMapper.xml                  # new
└── db/migration/V<next>__create_t_user_skin.sql # new (or existing migration dir)
```

---

## 10. Open Questions (to resolve in plan phase)

1. Exact path for `/api/auth/login` on the existing backend (need to read `AuthController.java`).
2. Existing migration tool used by `all_function_api` (Flyway? Liquibase? raw `schema.sql`?).
3. Confirm `inventorySyncLimiter` bean name and config location so the new `skinSyncLimiter` follows the same convention.
4. Final list of rate-limit thresholds — to mirror the inventory limiter to keep ops consistent.
5. Whether to ship a code-signing certificate for the Windows installer (out of scope for v1, but flagged for release).

---

## 11. Decisions Log

| Decision | Choice | Why |
| --- | --- | --- |
| Backend sync architecture | New `/api/skins/sync-user-skins` (B) | Electron can preview owned-skin count locally; backend independently verifies PUUID. |
| Auth | Reuse WeChat Mini-Program JWT | One user identity across Electron + MP; no parallel auth system. |
| LCU detection | lockfile file | No `wmic` (deprecated), no command invocation. |
| UI lib | Element Plus | Mature Vue 3 ecosystem, dark theme out of the box. |
| Token storage | `safeStorage` | OS-encrypted; no plaintext on disk. |
| Bundler | `electron-vite` | Official scaffold; HMR + electron-builder zero-config. |
| Backend LCU client location | New `LcuBackendConfig` bean | Centralized; one lockfile read per startup, not per request. |