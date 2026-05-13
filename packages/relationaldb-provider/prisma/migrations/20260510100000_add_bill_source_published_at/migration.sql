-- Add source_published_at to bills table.
-- Stores the "Date Published" timestamp scraped from the bill text page,
-- used to skip LLM re-extraction when the bill hasn't changed since the
-- last sync run.
ALTER TABLE "bills" ADD COLUMN "source_published_at" TIMESTAMPTZ;
