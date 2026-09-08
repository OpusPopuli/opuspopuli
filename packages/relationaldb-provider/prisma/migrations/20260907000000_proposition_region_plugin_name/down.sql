-- Rollback for 20260907000000_proposition_region_plugin_name (opuspopuli#1164).
--
-- Safe: the column carries no foreign key and no RLS policy, and the only
-- readers are PropositionsSyncService's stage backfill (which falls back to an
-- unscoped query when the plugin can't name itself) and the sync write path.
-- The index exists solely to serve #1139's future jurisdiction filter.
--
-- What is lost: the jurisdiction label on every row. That is recoverable by
-- re-running the syncs — each plugin re-stamps its own rows — but county and
-- statewide measures become indistinguishable again in the meantime, which is
-- the #1139 defect. Drop the county rows too if the rollback is meant to
-- restore a statewide-only table:
--   DELETE FROM "propositions" WHERE "region_plugin_name" <> 'california';
-- (deliberately NOT executed here — rolling back a schema change should not
-- silently delete civic data).

DROP INDEX IF EXISTS "propositions_region_plugin_name_idx";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "region_plugin_name";
