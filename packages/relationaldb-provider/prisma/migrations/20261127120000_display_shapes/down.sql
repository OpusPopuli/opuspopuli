-- Rollback for 20261127120000_display_shapes (opuspopuli#1475).
-- Safe: the tables are new, and the column is display-only and nullable.
-- Everything dropped is rebuilt from the region config by the next boundary sync.
DROP TABLE IF EXISTS "jurisdiction_shapes";
DROP TABLE IF EXISTS "shape_frames";
ALTER TABLE "jurisdictions" DROP COLUMN IF EXISTS "display_boundary";
