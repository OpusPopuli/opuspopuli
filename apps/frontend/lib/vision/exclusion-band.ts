import type { Quad } from "./perspective";
import { getKeepRegion } from "./signature-region";

/**
 * Where to draw the "not captured" band, in the viewfinder's own pixels (#1075).
 *
 * The band tells someone, before they press the shutter, which part of the
 * sheet in front of them is dropped on this device. That makes it a privacy
 * claim rendered on glass, so it has to be positioned from the same source of
 * truth the crop uses — `getKeepRegion` — and it has to be bounded by something
 * the person can actually see.
 *
 * ── Why this converts to container pixels ─────────────────────────────────
 *
 * Three coordinate spaces meet in the viewfinder and they are not the same:
 *
 *   1. FRAME pixels — what the camera hands us, what the quad is expressed in,
 *      and what the crop operates on.
 *   2. CONTAINER pixels — the on-screen element. The <video> fills it with
 *      `object-cover`, so the frame is uniformly scaled to cover and then
 *      centre-cropped; the two spaces differ by that scale and offset.
 *   3. The GUIDE BOX — the corner brackets, laid out in CSS from `padding` and
 *      `aspectRatio`, in container pixels only.
 *
 * The band has to respect all three: positioned from the crop (frame), bounded
 * by the page or the guide box (container). Converting once, here, is what lets
 * the component render plain absolutely-positioned elements instead of
 * projecting an SVG and hoping the projections agree.
 *
 * The first version did project, onto a square `0 0 100 100` viewBox with
 * `slice`. That silently mis-projects every non-square camera frame — it maps
 * the unit square onto a square region — so on a 720x1280 feed the band and the
 * page outline both landed well off the real page edges and ran past the screen.
 */

/**
 * Below this the band is visually just its own dashed border: too short to
 * carry the notice, too short to read as a region. A sliver like that says
 * nothing while looking like a rendering fault, so we draw nothing instead.
 * Reached when the detected page is tiny in frame — the user is far away and
 * has not framed anything yet.
 */
export const MIN_BAND_HEIGHT_PX = 8;

export interface ExclusionBandInput {
  /** Detected page corners, in frame pixels. */
  quad: Quad | null;
  frameWidth: number;
  frameHeight: number;
  /** On-screen size of the viewfinder element. */
  containerWidth: number;
  containerHeight: number;
  /** Guide-box inset, matching the corner brackets' CSS. */
  padding: number;
  /** Guide-box aspect ratio, matching the corner brackets' CSS. */
  aspectRatio: number;
}

export interface ExclusionBand {
  left: number;
  top: number;
  width: number;
  height: number;
  /** True when bounded by a detected page rather than the guide box. */
  fromDetectedQuad: boolean;
  /**
   * A CSS `clip-path` in the band's OWN coordinates, or null when there is
   * nothing to clip to.
   *
   * The band's box is the page's axis-aligned bounding box, and on a tilted
   * page that box is strictly larger than the page — its bottom edge and both
   * lower corners hang outside the sheet. Left unclipped it reads as the
   * overlay spilling past the frame, and it overstates what the crop drops.
   */
  clipPath: string | null;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The corner-bracket box, in container pixels.
 *
 * Mirrors the CSS in `DocumentFrameOverlay`: width is the container inset by
 * `padding` on both sides, height follows from `aspectRatio` but is capped at
 * the same inset. The cap is why height is a `min` and not a plain division —
 * `max-height` clips the box on short viewports without shrinking its width.
 */
export function getGuideBox(
  containerWidth: number,
  containerHeight: number,
  padding: number,
  aspectRatio: number,
): Box {
  const width = Math.max(containerWidth - padding * 2, 0);
  const height = Math.min(
    width / aspectRatio,
    Math.max(containerHeight - padding * 2, 0),
  );
  const top = (containerHeight - height) / 2;

  return {
    left: (containerWidth - width) / 2,
    top,
    right: (containerWidth - width) / 2 + width,
    bottom: top + height,
  };
}

/**
 * Corners in perimeter order, by angle about the centroid.
 *
 * The detector already returns them ordered, but a clip path built from
 * out-of-order corners renders as a bowtie — a silent, ugly failure that would
 * expose part of the sheet the band claims to cover. Sorting costs nothing.
 */
function orderedCorners(quad: Quad): Quad[number][] {
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / quad.length;
  const cy = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;

  return [...quad].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
}

/** The object-cover mapping from frame pixels to container pixels. */
function coverTransform(
  frameWidth: number,
  frameHeight: number,
  containerWidth: number,
  containerHeight: number,
) {
  const scale = Math.max(
    containerWidth / frameWidth,
    containerHeight / frameHeight,
  );
  return {
    scale,
    offsetX: (containerWidth - frameWidth * scale) / 2,
    offsetY: (containerHeight - frameHeight * scale) / 2,
  };
}

export function getExclusionBand({
  quad,
  frameWidth,
  frameHeight,
  containerWidth,
  containerHeight,
  padding,
  aspectRatio,
}: ExclusionBandInput): ExclusionBand | null {
  if (
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return null;
  }

  const keep = getKeepRegion({ quad, frameWidth, frameHeight });
  if (keep.width <= 0 || keep.height <= 0) return null;

  const { scale, offsetX, offsetY } = coverTransform(
    frameWidth,
    frameHeight,
    containerWidth,
    containerHeight,
  );

  // Where the crop stops — the one number that must not drift from the crop.
  const cutoff = (keep.y + keep.height) * scale + offsetY;

  // What bounds the band. A detected page bounds it to the sheet itself; with
  // no detection there is no sheet to bound it to, so it falls back to the
  // guide box — the only rectangle the person can see. Running to the edges of
  // the screen instead reads as "the camera is blocked down here" rather than
  // "this part of the sheet is dropped".
  const guide = getGuideBox(
    containerWidth,
    containerHeight,
    padding,
    aspectRatio,
  );

  const bounds: Box = quad
    ? {
        left: Math.min(...quad.map((p) => p.x)) * scale + offsetX,
        right: Math.max(...quad.map((p) => p.x)) * scale + offsetX,
        top: Math.min(...quad.map((p) => p.y)) * scale + offsetY,
        bottom: Math.max(...quad.map((p) => p.y)) * scale + offsetY,
      }
    : guide;

  // Clamp to the visible element: a page held close can extend past the
  // viewfinder, and a band drawn off-screen is a band the user cannot check.
  const left = Math.max(bounds.left, 0);
  const right = Math.min(bounds.right, containerWidth);
  const top = Math.max(cutoff, bounds.top, 0);
  const bottom = Math.min(bounds.bottom, containerHeight);

  if (right <= left || bottom - top < MIN_BAND_HEIGHT_PX) return null;

  // Clip to the sheet itself. Corners above the band's top come out negative,
  // which is fine — the box already starts at the crop line, so the clipped
  // result is exactly "the part of the page below the cutoff".
  const clipPath = quad
    ? `polygon(${orderedCorners(quad)
        .map(
          (pt) =>
            `${pt.x * scale + offsetX - left}px ${pt.y * scale + offsetY - top}px`,
        )
        .join(", ")})`
    : null;

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    fromDetectedQuad: keep.fromDetectedQuad,
    clipPath,
  };
}
