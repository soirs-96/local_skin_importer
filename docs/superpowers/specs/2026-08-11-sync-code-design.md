# Sync Code — 6-Digit Cross-Device Login

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a WeChat mini-program user generate a short-lived 6-digit code on their phone, type it into the LOL Skin Importer Electron desktop client, and receive a JWT bound to their `t_user.id` — without storing any secret in the desktop client.

**Architecture:** New backend module `sync-code` exposes two endpoints (`POST /api/sync-code/generate` requires JWT-from-mini-program, `POST /api/sync-code/redeem` is public-and-rate-limited). Codes live in Redis with a 5-minute TTL and are deleted on successful redemption. The mini-program gains a "获取桌面同步码" button on the profile page. The Electron desktop client replaces its broken `/api/user/login` flow with a single 6-digit code input that calls `/api/sync-code/redeem`.

**Tech Stack:** Spring Boot (backend, MyBatis-Plus, RedisTemplate), uni-app-free native WeChat mini-program (wx.* APIs), Electron + Vue 3 + axios + safeStorage (desktop).

---

## Background and Motivation

The current desktop client (`local_skin_importer`) wires `auth.login(username, password)` to `/api/user/login` (Electron `auth.ts:19`). That endpoint does not exist — the only login endpoint is `/api/auth/login` which requires a WeChat `code` field, not username/password. The desktop client has no way to obtain a WeChat `code`, so login is non-functional.

Three properties the design must satisfy:

1. **No secrets on the desktop client.** The Electron app must not hold an `AppSecret`, long-lived API key, or admin token. It must also not speak the WeChat OAuth dance.
2. **Bound to the correct `t_user.id`.** The JWT the desktop receives must be signed for the same `t_user.id` that owns the WeChat account — not for an admin account from a different table.
3. **Self-service, not admin-mediated.** The mini-program user themselves triggers the flow, with no admin in the loop.

The chosen mechanism — a 6-digit numeric code generated on the phone and typed into the desktop — satisfies all three: no secret material crosses the air-gap, the code resolves to the phone's own `t_user.id` via the mini-program's existing JWT, and the player drives both sides.

## Scope

### In scope (v1)

- Backend: two endpoints + Redis-backed code store + rate limits + lockout.
- Mini-program: profile-page entry "获取桌面同步码" with modal, copy button, 5-minute countdown, 30-second generation cooldown surfacing in UI.
- Desktop: single input field "6 位同步码" replacing username/password; calls `/api/sync-code/redeem`; stores JWT via existing `safeStorage` path.

### Out of scope (v1)

- Replacing the existing `/api/desktop/token` X-Admin-Token endpoint. That endpoint stays — it is the dev/admin path used by curl-level smoke tests. Production player flow does NOT use it.
- QR-code variants, push notifications, or any non-manual handoff.
- A logout-everywhere / revoke-issued-JWT mechanism. JWTs remain valid until their natural expiry (per existing `JwtService` config).
- Multi-language strings for the new mini-program UI; copy is Chinese only.

## Design

### Data flow

```
  Mini-program user                       Electron desktop client
  ┌──────────────────┐                    ┌──────────────────────────┐
  │ 1. Tap "获取同步码"│                    │                          │
  │ 2. POST /api/sync-code/generate        │                          │
  │    (Authorization: Bearer <mp-JWT>)    │                          │
  │   ────────────────────────────► Backend                          │
  │                                       │                          │
  │ 3. {code: "482931", expiresInSec: 300}│                          │
  │   ◄────────────────────────────────    │                          │
  │                                       │                          │
  │ 4. Display "482931" + copy + countdown │                          │
  │                                       │ 5. User types "482931"   │
  │                                       │ 6. POST /api/sync-code/  │
  │                                       │      redeem {code}       │
  │                                       │   ─────────────────────► │
  │                                       │                          │
  │                                       │ 7. {token: <JWT>,        │
  │                                       │     userId, nickname}    │
  │                                       │   ◄───────────────────── │
  │                                       │ 8. safeStorage.encrypt   │
  │                                       │    + writeFileSync       │
  └──────────────────┘                    └──────────────────────────┘
```

