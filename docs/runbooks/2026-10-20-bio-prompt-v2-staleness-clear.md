# Clearing v1 bios so prompt v2 can run

**Date:** 2026-10-20 · **Scope:** local UAT (`opuspopuli-db`, database `postgres`)

## Why this is needed

`BioGeneratorService.enrichBios` generates only for reps whose bio is empty:

```ts
const candidates = reps.filter((r) => !r.bio || r.bio.trim() === '');
```

That is the right precedence rule — it is what stops a generated bio from
overwriting a scraped one. But it also means a **prompt revision alone changes
nothing**: trigger a sync after seeding
`document-analysis-representative-bio` v2 and all 123 existing v1 bios are
skipped, so v2 is never exercised and the corpus keeps the invented
biographies the revision exists to remove.

These bios are stale on the **prompt axis**, which
`project_analysis_staleness_no_model_axis` names as one of the two real
staleness axes (the other being source text; there is no model axis). So
clearing them is the defined response to a prompt version bump, not a
workaround.

## What it must cover

Clearing `bio` alone is not enough. The row also carries the attribution and
the claims that attest to the removed text:

| column | why |
|---|---|
| `bio` | makes the rep a generation candidate again |
| `bio_source` | must not say `ai-generated` while holding no bio |
| `bio_claims` | per-sentence attribution for text that no longer exists |
| `bio_prompt_hash`, `bio_prompt_version` | points at v1, which no longer produced anything stored |
| `bio_llm_model`, `bio_llm_digest` | same |

And the shared `claims` table holds 2,212 `subject_type='representative'`
rows. `recordClaims` supersedes per subject transactionally, so a rep that
**gets** a new bio is handled by the normal path. A rep that gets **no** bio
is not — and v2 deliberately produces no bio for a vacant seat, where v1 wrote
158 words about nobody. Without superseding here, those reps keep current
claims attesting to a bio that is gone.

Claims are **superseded, not deleted** (`valid_until = now()`). The table is
bi-temporal; deleting the history would discard the evidence that the v1
corpus made these assertions, which is exactly what a later audit needs.

## Only `ai-generated`

The 2 scraped bios are untouched. They are the good outcome (#1383 landed the
secondary-detail hop that produced them), they carry no AI attribution
(#1391), and they are not stale — their source text did not change.

## Backup first

The v1 bios are not reproducible: regenerating under v2 cannot recover them,
and a capped trigger (`maxReps`) repopulates only part of the corpus, leaving
the rest blank until a full run.

```bash
docker exec -i opuspopuli-db psql -U postgres -d postgres -At -c "
copy (select id, external_id, name, bio_source, bio, bio_claims,
             bio_prompt_hash, bio_prompt_version, bio_llm_model, bio_llm_digest
        from representatives order by external_id)
  to stdout with (format csv, header true);" > reps-bio-backup-v1.csv
```

Taken 2026-10-20 to the session scratchpad (125 rows).

## The clear

One transaction. Counts are echoed so a wrong scope shows up before COMMIT.

```sql
BEGIN;

-- Supersede claims for the reps whose bio is about to go.
UPDATE claims c
   SET valid_until = now(), updated_at = now()
 WHERE c.subject_type = 'representative'
   AND c.valid_until IS NULL
   AND c.subject_id IN (SELECT id FROM representatives
                         WHERE bio_source = 'ai-generated');

UPDATE representatives
   SET bio = NULL,
       bio_source = NULL,
       bio_claims = NULL,
       bio_prompt_hash = NULL,
       bio_prompt_version = NULL,
       bio_llm_model = NULL,
       bio_llm_digest = NULL
 WHERE bio_source = 'ai-generated';

-- Must be 2, both scraped, both with NULL attribution.
SELECT bio_source, count(*) FROM representatives
 WHERE bio IS NOT NULL AND bio <> '' GROUP BY bio_source;

COMMIT;
```

## After the trigger — what to check

```sql
SELECT bio_source, count(*), round(avg(length(bio))) AS avg_chars,
       count(DISTINCT bio_prompt_version) AS vers, max(bio_prompt_version) AS ver
  FROM representatives GROUP BY bio_source;
```

Expect `ai-generated` at **v2** and an average length near **80–120 chars**
(v1 averaged 991). Then the grounding check, which should return zero rows:

```sql
SELECT external_id, bio FROM representatives
 WHERE bio_source = 'ai-generated'
   AND (bio ~ '\y(1[7-9][0-9]{2}|20[0-9]{2})\y'
        OR bio ~* '\y(first|second|third|fourth|[0-9]+(st|nd|rd|th))\s+terms?\y'
        OR bio ~* 'Republican Leader|Democratic Leader|President pro Tem'
        OR bio ~* 'University|College|resides|married|City Council');
```

A hit here is not a prompt regression to argue about — it is either a fact
class `bio-source-guard.ts` does not yet cover, or the guard not running.

## Follow-up worth filing

There is no entry point for a prompt-axis staleness clear; this is the second
time it has been done by hand (the first was the duplicate-supervisor cleanup
runbook, 2026-10-20). A `clearStaleAnalyses(subjectType, promptVersion)`
mutation alongside `runPostSyncLinkers` (#1000) would make this a tool call
rather than a runbook, and would make the backup/supersede/clear sequence
atomic and tested rather than copied.
