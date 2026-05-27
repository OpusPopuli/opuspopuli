-- Bill enrichment for OpusPopuli/opuspopuli#741 (personalized bill feed, epic #740).
-- Adds structured AI summary fields populated by the bill-analysis prompt-service
-- endpoint. JSONB on the bill row keeps storage simple; consumers read the
-- structured shape via the GraphQL BillAiSummary model. ai_summary_version
-- enables re-enrichment when the prompt template version bumps without re-
-- running the bill-extraction step.
--
-- Additive only — existing bills get NULL; the next bills sync enriches them.

ALTER TABLE "bills"
  ADD COLUMN "ai_summary"              JSONB,
  ADD COLUMN "ai_summary_version"      VARCHAR(20),
  ADD COLUMN "ai_summary_generated_at" TIMESTAMPTZ;