### Backend endpoints

Both endpoints are annotated `@RequestMapping("/sync-code")` (no `/api` prefix — Spring Boot's `server.servlet.context-path=/api` is appended automatically, matching the existing `DesktopTokenController.java:23` pattern and project memory `spring-controller-mapping`).

#### `POST /api/sync-code/generate`

- Auth: requires the mini-program JWT (`Authorization: Bearer <mp-jwt>`). Reuses existing `JwtService.getUserId` pattern from `AuthController.java:46-66`.
- Body: none. `userId` comes from the JWT.
- Effect: deletes any existing code for this user, generates a fresh 6-digit zero-padded numeric (`000000`–`999999`), stores it in Redis under `sync_code:user:{userId}` → `{code, expiresAt}`, with TTL = 300 seconds.
- Rate limit: 30 seconds between consecutive generations per userId. Returns HTTP 429 with `Result.error(429, "请稍后再试")` if violated.
- Response:
  ```json
  {
    "code": 200,
    "data": { "code": "482931", "expiresInSec": 300 },
    "message": "操作成功"
  }
  ```
- Implementation notes:
  - Use the existing `StringRedisTemplate` bean (`RedisConfig.java:61`). All four keys are stored as plain strings — value is either a small integer (counters) or a tiny JSON envelope (the user-key value, ~50 bytes), no Jackson round-trip required. Trade-off documented: this avoids both the `@class` hint and `@JsonCreator` traps (project memory `jackson-public-final-pojo-needs-jsoncreator-for-redis-roundtrip`).
  - Generate the code via `SecureRandom` (NOT `java.util.Random` — predictable seeding defeats the entropy argument): `int n = secureRandom.nextInt(1_000_000); String code = String.format("%06d", n);`. 6 digits × 10^6 keyspace × 5-minute TTL — entropy is acceptable for v1 (≈30 bits).
  - **Code-collision handling via retry loop.** Different users can theoretically pick the same 6-digit code in the same 5-minute window (birthday-paradox for two random codes out of 10^6 ≈ 10^-6 per pair — negligible in practice but we defend anyway). After computing `code`, attempt `redis.opsForValue().setIfAbsent("sync_code:lookup:" + code, String.valueOf(userId), Duration.ofSeconds(300))` (this is Redis `SETNX` with TTL). If `false` (collision — another user already owns this code), retry with a fresh `SecureRandom` draw. Cap at **5 attempts**; if all 5 collide, throw `RateLimitedException("服务繁忙,请重试")`. The project's `GlobalExceptionHandler.java:35-40` maps `RateLimitedException` to HTTP 429 with `Result.error(429, message)`, so this surfaces to the mini-program as "操作太频繁,请稍后再试" (or the backend's specific "服务繁忙" message if `request.js:194` was updated per the mini-program task). 5 retries × 10^-6 per-attempt collision = 10^-30, never expected to fire.
  - Invalidate the previous lookup key by reading the old code from the user-key, computing the old lookup key, deleting it, then writing the new pair (best-effort; TTL is the safety net). The two writes that follow (user-key + lookup-key via SETNX above) are sequenced: write user-key first (it holds `{code, expiresAt}` metadata), then SETNX the lookup-key (the security-critical step). If the SETNX fails after we wrote the user-key, the next retry will overwrite the user-key atomically (`opsForValue().set` is unconditional), so stale metadata is overwritten.
  - **Atomic redeem via Lua.** See `POST /api/sync-code/redeem` implementation notes below.

#### `POST /api/sync-code/redeem`

- Auth: **none**. This endpoint is the trust boundary — anyone who knows the 6-digit code can claim the JWT. The code itself is the credential.
- Body:
  ```json
  { "code": "482931" }
  ```
