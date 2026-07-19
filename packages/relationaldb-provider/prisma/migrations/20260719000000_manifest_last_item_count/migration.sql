-- #911: persist the item count from the last successful extraction so the
-- self-healing validator can detect a *drop* (e.g. 13 → 1) rather than only a
-- total zero. Without a stored baseline `previousItemCount` was always
-- undefined and the count-drift check was dead code. Additive, nullable column
-- — no rewrite, prod-safe. Backfills as NULL (drift check no-ops until the
-- first successful extraction records a baseline).
ALTER TABLE "structural_manifests" ADD COLUMN "last_item_count" INTEGER;
