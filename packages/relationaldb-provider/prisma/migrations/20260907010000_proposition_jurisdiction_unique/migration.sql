-- Scope proposition uniqueness to the jurisdiction (opuspopuli#1164).
--
-- `external_id` was globally unique, which was correct while every row was a
-- California statewide measure. It stops being correct the moment county rows
-- land: every county letters its measures A, B, C…, and the sync upserts on
-- `where: { externalId }`. County B writing "Measure A" would MATCH county A's
-- row and overwrite its title, summary, full_text, status, election date and
-- source URL, then re-stamp region_plugin_name to the new plugin — silently
-- destroying the first county's measure and removing it from its own plugin's
-- backfill scope. `propositions.external_id` is also the petition-scanner join
-- key, so a hijacked row mis-links scanned petition sheets to the wrong measure.
--
-- Nothing outside the sync path depended on the global constraint: every
-- `findUnique` on this table keys on `id`, and the scanner link uses a
-- `findFirst` with a `contains` match. Verified before writing this.
--
-- Safe on existing data: the constraint is being WEAKENED (a strict superset
-- of what was permitted stays permitted), so no row can violate the new index.
-- The old index is dropped after the new one exists, leaving no window in
-- which duplicates could be inserted.
--
-- Requires a coordinated deploy — the sync must upsert on the compound key
-- from the same release. docker-compose gates every service on db-migrate
-- completing, so the ordering is enforced.

CREATE UNIQUE INDEX "propositions_region_plugin_name_external_id_key"
  ON "propositions"("region_plugin_name", "external_id");

DROP INDEX IF EXISTS "propositions_external_id_key";
