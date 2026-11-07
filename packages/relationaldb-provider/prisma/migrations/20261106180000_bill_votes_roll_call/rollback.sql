-- Rollback for 20261106180000_bill_votes_roll_call. Drops the extra same-day
-- roll calls so the narrower key can be restored; the next pubinfo import
-- derives them again once the column is back.
DROP INDEX IF EXISTS "bill_votes_bill_id_representative_id_vote_date_chamber_roll_key";
DELETE FROM "bill_votes" v USING "bill_votes" w
  WHERE v."bill_id" = w."bill_id"
    AND v."representative_id" = w."representative_id"
    AND v."vote_date" = w."vote_date"
    AND v."chamber" = w."chamber"
    AND v."id" > w."id";
CREATE UNIQUE INDEX "bill_votes_bill_id_representative_id_vote_date_chamber_key"
  ON "bill_votes" ("bill_id", "representative_id", "vote_date", "chamber");
ALTER TABLE "bill_votes" DROP COLUMN IF EXISTS "roll_call";
