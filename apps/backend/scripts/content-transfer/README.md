# Content transfer (#1305)

Move locally-regenerated AI content to another database instead of re-running
the model there. The expensive half of a refresh is inference — ~550 s per
measure on `olmo-3.1:32b-instruct`, days across the corpus — and the node
shares its Ollama with the nightly cron.

## What makes it safe

Every analysis records the hash of the text it was generated against (#1279).
The import re-hashes the **target's** text and refuses any row that differs, so
an analysis is never written onto text it never saw. That is verification, not
trust.

Evidence is **not transferred**. The bundle carries claim *content*; the import
re-runs the verify-or-snap gate against the target's own text and compares the
resulting distribution with the bundle's. Copied verdicts would be trusted;
re-derived ones are verified.

## Usage

```bash
# 1. Export from the source (dev)
cd apps/backend
DATABASE_URL=… npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/content-transfer/export.ts --out bundle.json --label local-dev

# 2. Dry run against the target — reports every refusal, writes nothing
DATABASE_URL=… npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/content-transfer/import.ts --in bundle.json

# 3. Apply, once the dry run reads as expected
DATABASE_URL=… npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/content-transfer/import.ts --in bundle.json --apply
```

Exit codes: `0` applied cleanly, `2` some rows refused, `1` error.

## Rules it will not break

| | |
|---|---|
| Carries only `propositions`, `minutes`, `representatives` | The table list is a constant, not a parameter. No `users`, `documents`, `audit_logs` or any other personal-data table |
| Never creates a civic row | Creating measures is sync's job; a missing row is refused and named |
| Never deletes | Content the target has and the bundle lacks is left alone — absence means "no opinion" |
| Dry run by default | `--apply` is required to write |
| Natural keys | Primary keys diverge between databases. Propositions key on `(region_plugin_name, external_id)`, the others on `external_id` |

## Before you run it

The target must be **migrated to the evidence graph** (#1291) — the import
checks and says so plainly rather than failing deep inside a transaction.

Source text must not change between export and apply. The import re-verifies
at apply time, so drift is refused rather than silently written, but a
proposition sync mid-window will cost you those rows.
