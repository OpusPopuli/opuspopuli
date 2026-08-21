/**
 * Perspective (homography) math for document deskewing.
 *
 * Given the four corners of a document as seen by the camera (an arbitrary
 * convex quadrilateral) we want to warp it back to a flat, axis-aligned
 * rectangle — the same "deskew + crop" a dedicated document scanner does. That
 * removes the background and un-skews the text, which is the single biggest
 * lever on OCR quality.
 *
 * These functions are pure and framework-free so they can be unit-tested
 * without a browser or a real camera. The browser-only pixel warp
 * (`deskewImageData`) is built on top of them.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A document quadrilateral, corner order unspecified until ordered. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3x3 homography matrix in row-major order (9 numbers). */
export type Matrix3 = readonly number[];

/**
 * Order four points as [top-left, top-right, bottom-right, bottom-left].
 *
 * Uses the classic sum/difference trick: on a top-left-origin image the
 * top-left corner has the smallest x+y, the bottom-right the largest; the
 * top-right has the largest x-y, the bottom-left the smallest. Robust to the
 * input order the detector happened to produce.
 */
export function orderCorners(points: Quad): Quad {
  let tl = points[0];
  let br = points[0];
  let tr = points[0];
  let bl = points[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of points) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
  }

  return [tl, tr, br, bl];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Estimate the output rectangle size for an ordered quad: width is the longer
 * of the two horizontal edges, height the longer of the two vertical edges.
 * Keeps the deskewed image from squashing a perspective-foreshortened side.
 */
export function estimateRectSize(ordered: Quad): {
  width: number;
  height: number;
} {
  const [tl, tr, br, bl] = ordered;
  const width = Math.max(distance(tl, tr), distance(bl, br));
  const height = Math.max(distance(tl, bl), distance(tr, br));
  return { width: Math.round(width), height: Math.round(height) };
}

/** Row (>= `col`) with the largest magnitude in `col` — the partial pivot. */
function pivotRow(m: number[][], col: number, n: number): number {
  let pivot = col;
  for (let r = col + 1; r < n; r++) {
    if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
  }
  return pivot;
}

/** Zero out `col` in every row except `col` itself (Gauss-Jordan step). */
function eliminateColumn(m: number[][], col: number, n: number): void {
  for (let r = 0; r < n; r++) {
    if (r === col) continue;
    const factor = m[r][col] / m[col][col];
    for (let c = col; c <= n; c++) {
      m[r][c] -= factor * m[col][c];
    }
  }
}

/**
 * Solve the linear system Ax = b for a square matrix A (n x n, row-major) via
 * Gauss-Jordan elimination with partial pivoting. Returns null if singular.
 */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix (copy so we don't mutate the caller's arrays).
  const m = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    const pivot = pivotRow(m, col, n);
    if (Math.abs(m[pivot][col]) < 1e-12) return null; // singular
    [m[col], m[pivot]] = [m[pivot], m[col]];
    eliminateColumn(m, col, n);
  }

  // Full elimination above leaves a diagonal matrix, so each unknown is just
  // the augmented entry divided by the diagonal.
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = m[i][n] / m[i][i];
  return x;
}

/**
 * Homography mapping the four `from` points to the four `to` points.
 *
 * Solves the 8-parameter DLT system (h33 fixed to 1). `from`/`to` must already
 * be corresponded (same order). Returns null if the points are degenerate.
 */
export function getPerspectiveTransform(from: Quad, to: Quad): Matrix3 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Apply a homography to a point. */
export function applyMatrix3(m: Matrix3, p: Point): Point {
  const denom = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / denom,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / denom,
  };
}

/**
 * Deskew a document quad out of a source frame into a flat rectangle.
 *
 * Browser-only (needs a 2D canvas). Returns an ImageData of size
 * (outWidth x outHeight); each output pixel is bilinearly sampled from the
 * source at the position given by the dest->source homography. Returns null if
 * the transform is degenerate or a canvas context is unavailable.
 */
export function deskewImageData(
  source: ImageData,
  quad: Quad,
  maxDimension = 1600,
): ImageData | null {
  const ordered = orderCorners(quad);
  const { width, height } = estimateRectSize(ordered);
  if (width < 8 || height < 8) return null;

  // Clamp the output so a huge capture doesn't allocate an enormous buffer.
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const destRect: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  // Map every DEST pixel back to the SOURCE to sample it.
  const destToSrc = getPerspectiveTransform(destRect, ordered);
  if (!destToSrc) return null;

  const src = source.data;
  const sw = source.width;
  const sh = source.height;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const { x: sx, y: sy } = applyMatrix3(destToSrc, { x, y });
      // Bilinear sample with edge clamping.
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * outW + x) * 4;

      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }

  return new ImageData(out, outW, outH);
}
