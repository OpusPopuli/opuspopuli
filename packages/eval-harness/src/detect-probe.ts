import { readFileSync } from "node:fs";
import { analyzeFrame } from "../../../apps/frontend/lib/vision/documentDetection.ts";

class ImageDataShim {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = "srgb" as const;
  constructor(d: Uint8ClampedArray, w: number, h: number) {
    this.data = d;
    this.width = w;
    this.height = h;
  }
}
(globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataShim;

// Path to a JSON manifest of raw RGBA frames to probe, given on the command
// line rather than hardcoded: the frames are scratch data produced per
// investigation, and a fixed /tmp path silently reads a STALE manifest from an
// earlier run instead of failing.
const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error(
    "usage: tsx src/detect-probe.ts <frames.json>\n" +
      '  where frames.json is {"<label>": {"path": "<raw rgba>", "width": N, "height": N}}',
  );
  process.exit(1);
}

const frames = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
  string,
  { path: string; width: number; height: number }
>;

// The production gate: useDocumentDetection.ts trusts the quad only above this.
const MIN_CONFIDENCE = 0.35;
const MIN_COVERAGE = 0.4;
const MIN_SHARPNESS = 40;

for (const [name, f] of Object.entries(frames)) {
  const buf = readFileSync(f.path);
  const img = new ImageDataShim(
    new Uint8ClampedArray(buf),
    f.width,
    f.height,
  ) as unknown as ImageData;
  const a = analyzeFrame(img);
  const trusted = a.confidence >= MIN_CONFIDENCE && a.quad !== null;
  console.log(
    `${name.padEnd(9)} sharpness=${a.sharpness.toFixed(1).padStart(7)}` +
      `  coverage=${a.coverage.toFixed(3)}` +
      `  confidence=${a.confidence.toFixed(3)}` +
      `  quad=${a.quad ? "found" : "NULL"}` +
      `  -> ${trusted ? "CROP" : "FULL FRAME (fallback)"}`,
  );
  console.log(
    `          gates: coverage>=${MIN_COVERAGE} ${a.coverage >= MIN_COVERAGE ? "ok" : "FAIL"}` +
      ` | sharpness>=${MIN_SHARPNESS} ${a.sharpness >= MIN_SHARPNESS ? "ok" : "FAIL"}` +
      ` | confidence>=${MIN_CONFIDENCE} ${a.confidence >= MIN_CONFIDENCE ? "ok" : "FAIL"}`,
  );
}
