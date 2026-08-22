import {
  orderCorners,
  estimateRectSize,
  solveLinear,
  getPerspectiveTransform,
  applyMatrix3,
  deskewImageData,
  type Quad,
} from "../perspective";

// jsdom provides no ImageData, but deskewImageData constructs one (correct in
// the browser). Minimal shim so the pure warp logic is testable in node. Runs
// at module load — before any test calls into the warp — which is enough.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  class ImageDataShim {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = "srgb" as const;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as { ImageData: unknown }).ImageData = ImageDataShim;
}

describe("orderCorners", () => {
  it("orders shuffled corners as [TL, TR, BR, BL]", () => {
    // A slightly skewed quad given in arbitrary order.
    const shuffled: Quad = [
      { x: 90, y: 12 }, // TR
      { x: 8, y: 100 }, // BL
      { x: 10, y: 10 }, // TL
      { x: 95, y: 105 }, // BR
    ];
    const [tl, tr, br, bl] = orderCorners(shuffled);
    expect(tl).toEqual({ x: 10, y: 10 });
    expect(tr).toEqual({ x: 90, y: 12 });
    expect(br).toEqual({ x: 95, y: 105 });
    expect(bl).toEqual({ x: 8, y: 100 });
  });
});

describe("estimateRectSize", () => {
  it("takes the longer of each opposing edge pair", () => {
    const ordered: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 120, y: 60 }, // bottom edge longer (120) than top (100)
      { x: 0, y: 50 },
    ];
    const { width, height } = estimateRectSize(ordered);
    expect(width).toBe(120);
    // right edge hypot(20,60)=63.2 -> 63 is the longer vertical edge (left=50)
    expect(height).toBe(63);
  });
});

describe("solveLinear", () => {
  it("solves a 2x2 system", () => {
    // 2x + y = 5 ; x - y = 1  -> x=2, y=1
    const x = solveLinear(
      [
        [2, 1],
        [1, -1],
      ],
      [5, 1],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(2, 6);
    expect(x![1]).toBeCloseTo(1, 6);
  });

  it("returns null for a singular matrix", () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
  });
});

describe("getPerspectiveTransform / applyMatrix3", () => {
  const unit: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("maps the four correspondences exactly", () => {
    const dst: Quad = [
      { x: 3, y: 2 },
      { x: 9, y: 1 },
      { x: 10, y: 8 },
      { x: 2, y: 9 },
    ];
    const H = getPerspectiveTransform(unit, dst)!;
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const p = applyMatrix3(H, unit[i]);
      expect(p.x).toBeCloseTo(dst[i].x, 6);
      expect(p.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("represents a pure 2x scale about the origin", () => {
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const H = getPerspectiveTransform(unit, dst)!;
    const mid = applyMatrix3(H, { x: 0.5, y: 0.5 });
    expect(mid.x).toBeCloseTo(1, 6);
    expect(mid.y).toBeCloseTo(1, 6);
  });
});

describe("deskewImageData", () => {
  // Build a 4x4 test image: left half red, right half blue.
  function makeImage(): ImageData {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const left = x < w / 2;
        data[i] = left ? 255 : 0; // R
        data[i + 1] = 0;
        data[i + 2] = left ? 0 : 255; // B
        data[i + 3] = 255;
      }
    }
    return new ImageData(data, w, h);
  }

  it("deskews an axis-aligned full-frame quad back to a similar image", () => {
    const src = makeImage();
    // Quad covering the whole 4x4 frame (corners at pixel edges).
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 16 },
      { x: 0, y: 16 },
    ];
    const out = deskewImageData(src, quad);
    expect(out).not.toBeNull();
    // Left side should read reddish, right side bluish.
    const at = (img: ImageData, x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return { r: img.data[i], b: img.data[i + 2] };
    };
    const leftPx = at(out!, 0, Math.floor(out!.height / 2));
    const rightPx = at(out!, out!.width - 1, Math.floor(out!.height / 2));
    expect(leftPx.r).toBeGreaterThan(leftPx.b);
    expect(rightPx.b).toBeGreaterThan(rightPx.r);
  });

  it("returns null for a degenerate (zero-area) quad", () => {
    const src = makeImage();
    const degenerate: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(deskewImageData(src, degenerate)).toBeNull();
  });
});
