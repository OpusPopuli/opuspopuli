-- #955: attribute independent expenditures to their committee + target.
-- S496_CD line items carry no committee id — the filer committee (FILER_ID) and
-- the IE target (candidate/measure + support/oppose) live on the Form 496 cover
-- page (CVR_CAMPAIGN_DISCLOSURE_CD, FORM_TYPE=F496), joined by FILING_ID. This
-- migration persists those cover pages (cvr_filings) and lets
-- IndependentExpenditureLinkerService stamp the committee post-sync.
--
-- Additive + widening only: a new table, a new nullable column, and relaxing an
-- existing NOT NULL — no drops/renames. Prod-safe: independent_expenditures is
-- currently empty on prod, so relaxing committee_id NOT NULL rewrites nothing.
-- Data classification: none — public CAL-ACCESS campaign-finance data (committee/
-- candidate/measure names). No PHI/PII; no RLS/masking concerns.

-- Form 496 cover-page map (mirrors cvr2_filings; persisted so the IE linker can
-- resolve filing_id -> filer_id -> committee independently of the sync cycle).
CREATE TABLE "cvr_filings" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "filing_id" VARCHAR(50) NOT NULL,
    "filer_id" VARCHAR(50) NOT NULL,
    "candidate_name" TEXT,
    "candidate_office" VARCHAR(50),
    "proposition_title" TEXT,
    "support_or_oppose" VARCHAR(10),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cvr_filings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cvr_filings_external_id_key" ON "cvr_filings"("external_id");
CREATE INDEX "cvr_filings_filing_id_idx" ON "cvr_filings"("filing_id");
CREATE INDEX "cvr_filings_filer_id_idx" ON "cvr_filings"("filer_id");

-- S496 line items arrive with no committee; committee_id is stamped post-sync by
-- the linker. Relax NOT NULL (FK stays ON DELETE RESTRICT) and add the FILING_ID
-- join key. Existing propositionId already follows this nullable-then-linked shape.
ALTER TABLE "independent_expenditures" ALTER COLUMN "committee_id" DROP NOT NULL;
ALTER TABLE "independent_expenditures" ADD COLUMN "filing_id" VARCHAR(50);

CREATE INDEX "independent_expenditures_filing_id_idx" ON "independent_expenditures"("filing_id");
