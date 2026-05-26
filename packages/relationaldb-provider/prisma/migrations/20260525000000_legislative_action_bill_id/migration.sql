-- Per-bill legislative action linkage for opuspopuli#666 (weekly histories).
-- Additive only: existing rows get NULL; subsequent linker passes will
-- populate via canonical bill-citation matching against the bills table.

ALTER TABLE "legislative_actions"
  ADD COLUMN "bill_id" TEXT;

ALTER TABLE "legislative_actions"
  ADD CONSTRAINT "legislative_actions_bill_id_fkey"
  FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "legislative_actions_bill_id_date_idx"
  ON "legislative_actions"("bill_id", "date" DESC);
