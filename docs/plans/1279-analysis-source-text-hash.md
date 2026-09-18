# #1279 — Bind claims to the text version they cite

|                         |                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Issue**               | [#1279](https://github.com/OpusPopuli/opuspopuli/issues/1279) — sub-issue of #1207 (M1)       |
| **Date**                | 2026-09-17                                                                                    |
| **Author**              | Rodney Gagnon                                                                                 |
| **Base branch**         | `main`                                                                                        |
| **Branch**              | `feat/analysis-source-text-hash-1279`                                                          |
| **Data classification** | Public civic records + a content hash. No CCPA personal information in the new columns — but see §5 on #1263 |
| **Compliance profile**  | `us-state-privacy` + `soc2`; applicable class `ca-personal-information`                        |
| **Schema migration**    | **Yes** — additive, two columns, one of them `GENERATED ALWAYS … STORED`                       |
| **GraphQL / federation**| Only if S3 ships — additive field, validate at the API Gateway                                 |
| **Effort**              | ~2 focused sessions                                                                           |
| **Related**             | #1207 (M1), #1208 (blocked on this), #1212/#1274 (derived the offsets this binds), #1263, #1168 |

---

## 1. The problem

`propositions-sync.service.ts` upserts `fullText` **in place** without touching the
analysis columns. Staleness is caught only by a **timestamp** comparison, never by
a hash of the analysed text.

#1212 made this sharper rather than softer. Claim offsets are now **derived** by
locating a verbatim `sourceQuote` in `fullText`, so they are exact at the moment
of generation — and if `fullText` is later replaced, those stored offsets silently
address different characters. Deriving offsets correctly and then not binding them
to a text version is a half-built guarantee.

**This is explicitly the gap #1212 S5 left open.** S5 fixed the *prompt* axis:
`generateMissing` now selects rows whose `analysisPromptHash` differs from the live
hash. It deliberately did not cover the *source-text* axis, because Prisma cannot
express a column-to-column comparison and doing it in memory means fetching every
candidate's `fullText` to apply a cap — unbounded work.

## 2. Design

Two columns:

- **`analysisSourceTextHash`** — SHA-256 of the `fullText` the analysis was
  generated against. Direct sibling of the existing `embeddingSourceHash`, whose
  schema comment states the same rationale: *"sync runs often and fullText rarely
  changes."*
- **`fullTextHash`** — a Postgres **`GENERATED ALWAYS AS (…) STORED`** column over
  `full_text`.

### Why a generated column

The alternative is maintaining the hash in application code at every `fullText`
write site. That fails the moment someone adds a write site and forgets, and the
failure mode is the worst kind: a row that **reports fresh while being stale**. A
generated column cannot drift, because the database maintains it.

There is precedent in this very table — `searchVector` is
`GENERATED ALWAYS … STORED`, including the fact that Prisma cannot express it so it
lives in the migration.

It also dissolves the problem that blocked S5: staleness becomes a comparison of
**two short hashes**, so the candidate query stays cheap and bounded. No fetching
every row's `fullText` to apply a cap.

### Verified before committing to it (2026-09-17)

| Question | Result |
| --- | --- |
| `sha256()` available? | Yes — PostgreSQL 17.6, `provolatile = i` (IMMUTABLE) |
| `convert_to(body,'UTF8')` usable in a generated column? | **No** — `provolatile = s` (STABLE); Postgres rejects it with `generation expression is not immutable` |
| `sha256(body::bytea)` usable? | **Yes**, and produces the correct digest |
| Does Node compute the same hash? | **Yes — byte-identical** across ASCII, smart quotes/em-dashes, Spanish accents, and the empty string |

That last row is load-bearing: if the application and the database disagreed, every
row would look stale forever and regenerate on every run.

**Caveat to record:** `text::bytea` reinterprets the text in the server encoding, so
the hash is encoding-dependent. The database is UTF8 and a restore into a non-UTF8
database would change every hash. Acceptable, but it must be written down.

## 3. Subtasks

### S1 — migration + schema · 0.5 session
- `packages/relationaldb-provider/prisma/schema.prisma`: `analysisSourceTextHash`
  (`@db.VarChar(64)`) and `fullTextHash`, the latter documented as
  database-maintained and never written by application code.
- Migration: additive columns; the generated column in raw SQL, since Prisma cannot
  express it. **`prisma migrate`, never `db push`** (#1168).
- Round-trip on `postgres_test`.

### S2 — write and compare · 1 session
- `proposition-analysis.service.ts`: persist `analysisSourceTextHash` on every
  generate; extend `generateMissing`'s candidate query with the hash-mismatch arm
  alongside the existing `analysisPromptHash` arm; extend `isCurrent` for the
  single-proposition path.
- Mirror S5's structure and its **fail-closed** posture exactly.
- Tests: text change selects the row; unchanged text does not; both axes together;
  NULL hash treated as stale. Verify by reintroducing the defect.

### S3 — surface it · 0.5 session · OPTIONAL
- Expose on the GraphQL model so a reader can see which text version a citation was
  checked against. Requires rebuilding region, restarting the gateway and refreshing
  the introspection snapshot — the full federation dance from #1274.

## 4. Risk register

| Risk | Severity × Likelihood | Mitigation |
| --- | --- | --- |
| Generated column slows writes on a large `TEXT` | medium × possible | Measure on `postgres_test`; `searchVector` already generates over the same column |
| App and DB hashes disagree → permanent staleness | **critical × rare** | **Verified byte-identical** before writing the migration (§2) |
| Both staleness axes fire at once and regenerate everything | **high × possible** | 3–5h on the 32B. Keep the cap; land before R7 so the refresh runs once on the chosen model |
| Existing 54 rows have no hash | low × certain | NULL = unknown = stale. Regenerates once, which is wanted |
| Hashing `fullText` alone misses a title change | low × likely | Deliberate: claims cite `fullText`. Documented, not silently scoped |
| Encoding-dependent hash | low × rare | Documented in §2; DB is UTF8 |
| AGPL-3.0 dependency constraints | low × rare | No new dependencies |

## 5. Data classification

Public civic records plus a content hash. The new columns hold a digest and are
never logged, never sent to a model, and never placed in fixtures.

**#1263 note:** `propositions.full_text` carries proponent postal addresses, emails
and phone numbers unredacted. The *hash* is safe — it is one-way and not reversible
to the text. Nothing here widens that exposure. Anything that later renders the
hashed text still must account for it.
