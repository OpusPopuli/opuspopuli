# Cleanup: duplicate Sonoma supervisors (#1386)

**What happened.** A representatives sync on 2026-10-20 13:33Z (job `a1b5fa7c`),
run to verify #1383, minted a second identity for all five Sonoma County
supervisors. `representatives` for `chamber = 'Board of Supervisors'` went from
5 rows to 10.

| original (2026-09-05) | duplicate (2026-10-20 13:45) |
|---|---|
| `sonoma-district-1` Rebecca Hermosillo | `ca-board of supervisors-1` |
| `sonoma-district-2` David Rabbitt | `ca-board of supervisors-2` |
| `sonoma-district-3` Chris Coursey | `ca-board of supervisors-3` |
| `sonoma-district-4` James Gore | `ca-board of supervisors-4` |
| `sonoma-district-5` Lynda Hopkins | `ca-board of supervisors-5` |

Each duplicate had its own AI-generated biography and **58 `claims` rows**
between them.

**Cause.** `canonicalizeRepresentativeId` treated only `ca-assembly-N` /
`ca-senate-N` as already-canonical, so the county plugin's
`sonoma-district-1` was re-keyed under the active (state) plugin's prefix.
The derived key missed the upsert and INSERTed. The chamber was lowercased but
not slugified, which is where the spaces came from.

## What was run

Local dev database (`opuspopuli-db` / `postgres`), in one transaction, with
two guards that abort rather than proceed on an unexpected shape:

```sql
BEGIN;
CREATE TEMP TABLE dups AS
  SELECT id, external_id FROM representatives
   WHERE chamber = 'Board of Supervisors'
     AND external_id LIKE 'ca-board of supervisors-%';
-- abort unless exactly 5 duplicates AND exactly 5 sonoma-district-* originals
DELETE FROM claims WHERE subject_id IN (SELECT id FROM dups);  -- no FK: polymorphic subject
DELETE FROM representatives WHERE id IN (SELECT id FROM dups);
COMMIT;
```

`DELETE 58` then `DELETE 5`.

**Why `claims` needed an explicit delete.** `claims.subject_id` has no foreign
key — the subject is polymorphic (`subject_type` + `subject_id`) — so deleting
the representatives alone would have orphaned 58 rows invisibly.
`claim_evidence` and `claim_relations` DO cascade from `claims`, so those were
cleaned by the first delete.

**Blast radius checked before deleting.** All seven FKs that reference
`representatives` held zero rows for the duplicates
(`representative_committee_assignments`, `representative_relevance_cache`,
`bill_co_authors` — CASCADE; `bill_votes`, `bills.author_id`, `committees`,
`legislative_actions` — SET NULL).

## Verification after

- `Board of Supervisors` back to **5** rows, all `sonoma-district-*`
- bio lengths unchanged from before the sync: 402 / 946 / 650 / 552 / 1260
- orphaned representative claims: **0**

## Not done here

Production was not touched and does not need to be — it runs v1.28.0 and has
not had this sync. The fix (#1386) prevents recurrence; this runbook only
records the local cleanup.
