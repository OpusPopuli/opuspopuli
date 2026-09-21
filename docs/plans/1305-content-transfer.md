# Plan of record — #1305: transfer locally-regenerated AI content to production

| | |
|---|---|
| **Issue** | [opuspopuli#1305](https://github.com/OpusPopuli/opuspopuli/issues/1305) — roadmap §6.4 step 3 |
| **Date** | 2026-09-21 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/content-transfer-1305` |
| **Data classification** | Public civic records **only**, enforced structurally: the tool names the tables it carries and cannot be pointed at others. No `users`, `user_profiles`, `user_addresses`, `signal_profiles`, `sensitive_profiles`, `documents` or `audit_logs`. |
| **Why now** | Built *before* the refresh, so a multi-day result is never held with no safe way to move it. Its pre-flight is also what confirms the transfer window is still valid when it is used. |

## 1. Preconditions, re-verified 2026-09-21

| | |
|---|---|
| `full_text` md5, local vs prod | `6eaf8ba6…` — **identical** |
| prod `claims` table | **absent** (9 migrations behind, at `20260913120000_capture_detection_telemetry`) |
| analysed propositions | 54 both sides |

**Production must be migrated before any transfer.** That is a release, and
#1301's fix is in the chain — so it will now succeed rather than failing on
the 15 propositions whose `full_text` contains a backslash.

## 2. The design decision: re-derive evidence, do not transfer it

The bundle carries claim **content** — text, subject field, confidence,
citation. The import calls the same `recordClaims` the generators use, which
re-runs the verify-or-snap gate **against the target's own text**, and then
asserts the resulting verdict distribution equals the bundle's.

Better than copying verdicts, for a reason that matters on this platform:
copied evidence is *trusted*, re-derived evidence is *verified*. It reuses the
gate rather than adding a second path that could disagree with it — the drift
that #1212 and #1292 both had to correct — and it removes the entire
evidence/`claim_evidence` UUID remapping problem, because nothing about
evidence is transferred at all.

## 3. Natural keys, measured not assumed

| Table | Unique key |
|---|---|
| `propositions` | **`(region_plugin_name, external_id)`** — composite |
| `minutes` | `external_id` |
| `representatives` | `external_id` |

The composite key corrects the issue body, which said "keyed on `external_id`".
Primary keys diverge between databases (proposition and representative UUIDs
differ; minutes happen to match, which is a coincidence to exploit carefully
rather than rely on), so the natural key is the only safe join.

## 4. Fail-closed rules

1. **The target row must already exist.** Civic rows are sync's job; a missing
   row is reported, never inserted.
2. **The source text hash must match.** If the target's `full_text` /
   `raw_text` differs, the analysis does not belong to that text — refuse that
   row and name it.
3. **Never delete what the target has and the source lacks.** Production
   carries one more `bio_claims` row than local; a mirror would silently drop
   it. Upsert only — absence locally means "no opinion", not "delete".
4. **Per-subject, idempotent resume — not one transaction.** The plan first
   said single transaction, following `scrub-pi.sql`. That was wrong for this
   shape: a transaction spanning every subject holds `recordClaims`'
   per-subject advisory locks for its whole duration, blocking any generator
   touching those rows for minutes — and Prisma cannot nest the interactive
   transaction `recordClaims` opens inside an outer one anyway. What makes
   per-subject safe is that the transfer is **idempotent**: a run that dies at
   subject 40 is repaired by running it again, because the blob upsert writes
   the same values and `recordClaims` no-ops on unchanged content (#1295).
   Failures are counted and named so a partial run cannot pass for a clean one.
5. **Dry-run by default.** This is the first tool that writes production data
   from a developer's machine; applying requires an explicit `--apply`, and a
   pre-flight reports everything it would refuse *before* anything is written.

## 5. Transport: a file, deliberately

Evaluated and rejected, recorded on the issue:

- **Logical replication** — cannot transform a value in flight, so
  `claims.subject_id` would arrive holding local UUIDs; it is continuous, so
  every intermediate experiment streams to production; and there is nowhere to
  put the pre-flight check.
- **`postgres_fdw`** — fits the shape, but requires production to open an
  outbound path to a developer machine for a job that runs a handful of times.

A JSON bundle is inspectable and auditable *before* it is applied. For a rare,
high-consequence, one-directional move, a reviewable artifact beats a live
connection.

## 6. Subtasks

| # | Work |
|---|---|
| **S1** | Bundle format + `export.ts` — JSON with a manifest: counts, source identity, and the prompt/model provenance the content was generated under |
| **S2** | `import.ts` — pre-flight verification reporting every refusal before writing |
| **S3** | Claims via `recordClaims` re-derivation, distribution equality asserted |
| **S4** | Integration tests on a real database: round-trip, UUID divergence, text-mismatch refusal, target-only content preserved, idempotency |

## 6a. Findings from review, all fixed here

- **The export predicate was a no-op.** `{ analysisClaims: { not: undefined } }`
  reads as "no filter" in Prisma, so the query returned **69** propositions
  instead of 54 and only a later guard narrowed it — loading full source text
  for rows that were never going to be exported. `Prisma.DbNull` is the
  predicate `claim-backfill.service.ts` already uses; measured 69 vs 54 to
  confirm.
- **The plan's single transaction was wrong**, for the reasons in §4.4.
- **`process.exit()` can truncate buffered stdout**, and on a dry run the
  refusal list is the entire output. Uses `process.exitCode` instead.
- **A skipped distribution check read as a passing one.** It now says why it
  is not asserted when refusals are present.

## 7. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Personal data reaches the bundle | **critical** × rare | Table list is a closed constant, not a parameter; asserted by a test that the bundle contains no other table |
| An analysis is written onto text it was not generated from | **critical** × possible | Source-text hash verified per row; mismatch refuses and names the row |
| Production content silently deleted | **high** × possible | Upsert only; target-only rows asserted preserved by a test |
| Half-applied transfer | **high** × rare | Single transaction |
| Accidental write to production | **high** × possible | Dry-run by default; `--apply` required |
| Prod `full_text` changes between export and import | medium × possible | Pre-flight re-verifies at apply time, not only at export |
| Re-derived verdicts differ from the source's | medium × possible | Distribution equality asserted; a difference refuses rather than warns |
| Transfer run before prod is migrated | **high** × likely | Absent `claims` table detected in pre-flight with a clear message |

## 8. Effort

~1 session.
