/**
 * Deskew Detection
 *
 * Detects document skew angle using projection profile analysis.
 * Works by finding the rotation angle that maximizes horizontal line variance.
 */

import sharp from "sharp";

/**
 * Detect the skew angle of a document image
 *
 * Uses projection profile analysis to find the rotation angle
 * that best aligns text lines horizontally.
 *
 * @param buffer - Image buffer to analyze
 * @param maxAngle - Maximum angle to search (default: 15 degrees)
 * @returns Detected skew angle in degrees (negative = rotate clockwise to fix)
 */
export async function detectSkewAngle(
  buffer: Buffer,
  maxAngle: number = 15,
): Promise<number> {
  // Convert to grayscale and get raw pixel data
  const { data, info } = await sharp(buffer)
    .grayscale()
    .resize({ width: 500, fit: "inside", withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Apply edge detection (simple Sobel-like filter for horizontal edges)
  const edges = detectEdges(data, width, height);

  // Search for angle with maximum projection variance
  let bestAngle = 0;
  let bestVariance = 0;

  // Search in 0.5 degree increments
  const step = 0.5;
  for (let angle = -maxAngle; angle <= maxAngle; angle += step) {
    const variance = calculateProjectionVariance(edges, width, height, angle);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  // Refine the search around the best angle with smaller steps
  const refinedStart = bestAngle - step;
  const refinedEnd = bestAngle + step;
  const refinedStep = 0.1;

  for (let angle = refinedStart; angle <= refinedEnd; angle += refinedStep) {
    const variance = calculateProjectionVariance(edges, width, height, angle);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

/**
 * Simple edge detection for finding text lines
 */
function detectEdges(data: Buffer, width: number, height: number): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Simple vertical gradient (detects horizontal edges = text lines)
      const above = data[idx - width];
      const below = data[idx + width];
      const gradient = Math.abs(above - below);

      // Threshold to get binary edge map
      edges[idx] = gradient > 30 ? 255 : 0;
    }
  }

  return edges;
}

/**
 * Calculate the variance of horizontal projections at a given angle
 *
 * Higher variance indicates better alignment with text lines
 */
function calculateProjectionVariance(
  edges: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
): number {
  const angleRad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Center of image
  const cx = width / 2;
  const cy = height / 2;

  // Calculate rotated projection (sum of edge pixels per row)
  const projections: number[] = new Array(height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] > 0) {
        // Rotate point around center
        const dx = x - cx;
        const dy = y - cy;
        const newY = Math.round(-dx * sin + dy * cos + cy);

        if (newY >= 0 && newY < height) {
          projections[newY]++;
        }
      }
    }
  }

  // Calculate variance of projections
  const sum = projections.reduce((a, b) => a + b, 0);
  const mean = sum / projections.length;
  const variance =
    projections.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
    projections.length;

  return variance;
}

/**
 * Check if image appears to need deskewing
 *
 * Quick heuristic check before running full detection
 */
export async function needsDeskew(buffer: Buffer): Promise<boolean> {
  try {
    const angle = await detectSkewAngle(buffer, 5); // Quick check with small range
    return Math.abs(angle) > 1;
  } catch {
    return false;
  }
}
