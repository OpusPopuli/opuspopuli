-- Stage data foundation: bundled additive columns for #689 + #679

-- #679: lifecycle stage id on propositions
ALTER TABLE "propositions" ADD COLUMN "lifecycle_stage_id" VARCHAR(100);
CREATE INDEX "propositions_lifecycle_stage_id_idx" ON "propositions"("lifecycle_stage_id");

-- #689: journal-driven status re-check flag on bills
ALTER TABLE "bills" ADD COLUMN "needs_status_recheck" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "bills_needs_status_recheck_idx" ON "bills"("needs_status_recheck");
