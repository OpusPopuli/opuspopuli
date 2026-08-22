import {
  downscaleToGray,
  laplacianVariance,
  sobelMagnitude,
  extremeQuad,
  analyzeFrame,
} from "../documentDetection";
import type { Point } from "../perspective";

// jsdom has no ImageData; a minimal shim so we can build synthetic frames.
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

/** Solid-colour frame. */
function solid(w: number, h: number, v: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/** Black frame with a white rectangle [x0,x1) x [y0,y1). */
function rectFrame(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ImageData {
  const img = solid(w, h, 0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
    }
  }
  return img;
}

describe("downscaleToGray", () => {
  it("caps the longest side at maxDim and reports the source scale", () => {
    const img = downscaleToGray(solid(400, 200, 128), 100);
    expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(100);
    expect(img.scaleX).toBeCloseTo(400 / img.width, 3);
    expect(img.gray[0]).toBeCloseTo(128, 0);
  });
});

describe("laplacianVariance", () => {
  it("scores a high-frequency frame far above a flat one", () => {
    const flat = downscaleToGray(solid(64, 64, 128), 64);
    // Checkerboard: alternate black/white per pixel.
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = (x + y) % 2 === 0 ? 255 : 0;
        const i = (y * 64 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const sharp = downscaleToGray(new ImageData(data, 64, 64), 64);
    expect(laplacianVariance(sharp)).toBeGreaterThan(
      laplacianVariance(flat) + 1000,
    );
  });
});

describe("sobelMagnitude", () => {
  it("responds at a strong edge and stays quiet on flat regions", () => {
    const img = downscaleToGray(rectFrame(40, 40, 10, 10, 30, 30), 40);
    const mag = sobelMagnitude(img);
    // A pixel on the rectangle's left border should have high magnitude.
    const border = mag[20 * img.width + 10];
    const interior = mag[20 * img.width + 20];
    expect(border).toBeGreaterThan(interior);
  });
});

describe("extremeQuad", () => {
  it("returns the extreme corners of a point cloud", () => {
    const pts: Point[] = [
      { x: 5, y: 5 },
      { x: 50, y: 6 },
      { x: 52, y: 48 },
      { x: 4, y: 47 },
      { x: 25, y: 25 }, // interior, should be ignored
    ];
    const q = extremeQuad(pts);
    expect(q).not.toBeNull();
    expect(q![0]).toEqual({ x: 5, y: 5 }); // TL (min x+y)
    expect(q![2]).toEqual({ x: 52, y: 48 }); // BR (max x+y)
  });

  it("returns null with fewer than four points", () => {
    expect(extremeQuad([{ x: 1, y: 1 }])).toBeNull();
  });
});

describe("analyzeFrame", () => {
  it("detects a document rectangle with coverage and confidence", () => {
    const result = analyzeFrame(rectFrame(120, 120, 24, 24, 96, 96));
    expect(result.quad).not.toBeNull();
    expect(result.coverage).toBeGreaterThan(0.2);
    expect(result.confidence).toBeGreaterThan(0);
    // Quad is reported in source pixel coords (~24..96 on each axis).
    const xs = result.quad!.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(40);
    expect(Math.max(...xs)).toBeGreaterThan(80);
  });

  it("returns no quad for a blank frame", () => {
    const result = analyzeFrame(solid(120, 120, 200));
    expect(result.quad).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.confidence).toBe(0);
  });
});
