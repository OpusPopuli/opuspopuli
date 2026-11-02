-- Meetings Phase B step 4 (docs/plans/meetings-phase-b.md §4b, §4c / D5).
-- Additive only: two nullable columns, no index, no backfill.

-- The manifest's config axis (§4b): a hash of the data-source fields the
-- structural-analysis prompt is given (dataType, contentGoal, category,
-- hints). Without it, a hint edit never re-derives a manifest. NULL is a
-- manifest saved before this column existed (all 13 active ones today): it is
-- stamped with the current hash on its next use, not re-derived — the
-- legacy rule the output skip keys use.
ALTER TABLE "structural_manifests"
    ADD COLUMN "config_hash" VARCHAR(64);

-- The skip key under which this row's last summary attempt FAILED (D5).
-- While the live key equals it, the row is not retried: the same prompt,
-- model, text and config failed last time and will again (3 documents on UAT
-- hit the output cap on every sync). Any axis moving clears the skip.
-- Cleared on a successful write. 'sk1-' + sha256 hex = 68 chars.
ALTER TABLE "minutes"
    ADD COLUMN "summary_failed_key" VARCHAR(80);
