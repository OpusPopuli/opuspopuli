# Change Record — #1456 Open the civic record to visitors without an account (subtasks 3–7)

> SOC 2 CC8.1 change-management record. Fields marked **PENDING** are closed at
> PR review / release time; `/op-validate` collects this record into the
> release evidence pack and must not accept it with pending fields.

| Field | Value |
|---|---|
| **Change ID** | `1456-open-civic-record` (subtasks 3–7; subtasks 1–2 shipped in #1457, v2.2.0) |
| **Linked issues** | [#1456](https://github.com/OpusPopuli/opuspopuli/issues/1456); disclaimers for signed-out readers from [#962](https://github.com/OpusPopuli/opuspopuli/issues/962); follow-ups in `opuspopuli-node` (alert sync) |
| **Date** | 2026-11-25 |
| **Branch** | `opuspopuli @ feat/open-civic-record-location-1456`, 16 commits on `main` (`92213503` … `f1ae8013`), 102 files, +5,077 / −196 |
| **Author** | Claude Code (Anthropic Claude), directed by Rodney Gagnon — AI-assisted; each subtask approved by the owner in-session before its commit (2026-11-24 and 2026-11-25) |
| **Reviewer(s)** | **PENDING.** No pull request yet. Separation of duties: self-review only, until independent PR review or a countersignature |
| **Plan of record** | `docs/plans/1456-open-civic-record.md`, with every departure from it recorded under "Changes from the plan" |

## What changed and why

The civic record (`/region`) sat behind sign-in, although every civic read was already public on the
server; the account was needed only for location. This change opens it.

- **Location without an account:** a visitor sets it on their own device, by an address (resolved through the US Census geocoder) or the browser's location. Only the resulting district ids are kept, in the browser. A new public `countySupervisorsAt` query serves their supervisor.
- **No wall, but invitations:** the `ProtectedRoute` wall is removed. The header and landing page lead with exploring. Proposition, representative and bill pages offer an account inline rather than requiring one.
- **Indexing:** search engines index the civic record through per-kind sitemaps, page metadata, and `noindex` on private areas. The Worker's server-side reads can be signed for a budget of their own; the secret is not set at launch, by owner decision.
- **#962 disclaimers for signed-out readers:** a translated footer, the finance disclaimer on every finance page, a one-time "how to read this site" notice, an AI label that says "may contain errors", and a notice at collection on the privacy page.
- **Gateway observability:** the gateway had no GraphQL request metrics at all. It now records them, with alerts on its refusal rate and latency.

## Files (by area)

| Area | Main files |
|---|---|
| Region service | `region.resolver.ts`, `region.service.ts`, `region-query.service.ts` (`countySupervisorsAt`; `@SkipAudit` on `representativesByDistricts`), `region-schema.gql` |
| Gateway | `graphql-rate-limit.middleware.ts` (edge-read budget), `gateway-request-metrics.middleware.ts`, `rate-limit/edge-read-signature.ts`, `shared-app.config.ts`, `env.validation.ts`, `api/src/app.module.ts` |
| Frontend: location | `JurisdictionsContext.tsx`, `LocateForm.tsx`, `NoLocationState.tsx`, `lib/visitor-location.ts`, `lib/hooks/useCountySupervisors.ts`, region pages |
| Frontend: open access | `app/region/layout.tsx`, `Header.tsx`, `CountyHero.tsx`, `AccountPrompt.tsx`, `lib/i18n/context.tsx`, `lib/device-dismissals.ts` |
| Frontend: indexing | `app/robots.ts`, `app/sitemap.ts`, `app/region/sitemap.ts`, four `[id]/layout.tsx`, `lib/server/*`, `config/indexing.config.mjs`, `next.config.mjs` |
| Frontend: #962 | `Footer.tsx`, `ReadingNotice.tsx`, four finance subpages, `app/privacy/page.tsx`, locales (en, es) |
| Ops and docs | `observability/prometheus-alerts.yml`, `docker-compose-uat.yml`, `docs/architecture/frontend-architecture.md`, `docs/guides/auth-security.md`, the plan |

## Data classification

**CCPA personal information, transiently; CPRA sensitive PI for a browser location.** Repo profile:
`us-state-privacy` + `soc2`.

- **The address or location** is used once to compute districts. It's sent in a POST body only and never stored, cached, logged, audited, traced or sent to a model.
- **District ids** are kept on the visitor's device only, and Clear removes them.
- **Account-free reads of public civic data** involve no personal information.
- **Data scan:** `scripts/data-scan.ts` on this branch's diff passed, with 0 findings (1 existing allowlist entry).

## Risk register

From the plan, updated for what this branch found.

| # | Risk | Severity × likelihood | Mitigation |
|---|---|---|---|
| 1 | An address or location reaches logs, audit records or traces | High × Possible | Mutation-only lookup; `@SkipAudit` on all four location operations (one added after `/op-verify` found an audit row); trace query values redacted; verified on UAT (logs, audit table, Tempo) |
| 2 | A spoofed client IP bypasses throttles | High × Likely if unmitigated | Shipped in #1457; gateway and Kong on loopback (`opuspopuli-node` #70, merged). Post-release check through Cloudflare **PENDING** |
| 3 | Crawler and signed-out load overwhelms the Studio | Medium × Likely | Measured: 3–4 requests per page, under one origin request a second for a full crawl. Edge-cached sitemaps and metadata; per-client limits; new 429 and latency alerts |
| 4 | Indexed pages spread inaccuracy or misattribution | High × Possible | #962 disclaimers on every surface and in a one-time notice; AI label warns of errors; receipts (#1450). No counsel review, by owner decision 2026-11-25 |
| 5 | Signed-in users regress | Medium × Rare | Both modes covered in unit tests and e2e; signed-in path driven live with a real account (6/6) |
| 6 | A signed-out page sends an account-only query and triggers a session refresh or redirect | Medium × Possible | A signed-out Playwright spec fails on any account-only field; found and fixed `I18nProvider`'s `myProfile` read |
| 7 | The release fails to build | High × Likely if unmitigated | Found on a production build (`useSearchParams` outside Suspense once the wall was gone); fixed in `bef12c43` |
| 8 | The frontend ships before the backend's new queries | Medium × Possible | Release order: backend `v*` first, then `frontend-v*` |
| 9 | Crawls exhaust the Worker's shared budget, so some pages are indexed with generic titles | Low × Possible | Optional signed edge-read budget built but not configured, by owner decision; `GatewayRateLimitingReaders` is the trigger to configure it |
| 10 | GPL dependency | Low × Rare | No new dependencies; licence check passed |
| — | Migration safety | — | No migration |

## Verification evidence

- **Gated stages** (`scripts/stack.ts`, as `.husky/pre-push` runs them), on `f1ae8013`:
  - test passed (backend 4,078, frontend 2,106; 8,371 across 19 packages, with coverage floors enforced per jest config);
  - duplication passed (0 clones);
  - Sonar lint passed;
  - dependency audit passed (49 advisories, none HIGH or CRITICAL);
  - licence check passed.
- **E2E:** 355 Chromium tests pass (12 skipped by their own conditions) on a **production build**, including `e2e/region-signed-out.spec.ts`.
- **Behavioural (`/op-verify`, 2026-11-25),** on a production build against UAT rebuilt from this branch, with the live Census geocoder and PostGIS:
  - signed-out journeys 23/23;
  - gateway edge cases 10/10;
  - signed-in regression 6/6;
  - personal-data observation clean after the audit fix.
  - Details are in the plan's "Behavioural verification" section.
- **Not drivable on UAT:** hiding the in-app contact form from visitors. No UAT representative has an email on file; a unit test covers it.

## Security evidence

- **Personal-data scan:** passed, 0 findings on the diff.
- **`/op-security` (CVEs, filesystem, secrets):** **PENDING.**
- **Pre-push AI reviews (`/op-review`, `/security-review`, hook stages 7–8) and the Trivy scan:** **PENDING** until the push.
- **Security-relevant design:**
  - the client IP is resolved from Cloudflare, not the client;
  - per-client GraphQL limits;
  - the lookup is mutation-only;
  - `@SkipAudit` on location operations;
  - the edge-read signature is HMAC-SHA256 over path and query, 5-minute window, GET only, constant-time compare, inert without a secret;
  - the secret is never in `.env`, which OpenNext bundles.

## Rollback

- **Frontend:** redeploy the previous `frontend-v*` tag, or `git revert` the frontend commits. That restores the sign-in wall and the previous header, landing page and indexing rules. Signed-out visitors keep only district ids in `localStorage`, which the old build ignores.
- **Backend:** the changes are additive: a new public query, two `@SkipAudit` decorators, a metrics middleware, and a budget that's inert without a secret. They're safe to leave in place under an older frontend; otherwise redeploy the previous `v*` tag.
- **Order:** roll back the frontend first, then the backend.
- **No migration and no data change,** so nothing needs reversing in the database.
- **Persisted Apollo cache:** the key is bumped to v4. An older build purges it under its own key on next load.

## Approval

| | |
|---|---|
| **Record approved by** | Rodney Gagnon, in session, 2026-11-25: approved the record's contents as an accurate account of the change. Not a release approval |
| **Approved for release to production by** | **PENDING** (after independent review and the pre-push gate) |
| **Meaning of release approval** | The change was planned, independently reviewed, tested and verified as recorded above, and is reversible as described |
