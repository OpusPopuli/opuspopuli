-- Rollback for 20260907010000_proposition_jurisdiction_unique (opuspopuli#1164).
--
-- WARNING — this rollback can FAIL, by design. Restoring the global unique on
-- external_id requires that no two jurisdictions share one. Once a second
-- county is ingesting, duplicates across counties are expected and legitimate
-- (every county has a "Measure A"), so the CREATE UNIQUE INDEX below will
-- error rather than silently discard data.
--
-- If it fails, that is the constraint doing its job: decide which rows to keep
-- before rolling back. To see the conflicts:
--   SELECT external_id, array_agg(region_plugin_name), count(*)
--   FROM "propositions" GROUP BY external_id HAVING count(*) > 1;
--
-- Rolling back to a statewide-only table is the clean path:
--   DELETE FROM "propositions" WHERE "region_plugin_name" <> 'california';
-- (deliberately NOT executed here — a schema rollback must not silently
-- delete civic data.)

CREATE UNIQUE INDEX "propositions_external_id_key"
  ON "propositions"("external_id");

DROP INDEX IF EXISTS "propositions_region_plugin_name_external_id_key";
