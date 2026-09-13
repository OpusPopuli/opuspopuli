-- What the on-device document detector decided, per scan (opuspopuli#1049).
--
-- ── The question these answer ────────────────────────────────────────────
--
-- #1049 asks for detection thresholds "chosen from observed device behavior".
-- They cannot be: nothing records what the detector observed. Scan images are
-- never persisted (by design, #1075), so after the fact there is no way to ask
-- whether the deskew-crop fired, or which gate stopped it.
--
-- Measured 2026-09-13, and the gap is not academic. Against a camera-app still
-- the detector reports confidence 0.993 and coverage 0.816 against gates of
-- 0.35 and 0.4 — it locks on hard. But that still never went through the app.
-- Production captures a VIDEO frame (`canvas.width = video.videoWidth`), which
-- is a different distribution, and not one frame of it has ever been measured.
-- Tuning a threshold against the wrong distribution is how the current values
-- were set in the first place.
--
-- ── Why this is numbers and not pixels ───────────────────────────────────
--
-- Petition scans carry third-party personal information — names, addresses and
-- signatures of people who are not our users. The image is dropped on the
-- device and its OCR text is the only thing retained. These columns keep that
-- property: six numbers describing a decision, nothing that could reconstruct
-- what was photographed. No new personal-data sink.
--
-- Nullable throughout. Scans from before this column existed, and any client
-- that does not send the metrics, record NULL — which is honest rather than
-- zero, and distinguishes "not reported" from "detector found nothing".

ALTER TABLE "documents" ADD COLUMN "capture_detection_confidence" DOUBLE PRECISION;
ALTER TABLE "documents" ADD COLUMN "capture_coverage" DOUBLE PRECISION;
ALTER TABLE "documents" ADD COLUMN "capture_sharpness" DOUBLE PRECISION;

-- The single fact most needed and least available today: did the crop happen,
-- or did capture fall back to the whole frame?
ALTER TABLE "documents" ADD COLUMN "capture_crop_fired" BOOLEAN;

-- Frame dimensions answer a second open question at no extra cost: what
-- resolution the video stream actually delivers on real devices, against the
-- 1280x720 / 1920x1080 / 2560x1440 the app requests as `ideal`.
ALTER TABLE "documents" ADD COLUMN "capture_frame_width" INTEGER;
ALTER TABLE "documents" ADD COLUMN "capture_frame_height" INTEGER;
