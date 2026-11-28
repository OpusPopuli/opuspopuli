/** How well a county's district plan fits its outline (#1475). */
export interface ShapeQuality {
  /** Land inside the county that no district covers, as a share of its area. */
  gapShare: number;
  /** Land two or more districts both claim, as a share of its area. */
  overlapShare: number;
  /** Either passes the tolerance: the map says it's a best effort. */
  bestEffort: boolean;
}

/**
 * A district plan whose gaps or overlaps pass this share of the county's
 * area is drawn with a best-effort note (plan Q14).
 *
 * A clean plan measured against a generalised shoreline outline still shows a
 * few tenths of a percent uncovered, because the two coastlines never agree
 * exactly (the first plan measured, in #1475: 0.21% gap, no overlap). 0.5%
 * sits above that noise and well below a plan with a real hole or a
 * disputed strip.
 */
export const BEST_EFFORT_TOLERANCE = 0.005;

export function isBestEffort(
  gapShare: number,
  overlapShare: number,
  tolerance = BEST_EFFORT_TOLERANCE,
): boolean {
  return gapShare > tolerance || overlapShare > tolerance;
}

export function shapeQuality(
  gapShare: number,
  overlapShare: number,
): ShapeQuality {
  // Area arithmetic can land a hair below zero; a negative gap means none.
  const gap = Math.max(0, gapShare);
  const overlap = Math.max(0, overlapShare);
  return {
    gapShare: gap,
    overlapShare: overlap,
    bestEffort: isBestEffort(gap, overlap),
  };
}
