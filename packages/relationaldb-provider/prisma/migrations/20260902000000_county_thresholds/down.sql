-- Rollback for 20260902000000_county_thresholds (opuspopuli#1106).
--
-- Safe: both tables are new and nothing outside the California landing page
-- reads them. Dropping loses the ingested threshold facts, which #1107's script
-- reproduces from public records on demand. No existing table is touched, and
-- jurisdictions is untouched in both directions.

DROP TABLE IF EXISTS "county_adjacency";
DROP TABLE IF EXISTS "county_thresholds";
