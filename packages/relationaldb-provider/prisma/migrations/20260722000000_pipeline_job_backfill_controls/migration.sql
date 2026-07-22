-- Operator-facing meetings historical-backfill controls on the region-sync job.
-- `syncRegionData` now accepts `maxDocuments` (override pdf_archive maxNew) and
-- `resetWatermark` (ignore the ingestion watermark for one run) — persisted here
-- for observability, mirroring max_reps / max_bills. Additive, nullable columns
-- — no rewrite, prod-safe.
ALTER TABLE "pipeline_jobs" ADD COLUMN "max_documents" INTEGER;
ALTER TABLE "pipeline_jobs" ADD COLUMN "reset_watermark" BOOLEAN;
