-- #1450: the receipt shown under each AI-written passage names when it was
-- generated. Every other AI output records that time; minutes summaries did
-- not. Additive, nullable, no backfill: `updated_at` moves on unrelated
-- writes (failure counters, linking), so it is not a generation time, and a
-- guessed date on a receipt would be worse than "not recorded". Existing
-- summaries stay NULL until they are next regenerated.
ALTER TABLE "minutes" ADD COLUMN "summary_generated_at" TIMESTAMPTZ;

COMMENT ON COLUMN "minutes"."summary_generated_at" IS
  'When the AI summary was generated; NULL for summaries written before #1450';
