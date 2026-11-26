# Runbook — full corpus resync, 2026-09-22

> **Carried out 2026-09-22 (recorded 2026-11-26).** The OLMo lanes it set up were later replaced by nemotron (opuspopuli-node-us-ca #44; `docs/evals/2026-09-27-civics-gold.md`), and that UAT corpus was regenerated and shipped in the production cutover's Window B. Kept for its measurements:
> - `full_text` byte-identical on 46 of 46 documents;
> - OLMo located 38% of verbatim citations live, against qwen's 72% in the pilot, because it shortens quotes with ellipses;
> - OCR glyph noise costs about 12 points of verification whatever the model.

Prepared 2026-09-21. Everything below was verified on the workstation stack, not assumed.

## What changed since the last sync

| | |
|---|---|
| #1306 | `source_versions` now stores the **derived text** beside the bytes; rows and evidence carry `source_version_id`. This is the first sync that will populate any of it. |
| #1316 / #1318 | undici `headersTimeout` raised to 22.5 min wherever a provider is built, and the "configuration ignored" warning no longer fires spuriously. |
| #1311 / #1315 | Two inference lanes, named by job. |

## Model lanes — all OLMo, qwen removed

Decided 2026-09-22: run the entire corpus on one model family, and remove
`qwen3.5:9b` from Ollama so nothing can quietly produce off-family output.

| lane | model |
|---|---|
| analysis | `olmo-3.1:32b-instruct` |
| ingestion | `olmo-3:7b-instruct` |
| last-resort fallback (`LLM_MODEL`) | `olmo-3.1:32b-instruct` |

### Why removing the model mattered more than changing the variables

`LLM_MODEL` is the final entry in the resolution chain, and the committed UAT
compose sets it to `qwen3.5:9b` on five services. Worse, **`llm-rerank-worker`
carries no lane variables at all** in that file — it had been running on qwen
throughout. Changing only the lane variables would have left a corpus that was
mostly OLMo with an undocumented qwen seam in it, and nothing would have said so.

Verified after the switch: all six LLM services resolve OLMo for every model
variable, and the removed model now errors rather than falling back —

```
$ curl -s localhost:11434/api/generate -d '{"model":"qwen3.5:9b",...}'
{"error":"model 'qwen3.5:9b' not found"}
```

`qwen2.5vl:7b` is **kept**: it is vision OCR, a different job with no OLMo
equivalent, and not part of "all LLM".

### The request timeout had to move with it

`OLLAMA_REQUEST_TIMEOUT_MS` was 600000 (10 min). The 32B took **183s idle and
1493s under load** on the same prompt, so a slow call mid-sync would have aborted
and been reported as an LLM failure rather than as slowness. Raised to 1320000 —
just under the 1350000 transport timeout (#1273), so the provider's own error
fires first and names the model.

### The known cost, recorded so it is measured

Four propositions through the live v3 prompt, 2026-09-21:

| model | claims | verbatim | after OCR denoise | ellipsis | wall (idle) |
|---|---|---|---|---|---|
| qwen3.5:9b | 32 | 72% | 84% | 0 | 88s |
| olmo-3.1:32b | 41 | 49% | 59% | 8 | 183s |

OLMo abridges quotes with ellipses — `"Notwithstanding any other provision ...
temporarily"` — and an abridged quote cannot be located, so it lands unverified.
**Expect the verification rate to fall.** n=4, so this is a pilot signal rather
than a settled result; the point of recording it is that the resync either
confirms or refutes it against the whole corpus.

If it does fall materially, the lane is one variable away from reverting, and the
pre-resync dump is the way back to the current corpus:

```bash
LLM_ANALYSIS_MODEL=... docker compose -f docker-compose-uat.yml \
  -f docker-compose-uat.local.yml up -d --force-recreate region region-worker
```

## Before starting

- [x] **Backup taken and restore-verified** — `backups/postgres-2026-09-21-pre-resync.dump` (1.8 GB).
      Restored into a scratch database: 69 propositions, 1,497 claims, 1,497 evidence,
      5,019 bills, 54 full texts. Only `vault.secrets` failed, which the postgres role
      cannot read by design.
- [x] Images rebuilt from `main` @ `70efa043`
- [x] 54 migrations applied, latest `20260921150000_source_version_derivation_link`
- [x] prompt-service healthy — HTTP 200, 32 active templates, database connected
- [x] Models present: `olmo-3.1:32b-instruct`, `olmo-3:7b-instruct`, `nomic-embed-text-v2-moe`, `qwen2.5vl:7b` (OCR). `qwen3.5:9b` removed.
- [x] Embeddings on `ollama` + `nomic-embed-text-v2-moe` (768), matching the corpus
- [x] Disk: 417 GB free, database 11 GB
- [x] Stack healthy on the new images — all 8 services, every LLM service recreated with the OLMo lanes
- [x] Region plugins enabled: **california, california-sonoma, federal** (3 of 60).
      The other 57 counties are dormant, so this run is scoped to those three —
      not "everything" in the sense of every county.

## Why the backup is not optional

A resync **overwrites `full_text` in place**, and #1306 made the derivation
**write-once** — the first extraction to reach a `source_versions` row wins
permanently. So the run is not idempotent, and if the rescrape were to yield
worse text than what is stored, the current corpus would be gone.

### Measured 2026-09-22: it did not

The first 46 propositions through the resync were compared against the
pre-resync dump, and every one came back **byte-identical**:

```
compared:        46
byte-identical:  46
CHANGED:          0
```

The extraction is deterministic — same PDF, same pdf-parse and Tesseract
output — so a rescrape reproduces the stored text rather than replacing it.

**This corrects the warning that stood here before.** It said #1305's content
transfer depends on `full_text` being byte-identical across both sides, that a
resync would break that, and that you therefore had to choose between
transferring to production first and resyncing. That is **wrong**: `full_text`
is unchanged, so the transfer remains viable after a resync. Production being
ten migrations behind is still the real blocker on transferring, and always was.

The backup is still worth taking — determinism is a measurement, not a
guarantee, and a changed source page would still overwrite — but it is
insurance rather than a one-way door.

The same check is worth re-running after any future resync:

```sql
-- against a restored pre-run snapshot
select count(*) filter (where new.full_text = old.full_text) as identical,
       count(*)                                              as compared
  from propositions new join old_propositions old using (external_id);
```

Also verified on the same 46: `source_versions.derived_text` equals the
`full_text` it indexes, and each `derived_text_hash` matches its own content —
46/46 on both. That is the invariant #1306 rests on, now confirmed against real
documents rather than fixtures.

## Watch for

**OCR glyph noise costs roughly 12 points of verification, independent of model.**
SCA 1's body reads `for a | recalled state officer`; models quote it as
`for a recalled state officer` — semantically right, character-wise wrong, so
quote-then-locate fails. Denoising stray glyphs recovered 4 of 9 quotes on that
measure. Worth more than any model swap, and not yet implemented.

**#1266 is live and understated.** ACA 22 reads `approved by a % vote` — the fraction
glyph is dropped, so the vote threshold is simply absent from the text being analysed.

**Corruption is concentrated in cover pages, not whole documents.** 25-0001's letterhead
is word-order-inverted; its body is fine. Do not judge a document by its first 300
characters.

### Live result, 2026-09-22

The predicted citation cost is showing up, and worse than the pilot suggested.
Each analysed measure logs a line like:

```
WARN Claim citations dropped: 5 unlocatable, 0 containing contact details (of 8 claims)
```

"Unlocatable" means the quote the model supplied cannot be found in the source
— the ellipsis-abridgement failure, not a contact-detail redaction.

| measurement | verbatim citations located |
|---|---|
| qwen3.5:9b, 4-proposition pilot | 72% (84% denoised) |
| olmo-3.1:32b, 4-proposition pilot | 49% (59% denoised) |
| **olmo-3.1:32b, live run** | **38%** |

Throughput is better than projected: ~2.5 min/measure rather than the 5.4
implied by the idle 325s figure, so 54 measures is ~2.5 h rather than 5.

## Baseline to measure against

Taken 2026-09-21, before the run:

```
propositions               69   (54 with full_text)
minutes                    56
claims (current)        1,497
evidence verified         164   of 1,497
source_versions             0   ← first sync populates this
rows/evidence linked        0   ← and this
```

The acceptance question for #1306 is whether a claim resolves end-to-end to a passage
in archived bytes against **real synced data** — the one criterion its PR could not
assert. After the sync:

```sql
select count(*) from source_versions where derived_text is not null;
select count(*) from evidence where source_version_id is not null;
```

## Rollback

```bash
docker compose -f docker-compose-uat.yml -f docker-compose-uat.local.yml down
docker exec -i opuspopuli-db psql -U postgres -c "drop database postgres;"  # see note
docker exec -i opuspopuli-db pg_restore -U postgres -d postgres --no-owner --no-acl \
  < backups/postgres-2026-09-21-pre-resync.dump
```

Note: `postgres` cannot be dropped while connections exist — stop the stack first, and
Supabase's own services hold connections too. In practice restoring into a fresh
database and repointing is less fight than dropping this one.
