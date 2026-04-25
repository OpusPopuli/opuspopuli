-- Per-sentence attribution (BioClaim[]) for AI-generated biographies.
-- See #602. Stored as JSONB; null for scraped bios.
ALTER TABLE "representatives" ADD COLUMN "bio_claims" JSONB;