- Validation:
  - Body shape: `code` must be a string matching `^\d{6}$`. Else 400.
  - Lookup: `sync_code:lookup:{code}` must exist. Else 400 with message "无效或过期".
  - **Lockout check**: before validation, increment `rate:redeem:fail:{clientIp}` with 10-minute TTL on each failed attempt. If the counter is already ≥ 5, return 429 with "尝试次数过多,请 10 分钟后再试".
  - On success: resolve userId via **atomic Lua redeem script**, then look up the user via `userMapper.selectById(userId)`, sign a JWT via `jwtService.generateToken(userId, user.getOpenid())` (same call `DesktopTokenController.java` uses).
- **Atomic Lua redeem script** (`resources/scripts/sync_code_redeem.lua`):
  ```lua
  -- KEYS[1] = sync_code:lookup:{code}
  -- Returns: userId as string, or nil if code is invalid/expired
  local userId = redis.call('GET', KEYS[1])
  if not userId then return nil end
  redis.call('DEL', KEYS[1])
  redis.call('DEL', 'sync_code:user:' .. userId)
  return userId
  ```
  The script runs in a single Redis round-trip via `redis.execute(new DefaultRedisScript<>(luaText, String.class), List.of(lookupKey))` — no ARGV (script takes no args). Three side effects — `GET lookup` → `DEL lookup` → `DEL user` — happen in one atomic Redis operation, eliminating the "DEL one, leave the other" race that sequential DEL would expose. Both keys disappear together; if a second redeem arrives in the same millisecond, the second sees `nil` and returns 400.
- Lockout counter management: increment `rate:redeem:fail:{clientIp}` on each failed attempt (404 lockout miss → increment; the lookup-miss is the failure). On success, `DEL rate:redeem:fail:{clientIp}`. Both ops run from Java after the Lua script returns. The lockout check (counter ≥ 5) runs FIRST (before the Lua call) so locked-out clients never waste a Redis round-trip on the script.
- Response:
  ```json
  {
    "code": 200,
    "data": { "token": "eyJ...", "userId": 1, "nickname": "Soirs" },
    "message": "操作成功"
  }
  ```
- Client IP: resolved via a new utility `com.lolskin.common.ClientIpResolver.resolve(HttpServletRequest)`. This is extracted from `EarnedSalaryController.resolveClientIp()` (`EarnedSalaryController.java:302-311`), which is `private` and unreachable from another controller. The new utility follows the same XFF-first → `X-Real-IP` → `getRemoteAddr()` precedence. After extraction, `EarnedSalaryController` is updated to call `ClientIpResolver.resolve(request)` instead of its own private method. Rationale: `application.yml` has no `server.forward-headers-strategy` configured (verified across all 191 lines of the yml — no `.properties` file exists). This means Tomcat does NOT auto-popate `getRemoteAddr()` from `X-Forwarded-For`; Spring's `request.getRemoteAddr()` would return the proxy IP (constant) for every request, which would collapse the per-IP lockout into a single global counter (same class of bug as project memory `rate-limiter-must-be-per-key`). The spec deliberately does NOT add `server.forward-headers-strategy: native` to `application.yml` because that change has broader trust implications across the entire backend; we instead trust the XFF header explicitly inside `ClientIpResolver` (the only call site that needs per-IP bucketing today). This is consistent with the codebase's existing precedent in `EarnedSalaryController` (XFF-first → X-Real-IP → getRemoteAddr) and is conservative: only this utility reads the header, other endpoints keep their current behavior.
- Error responses:
  - 400 with `Result.error(400, "码格式无效")` for non-6-digit input.
  - 400 with `Result.error(400, "无效或过期")` for missing code in Redis.
  - 429 with `Result.error(429, "尝试次数过多,请 10 分钟后再试")` for lockout.
  - 500 only for genuine internal errors; never leak details.

### Redis key schema

