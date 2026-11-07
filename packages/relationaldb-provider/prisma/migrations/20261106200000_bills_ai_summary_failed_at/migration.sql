-- bills-phase-b.md, UAT run 2: a bill whose summary fails (too long for the
-- model, or no JSON back) was a candidate again first thing every sync, so
-- the same few tripped the five-failure abort each night. Additive, nullable,
-- no backfill: existing bills have never recorded a failure.
ALTER TABLE "bills" ADD COLUMN "ai_summary_failed_at" TIMESTAMPTZ;

COMMENT ON COLUMN "bills"."ai_summary_failed_at" IS
  'Last failed summary attempt; skipped as a candidate for 7 days, cleared on success';
