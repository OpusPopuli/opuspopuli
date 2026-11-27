-- Rollback for 20261127140000_shape_sources (opuspopuli#1475).
-- Safe: both columns are bookkeeping the next sync rewrites.
ALTER TABLE "shape_frames" DROP COLUMN IF EXISTS "fingerprint";
ALTER TABLE "jurisdictions" DROP COLUMN IF EXISTS "display_source";
