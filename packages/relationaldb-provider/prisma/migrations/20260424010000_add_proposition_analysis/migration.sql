-- AI-backed civic analysis fields for ballot propositions. Populated by
-- PropositionAnalysisService from the extracted PDF fullText so the
-- frontend Layer 1/2/4 stop showing "Coming Soon" placeholders.
--
-- All columns are nullable so existing rows remain valid until the
-- backfill + ingestion hook populate them. See bio_claims (#602) and
-- committees_summary (#594) for the JSONB + per-claim attribution
-- precedent this mirrors.

ALTER TABLE "propositions" ADD COLUMN "analysis_summary" TEXT;
ALTER TABLE "propositions" ADD COLUMN "key_provisions" JSONB;
ALTER TABLE "propositions" ADD COLUMN "fiscal_impact" TEXT;
ALTER TABLE "propositions" ADD COLUMN "yes_outcome" TEXT;
ALTER TABLE "propositions" ADD COLUMN "no_outcome" TEXT;
ALTER TABLE "propositions" ADD COLUMN "existing_vs_proposed" JSONB;
ALTER TABLE "propositions" ADD COLUMN "analysis_sections" JSONB;
ALTER TABLE "propositions" ADD COLUMN "analysis_claims" JSONB;
ALTER TABLE "propositions" ADD COLUMN "analysis_source" VARCHAR(20);
ALTER TABLE "propositions" ADD COLUMN "analysis_prompt_hash" VARCHAR(64);
ALTER TABLE "propositions" ADD COLUMN "analysis_generated_at" TIMESTAMPTZ;
