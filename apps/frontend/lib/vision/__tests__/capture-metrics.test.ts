import {
  toCaptureMetrics,
  readCaptureMetrics,
  type CaptureMetrics,
} from "../capture-metrics";
import type { DocumentReadiness } from "@/lib/hooks/useDocumentDetection";

const readiness = (
  overrides: Partial<DocumentReadiness> = {},
): DocumentReadiness => ({
  ready: true,
  hint: "ready",
  coverage: 0.8164,
  sharpness: 10472.318,
  quad: null,
  confidence: 0.9931,
  frameWidth: 1920,
  frameHeight: 1080,
  ...overrides,
});

const valid: CaptureMetrics = {
  detectionConfidence: 0.9931,
  coverage: 0.8164,
  sharpness: 10472.32,
  cropFired: true,
  frameWidth: 1920,
  frameHeight: 1080,
};

describe("toCaptureMetrics", () => {
  it("carries the detector's reading and the crop outcome", () => {
    expect(toCaptureMetrics(readiness(), true)).toEqual(valid);
  });

  it("records that the crop did not fire", () => {
    expect(toCaptureMetrics(readiness(), false).cropFired).toBe(false);
  });

  /**
   * Sharpness varies run to run on an unchanged scene, so the tail digits of a
   * double are noise in a column we intend to aggregate. Rounding is not
   * cosmetic — it keeps the stored precision honest about the measurement.
   */
  it("rounds to the precision the measurement actually carries", () => {
    const m = toCaptureMetrics(
      readiness({ confidence: 0.123456789, sharpness: 1.23456789 }),
      true,
    );

    expect(m.detectionConfidence).toBe(0.1235);
    expect(m.sharpness).toBe(1.23);
  });

  /**
   * The detector divides by frame area and by edge counts, so a degenerate
   * frame yields NaN or Infinity. GraphQL Float cannot serialise either: the
   * mutation would fail, and a scan would be LOST over telemetry about itself.
   * Recording 0 keeps the scan and is a defensible reading of "nothing found".
   */
  it("does not let a non-finite reading fail the scan", () => {
    const m = toCaptureMetrics(
      readiness({
        confidence: Number.NaN,
        coverage: Number.POSITIVE_INFINITY,
        sharpness: Number.NaN,
      }),
      false,
    );

    expect(m.detectionConfidence).toBe(0);
    expect(m.coverage).toBe(0);
    expect(m.sharpness).toBe(0);
    expect(
      Object.values(m).every(
        (v) => typeof v !== "number" || Number.isFinite(v),
      ),
    ).toBe(true);
  });

  it("rounds fractional frame dimensions to whole pixels", () => {
    const m = toCaptureMetrics(
      readiness({ frameWidth: 1919.6, frameHeight: 1080.4 }),
      true,
    );

    expect(m.frameWidth).toBe(1920);
    expect(m.frameHeight).toBe(1080);
  });
});

describe("readCaptureMetrics", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips what toCaptureMetrics wrote", () => {
    sessionStorage.setItem("petition-scan-capture", JSON.stringify(valid));

    expect(readCaptureMetrics()).toEqual(valid);
  });

  it("returns null when nothing was written", () => {
    expect(readCaptureMetrics()).toBeNull();
  });

  /**
   * These run inside the results page's mount effect, after `hasStarted` is
   * set. A throw there aborts the pipeline BEFORE OCR and strands the user on
   * a dead screen holding a photograph they cannot retake — so every bad input
   * must degrade to "not reported", never to an exception.
   */
  it("does not throw on malformed JSON", () => {
    sessionStorage.setItem("petition-scan-capture", "{not json");

    expect(readCaptureMetrics()).toBeNull();
  });

  it("rejects a payload missing fields rather than sending a partial row", () => {
    sessionStorage.setItem(
      "petition-scan-capture",
      JSON.stringify({ coverage: 0.5 }),
    );

    expect(readCaptureMetrics()).toBeNull();
  });

  it("rejects wrongly-typed fields", () => {
    sessionStorage.setItem(
      "petition-scan-capture",
      JSON.stringify({ ...valid, cropFired: "true" }),
    );

    expect(readCaptureMetrics()).toBeNull();
  });

  it("rejects a JSON scalar where an object is expected", () => {
    sessionStorage.setItem("petition-scan-capture", "null");
    expect(readCaptureMetrics()).toBeNull();

    sessionStorage.setItem("petition-scan-capture", "42");
    expect(readCaptureMetrics()).toBeNull();
  });
});
