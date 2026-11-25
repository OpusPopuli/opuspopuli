# Plan: open the civic record to visitors without an account (#1456)

| | |
|---|---|
| **Issue** | [#1456](https://github.com/OpusPopuli/opuspopuli/issues/1456) |
| **Date** | 2026-11-22 |
| **Author** | Rodney Gagnon (plan drafted by Claude Code under direction) |
| **Branch** | `feat/open-civic-record-1456` |
| **Data classification** | **CCPA personal information, transiently.** A street address, or a browser location (CPRA *sensitive* PI: precise geolocation), is used once to compute districts. Neither is stored, cached, logged, audited, traced or sent to a model. Signed-out reading of public civic data involves none |
| **Migrations** | None |
| **New dependencies** | None |
| **Blocker** | The parts of #962 that face signed-out readers, done here as subtask 6 |
| **Effort** | About 7 focused sessions |

## Decisions (owner, 2026-11-22)

1. **Location without an account:** both an address and the browser's location. A public query resolves them server-side and stores and logs nothing. The device keeps the district IDs only.
2. **Petitions stay behind an account:** scanning, history and the map. The map shows where people scanned.
3. **Search engines index the content pages.**

## Findings that shape the plan

- **The API is already open.** Every civic read in the region subgraph is `@Public`: propositions, bills, representatives, committees, meetings, minutes, finance, civics and search. `requestBillSummary` is public, with caps per day, per reader and per IP.
- **The wall is frontend-only.** `ProtectedRoute` wraps `app/region/layout.tsx`, `app/petition/layout.tsx` and `app/me/briefing/layout.tsx`.
- **The region pages need the account only for location.**
  - `JurisdictionsContext` queries `myJurisdictions`.
  - `myCountySupervisors` is used on the region home, county and representatives pages and in `JurisdictionStack`.
  - `myAddresses` is used on the representatives page.
  - The public `countyRepresentatives(countyRegionId)` already exists.
- **The expired-session redirect is safe for signed-out visitors.** `triggerAuthExpiredRedirect` returns early when no user is stored, so a signed-out 401 doesn't loop to `/login`.
- **Resolution today** runs the Census geocoder, then a PostGIS `ST_Contains` lookup, and persists the result per user address (`JurisdictionResolutionService`, users service).
  - On prod, every jurisdiction type has a boundary: 6,326 rows, and only the `STATE` row has none. So a point resolves completely through PostGIS.
  - The address path needs the geocoder only to turn an address into a point.
- **The client IP is spoofable.** The gateway throttler, the gateway's `clientIp` and `requestBillSummary`'s per-IP cap all key on the **first** `X-Forwarded-For` hop, which the client controls.
- **The gateway has no per-client limit on GraphQL at all** (found 2026-11-22, during subtask 1).
  - **Measured on UAT:** 300 parallel queries from one client in 1.8 s, none refused, whatever `X-Forwarded-For` carried.
  - **Why:** the gateway's `ThrottlerGuard` is a Nest guard, and Apollo Gateway executes operations without Nest resolvers, so the guard runs only on the REST routes. Even there, it keyed on `req.ip`, which behind the tunnel is the `cloudflared` container.
  - **What was left:** the only GraphQL limit was the subgraphs' global cap, which every user shares, so one client could spend it for everyone.
  - **This affects prod today**, since the civic API is already public. Subtask 1 now includes the fix.
- **The Studio publishes the gateway on `0.0.0.0:8080`.** The tunnel reaches it over the Docker network and doesn't need the host port. Anyone who can reach that port can forge `cf-connecting-ip`. That's on the LAN at least, and possibly beyond, depending on the router. Follow-up in `opuspopuli-node`: bind it to `127.0.0.1`.
- **Indexing is blocked today.** `robots.ts` disallows `/region/`, the sitemap lists none of it, and the region pages are client components with no per-page metadata.
- **The geocoder's log lines are already scrubbed** of street addresses (#1094), and `@SkipAudit()` exists.

## Subtasks

### 1. Client IP from Cloudflare, not from the client

**Where:** `apps/backend/src/common/` and the gateway (`api/src/app.module.ts`, `hmac-data-source.ts`).

- Add one helper, `resolveClientIp(headers, socketIp)`:
  - `cf-connecting-ip` first. Cloudflare sets it and overwrites any value the client sends.
  - Otherwise the **last** `X-Forwarded-For` hop.
  - Otherwise the socket address.
- Use it in:
  - `common/guards/throttler.guard.ts` and the gateway's tracker;
  - the gateway's `clientIp`, forwarded to subgraphs;
  - `bill-summary.resolver.ts` `firstForwardedIp`;
  - the audit interceptor and the logger middleware, so the IP they record is the real one.
- **Verify** that the gateway is reachable only through Cloudflare. If it's reachable directly, `cf-connecting-ip` can be spoofed too, and the origin needs locking down first.
  - **Result:** the Studio publishes `0.0.0.0:8080`; the follow-up is listed under Findings.
- **`GraphqlRateLimitMiddleware`** on the gateway's `/api` route, registered before CSRF and auth.
  - It applies the `GATEWAY_THROTTLER_CONFIG` tiers per resolved client IP, with one storage key per tier.
  - It uses the throttler module's own storage.
  - When a tier is exceeded it returns 429, a `Retry-After` header, and a GraphQL-shaped `TOO_MANY_REQUESTS` error.
- **`ClientIpThrottlerGuard`** replaces the stock guard, so the gateway's REST routes are keyed on the client too.
- **Tests:** a spoofed `X-Forwarded-For` doesn't change the throttle key or the per-IP cap key. Mutation-check by restoring first-hop parsing.
  - **Done:** 7 tests fail with first-hop parsing restored.
  - **Proof on UAT:** rerun the 300-request probe against the rebuilt gateway.

### 2. A public jurisdiction lookup

**Where:** region subgraph. **This is a federation change.**

- Move `GeocodingService` and its error type from the users service to `common/geocoding/`, with no behaviour change. The users service imports it from there.
- Add `PublicJurisdictionService` in region:
  - `locate({ point })`: one PostGIS `ST_Contains` query with the jurisdiction's parent.
  - `locate({ address })`: the Census geocoder turns the address into a point, then the same lookup runs.
  - No log line carries the input. Errors report the locality at most.
- Add `locateJurisdictions(input: LocateJurisdictionsInput!): [JurisdictionModel!]!`:
  - `@Public` and `@SkipAudit`.
  - The input carries exactly one of `point { lat, lng }` or `address { line1, city, state, postalCode }`, with validated ranges and lengths.
  - It gets a dedicated per-IP throttle at the gateway, much tighter than page reads.
- Add `jurisdictionsByIds(ids: [ID!]!): [JurisdictionModel!]!`, `@Public`, with at most 50 IDs. It rebuilds a returning visitor's districts from the IDs saved on the device.
- Regenerate `region-schema.gql`, check composition at the gateway, and update the frontend introspection snapshot.
- **Tests:**
  - Unit: validation; the logger and audit interceptor never receive the address or coordinates; the geocoder's failure modes.
  - Integration, on the real test database: a known point resolves to its districts.
  - A check that OpenTelemetry spans don't record GraphQL variables.

### 3. Location on the frontend

**Where:** `components/region/JurisdictionsContext.tsx` and a new `components/region/LocateForm.tsx`.

- **Signed in:** `myJurisdictions`, unchanged.
- **Signed out:** district IDs from `localStorage`, read and written inside try/catch so the page renders without storage, then loaded with `jurisdictionsByIds`.
- The provider adds `setLocation(jurisdictions)` and `clearLocation()`.
- `LocateForm` offers address fields and "Use my location". It handles a refused permission and an unavailable geocoder distinctly, and says: *"We use this once to find your districts and don't keep it."*
- It appears in the no-jurisdictions state of the region home, state, county, federal and representatives pages. Once a location is set, a "Change or clear location" control appears.
- Signed out, use `countyRepresentatives` instead of `myCountySupervisors`. Call `myAddresses` only when signed in.
- **Tests:** both modes, storage unavailable, geolocation denied; axe; English and Spanish.

### 4. Remove the wall, update navigation, add account prompts

- Remove `ProtectedRoute` from `app/region/layout.tsx`. `/petition` and `/me/briefing` keep it.
- **Header, signed out:** Explore (`/region`), Search, Sign in, Create account.
- **Landing CTA:** Explore for everyone; "Get your briefing" leads to sign-up.
- An `AccountPrompt` component, inline and dismissible, never a modal:
  - proposition: "What this means to you";
  - representative: "Follow in your briefing";
  - bill: "Follow in your briefing".
- Signed-out pages fire no guarded query. Assert this in tests, so the session-refresh link never runs for a visitor.
- **Tests:** Playwright signed-out journeys (browse, search, locate, open a receipt, request a bill summary). Update the end-to-end tests that expect `/region` to redirect to login.

### 5. Indexing

- **`robots.ts`:** allow `/region/`. Keep `/petition/`, `/settings/`, `/me/`, `/onboarding` and the auth routes disallowed.
- **`noindex`** metadata on `/me`, `/settings`, `/petition`, `/onboarding` and the auth pages.
- **Dynamic `sitemap.ts`:** the section pages, plus the detail pages for propositions, bills, representatives and committees (about 5,500 URLs).
  - It's read from the gateway with `cf.cacheTtl` and a timeout, as the prompt page does on the Worker.
  - If the read fails, the sitemap falls back to the static pages and never errors.
- **`generateMetadata`** in a small server `layout.tsx` on each `[id]` route: title, description and canonical URL from one light public query, edge-cached, with a timeout.
- **Tests:** robots rules, sitemap with the gateway up and down, and the metadata.

### 6. #962 for signed-out readers, and privacy

- The footer in English and Spanish; it's English-only today.
- `FinanceDisclaimer` on the campaign-finance subpages (committees, contributions, expenditures, independent expenditures).
- A one-time "how to read this site" notice, dismissed on the device.
- Check the wording of the "AI-generated" label against #962.
- **Privacy page:** notice at collection for the location lookup.
  - Its purpose is finding your districts.
  - The address path calls the US Census geocoder.
  - Nothing is kept, sold or shared.
  - The device keeps the district IDs only, and the reader can clear them.
- **Owner action:** counsel review of the wording. The copy is swappable through the translation files.

### 7. Load, UAT and release

- Measure gateway requests per signed-out page load, and estimate crawler load.
- Check the throttle limits against the real client IP.
- Add alerts on the gateway's 429 rate and p95 latency.
- Deploy to UAT and walk every signed-out journey. Then release: backend `v*` first (new queries), then `frontend-v*`.
- **Docs:** `docs/architecture/frontend-architecture.md` (which surfaces are public and which need an account), and `docs/guides/auth-security.md` (the public lookup and the client-IP rule).

## Changes from the plan

Recorded as they were made, with the reason.

**Subtask 1, after an independent review found four blockers:**
1. **The limiter was bypassable.** Apollo is mounted on `/api` as a prefix, so `POST /api/x` reached it with the middleware unbound.
   - **Change:** the middleware binds `api` and `api/*splat`.
   - **Proof on UAT:** 300 posts to `/api/x` gave 50 × 200 and 250 × 429.
2. **The stock `@nestjs/throttler` in-memory store was unsafe with one key per visitor.**
   - One client's expiring block cleared every other key's decay timers, so ordinary visitors climbed to the limit.
   - It never deleted a key, at about 1.25 KB per distinct IP, against a 512 MB gateway.
   - **Change:** a bounded fixed-window store, `common/rate-limit/fixed-window-storage.ts`, with no timers, a periodic sweep and a key cap. All five services use it through `throttlerModuleOptions()`.
3. **The subgraph throttle log printed full client IPs.**
   - **Change:** the log is masked. So is the login-lockout warning in `auth.resolver.ts`, which printed an email and an IP unmasked. That one predates #1456.
4. **The subgraph throttles were keyed on the gateway's IP** (predates #1456).
   - **Change:** `throttlerModuleOptions()` sets one `getTracker` for every service: the client IP the gateway forwards. This also replaced the planned `ClientIpThrottlerGuard`.
   - *Corrected after the second review:* this was first written up as making the 5-per-minute login throttle site-wide. In fact it never applied at all (see below).

**Two further hardenings from the review:**
- **Proxy headers are believed only from a private or loopback peer:** the tunnel container, or the gateway inside a subgraph. Headers must also be valid IPs. A request that reaches the gateway from a public address can no longer pick its own key.
- **IPv6 clients are keyed per /64,** so one line can't mint budgets.

**Subtask 2:**
- **No migration after all.** `jurisdictions.boundary` has had a GiST index since #690 (`jurisdictions_boundary_gist_idx` in `spatial-indexes.sql`, applied by `db-migrate.sh`). The query cast to `geometry`, so the index was never used.
  - The signed-in address resolution has always done a full scan: 285 ms locally.
  - **Change:** one shared function, `common/geocoding/jurisdictions-at-point.ts`, queries in geography (`ST_Covers`) and uses the index: 37 ms.
  - **Equivalence:** the same districts for all 300 test points (200 random in California, 100 inside random districts).
  - **Both paths:** the signed-in resolution and the public lookup now call it.
- **`locateJurisdictions` is a mutation**, so it can only be sent as a POST, and an address can never sit in a URL the request logger writes.
  - **Proof on UAT:** a GET is refused with "GET requests only support query operations".
- **`jurisdictionsByIds` is `@SkipAudit` too.** UAT showed its audit row pairs a visitor's IP with their district ids, down to water and fire districts. That is the location record the lookup promises not to keep.
- **Integration tests didn't have the spatial indexes.** The bootstrap now applies `spatial-indexes.sql`'s `CREATE INDEX` statements, read from the file. A test asserts that the point query uses the index.

**After a second independent review of the whole diff:**
- **The street address was being written to traces (blocker; predates #1456).**
  - The undici auto-instrumentation records each outgoing request's full URL, and the geocoder sends the address as query parameters. A Tempo trace of `locateJurisdictions` held `url.query = ?street=1315+10th+St&…` beside a server span carrying the client IP.
  - **Every signed-in address save on production has done the same.**
  - **Change:** `common/tracing-redaction.ts` redacts every query value on every outgoing span before it starts (undici `startSpanHook`, http `startOutgoingSpanHook`), keeping only the parameter names.
  - **Proof on UAT:** the geocoder span now reads `street=REDACTED&city=REDACTED&…`.
- **"Verified on UAT" was claimed for the `jurisdictionsByIds` audit fix before UAT had been rebuilt with it (blocker).**
  - UAT was rebuilt after the final edit and re-verified: no audit rows for either operation.
  - The 4 earlier test rows were deleted from the UAT audit log.
- **The auth route limits never applied (predates #1456).**
  - `@Throttle({ default: … })` names a throttler nothing registers, and the v6 guard reads overrides only under registered names.
  - **Change:** `authThrottle()` applies each limit to the `long` tier, per route and per client. A test asserts that every throttle name on `AuthResolver` is a registered tier.
  - **Proof on UAT:** 5 failed logins went through and the 6th and 7th were refused.
- **The point query keeps planar semantics.**
  - `ST_Covers` in geography bows long boundary edges by up to about 20 m, and counts a point exactly on an edge as inside both neighbours.
  - **Change:** the query is now `boundary && point::geography` (index) `AND ST_Contains(boundary::geometry, point)` (the original exact test).
  - **Speed:** 2.3 ms.
  - **Equivalence with the original:** identical on 3,893 points (random points, interior points and boundary vertices), plus 6,000 quarter-points on the 2,000 longest boundary edges.
  - **Index test:** it now EXPLAINs the exact SQL in a transaction with `SET LOCAL`, and requires an `Index Cond`. Naming the index wasn't enough, because a full index walk also names it; this was confirmed by mutation.
- **IPv6 budgets:**
  - The bill-summary per-IP cap is keyed per /64.
  - Address lookups are keyed per /48, so one home allocation (256 /64s) can't spend the shared geocoder budget.
- **The geocoder logs the state only.** The city is free text from anonymous visitors.
- **Where the per-IP lookup budget lives:** the plan said "a dedicated per-IP throttle at the gateway". It's in the region service (`PublicJurisdictionService`), because only the subgraph knows which operation a request is.
- **Subgraph throttles are now per client, so there is no global throughput cap.** The gateway's per-client tiers are the real control. A global brake, if wanted, is a separate decision.
- **Carried to subtask 5:** server-side reads from the Worker (sitemap, `generateMetadata`) all arrive with the Worker's egress IP and would share one budget. They need an exemption, for example an HMAC-signed Worker header, before subtask 5 ships.
- **Release gate, not a follow-up:** Docker Desktop presents every peer on a published port as `192.168.65.1`, a trusted private address. So on the Studio, anyone who can reach `0.0.0.0:8080` can still choose their own key. Binding the host ports to `127.0.0.1` (opuspopuli-node) must land before subtask 7.

**Subtask 3, found before starting (2026-11-24):**
- **`countyRepresentatives` can't serve signed-out readers.** Its argument is a region plugin *name* (`sonoma-county`), which the server derives from the county's FIPS code through `region_plugins`. A signed-out page holds only jurisdiction ids.
  - It also returns the whole board. `myCountySupervisors` narrows it to the reader's seat when a supervisorial district resolves (#1136), and the region home, county page and `JurisdictionStack` depend on that.
- **The representatives page doesn't need `myAddresses` for legislators.** `useStateLegislators(jurisdictions)` already derives them from jurisdictions through the public `representativesByDistricts`.
- **Decision (owner, 2026-11-24):** a public `countySupervisorsAt(jurisdictionIds)` in region, `@Public` and `@SkipAudit`, sharing one core with `myCountySupervisors` so the #1136 seat matching stays in one place.
  - It's a federation change, so it ships in the backend release ahead of the frontend.
  - Rejected: a frontend-only filter of the whole board, which duplicates #1136's matching and isn't scoped to one county.
- **Map-first navigation is being explored separately (owner, 2026-11-24).** The idea: the map is the main navigation, the county shape is the centrepiece of the county page, and a visitor can set a location by tapping a county (a public FIPS code, nothing personal) or a point.
  - A clickable mockup comes first, in its own context.
  - Subtask 3 is unaffected. Its data layer is needed either way, and `LocateForm` remains the accessible, non-map path. It is kept self-contained so a map picker can sit beside it.

**Verified on UAT, 2026-11-22 (rebuilt after the final edit):**
- A point at the Capitol resolved to 8 districts.
- The address path through the real Census geocoder resolved the same 8 types.
- Restoring by id returned 8.
- No address or coordinate appeared in the api or region logs, or in any audit row.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| A spoofed `X-Forwarded-For` bypasses the throttles and the bill-summary cap | **High × Likely** once anyone can visit | Subtask 1, tested and mutation-checked. Confirm the origin is reachable only through Cloudflare |
| An address or location reaches logs, the audit log or traces | High × Possible | `@SkipAudit`; no input in any log line; logger and interceptor spy tests; span check; the #1094 rule |
| Crawler and signed-out load overwhelms the single Studio | Medium × Likely | Edge-cached sitemap and metadata; a real per-IP throttle; 429 and latency alerts; measured before release |
| The Census geocoder throttles or blocks our IP | Medium × Possible | Tight per-IP limit on the address path, plus a global cap. Browser location never calls the geocoder |
| Indexing spreads inaccuracies or misattribution further | High × Possible | Subtask 6 before release; counsel review; receipts on every AI passage (#1450) |
| Signed-in users regress | Medium × Rare | Both modes tested in the provider and end to end |
| More bill-summary requests cost model time | Medium × Possible | Existing global daily cap; the per-IP cap now uses the real IP |
| The frontend ships before the backend | Medium × Possible | Release order, stated in the PR |
| GPL or other dependency conflict | Low × Rare | No new dependencies |
| Migration safety | — | No migration |

## Not in scope

- Making the petition map, or any scan data, public.
- Server-rendering whole pages; the metadata layer is enough for indexing now.
- The nightly sync, which stays off by owner decision (2026-11-22).
