# Plan: silent session refresh (#977)

| | |
|---|---|
| **Issue** | [#977](https://github.com/OpusPopuli/opuspopuli/issues/977) — access token expires after 15 minutes with no refresh flow |
| **Date** | 2026-08-14 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Authentication credentials (access + refresh tokens) and session metadata (IP, user agent, device). Strict PHI/PII lens applies by default — the repo has no `.claude/compliance-profile.yaml`. |
| **Branch** | `fix/session-refresh-flow-977` |
| **Status** | Approved 2026-08-14. **All 7 subtasks complete** — see the log below. |

## Problem

A signed-in user is forced back to `/login` roughly 15 minutes after authenticating, mid-session.
The access-token cookie has an absolute 15-minute `maxAge` and nothing renews it, so continuous use
makes no difference. `authExpiryLink` classifies the resulting `403` / `UNAUTHENTICATED` as an
expired session and full-page redirects.

The refresh half of the design was issued but never built: `setAuthCookies()` writes a 7-day
`refresh-token` cookie scoped to `path: '/api/auth/refresh'`, an endpoint that does not exist. The
credential is minted, stored, and never read by anything.

`/settings` and `/me/*` get blamed because they fire fresh authenticated queries and are usually
the first request to observe the dead cookie. Pages served from the persisted Apollo cache keep
rendering without a round-trip. The profile route is a symptom.

## What is actually missing

The issue names two gaps. There are three — the third is the one that gates the others.

| | Status |
|---|---|
| `/api/auth/refresh` route | **Absent.** The string exists only as a cookie `path` in `cookie.utils.ts:70,106`. |
| `refresh` mutation | **Absent.** `schema.gql` carries `refreshToken` only as a field on `Auth`. |
| **`IAuthProvider.refreshSession()`** | **Absent, and unmentioned in the issue.** Neither `packages/common/src/providers/auth/types.ts` nor `supabase.provider.ts` can redeem a refresh token at all. |

## Three findings that shape the design

**1. The cookie path forecloses a mutation-only fix.** GraphQL is mounted at `path: 'api'`
(`api/src/app.module.ts:158`); the refresh cookie is scoped to `/api/auth/refresh`. A browser will
not send that cookie to `/api`. Serving renewal purely as a GraphQL mutation therefore *requires*
widening the cookie path, which puts a 7-day credential on every GraphQL request.

**2. `AuthMiddleware` does not block.** `auth.middleware.ts:45` copies the cookie into the
`Authorization` header and calls `next()`. It never rejects, so a refresh route reached with an
expired access token works. `CsrfMiddleware` *does* reject and is applied to `path: '*'`
(`app.module.ts:270`), so a new route inherits CSRF protection rather than needing its own.

**3. No migration is required.** `UserSession`
(`packages/relationaldb-provider/prisma/schema.prisma:694`) already carries `refreshToken`,
`isActive`, `revokedAt`, `revokedReason`, `lastActivityAt`, `expiresAt`. Rotation and reuse
detection update rows in place.

## Design decision

**A REST route on the gateway, preserving the narrow cookie path.**

`POST /api/auth/refresh` reads the refresh cookie, calls a users-subgraph mutation over HMAC
(reusing the `hmacSigner.signGraphQLRequest` seam at `hmac-data-source.ts:111`), and re-sets
cookies through the existing `setAuthCookies`.

**Rejected: mutation-only with the cookie re-scoped to `/api`.** Less code, but it sends a 7-day
credential with every GraphQL request instead of to one endpoint. The issue already rejects the
analogous shortcut of raising `COOKIE_ACCESS_TOKEN_MAX_AGE` on the grounds that a longer-lived
bearer credential is a security regression; widening the path is the same trade in a different
place. If this decision is ever reversed, re-run `/security-review` against that change
specifically, and re-check `clearAuthCookies`' path (see subtask 5).

## Subtasks

### 1. `refreshSession` on the auth provider

**Files:** `packages/common/src/providers/auth/types.ts`,
`packages/auth-provider/src/providers/supabase.provider.ts`

Optional interface method, following the established `createSessionForUser?` /
`validateAccessToken?` pattern with an `if (!this.authProvider.refreshSession) throw` guard at the
call site. Implementation calls GoTrue `POST /auth/v1/token?grant_type=refresh_token`.

GoTrue **rotates the refresh token on redemption and applies a reuse interval**. Build on that
behaviour rather than reimplementing it; the interval is what makes multi-tab races survivable.

**Tests:** unit — success, expired, revoked, reuse, provider-down (circuit breaker path).

### 2. `refreshSession` in the users service

**Files:** `apps/backend/src/apps/users/src/domains/auth/auth.service.ts`, `auth.resolver.ts`

Service redeems via the provider, then updates the `UserSession` row: new `sessionToken`, new
`refreshToken` (both last-32 fragments, per the existing convention), bump `lastActivityAt`.
Redemption of an already-rotated token revokes that session with
`revokedReason: 'refresh_reuse'` and fails.

Resolver mutation restricted to HMAC-internal callers. Audit-log renewal with tokens masked,
mirroring `auth.resolver.ts:144`.

**Federation:** new mutation on the users subgraph — validate composition at the API Gateway per
`CLAUDE.md`.

**Tests:** unit on the service; composition check in CI.

### 3. Gateway route

**Files:** new `apps/backend/src/api/src/auth-refresh.controller.ts`, `api/src/app.module.ts`

The gateway currently has **no controllers** — this is the first, so verify it inherits the
middleware chain rather than assuming it.

Reads the refresh cookie, calls subtask 2 over HMAC, calls `setAuthCookies`, returns **204 with no
body**. Tokens must never reach JavaScript. On failure: `clearAuthCookies` and 401.

**Tests:** integration — a request without a CSRF header must 403.

### 4. Frontend refresh link

**Files:** `apps/frontend/lib/apollo-client.ts`, new `apps/frontend/lib/auth-refresh.ts`

New link between `authExpiryLink` and the transport link. On auth failure: call the refresh
endpoint, retry the operation **once**.

- A module-level in-flight promise collapses concurrent failures into a **single** refresh.
- A `hasRetried` marker on the operation context prevents a refresh from triggering a refresh.
- Refresh failure falls through to the existing `triggerAuthExpiredRedirect`, unchanged — the
  terminal behaviour in `auth-logout.ts` is correct and stays.

This is the highest-risk code in the change and the least amenable to manual verification: a broken
single-flight only manifests under concurrent queries, which is exactly the `/me/*` page load that
surfaced the bug. **Write these tests first.**

### 5. Logout and path coherence

**Files:** `apps/backend/src/common/utils/cookie.utils.ts`

`clearAuthCookies` clears the refresh cookie at `/api/auth/refresh` (`:106`). Correct under this
design; it is precisely what breaks silently if the cookie path is ever widened. Assert the paths
agree.

### 6. Tests

**Files:** `apps/backend/__tests__/integration/auth/auth.integration.spec.ts` (extend — the
directory already exists), frontend unit tests alongside subtask 4.

Integration tests hit the real local database per repo convention:

- renewal succeeds and rotates the `UserSession` row
- redeeming a rotated token revokes the session
- expired refresh returns 401 and clears both cookies

Frontend: single-flight collapse, retry-once, no-loop, terminal redirect preserved.

### 7. Docs

**Files:** `docs/guides/auth-security.md` — document the renewal flow, rotation, and reuse
detection.

## Data classification

**No PHI. PII and authentication credentials.**

The refresh token travels browser → gateway (httpOnly cookie, single path) → users service
(HMAC-signed) → GoTrue. It is persisted only as a last-32 fragment in `UserSession.refreshToken`.
Session metadata already stored — IP address, user agent, device type — is PII and is unchanged by
this work.

Constraints:

- **No token value may enter a log, prompt, fixture, seed, or third-party service.** `SecureLogger`
  redacts; audit entries use `slice(-32)`.
- **Tokens must never reach JavaScript.** The route returns 204, never a body containing tokens.
  Cookies stay httpOnly (`docs/guides/auth-security.md`).
- Renewal goes through the API Gateway so CSRF validation and `X-HMAC-Auth` signing are preserved.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Refresh loop hammers the auth provider on failure | **High × Possible** | `hasRetried` context marker; a failed refresh never re-enters the link. Explicit test. |
| Multi-tab race redeems the same token, logging both tabs out | **High × Likely** | Single-flight promise per tab; rely on GoTrue's reuse interval across tabs. Rotation *without* this causes the very bug it aims to prevent. |
| Widening the cookie path exposes a 7-day credential | **High × Rare** (only if the rejected design is revisited) | Recommended design keeps `/api/auth/refresh`. Re-run `/security-review` if reversed. |
| Gateway's first controller bypasses a gateway-wide assumption | Medium × Possible | Verify CSRF/Auth middleware coverage explicitly; integration test asserts a missing CSRF header 403s. |
| Federation drift from the new mutation | Medium × Possible | Gateway composition validation per `CLAUDE.md`; covered by CI. |
| Reuse detection false-positives cause mass logouts | Medium × Rare | Revoke the single session, never all sessions for the user. |
| New dependency with an incompatible licence | Low × Rare | None required — AGPL-3.0 constraint unaffected. |

## Effort

**3–4 focused sessions.** Backend chain (1–3) is the bulk, ~2. Frontend link (4) is ~0.5 but holds
the subtle concurrency bugs. Tests (6) ~1.

## Delivery log

| Subtask | Commit | Notes |
|---|---|---|
| 1 — provider | `dbb53fd` | `IAuthProvider.refreshSession()` — the gap the issue did not name |
| 2 — users service | `ba9a522` | `@inaccessible` mutation + in-place rotation |
| 3 — gateway route | `e0ddb54` | `POST /api/auth/refresh`, the gateway's first controller |
| 4 — frontend link | `89a74ce` | single-flight + retry-once; first user-visible change |
| 5 — path coherence | (this series) | `REFRESH_COOKIE_PATH` + route-metadata assertion |
| 6 — tests | (this series) | 8 integration tests, real stack + real DB |
| 7 — docs | (this series) | `auth-security.md` § Session Renewal |

### What the risk register got right, and what it missed

The multi-tab race and the refresh loop were both rated correctly and are both covered by tests.

Two things were **not** in the register and were found during implementation:

1. **A 4xx from the provider is not automatically terminal.** The first cut classified `429` as an
   invalid token, which would have revoked valid sessions under load — reintroducing this issue's
   forced logout at exactly the moment it hurts most. Found by review; `408`/`429` are now
   explicitly retryable.
2. **`UserInputError` erased the provider's error code**, which would have left the gateway route
   unable to distinguish a dead session from an outage. The safe-*looking* default there is to sign
   the user out. The code now travels in the GraphQL error extensions.

Both are the same species of bug as the one being fixed: a transient failure being treated as a
terminal one.

### Still unproven

No test exercises a **genuine GoTrue refresh token** end to end. The provider unit tests mock the
Supabase client, and the integration tests use a deliberately invalid grant. So the happy path —
`supabase.auth.refreshSession()` against a real GoTrue, with the client constructed from a
service-role key and `persistSession: false` — is verified by reading, not by running. A full
magic-link login in the integration suite would close this; it is the one gap worth knowing about
before trusting renewal in production.

## Explicitly out of scope

- Raising `COOKIE_ACCESS_TOKEN_MAX_AGE` as a stopgap. It trades a 15-minute forced logout for a
  longer-lived bearer credential and must not ship as the resolution.
- Any change to the terminal expired-session UX. `triggerAuthExpiredRedirect` is correct and stays
  as the fallback once refresh has genuinely failed.
