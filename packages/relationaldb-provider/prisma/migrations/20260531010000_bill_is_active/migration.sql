-- Currently-moveable flag for OpusPopuli/opuspopuli#747. Pairs with the
-- earlier `is_dead` column to give a 3-way partition of the bill corpus:
--
--   is_active=TRUE,  is_dead=FALSE → moveable (citizen can still influence)
--   is_active=FALSE, is_dead=FALSE → passed/chaptered (enacted law)
--   is_active=FALSE, is_dead=TRUE  → vetoed, died, expired, etc.
--
-- The bills-list `Active / Inactive` segmented toggle filters on is_active;
-- the personalized feed hard-excludes anything with is_active = FALSE (a
-- chaptered bill isn't actionable either). Computed at sync write time by
-- domains/bill-lifecycle.ts::isBillActive — true iff status starts with
-- "Active Bill - ...".
--
-- Additive only — existing rows default to FALSE; the backfill script
-- (apps/region/.../scripts/backfill-bill-is-dead.ts) now flips the live
-- ones once after deploy in the same pass that sets is_dead.
--
-- Partial index on is_active = TRUE: the default bills-list filter and
-- the ranker both want "active only", so PG can read the partial index
-- directly. The is_active = FALSE case (Inactive segment) is exception
-- traffic and tolerates a full scan.

ALTER TABLE "bills"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "bills_is_active_idx" ON "bills" ("is_active") WHERE "is_active" = TRUE;
