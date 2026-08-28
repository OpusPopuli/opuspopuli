import {
  getKeepRegion,
  cropImageData,
  KEEP_TOP_FRACTION,
  UNDETECTED_KEEP_TOP_FRACTION,
} from "@/lib/vision/signature-region";
import type { Quad } from "@/lib/vision/perspective";

/**
 * The crop that keeps other voters' signatures off our infrastructure (#1075).
 *
 * These are not cosmetic assertions. A petition sheet carries up to five
 * strangers' handwritten names and residence addresses, plus a circulator's
 * own address, and none of those people agreed to anything. Every case below
 * is a way that data could survive.
 */

const FRAME = { frameWidth: 1000, frameHeight: 2000 };

/** An axis-aligned page occupying most of the frame. */
const page: Quad = [
  { x: 100, y: 200 },
  { x: 900, y: 200 },
  { x: 900, y: 1800 },
  { x: 100, y: 1800 },
];

describe("getKeepRegion", () => {
  it("keeps the top of a detected page and drops the rest", () => {
    const r = getKeepRegion({ ...FRAME, quad: page });

    expect(r.fromDetectedQuad).toBe(true);
    expect(r.x).toBe(100);
    expect(r.y).toBe(200);
    expect(r.width).toBe(800);
    // Page is 1600 tall; we keep KEEP_TOP_FRACTION of it.
    expect(r.height).toBe(Math.round(1600 * KEEP_TOP_FRACTION));
  });

  it("never returns a region extending past the page bottom", () => {
    const r = getKeepRegion({ ...FRAME, quad: page });
    expect(r.y + r.height).toBeLessThan(1800);
  });

  /**
   * The most dangerous case. "We could not find the page" must never resolve
   * to "so keep everything" — that is precisely when a signature block is most
   * likely sitting in shot.
   */
  it("fails closed when no page is detected", () => {
    const r = getKeepRegion({ ...FRAME, quad: null });

    expect(r.fromDetectedQuad).toBe(false);
    expect(r.height).toBe(Math.round(2000 * UNDETECTED_KEEP_TOP_FRACTION));
    expect(r.height).toBeLessThan(2000);
  });

  it("keeps LESS when undetected than when detected", () => {
    expect(UNDETECTED_KEEP_TOP_FRACTION).toBeLessThan(KEEP_TOP_FRACTION);
  });

  it.each([
    [
      "rotated slightly",
      [
        { x: 110, y: 190 },
        { x: 905, y: 215 },
        { x: 890, y: 1810 },
        { x: 95, y: 1785 },
      ],
    ],
    [
      "corners supplied out of order",
      [
        { x: 900, y: 1800 },
        { x: 100, y: 200 },
        { x: 100, y: 1800 },
        { x: 900, y: 200 },
      ],
    ],
  ])("handles a page %s", (_label, quad) => {
    const r = getKeepRegion({ ...FRAME, quad: quad as unknown as Quad });

    expect(r.fromDetectedQuad).toBe(true);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    // Still a subset of the frame.
    expect(r.x + r.width).toBeLessThanOrEqual(FRAME.frameWidth);
    expect(r.y + r.height).toBeLessThanOrEqual(FRAME.frameHeight);
  });

  it("clamps a quad that spills outside the frame", () => {
    const spilling: Quad = [
      { x: -500, y: -400 },
      { x: 5000, y: -400 },
      { x: 5000, y: 9000 },
      { x: -500, y: 9000 },
    ];
    const r = getKeepRegion({ ...FRAME, quad: spilling });

    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(FRAME.frameWidth);
    expect(r.y + r.height).toBeLessThanOrEqual(FRAME.frameHeight);
  });

  it("falls back when the detected page is degenerate", () => {
    const flat: Quad = [
      { x: 400, y: 500 },
      { x: 400, y: 500 },
      { x: 400, y: 500 },
      { x: 400, y: 500 },
    ];
    const r = getKeepRegion({ ...FRAME, quad: flat });

    expect(r.fromDetectedQuad).toBe(false);
    expect(r.height).toBeGreaterThan(0);
  });

  it("returns an empty region for an empty frame rather than throwing", () => {
    const r = getKeepRegion({ quad: null, frameWidth: 0, frameHeight: 0 });
    expect(r).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      fromDetectedQuad: false,
    });
  });
});

describe("pageFillsImage (post-deskew)", () => {
  /**
   * `handleCapture` deskews to the detected page BEFORE cropping. After that
   * transform the quad describes the old frame's coordinate space and is
   * meaningless against the new image — cropping by it could leave the
   * signature block in shot. This flag is how the caller says "the image is
   * already the page".
   */
  it("keeps the top of the image and ignores a stale quad", () => {
    const stale: Quad = [
      { x: 900, y: 1700 },
      { x: 1000, y: 1700 },
      { x: 1000, y: 1900 },
      { x: 900, y: 1900 },
    ];
    const r = getKeepRegion({
      quad: stale,
      frameWidth: 800,
      frameHeight: 1600,
      pageFillsImage: true,
    });

    expect(r.fromDetectedQuad).toBe(true);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(800);
    expect(r.height).toBe(Math.round(1600 * KEEP_TOP_FRACTION));
  });

  it("keeps strictly less than the whole deskewed page", () => {
    const r = getKeepRegion({
      quad: null,
      frameWidth: 800,
      frameHeight: 1600,
      pageFillsImage: true,
    });
    expect(r.height).toBeLessThan(1600);
  });
});

describe("cropImageData", () => {
  /** Build an ImageData whose red channel encodes the row index. */
  function striped(width: number, height: number): ImageData {
    const img = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        img.data[i] = y;
        img.data[i + 3] = 255;
      }
    }
    return img;
  }

  it("returns only the rows inside the keep-region", () => {
    const src = striped(4, 10);
    const out = cropImageData(src, {
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      fromDetectedQuad: true,
    });

    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    // First pixel of the last kept row encodes row 3 — row 4+ is gone.
    expect(out.data[3 * 4 * 4]).toBe(3);
  });

  /**
   * The point of the whole exercise: content below the keep-region must not
   * survive into the encoded image.
   */
  it("drops content below the keep-region entirely", () => {
    const src = striped(4, 10);
    const out = cropImageData(src, {
      x: 0,
      y: 0,
      width: 4,
      height: 5,
      fromDetectedQuad: true,
    });

    const reds = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) reds.add(out.data[i]);
    // Rows 5..9 (the "signature block") are absent.
    for (const row of [5, 6, 7, 8, 9]) expect(reds.has(row)).toBe(false);
  });

  it("clamps a region that would run past the source bounds", () => {
    const src = striped(4, 10);
    const out = cropImageData(src, {
      x: 0,
      y: 8,
      width: 4,
      height: 50,
      fromDetectedQuad: false,
    });
    expect(out.height).toBe(2);
  });
});