| Key | Type | Value | TTL |
|---|---|---|---|
| `sync_code:user:{userId}` | String (JSON) | `{"code":"482931","expiresAt":1786443321}` | 300s |
| `sync_code:lookup:{code}` | String | userId (plain number string) | 300s |
| `sync_code:cooldown:{userId}` | String | "1" | 30s |
| `rate:redeem:fail:{clientIp}` | String (counter) | integer | 600s |

`StringRedisTemplate` is used for all four — value is either plain number string or small JSON, no Jackson round-trip required.

### Mini-program changes

- New page section in `pages/profile/profile.wxml` between lines 83 and 86 (the logout button), before the logout:
  - `hextech-menu-item` with label "获取桌面同步码" and bindtap `onSyncCodeTap`.
- New `onSyncCodeTap` handler in `profile.js`:
  - State machine in a small modal component (or `wx.showModal` upgraded with custom view) showing: idle button → loading → showing-code (large 6-digit display + copy button + 5-minute countdown) → cooldown-error → generic-error.
  - On tap: `POST /api/sync-code/generate` via existing `http.post(...)` wrapper (`utils/request.js:241`). The mini-program's request helper at `request.js:194` currently hardcodes the 429 message to `'操作太频繁,请稍后再试'`, which would discard the backend's custom "请 X 秒后再试" / "尝试次数过多,请 10 分钟后再试". Spec calls for: when `code === 429` AND the response carries a `message`, prefer that string; fall back to the hardcoded default otherwise. Update `request.js:194` to `case 429: this.showError(message || '操作太频繁,请稍后再试');` (`message` is already destructured at `request.js:177`). This is a one-line change to the existing `handleBusinessError` switch.
  - Handle 429 → show "请 X 秒后再试" inline; handle 200 → display code + start countdown; handle other → toast error.
  - Copy button: `wx.setClipboardData({ data: code })` with toast "已复制".
- New entry in `utils/config.js` paths table (line 14-43) — match existing single-quoted string style:
  - `SYNC_CODE_GENERATE: '/api/sync-code/generate'`

### Desktop changes

- `src/main/auth.ts`: replace `login(username, password)` with `redeemSyncCode(code: string): Promise<string>`. POST to `/api/sync-code/redeem`. Response envelope shape changes from `{ token }` (old) to `{ token, userId, nickname }` (new) — update the local `LoginEnvelope` type to `RedeemEnvelope`. The function returns just the JWT string (matching the existing contract: callers expect a string, not an object). `userId` and `nickname` are surfaced to the renderer via `auth.getAuthStatus()` already-implemented separately, so the renderer does not need them at login time.
- `src/main/ipc.ts`: keep IPC channel name `auth:login` (lower-churn — `src/main/__tests__/ipc.test.ts` has 9 references to this string). Only the payload type changes: from `{ username: string; password: string }` → `{ code: string }`, and the inner call changes from `auth.login(...)` → `auth.redeemSyncCode(...)`. Rename `assertLoginPayload` → `assertRedeemPayload` (validates `^\d{6}$`).
- `src/preload/index.ts`: change exposed method name `login` → `redeemCode(code: string)` but keep channel `'auth:login'`. Update `AuthStatus` return type unchanged.
- `src/renderer/src/stores/auth.ts`: rename store action `login(username, password)` → `redeemCode(code: string)`. Inside it, call `window.api.redeemCode(code)` (the renamed preload method) instead of `window.api.login(...)`. Return type stays `Promise<void>`. The store's `loggedIn` / `tokenPreview` / `initialized` state is unchanged.
- `src/renderer/src/views/Login.vue`: replace the username + password form with a single input "6 位同步码" with `pattern="[0-9]{6}"` (HTML5 form-level validation) and `maxlength="6"`. Bind to a new `code: Ref<string>` instead of `username` / `password`. On submit, call `auth.redeemCode(code.value.trim())` and surface the error message in the existing `el-alert`. Keep the existing "logged-in" branch (lines 50-53) unchanged — it shows the current `tokenPreview` and a logout button. The submit handler (lines 70-91) is rewritten to validate `code.value.trim().length === 6` instead of checking both username and password.
- `tests/main/auth.test.ts` (rewrite): real path is `src/main/__tests__/auth.test.ts` (the `tests/main/` path mentioned earlier does not exist). Tests must mock `axios.post` for `/api/sync-code/redeem` instead of `/api/user/login`. Existing test at `src/main/__tests__/auth.test.ts:59` (`login('alice','hunter2')`) needs full replacement.
- Also rewrite `src/renderer/src/stores/__tests__/auth.test.ts:54` — it mocks `window.api.login` and will fail after the rename.
- Update `src/main/ipc.ts:7-10` `interface AuthCredentials` → `interface RedeemPayload` (renamed alongside `assertLoginPayload` → `assertRedeemPayload`, which validates the 6-digit regex).
- Also rewrite `src/main/__tests__/ipc.test.ts` — references `auth:login` channel in assertions at lines 111, 119, 122, 193, 198, 261, 262, and mocks `auth.login(username, password)` at lines 47-52, 64, 103, 199. Per the channel-name decision below, the channel name stays `auth:login` but the payload type changes from `{ username, password }` to `{ code }`, and the inner call becomes `auth.redeemSyncCode(...)`. Update all assertions accordingly.

