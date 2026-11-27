-- What each shape was built from, so a changed source is noticed (#1475).
--
-- The display step and the shapes step both used to skip once anything
-- existed: one display layer that failed on first load, or a source changed
-- in config, then stayed missing or stale until a forced reload of every
-- boundary. Recording the source per row, and a fingerprint of the inputs
-- per frame, lets each step redo exactly what is missing or out of date.
--
-- Additive: two nullable text columns, no default, no rewrite.

-- The display source a row's display_boundary came from: the layer's
-- service URL and layer name. NULL where there's no display geometry.
ALTER TABLE "jurisdictions" ADD COLUMN "display_source" TEXT;

-- A hash of what the frames were built from (projection, sources, which
-- layers were complete). The region frame carries it; a different one means
-- rebuild.
ALTER TABLE "shape_frames" ADD COLUMN "fingerprint" TEXT;
