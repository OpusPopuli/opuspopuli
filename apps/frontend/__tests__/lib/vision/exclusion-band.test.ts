import {
  getExclusionBand,
  getGuideBox,
  MIN_BAND_HEIGHT_PX,
} from "@/lib/vision/exclusion-band";
import { getKeepRegion } from "@/lib/vision/signature-region";
import type { Quad } from "@/lib/vision/perspective";

/**
 * The band is a privacy claim drawn on glass (#1075): it tells someone, before
 * they press the shutter, which part of the sheet in front of them is dropped
 * on this device. Two things make that claim true, and both are tested here —
 * it starts exactly where the crop starts, and it is bounded by something the
 * person can see.
 */

// A phone-shaped viewfinder showing a portrait 1:2 camera frame — deliberately
// a different aspect from the container, since equal aspects hide projection
// bugs.
const VIEW = {
  frameWidth: 1000,
  frameHeight: 2000,
  containerWidth: 390,
  containerHeight: 750,
  padding: 32,
  aspectRatio: 8.5 / 11,
};

const page: Quad = [
  { x: 100, y: 200 },
  { x: 900, y: 200 },
  { x: 900, y: 1800 },
  { x: 100, y: 1800 },
];

/** The object-cover mapping the component's <video> uses. */
function toContainerY(frameY: number) {
  const scale = Math.max(
    VIEW.containerWidth / VIEW.frameWidth,
    VIEW.containerHeight / VIEW.frameHeight,
  );
  const offsetY = (VIEW.containerHeight - VIEW.frameHeight * scale) / 2;
  return frameY * scale + offsetY;
}

describe("getGuideBox", () => {
  it("matches the corner brackets' CSS box", () => {
    const box = getGuideBox(390, 750, 32, 8.5 / 11);

    // width: calc(100% - 64px) → 326, height from the aspect ratio.
    expect(box.left).toBe(32);
    expect(box.right).toBe(358);
    expect(box.bottom - box.top).toBeCloseTo(326 / (8.5 / 11), 6);
  });

  /**
   * `max-height: calc(100% - 64px)` clips the box on a short viewport. Missing
   * the cap would put the band's floor below the brackets the user sees.
   */
  it("caps its height on a short viewport", () => {
    const box = getGuideBox(900, 300, 32, 8.5 / 11);

    expect(box.bottom - box.top).toBe(300 - 64);
    expect(box.top).toBe(32);
  });

  it("never returns a negative box for a tiny container", () => {
    const box = getGuideBox(10, 10, 32, 8.5 / 11);

    expect(box.right - box.left).toBe(0);
    expect(box.bottom - box.top).toBe(0);
  });
});

