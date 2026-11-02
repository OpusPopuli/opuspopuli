-- Meetings Phase B step 4, D5 revisited (docs/plans/meetings-phase-b.md §4c).
-- Additive only. One failure under a key is not a verdict: at temperature 0.2
-- output length varies, and 2 of the 3 documents that hit the 4000-token
-- ceiling on every step 3 attempt fit on a later one under the same key
-- (UAT, 2026-11-01). summary_failed_key is now retried until it has failed
-- this many times. Zero for every existing row: no failure has been counted.
ALTER TABLE "minutes"
    ADD COLUMN "summary_failed_attempts" INTEGER NOT NULL DEFAULT 0;
