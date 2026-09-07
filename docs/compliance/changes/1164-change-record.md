# Change Record — #1164 Sonoma propositions: linkDiscovery hub navigation

> SOC 2 CC8.1 change-management record. Fields marked **PENDING** are closed at
> PR review / release time; `/op-validate` collects this record into the
> release evidence pack and must not accept it with pending fields.

| Field | Value |
|---|---|
| **Change ID** | `1164-sonoma-propositions-link-discovery` |
| **Linked issues** | [#1164](https://github.com/OpusPopuli/opuspopuli/issues/1164) (primary); minimal slice of #1139; closes the #731 backfill caveat |
| **Date** | 2026-09-07 |
| **Branches** | `opuspopuli @ fix/sonoma-propositions-link-discovery-1164` (6a2d2c0f, 9fb9c842, 8e06e8dc, 27ba857c + this record); `opuspopuli-regions @ fix/propositions-link-discovery-1164` (57b4ef6, 1de422b) |
| **Author** | Rodney Gagnon `<rodneygagnon@mac.com>` with Claude Fable 5 (co-authored, AI-assisted; plan self-authored by Claude, human-approved in-session 2026-09-07) |
| **Reviewer(s)** | **PENDING — no PR opened yet.** Separation of duties: currently self-review; requires independent PR review or explicit countersignature before merge (the plan header carries the countersign note) |
| **Plan of record** | [`docs/plans/1164-sonoma-propositions-link-discovery.md`](../../plans/1164-sonoma-propositions-link-discovery.md) (committed in 6a2d2c0f) |

## What changed and why

Sonoma's `propositions` sync persisted 0 measures because (1) the configured
source is a 2-hop hub and the pipeline had no way to reach the per-election
"List of Local Measures That Have Been Filed" leaf, and (2) the config's
extraction hints promised field names `PropositionSchema` rejects, so even
correct extractions were dropped in domain mapping (`parseOrCollect`). The
change adds a declarative `linkDiscovery` capability (regions schema +
`@opuspopuli/common` types + a deterministic, host-scoped navigator in
`@opuspopuli/scraping-pipeline` that runs the standard manifest→extract→map
flow once per leaf, with a loud zero-match staleness alarm), rewrites the
Sonoma source config and hints, and lands the minimal #1139 jurisdiction
slice: an additive `region_plugin_name` column (DEFAULT `'california'` doubles
as the backfill) stamped by both sync write paths, with the stage-id backfill
now region-scoped.

## Data classification

Public ballot-measure records only. Repo profile `us-state-privacy` + `soc2`:
no CCPA personal information is collected, stored, logged, or sent to a model
by this change; the navigator is restricted to the seed's HTTPS government
host; measure *argument* pages (which can name individuals) are deliberately
not extracted. `/op-data-scan`: not run — no regulated data class touched;
run at PR prep if policy requires.

## Risk register (from the plan of record)

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Effective-URL manifest keying regresses existing `html_scrape` sources | high × possible | `linkDiscovery`-gated branch; default path untouched; regression specs |
| County text/structure change breaks step patterns | medium × likely (eventually) | Zero-match step = loud pipeline error; one-line regex fix path |
| Per-cycle leaf cold start yields 0 rows on first sync | medium × likely | Standard async-analysis design; documented; daily cron self-resolves |
| #1139 lands in parallel → conflicting migrations | medium × possible | #1139 state checked before implementing; migration additive-only |
| LLM manifest targets wrong container on leaf page | medium × possible | Precision hints (OAG prior art); `staticManifest` escape hatch |
| Global `externalId` collision state vs county | high × rare | County-prefixed externalId scheme; asserted at sync verification |
| Election page with no measures link yet | low × likely | Per-page soft warning; only all-pages-zero errors |
| AGPL-3.0 dependency constraint | — | No new dependencies |
| Regulated-data exposure | — | None (public records) |

## Verification evidence

- **Unit/integration** (2026-09-07, local): scraping-pipeline 26/26 suites,
  443 tests (15 new); backend 151/151 suites, 2539 tests (4 new jurisdiction
  tests); opuspopuli-regions 16/16 suites, 519 tests (9 new). Full recursive
  suites re-ran green in every pre-commit hook of the commit series.
- **Behavioral** (`/op-verify`-equivalent, environment-limited): the committed
  Sonoma config driven through the real `LinkDiscoveryService` against the
  live sonomacounty.gov resolved exactly
  `…/november-3-2026-general-election-local-measures-that-have-been-filed`
  (11 measures listed at time of run); `maxLeafPages` cap and per-page
  soft-warning behaviors observed as designed.
- **PENDING**: full DB-backed Sonoma sync (expect ≥11 rows,
  `region_plugin_name = 'california-sonoma'`) — blocked on the regions
  package publish + `@opuspopuli/regions` bump; a release-gate step.

## Security evidence

- `/op-security`: **PENDING** (run at PR prep).
- Mandatory pre-push gates `/op-review` + `/security-review`: **PENDING —
  nothing pushed yet**; required before `git push` per repo policy.
- No new dependencies introduced; attack-surface delta is parsing government
  HTML already in the pipeline's scope, with host/HTTPS scoping added.

## Rollback plan

- **Code**: revert the 4 monorepo feature commits (no external consumer of the
  new API yet) and the 2 regions commits, or pin `@opuspopuli/regions` to the
  prior published version (Sonoma config `0.8.3`).
- **Migration** (`20260907000000_proposition_region_plugin_name`): additive
  column + index. Safe to leave in place on rollback (writes simply stop);
  full reversal is `DROP INDEX propositions_region_plugin_name_idx; ALTER
  TABLE propositions DROP COLUMN region_plugin_name;` — no data loss beyond
  the jurisdiction labels themselves.
- **No feature flag needed**: sources without `linkDiscovery` are on the
  unchanged code path; disabling the behavior = removing the config block.

## Approval

**PENDING.** No electronic signature is recorded. Approval meaning "approved
for release to production" is captured at PR merge + release tag by an
identity other than the author, or by explicit countersignature of the
self-review. Do not backfill this field — record who, when, and what was
attested at the time it happens.
