-- bills-phase-b.md, review of the final diff: the ledger records an import
-- complete before the derive runs, and the bills to derive were held only in
-- memory, so a derive that died left its bills stale until a line changed.
-- Each mirrored bill now records when it was last derived; the derive takes
-- every bill whose mirror rows changed after that. NULL = never derived, so
-- the first sync after this derives every bill once.
ALTER TABLE "pubinfo_bills" ADD COLUMN "derived_at" TIMESTAMPTZ;

COMMENT ON COLUMN "pubinfo_bills"."derived_at" IS
  'When bills/co-authors/votes were last derived from this bill''s mirror rows; NULL = never';

-- A changed motion re-derives only the bills whose votes use it.
CREATE INDEX "pubinfo_bill_detail_votes_motion_id_idx"
  ON "pubinfo_bill_detail_votes" ("motion_id");
