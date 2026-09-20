# Plan of record — #1291: `Claim` / `Evidence` relational core

| | |
|---|---|
| **Issue** | [opuspopuli#1291](https://github.com/OpusPopuli/opuspopuli/issues/1291) — sub-issue of [#1208](https://github.com/OpusPopuli/opuspopuli/issues/1208) (M2 — Evidence Graph), scope item 1 |
| **Date** | 2026-09-19 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/claim-evidence-core-1291` |
| **Data classification** | Public civic records. Evidence spans index into stored source text that can contain proponent contact details (#1263) — the same exposure `SourceVersion` already carries, not widened. Nothing renders a raw span without redaction. |
| **Depends on** | #1207 / R4 (merged): `SourceVersion`, rows→producing run, `analysisSourceTextHash` |
| **Reads first** | `docs/plans/1276-source-version-store.md`, `docs/plans/1279-analysis-source-text-hash.md` |

## 1. The epic's premise needs one adjustment

#1208 says "each `Evidence` pinned to a `SourceVersion` (from #1207) plus a
character span". Measured 2026-09-19: **no existing claim can be pinned to
one.** `source_versions` shipped in this cycle and only fills when a sync runs
with archiving enabled, so for the 528 proposition claims, 48 minutes rows and
124 representative rows there is nothing to point at.

The deeper problem is that the spans do not index into source bytes at all:

```
SourceVersion        immutable fetched bytes (HTML / PDF)
      |  derivation
propositions.fullText   mutable — upserted in place on every re-scrape
      |  character offsets
claim.sourceStart / sourceEnd
```

A character offset into `fullText` is not an offset into the archived HTML.
"Pin to a SourceVersion + span" cannot be the only anchor without a byte-offset
translation that does not exist and would be lossy if it did.

## 2. The anchor: two references, each nullable for a stated reason

| Field | Meaning | Null when |
|---|---|---|
| `sourceVersionId` | the immutable fetch this ultimately derives from | no archive existed when the claim was generated — true of every claim that exists today |
| `sourceTextHash` | SHA-256 of the **derived text** the span indexes into | never, for a span-bearing claim |
| `spanStart` / `spanEnd` | offsets into that derived text | the claim carries no span (`bio_claims`) |

Read-time re-derivation is therefore: load the current derived text, **verify
its hash equals `sourceTextHash`**, then slice.

A mismatch is not an error — it is the answer. The text changed after the claim
was made, so the evidence is stale and must be reported as such rather than
silently re-sliced against different text. This is exactly what #1279's
`analysisSourceTextHash` was built to detect, reused rather than reinvented.

This satisfies the acceptance criterion ("re-derived from the source at read
time rather than trusted from a denormalized copy") while being honest that the
immutable-bytes link is absent for everything that exists today and present for
everything generated from now on.

## 3. Generalise `LegislativeAction`, do not invent a second shape

`region-query.service.ts` (~1000-1030) already resolves a span correctly for one
entity: load `minutes.rawText`, slice `[passageStart, passageEnd]` under a
1024-character cap, and return ±500 characters of context snapped to whitespace.

The epic names it as the read model to generalise. This lifts that logic into a
shared resolver the new model uses rather than writing a parallel one.

## 4. Subtasks

| # | Work | Migration |
|---|---|---|
| **S1** | `Claim`, `Evidence`, `ClaimEvidence`, `ClaimRelation` models | additive; `prisma migrate` + `down.sql` |
| **S2** | Read-time span resolution with hash verification, generalised from `LegislativeAction` | — |
| **S3** | `ClaimRelation` kinds: supports / contradicts / qualifies / supersedes | — |
| **S4** | Integration tests against a real database | — |

## 5. Explicitly out of scope

- **No backfill** (#1294) and **no dual-write** (#1293). Both are gated on the
  verifier (#1292), because importing today's offsets into a table named
  `Evidence` would launder roughly 98% unverified assertions into first-class
  evidence — measured: the write path clamps offsets into range, and #1212
  measured ~2% genuinely anchored on this contract.
- **No read-path cutover.** Nothing reads the relational model as authoritative
  in this issue.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Evidence implies verification it does not have | **high** × likely | This issue writes no claims. The only writer is #1293, through the #1292 gate. The schema has no "verified" default |
| Span resolution trusts a stored copy | high × possible | Resolver slices the live derived text and verifies the hash first; an integration test changes the text and asserts staleness is reported |
| A second span-resolution shape diverges from `LegislativeAction` | medium × likely | Generalise the existing one; do not add a parallel implementation |
| Nullable `sourceVersionId` read as "no provenance" | medium × possible | Documented on the model: null means the claim predates archiving, which is distinct from a claim whose source is unknown |
| Cross-service claim-table joins | high × rare | Region owns the evidence graph; access from other services is via federation reference resolvers. No direct join introduced here |
| `db push` re-drops raw-SQL indexes (#1168) | high × rare | `prisma migrate` only, with `down.sql`. Resolved in `v1.27.0`, but the rule stands |

## 7. Effort

~1 focused session. The schema is the small part; the span resolver and its
staleness semantics are where the care goes.

## 8. Operational note found while scoping

The **dev database is 6 migrations behind** `postgres_test`
(`20260913120000_capture_detection_telemetry` vs `20260919100000_bulk_archive_tier`),
so M1's tables do not exist there. Not caused by this work and not blocking it —
but `prisma migrate deploy` against dev would make the two agree before more
schema lands.
