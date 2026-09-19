# Plan of record — #1278: source-store observability

| | |
|---|---|
| **Issue** | [opuspopuli#1278](https://github.com/OpusPopuli/opuspopuli/issues/1278) — sub-issue of [#1207](https://github.com/OpusPopuli/opuspopuli/issues/1207) (M1 Provenance foundation), scope item 1 |
| **Date** | 2026-09-19 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/source-store-observability-1278` |
| **Data classification** | Operational metrics only — byte counts and object counts. No source content, no personal data. |
| **Depends on** | #1276 (cited tier) and #1277 (bulk tier), both merged |
| **Scope change** | Approved 2026-09-19: app-level zstd dropped from scope. See §2. |

## 1. Why now rather than later

Store size and growth are gauges **from day one**, so a future capacity decision
is read off a graph rather than estimated. This store is the one component whose
growth is genuinely unbounded if the tiering is wrong.

The precedent is concrete: production backups stopped on 2026-07-23 and went
unnoticed for **49 days**, because nothing measured freshness (#1217). The fix
was a gauge. The same reasoning applies here, before the store has volume.

## 2. The compression premise, measured

The issue asks for "zstd compression at rest", on the basis that "civic HTML
compresses 5–10×, so this materially changes the sizing". Measured 2026-09-19
against a real CA AG initiatives page (49,695 bytes) and a representative
delimited export:

| Tier | Stores | Baseline **today** | With app-level zstd | Net gain |
|---|---|---|---|---|
| 1 — cited sources | HTML/PDF in Postgres `bytea` | **15,772 B** (pglz 3.15×, automatic) | 11,584 B | **1.36×** |
| 2 — bulk archive | ZIP in object storage | 10.6 KB | 10.6 KB | **1.00× — none** |
| *(reference)* | raw delimited text | 133.7 KB | 8.9 KB | 15.1× |

Two independent reasons the premise fails:

1. **Postgres already compresses tier 1.** `default_toast_compression` is `pglz`,
   applied automatically to any `bytea` over ~2 kB. The 5–10× figure compares
   against uncompressed data; nothing in this store is uncompressed.
2. **Tier 2 stores ZIPs**, which are deflate-compressed already. The 15× figure
   describes the CSV *inside* the archive, not what the tier holds.

They do not stack, either: storing pre-compressed bytes in Postgres disables
TOAST — measured at exactly 1.00× once zstd'd — so app-level compression
*replaces* pglz rather than adding to it.

**Decision (approved):** build the gauges as specified, **record** the ratio
actually achieved rather than adding one, and **skip app-level zstd in both
tiers.** Tier 2 gains nothing. Tier 1 gains 27% of a 1–3 GB/yr budget — some
0.3–0.8 GB/yr — in exchange for making stored evidence opaque to direct
inspection, and adding a compressed-vs-raw distinction beside a content hash
that must stay keyed to raw bytes. For a store whose value is being readable
later, that is a poor trade at this size.

Revisit if tier 1 grows an order of magnitude beyond its sizing, which is
exactly what these gauges are for.

## 3. Subtasks

| # | Work | Where |
|---|---|---|
| **S1** | Per-tier gauges — bytes, object count, growth — emitted from the region service | `apps/backend` |
| **S2** | Record the compression ratio actually achieved, from `pg_column_size` vs `octet_length` | region |
| **S3** | Alert rules for growth that would invalidate the "no hardware purchase required" sizing | `observability/` |
| **S4** | Grafana panel showing both tiers over time | `observability/` |
| **S5** | Tests, including that gauges are correct when a tier is empty | `apps/backend` |

## 4. Where the exporter lives

The **region service**: always-on, already exposes `/metrics`, and is already a
Prometheus target (4004, with the worker on 4005).

This follows the issue's own note, which follows #1270: the natural home for a
backup-freshness gauge was `docker-compose-backup.yml`, which `op-deploy`
excludes by design — the same mechanism that let backups die silently. **A
watchdog that can be left out of a deploy is not a watchdog.** Nothing here may
live in an optional overlay.

## 5. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Gauge query scans a large table on every scrape | medium × likely | Aggregate query, not per-row; measured before merge; refreshed on an interval rather than per-scrape if needed |
| `pg_column_size` aggregate is expensive on `contributions`-scale tables | medium × possible | Scoped to the two store tables only, never the finance tables |
| BigInt byte totals overflow a Prometheus float | low × rare | Prometheus gauges are float64; exact to 2^53 bytes (~9 PB) |
| A gauge reports 0 for "empty" and for "query failed" alike | **high** × possible | Distinguish explicitly: failure leaves the previous value and logs, rather than publishing a false zero — a silent zero is the #1217 failure shape |
| Alert thresholds picked from guesses | medium × likely | Derive from the epic's own sizing (1–3 GB/yr tier 1; 12–13 GB/yr tier 2 at latest+monthly) and state the arithmetic in the rule |

## 6. Effort

~1 focused session.
