-- Propositions carry their ingesting region plugin (opuspopuli#1164, the
-- minimal slice of #1139).
--
-- Today every proposition row is a California statewide measure, but only by
-- accident of timing: the moment Sonoma's registrar sync lands county ballot
-- measures (#1164), state and county rows would sit in one table with no
-- discriminator. This column records which region plugin ingested the row —
-- 'california' for the state SOS/OAG sources, 'california-sonoma' for the
-- county registrar — matching DeclarativeRegionPlugin.getName().
--
-- Additive only: one column with a DEFAULT plus one index. The default doubles
-- as the backfill — every pre-existing row IS a statewide 'california' measure
-- (#1139 AC1) — and keeps any insert path that predates the stamped write from
-- failing; it labels such a row with today's single-state reality instead.
-- Both sync write paths stamp the value explicitly from the same release.
--
-- Deliberately NOT a foreign key to region_plugins: plugin rows are
-- enable/disable state that can be removed and re-registered, and the
-- propositions table must not lose civic data to a plugin lifecycle event.
-- The full jurisdiction surface (GraphQL filter, UI badge, briefing scope)
-- stays in #1139.
--
-- Indexed because #1139's list filter and the briefing scope query will both
-- select on it, and unlike the 52-row present, the table grows per county
-- onboarded.

ALTER TABLE "propositions" ADD COLUMN "region_plugin_name" TEXT NOT NULL DEFAULT 'california';

CREATE INDEX "propositions_region_plugin_name_idx" ON "propositions"("region_plugin_name");
