# Plan of record — #1295 (supersession half): temporal validity on claims

| | |
|---|---|
| **Issue** | [opuspopuli#1295](https://github.com/OpusPopuli/opuspopuli/issues/1295) — sub-issue of [#1208](https://github.com/OpusPopuli/opuspopuli/issues/1208), scope items 2 and 4 |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/claim-supersession-1295` |
| **Data classification** | Public civic records. Retains claim rows that were previously deleted; no new data class, no new surface. |
| **Why now** | Step 2 of the refresh plan (roadmap §6.4) — without it the first OLMo pass destroys the measured baseline and every later pass destroys the one before |

## 1. Scope: the claims half only

#1295 bundles two things. **This delivers the first**: `validFrom` / `validUntil`
on claims, so applicability is expressible rather than implied by "the row
exists", and point-in-time reconstruction is a query.

**Deferred**: minutes-style row versioning for propositions and bills. That is
substantially larger and does not serve the model switch. Filed separately.

## 2. The problem it solves for the refresh

`recordClaims` **deleted** a subject's prior claims. So run N overwrote run
N−1: there was nothing to compare a model change against, and no way to tell
whether it helped. Iterating on a model without this is not iterating, it is
overwriting.

It also erased the answer to "what did we assert about this measure last
month", which a civic platform should be able to answer about its own output.

## 3. The tension, and how it resolves

Supersession and idempotency pull against each other. #1294 requires a re-run
to converge; naive supersession piles up a dead generation on **every** backfill
run and breaks that outright — verified by reintroduction, which fails
#1294's idempotency test as well as this issue's own.

**Resolution: supersede only when the content differs.** A stable signature over
claim text, subject field, confidence, span, quote, hint **and verdict state**
decides. Identical re-run is a no-op; a genuine regeneration is retained.

Two judgements inside that signature:

- **Sorted**, because claim order is the model's and carries no meaning. A
  reordered but otherwise identical generation is not a new assertion, and
  treating it as one would supersede the whole corpus on every run.
- **Verdict state included**, because the same claim text checked against
  rewritten source text is a genuinely different assertion *about the
  evidence*, and must be retained as one.

## 4. Every reader had to learn the filter

Four sites. Missing one inflates `claims_unevidenced` with each regeneration,
so the gauge would appear to worsen precisely as the corpus improved:

| Site | Change |
|---|---|
| `claim-evidence-metrics` ×2 `groupBy` | `validUntil: null` |
| `countEvidenceByState` raw SQL | `WHERE c.valid_until IS NULL` |
| `claim-backfill` `readDistribution` | evidence of current claims only |
| `claim-source-resolver` | **still resolves superseded claims** — historical tracing is the point — and now reports `superseded` so a caller cannot present a retired assertion as current |

## 5. Verification

Every guard verified by **reintroducing the defect**:

| Guard | Reintroduced | Result |
|---|---|---|
| Current-only gauge filter | dropped the filter | gauge test fails |
| Identical-run no-op | removed the short circuit | supersession **and #1294 idempotency** both fail |
| Supersede not delete | reverted to `deleteMany` | 5 tests fail |

998 unit tests / 54 suites, 50 claim integration tests across 6 suites, `tsc`
clean cold, sonar lint clean, `build:region` clean. Migration applied to the dev
database: 1,497 claims, all current, none superseded.

## 5a. Five findings from reviewing this change, all fixed here

1. **`signatureOf` read only `evidence[0]`.** `claim_evidence` is many-to-many,
   so a change to any citation beyond the first would have been invisible — a
   genuine regeneration mistaken for a no-op and that generation lost. Now
   every evidence row contributes.
2. **The first test of that fix did not guard it.** It attached a *differing*
   second citation, so it passed or failed on which row the relation happened
   to return first — nothing orders them. Rewritten to attach an **identical**
   one, which makes the outcome the same whichever comes back first, and
   verified by reintroduction.
3. **The signature re-serialised every tuple on every comparison** and used a
   comparator that never returned 0 for equals. Each tuple is now stringified
   once and the strings sorted.
4. **The point-in-time test slept 25ms** to separate two `new Date()` stamps —
   a flake waiting for a slow or fast machine. It now takes the instant from
   the stored row, which is inside the window by construction.
5. **Retention was unmeasured.** Added `claims_superseded{subject_type}`, so
   growth across repeated refreshes is watched rather than discovered — the
   argument that put a freshness gauge beside the source store after backups
   died unnoticed for 49 days (#1217). A **partial index** on the current rows
   was added with it: the gauge asks "all current claims by family" with no
   subject to anchor on, which the composite index cannot serve.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| A reader forgets the filter and counts dead claims | **high** × likely | All four enumerated and tested; gauge guard verified by reintroduction |
| Supersession breaks #1294's idempotency | **high** × certain without §3 | Content signature; both tests fail together if removed |
| History grows without bound over many refresh runs | medium × possible | Only genuine changes create a generation; a quiet corpus costs nothing. Retention policy is a later decision, once the growth rate is observable |
| Reordered claims read as a new generation | medium × likely | Signature is sorted |
| A superseded claim is presented as current | **high** × possible | Resolver reports `superseded`; readers filter by default |
| Point-in-time query ambiguous at the boundary | low × possible | `validFrom <= T AND (validUntil IS NULL OR validUntil > T)`; the test inserts a deliberate gap because the stamp is millisecond-resolution |

## 7. Effort

~1 session.
