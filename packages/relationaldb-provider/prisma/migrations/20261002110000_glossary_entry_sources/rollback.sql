-- Rollback for 20261002110000_glossary_entry_sources.
--
-- Lossless: every row in this table is derivable from `civics_blocks.glossary`
-- by re-running a civics sync, and nothing outside it references the table.
-- Dropping it also drops its two foreign keys and three indexes.
--
-- What rollback does NOT restore is any `glossary_entries` row that the
-- application prune retired while the table existed. That prune only fires
-- when a term's last defining page is gone, so the term had no page left to
-- support it — re-running the sync is the correct way back, not this file.

DROP TABLE IF EXISTS "glossary_entry_sources";
