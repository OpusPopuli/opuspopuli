# Plan of record — #1296: make "every assertion lacking primary evidence" answerable

| | |
|---|---|
| **Issue** | [opuspopuli#1296](https://github.com/OpusPopuli/opuspopuli/issues/1296) — sub-issue of [#1208](https://github.com/OpusPopuli/opuspopuli/issues/1208), the epic's **target property** |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/unevidenced-assertion-gauge-1296` |
| **Data classification** | Public civic records. The gauge emits counts only — never claim text, never source text. The resolve path returns a passage of public civic text to an admin-guarded caller. |
| **Depends on** | #1291, #1292, #1294 (all merged) |
| **Why now** | Step 1 of the refresh plan (roadmap §6.4). "Test until convinced" needs the number **watched**, not asked once — and it must instrument the baseline *before* anything is regenerated |

## 1. The property, and what it costs today

> Show every published assertion that lacks primary evidence.

Before #1291–#1294 this was not a hard query, it was an impossible one. It is
now a `groupBy`. This issue turns it from a query someone could write into a
number that is watched.

## 2. The measured starting point

From #1294, against the pre-refresh corpus:

| Family | claims | lacking verified evidence | |
|---|---|---|---|
| propositions | 528 | **469** | 88.8% |
| minutes | 218 | **113** | 51.8% |
| representatives | 751 | **751** | 100% |
| **total** | **1,497** | **1,333** | **89.0%** |

Representatives are 100% by construction, not by failure: bio claims cite
structured fields, so nothing in that family can ever reach `verified` against
a text span. **This is exactly why the gauge must be labelled per family** — an
aggregate would let 751 structurally-unverifiable claims swamp the 469 that
genuinely failed a check, and the number would stop meaning anything.

## 3. What the gauge must not do

#1278's lesson, applied: **a failed measurement must not publish a false zero.**
Production backups died unnoticed for 49 days because nothing measured
freshness. So the failure path deliberately leaves the value gauges untouched
and only the freshness gauge moves — a stale number is then visible as stale
rather than reading as a healthy zero.

Zero unevidenced claims and "we could not measure" must not render identically.

## 4. Scope

| # | Work |
|---|---|
| **S1** | The query: claims with no `verified` evidence, grouped by family |
| **S2** | Gauges — total, unevidenced, full state distribution, and measurement freshness. Labelled by `subject_type` |
| **S3** | Resolve-to-bytes: claim → evidence → `SourceVersion` → the passage, re-derived at read time and hash-checked |
| **S4** | Integration tests on a real database, including the failure path and the no-false-zero discipline |

## 5. The honest gap in AC 3

**`Evidence.sourceVersionId` is never populated.** Measured: `source_versions`
has **0 rows** and `propositions.pipeline_execution_id` is **NULL on every
row** — #1276 built the store and #1280 built row provenance, but no sync has
run since either landed.

Linking them needs the id to travel from the archive write, through the
pipeline, onto the subject row, and thence to the evidence — a chain across
`extraction-provider`, `scraping-pipeline`, `common`, the schema and `region`.
`ISourceArchive.archive()` returns `void` today, so the id is not even
available to propagate.

That is its own issue, filed as #1306. **What this issue delivers is the
consuming half**: the resolve path exists, is hash-checked, is tested against
seeded data, and reports "no archived source" honestly when the link is absent
— which is every row today. Building the consumer first means the producer has
something to satisfy rather than the other way round.

Stating it plainly rather than letting a green test imply a working chain: this
path is **inert on real data until a sync runs**.

## 6. Federation

The gauge and the query read `region`'s own tables only. No service reads or
joins another service's claim tables; cross-service access stays via reference
resolvers validated at the gateway, per the epic's constraint. Nothing here
adds a join across a bounded context.

## 7. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| A failed measurement publishes zero and reads as "fully evidenced" | **high** × likely | Failure path never touches value gauges; freshness gauge is the tell (#1278) |
| Aggregate gauge hides which family is unevidenced | **high** × certain if unlabelled | Labelled by `subject_type`; 751 structurally-unverifiable bio claims would otherwise swamp 469 genuine failures |
| A green resolve test implies a working source chain | **high** × likely | §5 states the gap; the test asserts the honest "no archived source" result for an unlinked row, not just the happy path |
| Gauge query cost grows with the corpus | medium × possible | `groupBy` over indexed `state` and `(subject_type, subject_id)`; 5-minute cron, not per-scrape |
| Resolve path returns a passage from text that changed | medium × possible | Hash-checked through `resolveEvidenceSpan`; a stale span refuses rather than returning the wrong characters |
| Exposing claim internals publicly before the read shape is decided | medium × possible | Resolve query is admin-guarded; the public surface is a later decision |

## 8. Verified against the real corpus

Not a mock and not a fixture: the region service rebuilt, booted in its
container, and published these against the live database — matching #1294's
independent measurement exactly.

```
claims_total{proposition}=528        {minutes}=218   {representative}=751
claims_unevidenced{proposition}=469  {minutes}=113   {representative}=751
claim_evidence_state{proposition,verified}=59   {minutes,verified}=105
```

That also settles the question unit tests cannot answer — DI resolves and
`onModuleInit` fires — which is the precise way #1278 shipped a metrics
service that constructed fine and never ran.

## 9. Effort

~1 session.
