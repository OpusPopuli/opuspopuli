-- #992: supersede amended filings, and reconcile against official totals.
--
-- (1) amend_id on the finance tables. CAL-ACCESS restates a filing on amendment
-- using NEW TRAN_ID/LINE_ITEM values, so the composite externalId cannot merge
-- the versions and both persist — filing 2505994 stores $339,123 against an
-- official $170,988. Retaining only max(amend_id) per filing needs the column.
--
-- INTEGER, not text, deliberately: AMEND_ID reaches 10, and under text ordering
-- '10' < '9', so max() would select amendment 9 as the latest and silently keep
-- the wrong version.
--
-- (2) filing_summaries holds SMRY_CD Form 460 summary lines — the totals each
-- committee reports itself. Reconciling itemized detail against them is what
-- found the defect above; stored, it becomes a standing check rather than a
-- manual exercise. It also exposes unitemized contributions (<$100), which
-- appear only on the summary and are otherwise invisible.
--
-- Additive: two nullable columns, two indexes, one new table. No drops, no
-- renames, no rewrites (ADD COLUMN with no default is catalog-only).
--
-- Data classification: PII, no PHI, and no NEW PII — filing_summaries is
-- aggregate amounts per filing with no donor detail. No RLS exists on any
-- finance table (none exists anywhere in this schema); access is mediated by
-- the region service.

ALTER TABLE "contributions" ADD COLUMN "amend_id" INTEGER;
ALTER TABLE "expenditures"  ADD COLUMN "amend_id" INTEGER;

-- Supersession scans per filing and compares amendments, so the index leads on
-- filing_id with amend_id second.
CREATE INDEX "contributions_filing_amend_idx" ON "contributions"("filing_id", "amend_id");
CREATE INDEX "expenditures_filing_amend_idx"  ON "expenditures"("filing_id", "amend_id");

CREATE TABLE "filing_summaries" (
    "id"            TEXT NOT NULL,
    "external_id"   TEXT NOT NULL,
    "filing_id"     VARCHAR(50) NOT NULL,
    -- Kept, not superseded: this is the summary OF an amendment, and
    -- reconciliation compares against the latest one specifically.
    "amend_id"      INTEGER,
    "form_type"     VARCHAR(20) NOT NULL,
    -- 47 distinct values on F460 alone, not all numeric.
    "line_item"     VARCHAR(10) NOT NULL,
    -- Observed range -60,000,000 to 195,446,000; negatives are real.
    "amount_a"      DECIMAL(14,2),
    "amount_b"      DECIMAL(14,2),
    "amount_c"      DECIMAL(14,2),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filing_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "filing_summaries_external_id_key" ON "filing_summaries"("external_id");
CREATE INDEX "filing_summaries_filing_id_idx" ON "filing_summaries"("filing_id");
-- Reconciliation looks up one line of one form for a filing.
CREATE INDEX "filing_summaries_lookup_idx"
    ON "filing_summaries"("filing_id", "form_type", "line_item");
