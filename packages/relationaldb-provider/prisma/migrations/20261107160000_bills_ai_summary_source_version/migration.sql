-- bills-phase-b.md, K6: a current bill's summary is regenerated when the
-- prompt template, the model build or the bill's text changes. Prompt and
-- model are recorded on each summary already; this records the export
-- version the summary was written from, which also says which text it
-- describes. Additive, nullable, no backfill: NULL counts as stale for an
-- export bill, so each is regenerated once, inside the per-sync cap.
ALTER TABLE "bills" ADD COLUMN "ai_summary_source_version" VARCHAR(30);

COMMENT ON COLUMN "bills"."ai_summary_source_version" IS
  'Export bill_version_id the summary was written from; NULL when unknown or page-sourced';
