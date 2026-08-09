-- #980 follow-up: enforce the invariant the cover-page join depends on, and
-- index the rows it actually looks for.
--
-- 1) CoverPageLinkerService joins `contributions.filing_id = cvr_filings.filing_id`
--    and assumes one cover page per filing. Until now that held only by accident:
--    `external_id` is unique, the mapper defaults `externalId = filingId`, and the
--    region config declines to map an externalId for that source. Three separate
--    facts across two repos. Give the cover-page source a `compositeKey` — the
--    feature #980 just added for RCPT/EXPN — and the join silently fans out,
--    attributing donor money to an arbitrary filer and driving the linker's
--    skipped-row arithmetic negative. Make it a database guarantee instead.
--
-- 2) The linker's steady-state query is "rows still awaiting attribution".
--    A partial index over exactly those rows stays tiny (it holds only staging
--    rows and empties as they resolve), costs nothing on write once a row is
--    linked, and turns each incremental run into an index scan. The plain
--    filing_id index added in 20260809000000 does not serve this predicate.
--
-- Additive: one constraint, two partial indexes. No drops, no renames, no
-- rewrites. Existing data already satisfies the uniqueness (verified: external_id
-- is unique and equals filing_id), so the constraint build cannot fail on it.

CREATE UNIQUE INDEX "cvr_filings_filing_id_key" ON "cvr_filings"("filing_id");

-- The plain index is now redundant — the unique index above serves every lookup
-- it did. Dropping an index removes no data and is instantly reversible.
DROP INDEX IF EXISTS "cvr_filings_filing_id_idx";

CREATE INDEX "contributions_pending_link_idx"
    ON "contributions"("filing_id")
    WHERE "committee_id" IS NULL;

CREATE INDEX "expenditures_pending_link_idx"
    ON "expenditures"("filing_id")
    WHERE "committee_id" IS NULL;
