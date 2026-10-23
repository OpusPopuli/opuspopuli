-- Civics K1 (docs/plans/civics-phase-b.md): skip a civics page whose
-- extraction inputs are unchanged.
--
-- civics_page_extractions records, per crawled page, the skip key of the
-- last COMPLETED extraction (sha256 of readable text + prompt template hash
-- + model digest + data-source config hash, via buildSkipKey) and whether
-- it yielded a block or nothing. It is separate from civics_blocks because
-- a page with no civic content deliberately writes no block (#874) — a key
-- kept only on the block could never skip those pages, which were 13 of 24
-- in the 2026-10-23 baseline. Not written for a failure or for an empty
-- extraction over an existing block (#1335): both must retry.
CREATE TABLE "civics_page_extractions" (
    "id" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "skip_key" VARCHAR(80) NOT NULL,
    "outcome" VARCHAR(10) NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "civics_page_extractions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "civics_page_extractions_outcome_check"
      CHECK ("outcome" IN ('block', 'empty'))
);

-- One row per page; also serves lookups by region (leading column).
CREATE UNIQUE INDEX "civics_page_extractions_region_id_source_url_key"
  ON "civics_page_extractions"("region_id", "source_url");

-- Attribution (step 2): what input produced a block, not only which prompt
-- and model. Nullable — existing rows have none; a page's next extraction
-- fills them.
ALTER TABLE "civics_blocks"
  ADD COLUMN "source_text_hash" VARCHAR(64),
  ADD COLUMN "config_hash" VARCHAR(64);

-- A glossary definition could not say which model wrote it.
ALTER TABLE "glossary_entries"
  ADD COLUMN "llm_model" VARCHAR(80),
  ADD COLUMN "llm_digest" VARCHAR(80);
