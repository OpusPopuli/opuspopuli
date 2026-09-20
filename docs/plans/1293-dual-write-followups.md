# Plan of record — #1293 follow-ups: the review suggestions, fixed

| | |
|---|---|
| **Issue** | Follow-up to [opuspopuli#1293](https://github.com/OpusPopuli/opuspopuli/issues/1293) (merged as [#1300](https://github.com/OpusPopuli/opuspopuli/pull/1300)) |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `fix/claim-dual-write-followups-1293` |
| **Data classification** | Public civic records. No change to what is stored or emitted, beyond raising one log line's level — that line carries `subjectType`, `subjectId` and an error message, never claim text. |

## Why this exists

`/op-review` on #1293 produced five suggestions. One was fixed in that PR;
four were reported and deferred **without being filed**, which is the same as
dropping them. The owner's standing instruction is to fix review suggestions by
default. This closes the four.

## 1. Concurrent regeneration duplicated a subject's claims

Under READ COMMITTED two writers on one subject both read the same stale id
set, one delete wins, and both inserts land — leaving two complete sets of
claims, indistinguishable and both apparently current. The realistic collision
is #1294's backfill sweeping a family while a generator regenerates a row in
it.

Fixed with a transaction-scoped advisory lock keyed on `subjectType:subjectId`.
It releases on commit or rollback, needs no schema, and does not block writers
on any other subject.

## 2. Bio skipped the mirror when a generation produced no claims

`if (rep.bioClaims?.length)` meant an empty array — a real generation that
produced nothing — left the superseded relational claims standing while the
blob was overwritten with `[]`.

The condition now tracks the blob's own exactly: `if (rep.bioClaims)`. An empty
array mirrors and clears; `undefined` (tier-2 salvage, where only the bio
string survived parsing and the blob **keeps** its previous claims) leaves the
rows alone. Both cases have a test, and they assert opposite things.

## 3. An unexpected confidence value could lose the whole claim

`confidence` was `VARCHAR(10)`, sized for the three words the generators
report. A longer value raises P2000, and dual-write swallows its errors by
design — so one odd string would silently discard the claim, over a field whose
own comment says it is never a substitute for verification.

Two halves: the column widens to `VARCHAR(32)`, and the normaliser drops a
value that still would not fit rather than truncating it. Losing the confidence
is acceptable; losing the claim is not, and storing a truncated value the
generator never said is worse than storing nothing.

## 4. Three statements per claim, now three per subject

Ids are minted with `randomUUID()` rather than read back, so the join never has
to assume `createMany` returned rows in the order given. A 20-claim proposition
goes from ~60 round-trips to 3.

## 5. A lost dual-write logged at `warn`

Raised to `error` in all three generators. The claims were not written, and
nothing reads these tables yet (#1296), so the log line is the only signal
there is until that gauge exists.

## What was NOT done, and why

- **A `dual_write_failures` metric.** It belongs with #1296's gauge, which owns
  the observability surface for this model. Adding a counter here would mean
  injecting metrics into `LlmGeneratorBase` — the DI coupling #1293
  deliberately avoided, and the source of three wiring failures this milestone.
- **Migration tests against a *populated* database** (from #1301's review). Real
  and worth doing; it is infrastructure work on the integration harness rather
  than a change to this code, and is filed separately.
- **One suggestion was withdrawn as wrong.** The #1301 review flagged a
  NULL-hash edge in the stale-candidate query; the query already carries
  `fullText: { not: null }`, so it cannot occur.

## Verification

Every fix verified by **reintroducing the defect**:

| Fix | Reintroduced | Result |
|---|---|---|
| Advisory lock | removed the lock | race test fails |
| Bio empty-array | restored `?.length` | empty-list test fails |
| Confidence guard | restored `text(...)` | claim-survives test fails |
| Log level | — | asserted at `error`, with `warn` asserted clean |

975 unit tests across 51 suites, 11 dual-write integration tests, `tsc` clean
on a cold cache, sonar lint clean, `build:region` clean.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Advisory lock serialises more than intended | medium × rare | Keyed per subject, transaction-scoped; a backfill over distinct subjects is unaffected. Test covers the same-subject case |
| `hashtextextended` collision locks two unrelated subjects | low × rare | 64-bit; a collision costs brief serialisation, never incorrect data |
| Batched `createMany` changes failure granularity — one bad row fails the batch | medium × possible | Already the case: the whole thing is one transaction, so a mid-loop failure rolled everything back before too |
| Widening `confidence` on a table with rows | low × rare | Widening is non-destructive; `down.sql` truncates explicitly |
| `error`-level logging becomes noisy if dual-write fails systematically | low × possible | That is the intent — a systematic failure should be loud. #1296 replaces it with a counter |
