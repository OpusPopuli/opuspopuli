import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  contentTokens,
  scoreDivergence,
  omissionSignal,
  calibrateDivergence,
  MIN_CALIBRATION_SAMPLES,
} from "./divergence.js";

describe("contentTokens", () => {
  test("keeps words and drops Tesseract's short noise", () => {
    // Tesseract's failures concentrate in short strings and digit soup.
    const t = contentTokens(
      "ESTABLISHES a| 3 xx voter identification ~~ 95814",
    );
    assert.ok(t.has("establishes"));
    assert.ok(t.has("voter"));
    assert.ok(t.has("identification"));
    assert.ok(!t.has("xx"));
    assert.ok(!t.has("95814"));
  });

  test("is case-insensitive and deduplicates", () => {
    const t = contentTokens("VOTER voter Voter");
    assert.equal(t.size, 1);
  });

  test("handles empty input", () => {
    assert.equal(contentTokens("").size, 0);
  });
});

describe("scoreDivergence", () => {
  test("separates omission from the VLM simply being better", () => {
    // The two directions are different failures and must not be blended.
    const d = scoreDivergence(
      "voter identification citizenship verification requirements",
      "voter identification requirements plus additional context",
    );
    assert.ok(d.vlmMissing.includes("citizenship"));
    assert.ok(d.vlmOnly.includes("additional"));
    assert.ok(d.omissionRate > 0);
  });

  test("reports a clean pair as no omission", () => {
    const text = "establishes additional voter identification requirements";
    const d = scoreDivergence(text, text);
    assert.equal(d.omissionRate, 0);
    assert.equal(d.overlap, 1);
    assert.deepEqual(d.vlmMissing, []);
  });

  test("flags a VLM that dropped a whole section", () => {
    const d = scoreDivergence(
      "signature printed name residential address county registration date",
      "signature printed name",
    );
    assert.ok(d.omissionRate > 0.5, `expected > 0.5, got ${d.omissionRate}`);
    assert.ok(d.lengthRatio < 0.5);
  });

  test("does not treat VLM paraphrase as omission of everything", () => {
    // Real observed behaviour: the VLM wrote "EXTRACTION" for "ESTABLISHES".
    // One substituted word must not read as a wholesale drop.
    const d = scoreDivergence(
      "ESTABLISHES additional voter identification requirements",
      "EXTRACTION additional voter identification requirements",
    );
    assert.equal(d.vlmMissing.length, 1);
    assert.ok(d.omissionRate < 0.3);
  });

  test("survives an empty Tesseract read without dividing by zero", () => {
    const d = scoreDivergence("", "a clean vlm transcription of the page");
    assert.equal(d.omissionRate, 0);
    assert.equal(d.tesseractTokens, 0);
  });

  test("scores an empty VLM output as total omission", () => {
    const d = scoreDivergence("voter identification requirements", "");
    assert.equal(d.omissionRate, 1);
  });
});

describe("calibrateDivergence", () => {
  test("refuses to suggest a threshold from too few pairs", () => {
    // A guard calibrated on two images of one document encodes that document.
    const c = calibrateDivergence([0.2, 0.25]);
    assert.equal(c.usable, false);
    assert.equal(c.suggestedThreshold, null);
    assert.match(c.note, /worse than no guard/);
  });

  test("suggests a threshold once there are enough pairs", () => {
    const c = calibrateDivergence(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => 0.2),
    );
    assert.equal(c.usable, true);
    assert.ok((c.suggestedThreshold ?? 0) > c.baselineMax);
  });

  test("puts the threshold above the worst known-good pair", () => {
    const samples = Array.from({ length: 12 }, (_, i) => 0.1 + i * 0.02);
    const c = calibrateDivergence(samples);
    assert.ok((c.suggestedThreshold ?? 0) > c.baselineMax);
  });

  test("handles no samples at all", () => {
    const c = calibrateDivergence([]);
    assert.equal(c.usable, false);
    assert.match(c.note, /nothing to calibrate/i);
  });
});

describe("omissionSignal", () => {
  const pair = scoreDivergence(
    "petition signature verification requirements county elections official",
    "petition signature verification",
  );

  test("refuses a verdict until the baseline exists", () => {
    // The rate is measurable long before it is trustworthy. Handing back a
    // boolean here is how a guard gets wired up on Tesseract's noise floor.
    const s = omissionSignal(pair, calibrateDivergence([0.2, 0.25]));
    assert.equal(s.available, false);
    assert.equal(s.omissionRate, null);
    assert.equal(s.flagged, false);
    assert.match(s.reason, /Not calibrated/);
  });

  test("refuses on no samples at all", () => {
    const s = omissionSignal(pair, calibrateDivergence([]));
    assert.equal(s.available, false);
    assert.equal(s.flagged, false);
  });

  test("gives a verdict once enough known-good pairs exist", () => {
    const cal = calibrateDivergence(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => 0.1),
    );
    const s = omissionSignal(pair, cal);
    assert.equal(s.available, true);
    assert.equal(s.omissionRate, pair.omissionRate);
    assert.equal(s.flagged, true);
    assert.match(s.reason, /above the calibrated/);
  });

  test("does not flag a pair inside the calibrated baseline", () => {
    const cal = calibrateDivergence(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => 0.9),
    );
    const s = omissionSignal(pair, cal);
    assert.equal(s.available, true);
    assert.equal(s.flagged, false);
    assert.match(s.reason, /within the calibrated baseline/);
  });
});