### Rate limiting — why these numbers

| Limit | Value | Rationale |
|---|---|---|
| `generate` per userId | 30s | A real user opening the modal twice by accident is the only failure mode this prevents; matches existing `RateLimitedException` defaults. |
| `redeem` failures per IP | 5 in 10min | 6-digit code = 1,000,000 possibilities. At 5 attempts / 10min = 30 attempts / hour, brute force is hopeless. Threshold of 5 keeps typo false-positives tolerable. |
| TTL | 5min | Long enough for the user to walk between phone and desktop; short enough that leaked codes self-heal quickly. |

## Risks and Mitigations

- **Redis is down.** `generate` returns 500 (Redis exception → wrapped in `Result.error(500, "服务暂时不可用")`); `redeem` same. Acceptable: this is a v1 feature, not a primary path. The system also has `DesktopTokenController` as a fallback for admin-side smoke tests.
- **Clock skew between client and server.** Countdown on the mini-program is purely cosmetic — the server's TTL is the source of truth. If the mini-program's local countdown hits 0 but the server hasn't, the redeem still works.
- **Player pastes the code into the wrong app.** Out of scope; the 30s cooldown + 5min TTL limits damage to one stale JWT per mistake.
- **Code reuse on partial failure.** Use a `MULTI/EXEC` Lua script OR sequential `DEL` with the understanding that a race between `DEL user-key` and `DEL lookup-key` could leave one orphan. The orphan expires via TTL in 5min, so the practical risk is one leaked-but-expired key. Document this trade-off in the implementation plan.
- **nginx `X-Forwarded-For` spoofing.** Without a trusted proxy header, attackers can rotate IPs trivially. Spring Boot sees `request.getRemoteAddr()` in production behind nginx — `X-Forwarded-For` parsing must only trust the header if Spring Boot is configured to do so (verify in `application.yml`; otherwise use `getRemoteAddr()` only). Implementation plan must check this.
- **JWT reuse after revocation.** If a user regenerates a code, the old code is invalidated. If a code has been redeemed, the JWT issued is valid until natural expiry. There is no server-side revocation in v1 — consistent with the rest of the codebase.

## Migration / Rollout

- No DB migration. Redis-only feature.
- Backend deployment: rebuild `lol-skin-api-1.0.0.jar` (per existing `/opt/app/` systemd unit), restart via `systemctl restart lol-skin-api`. No nginx config change.
- Mini-program: ship as part of the next normal release of `wechat_rating_program`.
- Desktop: rebuild and re-distribute the Electron app per the existing release flow.

## Open Questions

None — design is closed pending user review of this spec.