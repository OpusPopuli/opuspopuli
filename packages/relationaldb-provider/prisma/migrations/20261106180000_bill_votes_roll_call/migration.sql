-- bills-phase-b.md, UAT run 1: bill_votes kept one vote per member per bill
-- per day per chamber, so same-day roll calls from the pubinfo export
-- collapsed (1,803 groups on 2026-11-05; SB 280 kept 208 of 524 votes).
-- Additive: a roll-call column with a default, and the unique key widened to
-- include it. Page-path rows keep '' and so keep their one-per-day dedupe.
ALTER TABLE "bill_votes" ADD COLUMN "roll_call" VARCHAR(100) NOT NULL DEFAULT '';

COMMENT ON COLUMN "bill_votes"."roll_call" IS
  'Source roll-call identity (pubinfo: location:vote_date_time:vote_date_seq); empty when the source gives none';

DROP INDEX "bill_votes_bill_id_representative_id_vote_date_chamber_key";

CREATE UNIQUE INDEX "bill_votes_bill_id_representative_id_vote_date_chamber_roll_key"
  ON "bill_votes" ("bill_id", "representative_id", "vote_date", "chamber", "roll_call");
