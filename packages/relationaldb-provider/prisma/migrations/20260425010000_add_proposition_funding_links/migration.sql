-- Connect campaign-finance records to propositions.
--
-- Adds:
--   * CommitteeMeasurePositionType enum (support / oppose)
--   * committee_measure_positions join table — many-to-many committee↔proposition
--     with position + isPrimaryFormation flag (true when sourced authoritatively
--     from CVR2 Form 410 records, false when inferred from expenditures)
--   * cvr2_filings — raw CVR2_CAMPAIGN_DISCLOSURE_CD records persisted so the
--     proposition-finance-linker can run independently of the bulk-download cycle
--   * proposition_id FK on expenditures + independent_expenditures so aggregation
--     can join cleanly without string matching
--
-- All new columns / tables are additive. Existing rows are unaffected; the
-- linker populates the new FKs lazily after each campaign-finance sync.

-- 1. New enum --------------------------------------------------------------
CREATE TYPE "CommitteeMeasurePositionType" AS ENUM ('support', 'oppose');

-- 2. CommitteeMeasurePosition join table ----------------------------------
CREATE TABLE "committee_measure_positions" (
    "id" TEXT NOT NULL,
    "committee_id" TEXT NOT NULL,
    "proposition_id" TEXT NOT NULL,
    "position" "CommitteeMeasurePositionType" NOT NULL,
    "is_primary_formation" BOOLEAN NOT NULL DEFAULT false,
    "source_filing" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_measure_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "committee_measure_positions_committee_id_proposition_id_pos_key"
    ON "committee_measure_positions" ("committee_id", "proposition_id", "position");
CREATE INDEX "committee_measure_positions_proposition_id_position_idx"
    ON "committee_measure_positions" ("proposition_id", "position");

ALTER TABLE "committee_measure_positions"
    ADD CONSTRAINT "committee_measure_positions_committee_id_fkey"
    FOREIGN KEY ("committee_id") REFERENCES "committees" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "committee_measure_positions"
    ADD CONSTRAINT "committee_measure_positions_proposition_id_fkey"
    FOREIGN KEY ("proposition_id") REFERENCES "propositions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Cvr2Filing raw records -----------------------------------------------
CREATE TABLE "cvr2_filings" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "filing_id" VARCHAR(50) NOT NULL,
    "ballot_name" TEXT,
    "ballot_number" VARCHAR(50),
    "ballot_jurisdiction" VARCHAR(100),
    "support_or_oppose" VARCHAR(10),
    "source_system" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cvr2_filings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cvr2_filings_external_id_key" ON "cvr2_filings" ("external_id");
CREATE INDEX "cvr2_filings_filing_id_idx" ON "cvr2_filings" ("filing_id");
CREATE INDEX "cvr2_filings_ballot_name_idx" ON "cvr2_filings" ("ballot_name");

-- 4. proposition_id FK on expenditures ------------------------------------
ALTER TABLE "expenditures" ADD COLUMN "proposition_id" TEXT;
CREATE INDEX "expenditures_proposition_id_idx" ON "expenditures" ("proposition_id");
ALTER TABLE "expenditures"
    ADD CONSTRAINT "expenditures_proposition_id_fkey"
    FOREIGN KEY ("proposition_id") REFERENCES "propositions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. proposition_id FK on independent_expenditures ------------------------
ALTER TABLE "independent_expenditures" ADD COLUMN "proposition_id" TEXT;
CREATE INDEX "independent_expenditures_proposition_id_idx" ON "independent_expenditures" ("proposition_id");
ALTER TABLE "independent_expenditures"
    ADD CONSTRAINT "independent_expenditures_proposition_id_fkey"
    FOREIGN KEY ("proposition_id") REFERENCES "propositions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
