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

The lists are constants in the tool. A test parses `schema.prisma` and fails
if a model belongs to no class, so a new table can't silently fall through.

## 3. References from user data into the corpus

| Reference | Kind | Swap handling |
|---|---|---|
| `document_propositions.proposition_id` | FK, `ON DELETE CASCADE` | Remap by `(region_plugin_name, external_id)`. **Refuse** if any is unmatched |
| `user_jurisdictions.jurisdiction_id` | FK, no action | Remap by `ocd_id`, else `fips_code`. **Refuse** if any is unmatched |
| `email_correspondence.representative_id`, `.proposition_id` | soft | Remap where matched; report the rest by count, never content |
| relevance and briefing caches | FK, cascade | Emptied before the swap |
| `user_events.object_id`, `audit_logs.entity_id` | soft, historical | Left as is: they record IDs that were valid at the time |

## 4. The three commands

`apps/backend/scripts/corpus-transfer/`. Dry-run by default everywhere;
`--apply` to write.

### 4.1 `export` (dev machine, against UAT)

1. Refuse unless UAT's `_prisma_migrations` set is complete and has no failed rows.
2. Create a scratch database `corpus_export_<ts>` and copy **only the civic
   tables** into it (`pg_dump -t` for each listed table, then restore). UAT itself is never written.
3. In the scratch DB, apply the export rules:
   - **#1429 D3:** clear `bills.ai_summary*` unless prompt hash and model
     digest are set and `ai_summary_source_version` equals the current
     pubinfo version.
   - **Finance:** included only with `--include-finance`, which the runbook
     passes only after D3a records the raw-archive verification.
4. `ALTER SCHEMA public RENAME TO corpus_staging`, then
   `pg_dump -Fc -n corpus_staging`.
5. Write a manifest next to the dump: per-table row counts and content hashes,
   the migration list, the git SHA, the export rules applied with their counts,
   and the dump's sha256.
6. Drop the scratch database.

### 4.2 `stage` (Studio, prod live)

1. Verify the dump's sha256 against the manifest.
2. Refuse unless prod's migration list equals the manifest's.
3. `pg_restore -n corpus_staging` into the prod database. Prod's `public` is
   not read or written. Run it at low priority; the node keeps serving.
4. **Catalog diff:** for every table, compare columns (name, type, nullability,
   default), indexes (definition), and constraints (definition, renamed schema
   aside) between `corpus_staging.<t>` and `public.<t>`. Any difference is a
   refusal that names it.
5. Verify the staged row counts against the manifest.

### 4.3 `swap` (in the window, after W2–W3)

One transaction, `lock_timeout` set so it fails rather than waits:

1. Re-run the catalog diff and the dependency checks (no views, triggers,
   policies or foreign schemas referencing the tables).
2. Snapshot the user-table counts (users, passkeys, addresses,
   `document_propositions`, `user_jurisdictions`, `email_correspondence`).
3. Build the remaps of §3 into temp tables. Any unmatched cascade reference: **abort**.
4. Empty the per-user caches.
5. Record the definitions of every FK constraint from a non-civic table into a
   civic one (`pg_get_constraintdef`).
6. For each civic table: `DROP TABLE public.<t> CASCADE`. In this schema this
   drops only those recorded constraints, and the tool asserts that. Then
   `ALTER TABLE corpus_staging.<t> SET SCHEMA public`.
7. Apply the remaps to the three user tables.
8. Recreate the recorded constraints verbatim, validated.
9. Assert: user-table counts unchanged; civic counts equal the manifest;
   `corpus_staging` is empty. Then **commit**. Otherwise roll back, and prod is
   exactly as it was.
10. `NOTIFY pgrst, 'reload schema'`.

Post-commit rollback is the W3 backup (`restore-db.sh --quick`), as in §7 of
the cutover plan.

### 4.4 Report

Per command: counts per table, remaps applied, soft references unmatched,
summaries kept and cleared, refusals. **Counts and identifiers only, never
user content or civic text.**

## 5. Subtasks

| # | Work | Where |
|---|---|---|
| S1 | Table classes as constants plus the schema-coverage test | `scripts/corpus-transfer/tables.ts` |
| S2 | `export`: scratch DB, the D3 rule, the finance switch, the schema rename, dump, manifest | `export.ts` |
| S3 | `stage`: checksum, migration check, restore, catalog diff | `stage.ts`, `catalog.ts` |
| S4 | `swap`: remaps, constraint capture and recreation, the transaction, the assertions | `swap.ts` |
| S5 | Integration tests on a real database: two databases in the test container (source and target with diverged UUIDs). Cases: round trip; petition-scan links and jurisdictions survive; unmatched cascade reference refused; catalog mismatch refused; failure injected mid-swap leaves the target byte-identical; user counts identical; D3 rule; no user table in the dump. Each mutation-checked | `__tests__/integration/region/corpus-transfer.integration.spec.ts` |
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
