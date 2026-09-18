# Plan of record — #1276: `SourceVersion`, a content-addressed store for cited sources

| | |
|---|---|
| **Issue** | [opuspopuli#1276](https://github.com/OpusPopuli/opuspopuli/issues/1276) — sub-issue of [#1207](https://github.com/OpusPopuli/opuspopuli/issues/1207) (M1 Provenance foundation), scope item 1, tier 1 of 2 |
| **Date** | 2026-09-18 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/source-version-store-1276` |
| **Data classification** | **Public civic records that contain personal data** — see §4. This corrects the issue text. |
| **Blocks** | #1277 (bulk-archive tier), #1278 (store observability), #1208 (Evidence Graph) |
| **Reads first** | `docs/plans/ai-architecture-gap-analysis.md` §"Layer 3 — Immutable source storage + hashing", `docs/plans/1212-claim-anchoring-quote-then-locate.md`, `docs/plans/1279-analysis-source-text-hash.md` |

## 1. Why

A claim cites a passage. Today the only thing to check that citation against is
whatever `fullText` holds *now*, and `propositions-sync.service.ts:154-175`
upserts `fullText` in place. The artifact the scrape actually fetched is gone —
nothing durable, no content hash, no validators, no fetch timestamp.

#1279 bound claims to the *text version* they cite (`analysisSourceTextHash`),
which detects that the text changed. It cannot show **what it changed from**.
This issue stores the bytes so that question has an answer.

`structureHash` does not fill the gap: it hashes a text-stripped HTML skeleton
by design (`structure-hasher.ts:100`), so content changes are invisible to it.

## 2. Three findings from the code that shape the design

### 2.1 "SHA-256 of the raw bytes" is not currently reachable on the text path

`fetchUrl` decodes via `response.text()`. The provider's own comment
(`extraction.provider.ts:243`) is emphatic that this is lossy: every byte
> 0x7F becomes U+FFFD and **cannot be reversed**. Hashing that string would
content-address a corrupted derivative — the archive would attest to bytes the
server never sent, which is worse than not archiving, because it looks
authoritative.

`fetchAndDecode` (`:381`) is a single generic choke point for both the text and
binary paths. Fix in one place: read `response.arrayBuffer()` once, hash the
`Buffer`, decode the text **from that same buffer**.

### 2.2 `extraction-provider` must not learn about the database

It is a provider package with no Prisma dependency. Giving it one breaks the
provider pattern and the bounded-context rule. Therefore the fetcher **returns**
`contentHash` + validators as data; the **region** service writes the
`SourceVersion` row. The write path stays in the context that already owns
civic data.

### 2.3 The issue's data classification is wrong

The issue states "No personal data enters this store." That is not true, and
the error should not be carried into a store whose whole point is permanence.
See §4.

## 3. Subtasks

| # | Work | Package / service | Migration |
|---|---|---|---|
| **S1** | Hash raw bytes and capture `ETag` / `Last-Modified` / `fetchedAt` at `fetchAndDecode`. Extend `CachedFetchResult`. Cached hits carry the stored hash through rather than recomputing it. | `packages/extraction-provider` | — |
| **S2** | `SourceVersion` model — unique on `contentHash`, nullable FKs to `PipelineExecution` and `StructuralManifest`, `bytea` payload. | `packages/relationaldb-provider` | additive; `prisma migrate` + `down.sql` |
| **S3** | `SourceVersionService` — `record()` (content-addressed, dedup, append-only) and `getByHash()`. | `apps/backend/src/apps/region` | — |
| **S4** | Wire cited-source fetches (propositions, minutes) to record a version. | region sync services | — |
| **S5** | Integration tests against a real database, including the dedup proof the AC requires. | `apps/backend/__tests__/integration` | — |

No GraphQL or federation change: retrieval stays internal for this issue.
#1208 (Evidence Graph) is what surfaces it.

## 4. Data classification — corrected

**The raw bytes of a cited source do contain personal data.** Proponent contact
details are in `propositions.full_text` (#1263) precisely *because they are in
the source document*. Archiving raw source bytes therefore ingests personal
data by construction.

What is true, and what the issue was reaching for, is that this does not
**widen** exposure:

- The store is internal — no GraphQL field, no render path, no API surface.
- Scan images remain unstored (`location: 'not-stored'`); user-submitted
  material is unchanged by this issue.
- Anything that later renders stored bytes must redact first —
  `redactContactDetails` in `@opuspopuli/common` (moved there in #1212) is the
  existing primitive.

This correction should be posted to the issue so the store is not built against
a false premise.

## 5. Storage decision — Postgres `bytea`, not object storage

Chosen for this tier, deliberately, and **the opposite choice is correct for
the sibling bulk tier (#1277)**:

- **Transactional with the hash row.** No window in which a hash exists whose
  bytes do not, which is the failure mode that would quietly void the evidence
  base.
- **Covered by a backup we have actually proven restorable** — 226 s, row
  counts exact including 18,055,411 contributions (`docs/runbooks/restore-drill.md`
  §7). Object storage has **no off-node copy at all**; that is a known open gap
  in the same runbook. Putting the evidence base somewhere unbacked defeats the
  tier's purpose.
- **`IStorageProvider` cannot enforce immutability** — it exposes `deleteFile`,
  and neither provider has bucket versioning or object lock. Immutability there
  is convention; in the database it is an append-only service contract plus
  the restore guarantee.

Accepted cost: 1–3 GB/yr against a 20 GB database lengthens restore time
proportionally. #1278's gauges are what tell us if the estimate was wrong.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| `arrayBuffer` refactor changes decode behaviour for existing scrapes | high × possible | Decode from the same buffer; assert byte-identical output against existing fixtures **before** wiring anything downstream |
| Hash captured on a cache hit diverges from the stored bytes | medium × possible | Hash travels *inside* the cached value; never recomputed from decoded text |
| Personal data in stored raw bytes (§4) | medium × likely | Internal-only, no render path; redact at any future render via `redactContactDetails` |
| Store growth lengthens restore time / RTO | medium × likely | Per-tier gauges (#1278); revisit tiering if growth exceeds 1–3 GB/yr |
| `db push` re-drops raw-SQL indexes (#1168) | high × rare | `prisma migrate` only, with a `down.sql`; never `db push` |
| Dedup assumed rather than demonstrated | medium × possible | AC requires a test proving an unchanged re-fetch stores no new bytes (S5) |
| AGPL-3.0 licence surface | low × rare | No new dependencies; Node `crypto` and existing Prisma only |

## 7. Effort

~1.5 focused sessions. S1 and S2 are independent and can land together; S3–S5
follow.
