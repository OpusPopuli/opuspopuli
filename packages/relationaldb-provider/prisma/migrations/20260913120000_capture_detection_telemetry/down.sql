-- Rollback of the capture-detection telemetry (opuspopuli#1049).
--
-- Drops six nullable columns holding numbers about a capture decision. Nothing
-- else reads them and no personal data is involved, so this loses only the
-- accumulated measurements — which is the entire point of the columns, so do
-- not run this while the threshold tuning it feeds is still outstanding.

ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_frame_height";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_frame_width";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_crop_fired";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_sharpness";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_coverage";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "capture_detection_confidence";
