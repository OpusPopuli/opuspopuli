import type { DocumentReadiness } from "@/lib/hooks/useDocumentDetection";
import { readSessionJson } from "@/lib/session-json";

/**
 * What the on-device document detector decided about the frame we captured.
 *
 * ── Why this is recorded at all ──────────────────────────────────────────
 *
 * #1049 asks for detection thresholds chosen from observed device behaviour.
 * They cannot be, because nothing has ever recorded what the detector observed.
 * Scan images are dropped on the device by design (#1075), so after the fact
 * there is no way to ask whether the deskew-crop fired, or which gate stopped
 * it. Tuning `minCoverage` / `minSharpness` / `minConfidence` today would be
 * tuning by feel on one developer's phone.
 *
 * Measured 2026-09-13 against a camera-app still, the detector reports
 * confidence 0.993 and coverage 0.816 against gates of 0.35 and 0.4 — it locks
 * on hard. That is not evidence about production: capture takes a VIDEO frame
 * (`canvas.width = video.videoWidth`), a different and much softer
 * distribution, and not one frame captured through the app has ever been
 * measured.
 *
 * ── Why it is safe to send ───────────────────────────────────────────────
 *
 * Six numbers about a decision. No pixels, no text, nothing that narrows down
 * what was photographed — which matters more here than usual, because a
 * petition page carries the names, addresses and signatures of people who are
 * not our users and never agreed to anything. This must not become a new sink
 * for their data, so it stays numeric forever: do not add a thumbnail, a
 * cropped strip, or an OCR snippet to this type.
 */
export interface CaptureMetrics {
  /** Detector's 0..1 confidence in the page quad it found. */
  readonly detectionConfidence: number;
  /** Fraction of the frame the detected page covers, 0..1. */
  readonly coverage: number;
  /** Laplacian-variance sharpness — unbounded, higher is sharper. */
  readonly sharpness: number;
  /**
   * Whether the deskew-crop actually ran, or capture fell back to the whole
   * frame. The single fact most needed and least available today: the eval
   * harness measured full frame at rank 6 and cropped at rank 1 on the same
   * photograph and the same OCR engine, so this bit alone separates a good
   * scan from a bad one.
   */
  readonly cropFired: boolean;
  /** Source video frame size, which is NOT the resolution we asked for. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/**
 * Build the metrics from a detector reading plus the crop outcome.
 *
 * Rounds the floats. Full double precision would carry far more bits than the
 * measurement means — sharpness varies run to run on an unchanged scene — and
 * those digits are pure noise in a column we intend to aggregate.
 */
export function toCaptureMetrics(
  readiness: DocumentReadiness,
  cropFired: boolean,
): CaptureMetrics {
  return {
    detectionConfidence: round(readiness.confidence, 4),
    coverage: round(readiness.coverage, 4),
    sharpness: round(readiness.sharpness, 2),
    cropFired,
    frameWidth: Math.round(readiness.frameWidth),
    frameHeight: Math.round(readiness.frameHeight),
  };
}

function round(value: number, places: number): number {
  // A non-finite reading means the detector produced nothing usable; 0 records
  // that honestly, where NaN would fail GraphQL Float serialisation and take
  // the whole scan down with it. Losing telemetry must never lose a scan.
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Read the metrics back out of the sessionStorage hop between the capture page
 * and the results page.
 *
 * Returns null on anything unexpected — absent key, malformed JSON, a payload
 * that is not shaped like metrics. Telemetry is strictly secondary to the scan
 * it describes, so a bad value must degrade to "not reported" and never throw:
 * this runs inside the results page's mount effect, where an exception would
 * abort the pipeline before OCR and leave the user on a dead screen holding a
 * photograph they cannot retake.
 */
export function readCaptureMetrics(): CaptureMetrics | null {
  return readSessionJson("petition-scan-capture", isCaptureMetrics);
}

function isCaptureMetrics(value: unknown): value is CaptureMetrics {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.detectionConfidence === "number" &&
    typeof m.coverage === "number" &&
    typeof m.sharpness === "number" &&
    typeof m.cropFired === "boolean" &&
    typeof m.frameWidth === "number" &&
    typeof m.frameHeight === "number"
  );
}
