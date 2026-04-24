-- Add AI-generated committee-assignment summary column to representatives.
-- See #594 Task 4 — one-sentence preamble describing the policy areas
-- touched by the rep's committee assignments. Nullable; only populated
-- for reps that have committees.
ALTER TABLE "representatives" ADD COLUMN "committees_summary" TEXT;
