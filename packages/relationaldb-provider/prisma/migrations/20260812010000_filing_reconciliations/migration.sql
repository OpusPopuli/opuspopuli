-- #992 (subtask 4b): reconcile itemized detail against each filing's own totals.
--
-- Comparing summed detail against the committee's reported Form 460 figure is
-- what found the amendment double-count. Stored, it stops being a manual
-- exercise and becomes a standing property of every sync.
--
-- Two distinct readings come out of the same comparison, and conflating them
-- would make the table useless:
--
--   detail  >  reported   A FAULT. We are counting money the committee never
--                         reported — double-counted amendments, mis-attributed
--                         rows, a schedule summed that should not have been.
--
--   detail  <  reported   EXPECTED, and itself a finding. Schedule A itemizes
--                         only contributions of $100 or more, so the gap is
--                         unitemized small-donor money that exists nowhere in
--                         the detail. Measured across all 122,033 F460 filings,
--                         59% sit here. Without it a candidate funded by many
--                         small donors reads as less funded than one funded by
--                         a few large ones — a substantive distortion on a
--                         transparency platform, not a rounding detail.
--
-- Hence `status` rather than a boolean, and hence storing both figures rather
-- than only the delta: the delta alone cannot distinguish "we are wrong" from
-- "the source itemizes less than it totals".
--
-- Grain is one row per filing, at its surviving amendment. `filing_id` is
-- UNIQUE so a re-run upserts rather than accumulating history — the previous
-- verdict describes data that no longer exists.
--
-- Data classification: PII, no PHI, and no NEW PII. Every column is an
-- aggregate over a filing; no donor detail reaches this table. No RLS on any
-- finance table (none exists anywhere in this schema); access is mediated by
-- the region service.

CREATE TABLE "filing_reconciliations" (
    "id"                        TEXT NOT NULL,
    "filing_id"                 VARCHAR(50) NOT NULL,
    -- The amendment actually compared. Recorded because a later sync can move
    -- it, and a verdict is only meaningful against the version it was drawn on.
    "amend_id"                  INTEGER,
    -- Stamped from the detail rows, which the cover-page linker has already
    -- attributed by the time this runs. Nullable: attribution can fail.
    "committee_id"              TEXT,

    -- Form 460 line 1 column A — monetary contributions, as reported.
    "reported_contributions"    DECIMAL(14,2),
    -- Sum of stored Schedule A rows. Schedule A ALONE: 'C' (nonmonetary), 'I'
    -- (misc increases) and non-460 rows share the source file, and summing them
    -- against line 1 flags 29% of filings as faulty against a true rate of 0.31%.
    "itemized_contributions"    DECIMAL(14,2),
    -- reported - itemized, when positive. This is the unitemized (<$100) money.
    "unitemized_contributions"  DECIMAL(14,2),
    "contribution_status"       VARCHAR(20) NOT NULL,

    -- Form 460 line 6 column A — payments made. Schedule E ALONE: 'D' is a memo
    -- schedule restating E entries, so summing both double-counts 4.8M rows.
    -- Present for #991, which has a 40% shortfall and no independent check.
    "reported_expenditures"     DECIMAL(14,2),
    "itemized_expenditures"     DECIMAL(14,2),
    "expenditure_status"        VARCHAR(20) NOT NULL,

    "reconciled_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filing_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "filing_reconciliations_filing_id_key"
    ON "filing_reconciliations"("filing_id");

-- The point of the table: pull every filing whose detail exceeds what was
-- reported. Plain rather than partial indexes despite that being the only
-- query — a partial index cannot be expressed in schema.prisma, and the drift
-- would have every later `prisma migrate` try to reconcile it away. Selectivity
-- survives anyway: OVER_ITEMIZED is ~0.3% of rows, so the planner uses these.
CREATE INDEX "filing_reconciliations_contribution_status_idx"
    ON "filing_reconciliations"("contribution_status");
CREATE INDEX "filing_reconciliations_expenditure_status_idx"
    ON "filing_reconciliations"("expenditure_status");

-- Committee-level rollups of unitemized money.
CREATE INDEX "filing_reconciliations_committee_id_idx"
    ON "filing_reconciliations"("committee_id");