describe("getExclusionBand", () => {
  /**
   * The assertion the whole feature rests on. If this drifts, the notice is
   * making a promise the crop no longer keeps.
   */
  it("starts exactly where the crop stops", () => {
    const band = getExclusionBand({ ...VIEW, quad: page })!;
    const keep = getKeepRegion({
      quad: page,
      frameWidth: VIEW.frameWidth,
      frameHeight: VIEW.frameHeight,
    });

    expect(band.top).toBeCloseTo(toContainerY(keep.y + keep.height), 6);
  });

  it("is bounded by the detected page, not the screen", () => {
    const band = getExclusionBand({ ...VIEW, quad: page })!;

    expect(band.fromDetectedQuad).toBe(true);
    expect(band.top + band.height).toBeCloseTo(toContainerY(1800), 6);
    expect(band.top + band.height).toBeLessThan(VIEW.containerHeight);
  });

  /**
   * With no detected page there is no sheet to bound the band to, so it falls
   * back to the guide box — the only rectangle on screen. Running to the edges
   * reads as "the camera is blocked down here" rather than "this part of the
   * sheet is dropped".
   */
  it("falls back to the guide box when no page is detected", () => {
    const band = getExclusionBand({ ...VIEW, quad: null })!;
    const guide = getGuideBox(
      VIEW.containerWidth,
      VIEW.containerHeight,
      VIEW.padding,
      VIEW.aspectRatio,
    );

    expect(band.fromDetectedQuad).toBe(false);
    expect(band.left).toBeCloseTo(guide.left, 6);
    expect(band.left + band.width).toBeCloseTo(guide.right, 6);
    expect(band.top + band.height).toBeCloseTo(guide.bottom, 6);
  });

  it("excludes more of the page when nothing is detected", () => {
    const detected = getExclusionBand({ ...VIEW, quad: page })!;
    const undetected = getExclusionBand({ ...VIEW, quad: null })!;

    expect(undetected.top).toBeLessThan(detected.top);
  });

  /** A band drawn off-screen is a band the user cannot check. */
  it("clamps a page held closer than the viewfinder", () => {
    const spilling: Quad = [
      { x: -800, y: -600 },
      { x: 1800, y: -600 },
      { x: 1800, y: 4000 },
      { x: -800, y: 4000 },
    ];
    const band = getExclusionBand({ ...VIEW, quad: spilling })!;

    expect(band.left).toBeGreaterThanOrEqual(0);
    expect(band.top).toBeGreaterThanOrEqual(0);
    expect(band.left + band.width).toBeLessThanOrEqual(VIEW.containerWidth);
    expect(band.top + band.height).toBeLessThanOrEqual(VIEW.containerHeight);
  });

  it.each([
    ["the container is unmeasured", { containerWidth: 0, containerHeight: 0 }],
    ["the camera has not reported a frame", { frameWidth: 0, frameHeight: 0 }],
  ])("draws nothing while %s", (_label, override) => {
    expect(getExclusionBand({ ...VIEW, ...override, quad: page })).toBeNull();
  });

  /**
   * A page far enough away to be a few pixels tall still produces a band by
   * the arithmetic — 45% of 40px — but at well under a pixel it renders as a
   * stray dashed line across the sheet and carries no notice. Nothing is the
   * honest thing to draw, and the user has not framed a page yet anyway.
   */
  it("draws nothing when the page is too small for a readable band", () => {
    const distant: Quad = [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 40 },
      { x: 100, y: 40 },
    ];

    expect(getExclusionBand({ ...VIEW, quad: distant })).toBeNull();
  });

  it("draws a band as soon as one is tall enough to read", () => {
    const near: Quad = [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 1200 },
      { x: 100, y: 1200 },
    ];
    const band = getExclusionBand({ ...VIEW, quad: near })!;

    expect(band.height).toBeGreaterThanOrEqual(MIN_BAND_HEIGHT_PX);
  });

  /**
   * A square projection would place the band identically for both, which is
   * exactly the bug that put it off the screen edges.
   */
  it("accounts for the frame aspect, not just its size", () => {
    const wide = getExclusionBand({
      ...VIEW,
      frameWidth: 2000,
      frameHeight: 1000,
      quad: null,
    })!;
    const tall = getExclusionBand({ ...VIEW, quad: null })!;

    expect(wide.top).not.toBeCloseTo(tall.top, 3);
  });
  /**
   * The band's box is the page's axis-aligned bounding box, which on a tilted
   * page is strictly larger than the page — its bottom edge and both lower
   * corners hang outside the sheet. Unclipped it reads as the overlay spilling
   * past the frame, and it overstates what the crop actually drops.
   */
  describe("clipping to the sheet", () => {
    const tilted: Quad = [
      { x: 120, y: 260 },
      { x: 880, y: 240 },
      { x: 900, y: 1760 },
      { x: 100, y: 1780 },
    ];

    function points(clipPath: string) {
      return clipPath
        .replace(/^polygon\(|\)$/g, "")
        .split(",")
        .map((pair) => {
          const [x, y] = pair.trim().split(/\s+/).map(parseFloat);
          return { x, y };
        });
    }

    it("clips to the four corners of the detected page", () => {
      const band = getExclusionBand({ ...VIEW, quad: tilted })!;

      expect(band.clipPath).toMatch(/^polygon\(/);
      expect(points(band.clipPath!)).toHaveLength(4);
    });

    /**
     * The clip is in the band's own coordinates, so the page's top corners sit
     * above it and come out negative. Getting this offset wrong would shift the
     * clip down the sheet and re-expose the rows it exists to cover.
     */
    it("expresses the clip relative to the band, not the container", () => {
      const band = getExclusionBand({ ...VIEW, quad: tilted })!;
      const pts = points(band.clipPath!);

      // Two corners above the band's top edge, two below.
      expect(pts.filter((p) => p.y < 0)).toHaveLength(2);
      expect(pts.filter((p) => p.y > 0)).toHaveLength(2);
    });

    /**
     * A clip path built from out-of-order corners renders as a bowtie, which
     * silently uncovers part of the sheet the band claims to have covered.
     */
    it("orders corners so the clip cannot render as a bowtie", () => {
      const scrambled: Quad = [tilted[2], tilted[0], tilted[3], tilted[1]];
      const band = getExclusionBand({ ...VIEW, quad: scrambled })!;
      const pts = points(band.clipPath!);

      // Consecutive edges must all turn the same way for a simple polygon.
      const cross = pts.map((p, i) => {
        const a = pts[(i + 1) % 4];
        const b = pts[(i + 2) % 4];
        return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x);
      });
      expect(cross.every((c) => c > 0) || cross.every((c) => c < 0)).toBe(true);
    });

    it("has nothing to clip to without a detected page", () => {
      expect(getExclusionBand({ ...VIEW, quad: null })!.clipPath).toBeNull();
    });
  });
});
