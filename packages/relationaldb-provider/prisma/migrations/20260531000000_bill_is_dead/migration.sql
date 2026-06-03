-- Procedurally-dead flag for OpusPopuli/opuspopuli#747. Pairs with the
-- sibling `is_active` column (added in the next migration) to give a 3-way
-- partition of the bill corpus: active | passed/chaptered | dead.
--
-- Computed at sync write time from (status, currentStageId, sessionYear,
-- lastAction, lastActionDate) by domains/bill-lifecycle.ts::isBillDead.
-- Used by admin/research surfaces and the bill-detail banner; no list query
-- filters on this column directly (the personalized feed + bills resolver
-- both filter on `is_active` instead). A partial index would only earn its
-- write amplification if a future query hit `WHERE is_dead = TRUE` at
-- scale — none exists today.
--
-- Additive only — existing rows default to FALSE; the backfill script
-- (apps/region/.../scripts/backfill-bill-is-dead.ts) flips the dead ones
-- once after deploy in the same pass that sets is_active.

ALTER TABLE "bills"
  ADD COLUMN "is_dead" BOOLEAN NOT NULL DEFAULT FALSE;
