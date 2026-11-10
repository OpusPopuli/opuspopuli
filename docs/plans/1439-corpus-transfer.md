# #1439: transfer the UAT civic corpus to production by staged schema swap

| | |
|---|---|
| Issue | [#1439](https://github.com/OpusPopuli/opuspopuli/issues/1439) |
| Date | 2026-11-09 |
| Author | Rodney Gagnon (plan drafted with Claude Code) |
| Approved | Owner, 2026-11-09: staged swap rather than a row-by-row load; finance included only if D3a verifies it |
| Branch | `feat/corpus-transfer-1439` |
| Gate | G4a of `production-cutover-maintenance-window.md` (Window B, §5a) |
| Data classification | **Public civic records only leave UAT**, enforced structurally (a closed table list, tested). Production's user data (CCPA personal information under `us-state-privacy`) is never exported, never read into a report, and never deleted. The only user-table writes are FK re-pointing on three tables (§3) |
| Reference pattern | #1305, `apps/backend/scripts/content-transfer` |

## 1. Why a swap

UAT's `public` schema is 33 GB. 31 GB of it is campaign finance:
`contributions` 19.8M rows and 15 GB, `expenditures` 14.0M and 13 GB,
`filing_summaries` 4.3M and 2.1 GB. The rest is about 2 GB.

§5a.3 sketched a load into staging tables followed by `TRUNCATE` and `INSERT`
into `public`, in one transaction. At this size that writes tens of gigabytes
of WAL and rebuilds every index **inside the window**. A swap moves that work
outside it. The slow part (restore and index builds) happens while prod is
live, into a schema prod doesn't read. The window transaction is DDL plus a
few small updates.

Measured on UAT, re-checked on both sides by the tool: `public` has **no
views, no triggers, no RLS policies, no sequences, and no foreign keys from
another schema**. Nothing outside the table list depends on a civic table's
identity.

## 2. The table classes

From `schema.prisma`, every model:

- **Civic (replaced from UAT):**
  - bills: `bills`, `bill_co_authors`, `bill_committee_assignments`, `bill_votes`, every `pubinfo_*`
  - propositions and representatives: `propositions`, `representatives`, `representative_committee_assignments`, `legislative_committees`, `legislative_actions`
  - meetings: `meetings`, `minutes`
  - civics: `civics_blocks`, `civics_page_extractions`, `glossary_entries`, `glossary_entry_sources`
  - finance: `committees`, `committee_measure_positions`, `contributions`, `expenditures`, `independent_expenditures`, `filing_summaries`, `filing_reconciliations`, `cvr_filings`, `cvr2_filings`
  - provenance and pipeline: `claims`, `evidence`, `claim_evidence`, `claim_relations`, `source_versions`, `bulk_snapshots`, `bulk_imports`, `pipeline_executions`, `pipeline_execution_batches`, `pipeline_jobs`, `structural_manifests`, `structural_analysis_jobs`, `ingestion_watermarks`
  - geography and config: `jurisdictions`, `county_thresholds`, `county_adjacency`, `region_plugins`
- **User (kept from prod, never exported):** `users`, `user_profiles`, `signal_profiles`, `sensitive_profiles`, `user_events`, `user_logins`, `user_sessions`, `passkey_credentials`, `webauthn_challenges`, `user_consents`, `user_addresses`, `user_jurisdictions`, `email_correspondence`, `notification_preferences`, `documents`, `document_propositions`, `abuse_reports`, `audit_logs`
- **Per-user caches (emptied, rebuilt on demand):** `bill_relevance_cache`, `proposition_relevance_cache`, `representative_relevance_cache`, `committee_relevance_cache`, `briefing_summary_cache`, `personalized_impact_cache`, `llm_rerank_jobs`
- **Seed (untouched):** `prompt_templates`, re-seeded by the deploy

- **Not in Prisma, found in the live `public` schema (S1, 2026-11-09):**
  `default_embeddings_vectors` is **user** (the knowledge service's RAG chunks
  of users' documents, keyed by `user_id` and `document_id`, created at boot by
  `pgvector.provider.ts`; civic embeddings are columns on the civic tables).
  `_prisma_migrations` and PostGIS's `spatial_ref_sys` are **infra**, kept per
  database.

The lists are constants in `tables.ts`. `tables.spec.ts` parses
`schema.prisma` and fails if a model belongs to no class, if a class lists a
table the schema dropped, if a civic table references a non-civic one, or if
the foreign keys from kept data into the corpus differ from the declared
remaps. Prisma can't see every table, so each command also **refuses a
database whose `public` holds a table no class names**.

## 3. References from user data into the corpus

| Reference | Kind | Swap handling |
|---|---|---|
| `document_propositions.proposition_id` | FK, `ON DELETE CASCADE` | Remap by `(region_plugin_name, external_id)`. **Refuse** if any is unmatched |
| `user_jurisdictions.jurisdiction_id` | FK, no action | Remap by `ocd_id`, else `fips_code`. **Refuse** if any is unmatched |
| `email_correspondence.representative_id`, `.proposition_id` | soft | Remap where matched (`external_id`; `(region_plugin_name, external_id)`); report the rest by count, never content |
| relevance and briefing caches | FK, cascade | Emptied before the swap |
| `user_events.object_id`, `audit_logs.entity_id` | soft, historical | Left as is: they record IDs that were valid at the time |

Audited 2026-11-09 (S4): every non-FK, ID-shaped or JSON column on a user
table. None but the above holds a corpus ID: the JSON columns hold tags
(`convictionStrength` is keyed by tag) and extracted text, and petition
links go only through `document_propositions`. The soft references live in
`tables.ts` beside the hard ones, and a test fails if one gains a foreign
key without moving to the refusing list.

## 4. The three commands

`apps/backend/scripts/corpus-transfer/`. Dry-run by default everywhere;
`--apply` to write.

### 4.1 `export` (dev machine, against UAT)

As built in S2 (`export.ts`); it differs from the first draft in how the
scratch copy is made, for the reason given in step 2.

1. Refuse unless UAT's `_prisma_migrations` has no unfinished rows, every
   table in `public` is classified, and every civic table is present.
2. Refuse while other sessions use UAT, then clone it at file level:
   `CREATE DATABASE corpus_export_<ts> TEMPLATE <uat>`. UAT itself is never
   written. A clone, not a table-by-table copy: civic tables depend on 26
   enum types, extension types (`vector`, `geography`) and operator classes
   (`vector_cosine_ops`, `gin_trgm_ops`), which a copy would have to rebuild
   one by one. The clone needs UAT idle, which the D3a freeze implies: stop
   the stack's services, keep the database up.
3. In the clone, one transaction:
   - **#1429 D3:** clear `bills.ai_summary*` unless the prompt hash and model
     digest are set and, for an official bill, the summary was written from
     the version the app treats as current (`summaryStateOf` minus the live
     template and model, which are prod's to judge). Dry run on UAT,
     2026-11-09: 4,456 stored, **21 ship**, 4,435 cleared.
   - **Finance:** emptied unless `--include-finance` (O4). It still ships,
     as definitions with no rows.
   - Move only the civic tables into a new `corpus_staging` schema
     (`ALTER TABLE ... SET SCHEMA`). Not a rename of `public`: the enum and
     extension types stay there, and the staged tables keep referencing
     `public.<type>`, which prod has from the same migrations.
4. `pg_dump -Fc -n corpus_staging`.
5. **Read the dump back** (`pg_restore -l`) and refuse, deleting it, unless
   every entry is in `corpus_staging` and its tables and table data are
   exactly the civic set. This, not the way the clone was built, is what
   keeps personal data in: the clone briefly holds UAT's user rows on the
   same server, and the check is on the artifact that leaves.
6. Write a manifest next to the dump: per-table row counts, the migration
   list, the git SHA, the D3 counts, whether finance is included, and the
   dump's size and sha256. No per-table content hashes: hashing 15 GB tables
   on both sides costs more than it proves, given the dump checksum, the row
   counts and the catalog diff.
7. Drop the clone, whatever happened.

The tools run inside the database container (`docker exec`), which has
`pg_dump` at the server's exact version and needs no password; neither host
has the client binaries. Verified end to end on `postgres_test`
(2026-11-09): 51 tables, 51 table-data entries, 73 foreign keys, 211
indexes, no grants, all owned by `postgres`. UAT and prod may carry
Supabase role grants on these tables, so S3's catalog diff compares
permissions too.

### 4.2 `stage` (Studio, prod live)

As built in S3 (`stage.ts`, `catalog.ts`).

1. Verify the dump's sha256 against the manifest.
2. Refuse unless prod's applied migrations equal the manifest's (naming
   each one on one side only), every table in `public` is classified, and
   no `corpus_staging` exists (`--replace` drops a previous one, table by
   table and then the schema, never `CASCADE`).
3. **Dependency check:** refuse if anything would make dropping a live civic
   table do more than drop the user-side foreign keys the swap rebuilds, or
   would be silently lost with it: views, non-internal triggers, RLS
   policies, publications that include a civic table or cover all tables
   (Supabase's `supabase_realtime` exists and is empty today), foreign keys
   from other schemas, owned sequences. Re-run by the swap.
4. Read the archive's table of contents again (the export's check), then
   `pg_restore --single-transaction --exit-on-error` with no `-n` filter.
   The checksum proves the file is the manifest's; this proves what it
   restores. No filter is needed, and one would break the restore:
   `pg_restore -n` skips the schema's own `CREATE SCHEMA` entry (found
   2026-11-09). A failed restore leaves nothing behind. Prod's `public` is
   not written. The restore can't be reniced from outside the server; the
   site is closed until Window B anyway.
5. **Catalog diff**, for every civic table, staged against live: each
   column (position, type, nullability, default, identity, generated,
   collation, column grants), each index definition, each constraint
   definition and validity, the owner, the table grants, and the table's
   options (kind, persistence, RLS, replica identity, storage options).
   Read with an empty `search_path` so both sides print qualified names;
   the staged schema is then normalised to `public`.
   - **CHECK constraints are compared after a round trip.** A dump prints a
     constraint and the restore parses it again, and Postgres doesn't always
     print the result the same way: `ANY ((ARRAY['a'::varchar])::text[])`
     came back as `ANY (ARRAY[('a'::varchar)::text])`, so a correct staging
     showed two false differences. Instead of loosening the comparison,
     each CHECK is re-added from its printed text to a temporary copy of its
     table's columns and read back, on both sides. Printing is stable after
     one round, so a real change still differs.
   - **Grants are compared.** The local database grants `grafana_ro` on five
     user tables and no civic ones. If prod grants it on civic tables and
     UAT doesn't, stage reports the difference and the swap refuses. Fix it
     by granting on the staged tables, not by skipping the check.
6. Verify the staged row counts against the manifest.

Stage exits 0 only when staged, identical and counted; otherwise it leaves
the schema in place for inspection and exits 2.

**Verified 2026-11-09 on `postgres_test`:** a dump from the same database
staged with no differences. Then, on the staged copy, a changed CHECK
value, an added column, a changed default, a dropped index and an added
grant were each reported, and a view, a trigger and a publication on live
civic tables were each found by the dependency check.

### 4.3 `swap` (in the window, after W2–W3)

As built in S4 (`swap.ts`). Three modes: no flag runs the pre-checks only
and takes no lock; `--rehearse` runs the **whole transaction and rolls it
back**; `--apply` commits. The rehearsal is the same script byte for byte,
so the window runs an operation already proven on the same data. It takes
the same exclusive locks, so it too runs with writers stopped.

Pre-checks, outside the transaction: migrations equal the manifest's,
every table classified, staging present, no dependency findings, and a
catalog diff of zero.

Then one script, one transaction, `SET LOCAL lock_timeout` (default 5s)
so it fails rather than waits. Every check is a `DO` block that raises, so
any failure aborts the whole transaction:

1. Lock the live and staged civic tables, the caches and every user table.
2. Count every user table that exists on the target.
3. Build each remap into a temp table, old live ID to new staged ID, by
   natural key (in order: `ocd_id`, then `fips_code`). **Refuse** any
   foreign-key reference with no match, by count. Refuse a remap that
   would chain one ID into another mid-update. Count the unmatched soft
   references now: once re-pointed, a matched one no longer holds the ID
   its remap is keyed by. (Counting afterwards over-reported, found by the
   integration spec.)
4. Count, then `TRUNCATE`, the per-user caches.
5. Record every foreign key from a non-civic `public` table into a civic
   one, and the number of constraints and tables outside the civic set.
6. `DROP TABLE <all civic> CASCADE` in one statement. Then assert the
   non-civic tables are all there and exactly the recorded keys went.
7. `ALTER TABLE corpus_staging.<t> SET SCHEMA public`, each.
8. Re-point the hard and soft references.
9. Recreate the recorded keys verbatim, which validates them. Assert every
   one is back with an identical definition.
10. Assert user counts unchanged, civic counts equal to the manifest's, and
    `corpus_staging` empty. Drop it. Report, then `COMMIT` (or `ROLLBACK`).
11. After commit: `NOTIFY pgrst, 'reload schema'`.

The report is counts per reference, cache and table, never content.
Post-commit rollback is the W3 backup (`restore-db.sh --quick`), as in §7 of
the cutover plan.

### 4.4 Report

Per command: counts per table, remaps applied, soft references unmatched,
summaries kept and cleared, refusals. **Counts and identifiers only, never
user content or civic text.**

### 4.5 Review changes (2026-11-09)

Two independent reviews (correctness and data safety; security,
regulated data and quality) found no way for the swap to commit with user
rows lost or links wrong, and no SQL or command injection. What they did
find, all fixed:

- **The dump is trusted only by a checksum given out of band.** The
  manifest's hash proves only that the two files agree; whoever could
  replace one could replace both, and the archive listing can't see the
  SQL inside an entry. `stage --apply` requires `--expect-sha256 <hex>`,
  the value `export` printed, carried by a route other than the files
  (e.g. read off the terminal into the runbook). The listing check also
  became positional with a type allowlist: an entry must be one of the
  types the export produces *and* sit in `corpus_staging` by position, not
  merely mention it. The manifest is shape-checked before use, and its
  dump name must be a bare `corpus-<ts>.dump` (no paths).
- **The CASCADE guard is general.** Before the drop, the swap snapshots
  every object outside the civic tables by OID — relations, columns,
  constraints, functions, policies, rules, user triggers — and after it
  refuses unless the only difference is the recorded foreign keys. A
  function over a civic row type, or an RLS policy on a user table that
  reads a civic one, would otherwise have gone silently (both tested). The
  dependency check also refuses rules on civic tables.
- **Remap identity.** A match by a fallback key that contradicts an earlier
  one (FIPS matches, OCD IDs differ) is no match: refused for foreign keys,
  unmatched for soft ones. Proposition matches whose `election_date`
  differs are counted in the report, since `external_id`'s meaning changed
  in #1164 and prod's rows predate it.
- **After a commit, the tool says so.** A failure after `COMMIT` (NOTIFY,
  the report, or the client losing psql) used to print "production is as
  it was". It now checks whether `corpus_staging` still exists and says
  committed, not committed, or unknown.
- **Stage** checks the new archive before dropping a previous staging,
  counts every civic table (not only those the manifest lists), runs
  `VACUUM (ANALYZE)` on the staged tables so they go live with statistics,
  and reports the `region_plugins` differences (O2) by name and flag.
- **Export** drops clones an interrupted export left behind, drops its own
  on SIGINT/SIGTERM, and never lets a failed clean-up hide the original
  error (a clone holds a copy of user data, so a failed drop is loud).
- **Errors** keep an allowlist of Postgres error lines (psql also runs with
  `VERBOSITY=terse`): a multi-line `DETAIL` can carry a row across several
  lines, so dropping lines that start with DETAIL was not enough.
- **Smaller:** stream errors no longer crash the process mid-restore; a lock
  timeout of 0 (which means wait for ever) is refused; the catalog diff
  also compares index validity, column storage, compression and statistics
  targets, tablespace and comments; the three CLIs share `cli.ts`.

**For the runbook (S6):** run `swap --apply` inside tmux or nohup, since an
interrupted client may not stop a psql already sent its script. Restart
`region` and `region-worker` after the swap: they load the active region
plugin at boot.

## 5. Subtasks

| # | Work | Where |
|---|---|---|
| S1 | Table classes as constants plus the schema-coverage test | `scripts/corpus-transfer/tables.ts` |
| S2 | `export`: scratch DB, the D3 rule, the finance switch, the schema rename, dump, manifest | `export.ts` |
| S3 | `stage`: checksum, migration check, restore, catalog diff | `stage.ts`, `catalog.ts` |
| S4 | `swap`: remaps, constraint capture and recreation, the transaction, the assertions | `swap.ts` |
| S5 | Integration tests on two real databases the spec creates and migrates (a "UAT" source, a "prod" target sharing natural keys but not IDs). **Done 2026-11-09, 7 cases:** export (D3 rule, no user table, clone dropped); stage (identical); an unmatched petition link refused with the target unchanged; a failure at the very last check, after the drop, move, remaps and key rebuild, rolled back with the target unchanged; rehearsal unchanged; the swap (UAT IDs live, a petition link and jurisdictions by OCD ID and by FIPS re-pointed, a soft reference re-pointed and one left, caches empty, prod users untouched, UAT's user absent, keys enforced); a definition difference refused. Mutation-checked: each of six reintroduced faults fails a case | `__tests__/integration/region/corpus-transfer.integration.spec.ts` |
| S6 | Runbook section: where each command runs (see O1), timings, the W8 procedure | cutover plan, W8 |
| S7 | G4 rehearsal against a copy of prod on the Studio; the report becomes W8's expected output | — |

No migration, no GraphQL change, no federation impact. `pg_dump` and
`pg_restore` come from the Postgres containers already on both hosts.

## 6. Open items

- **O1, where `stage` and `swap` run on the Studio.** The node runs images,
  not a checkout. The options are a one-off `docker run` of the region image
  with the scripts compiled in, or running the tool from the Mac through an
  SSH tunnel to the prod database. To decide in S6, before G4.
- **O2, `region_plugins`.** It holds per-region configuration, including
  enabled flags. Replacing it with UAT's is correct only if both sides enable
  the same regions. The tool should report a diff, and the owner decides at G4.
- **O3, object-storage payloads** (D3b) aren't in the database and aren't
  moved by this tool.
- **O4, finance when D3a does not verify it.** Finance can't be kept from
  prod beside a replaced corpus: its tables reference `propositions`,
  `representatives`, `pipeline_executions` and `structural_manifests` by ID,
  and `pipeline_executions` has no natural key to remap by. Nothing outside
  finance references finance (tested), so the two workable fallbacks are
  shipping the finance tables **empty** or **holding Window B** until D3a
  passes. **Decided (owner, 2026-11-09): ship empty, transfer later.**
  Without `--include-finance` the export carries the finance tables'
  definitions with no rows. After the swap, prod's propositions and
  representatives carry UAT's IDs, so a later finance-only transfer from
  the same UAT lines up without remapping; the tool will refuse one whose
  references don't resolve.

## 7. Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Personal data leaves UAT in the dump | **critical** × rare | Closed table list; the schema-coverage test; a test that the dump has no user table; the export copies by allowlist only |
| User rows lost in the swap (a cascade we missed) | **critical** × possible | `DROP ... CASCADE` asserted to drop only the recorded constraints; user counts compared in the transaction; rehearsal on a copy of prod |
| Petition-scan links point at the wrong proposition | **high** × possible | Composite natural-key remap; unmatched aborts the swap; a test with diverged UUIDs |
| Staged tables differ from prod's definitions | **high** × possible | Identical migration lists required; full catalog diff at stage and again at swap |
| The swap fails half-way | **high** × rare | One transaction; a failure-injection test proves the target is unchanged |
| The swap waits on a lock during the window | medium × possible | W2 stops writers first; `lock_timeout` makes it fail fast and retryable |
| Unverified finance ships | **high** × possible | Finance only with `--include-finance`, which D3a gates |
| The staging restore slows the live node | medium × likely | Low priority; the site is closed anyway until Window B; the disk had 735 GB free |
| A new table added later is silently skipped | medium × possible | The schema-coverage test fails on any unclassified model |
| GPL or licence conflict | none | No new dependencies |

## 8. Effort

S1–S5: about 2–3 sessions. S6–S7: about 1 session, plus the restore time on the Studio.
