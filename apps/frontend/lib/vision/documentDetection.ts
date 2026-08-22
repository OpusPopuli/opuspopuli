/**
 * Lightweight, dependency-free document detection for the camera viewfinder.
 *
 * Two jobs, both cheap enough to run on the existing per-frame sampling loop:
 *
 *  1. **Readiness** — is the frame sharp enough and does a document fill enough
 *     of it that a capture would OCR well? Drives the "hold steady / ready"
 *     cue and the frame guide turning green.
 *  2. **Quad** — an estimate of the document's four corners, used at capture
 *     time to deskew-crop to just the document (which is the real OCR win).
 *
 * The quad estimate is a heuristic (extreme points of the edge cloud), so the
 * capture pipeline treats it as best-effort and falls back to the fixed guide
 * rectangle when confidence is low — it can never make OCR worse than today.
 *
 * All functions here are pure and framework-free so the deterministic parts
 * (grayscale, sharpness, edges, corner geometry) are unit-testable in node.
 */

import type { Point, Quad } from "./perspective";

export interface FrameAnalysis {
  /** Variance-of-Laplacian focus score; higher is sharper. */
  readonly sharpness: number;
  /** Fraction (0..1) of the frame the detected document covers. */
  readonly coverage: number;
  /** Best-effort document corners in the source image's pixel coords. */
  readonly quad: Quad | null;
  /** 0..1 heuristic confidence in `quad`. */
  readonly confidence: number;
}

export interface GrayImage {
  readonly gray: Float32Array;
  readonly width: number;
  readonly height: number;
  /** Multiply a downscaled coordinate by this to get the source coordinate. */
  readonly scaleX: number;
  readonly scaleY: number;
}

const DEFAULT_MAX_DIM = 240;
const EDGE_THRESHOLD = 48; // Sobel magnitude above which a pixel is an "edge".
const MIN_EDGE_FRACTION = 0.01; // Below this, the frame is blank — no document.

/** Downscale an ImageData to a small grayscale buffer for fast analysis. */
export function downscaleToGray(
  image: ImageData,
  maxDim = DEFAULT_MAX_DIM,
): GrayImage {
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const gray = new Float32Array(width * height);
  const src = image.data;
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x * scaleX));
      const i = (sy * image.width + sx) * 4;
      gray[y * width + x] =
        0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }

  return { gray, width, height, scaleX, scaleY };
}

/**
 * Variance of the Laplacian — the standard cheap focus metric. A blurry frame
 * has little high-frequency content so the Laplacian response is near zero and
 * its variance is low; a sharp frame scores high.
 */
export function laplacianVariance(img: GrayImage): number {
  const { gray, width, height } = img;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] -
        gray[i - 1] -
        gray[i + 1] -
        gray[i - width] -
        gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Sobel gradient magnitude at each interior pixel (borders are 0). */
export function sobelMagnitude(img: GrayImage): Float32Array {
  const { gray, width, height } = img;
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        gray[i - width + 1] +
        2 * gray[i + 1] +
        gray[i + width + 1] -
        gray[i - width - 1] -
        2 * gray[i - 1] -
        gray[i + width - 1];
      const gy =
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1] -
        gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

/** Collect coordinates whose edge magnitude exceeds the threshold. */
function strongEdgePoints(
  mag: Float32Array,
  width: number,
  height: number,
): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mag[y * width + x] > EDGE_THRESHOLD) points.push({ x, y });
    }
  }
  return points;
}

/**
 * Estimate a document quad as the extreme points of the edge cloud: on a
 * top-left-origin image the top-left corner minimises x+y, bottom-right
 * maximises it, top-right maximises x-y and bottom-left minimises it. Cheap,
 * and accurate when the document is the dominant high-contrast object.
 */
export function extremeQuad(points: readonly Point[]): Quad | null {
  if (points.length < 4) return null;
  let tl = points[0];
  let br = points[0];
  let tr = points[0];
  let bl = points[0];
  for (const p of points) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < tl.x + tl.y) tl = p;
    if (sum > br.x + br.y) br = p;
    if (diff > tr.x - tr.y) tr = p;
    if (diff < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

/** Shoelace area of a quad. */
function quadArea(q: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Scale a downscaled-space quad back into the source image's pixel coords. */
function scaleQuad(q: Quad, scaleX: number, scaleY: number): Quad {
  return q.map((p) => ({
    x: p.x * scaleX,
    y: p.y * scaleY,
  })) as unknown as Quad;
}

/**
 * Analyse a captured/preview frame for readiness + a document quad estimate.
 * Returns coverage 0 and a null quad when no document is discernible (blank or
 * too-noisy frame), so callers can safely fall back to the guide rectangle.
 */
export function analyzeFrame(
  image: ImageData,
  maxDim = DEFAULT_MAX_DIM,
): FrameAnalysis {
  const img = downscaleToGray(image, maxDim);
  const sharpness = laplacianVariance(img);
  const mag = sobelMagnitude(img);
  const points = strongEdgePoints(mag, img.width, img.height);

  const total = img.width * img.height;
  const edgeFraction = points.length / total;
  if (edgeFraction < MIN_EDGE_FRACTION) {
    return { sharpness, coverage: 0, quad: null, confidence: 0 };
  }

  const smallQuad = extremeQuad(points);
  if (!smallQuad) {
    return { sharpness, coverage: 0, quad: null, confidence: 0 };
  }

  const coverage = quadArea(smallQuad) / total;
  const quad = scaleQuad(smallQuad, img.scaleX, img.scaleY);
  // Confidence rewards a document that fills the frame; a tiny detected quad
  // (coverage near 0) or a frame-filling one with no clear object both read as
  // low confidence. Capped at 1.
  const confidence = Math.max(0, Math.min(1, coverage * 1.4 - 0.15));

  return { sharpness, coverage, quad, confidence };
}
