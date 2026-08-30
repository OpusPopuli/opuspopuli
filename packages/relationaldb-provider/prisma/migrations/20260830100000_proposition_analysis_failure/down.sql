-- Rollback for 20260830100000_proposition_analysis_failure (opuspopuli#1085).
--
-- Safe: both columns are nullable, carry no foreign keys, are referenced by no
-- index or RLS policy, and nothing outside PropositionAnalysisService reads
-- them. Dropping them loses the recorded failure reasons and nothing else —
-- the analyses themselves live in other columns.

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "analysis_failed_at";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "analysis_failure_reason";
