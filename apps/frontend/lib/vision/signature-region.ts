import { orderCorners, type Quad } from "./perspective";

/**
 * Where the petition ends and the signatures begin (#1075).
 *
 * A California petition sheet carries the measure text, then a block of up to
 * five handwritten signature rows — name, residence address, city, ZIP — and
 * then a Declaration of Circulator with the circulator's own name and address.
 * Photograph a partly-signed sheet and every one of those people is captured,
 * and none of them consented to anything.
 *
 * So we keep only the upper portion and discard the rest before the image
 * leaves the device. The Secretary of State's format puts the Attorney
 * General's title and summary at the top of every signature page (§ 9008), and
 * both sample petitions put the measure text above the signature rows, so
 * "keep the top" is a reliable rule rather than a guess.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS MODULE IS THE SINGLE SOURCE OF TRUTH.
 *
 * The viewfinder overlay renders what this returns, and the capture crops to
 * what this returns. If the two ever diverge, the interface is lying about
 * exactly the thing the pre-capture notice promises. One computation, two
 * consumers — do not inline a second version of this arithmetic anywhere.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Detecting handwriting was considered and rejected. It is probabilistic, and
 * a guarantee that holds most of the time is not a guarantee. Cropping is
 * deterministic and does not need to tell handwriting from print at all.
 */

/** Fraction of the detected page height kept, measured from its top edge. */
export const KEEP_TOP_FRACTION = 0.55;

/**
 * Fallback when no page has been detected. Deliberately smaller than
 * KEEP_TOP_FRACTION: with no idea where the page is, we cannot know where its
 * signature block falls, so we keep less rather than more.
 */
export const UNDETECTED_KEEP_TOP_FRACTION = 0.45;

/** An axis-aligned region of the source frame, in source pixels. */
export interface KeepRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** True when this came from a detected page rather than the fallback. */
  readonly fromDetectedQuad: boolean;
}

export interface KeepRegionInput {
  readonly quad: Quad | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /**
   * True when the image has ALREADY been deskew-cropped to the page, so the
   * image and the page are the same rectangle.
   *
   * This matters because `handleCapture` deskews before handing the frame on:
   * after that transform the quad is in the old frame's coordinate space and
   * is meaningless against the new image. Passing the stale quad would crop
   * the wrong rectangle — possibly leaving the signature block in shot.
   */
  readonly pageFillsImage?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The region of the frame that may be kept.
 *
 * Always a subset of the frame, and always fails CLOSED: an undetected page
 * yields a conservative centre crop rather than the whole frame. "We could not
 * find the page" must never resolve to "so keep everything" — that is exactly
 * the case where a signature block is most likely to be sitting in shot.
 */
export function getKeepRegion({
  quad,
  frameWidth,
  frameHeight,
  pageFillsImage = false,
}: KeepRegionInput): KeepRegion {
  const w = Math.max(0, Math.floor(frameWidth));
  const h = Math.max(0, Math.floor(frameHeight));

  if (w === 0 || h === 0) {
    return { x: 0, y: 0, width: 0, height: 0, fromDetectedQuad: false };
  }

  // Already deskewed to the page: the image IS the page, so keep the top of
  // the image and ignore any quad, which now refers to a coordinate space that
  // no longer exists.
  if (pageFillsImage) {
    return {
      x: 0,
      y: 0,
      width: w,
      height: Math.max(1, Math.round(h * KEEP_TOP_FRACTION)),
      fromDetectedQuad: true,
    };
  }

  if (!quad) {
    return {
      x: 0,
      y: 0,
      width: w,
      height: Math.max(1, Math.round(h * UNDETECTED_KEEP_TOP_FRACTION)),
      fromDetectedQuad: false,
    };
  }

  // orderCorners returns [top-left, top-right, bottom-right, bottom-left].
  const [tl, tr, br, bl] = orderCorners(quad);

  // Axis-aligned bounds of the detected page. The page may be rotated in
  // frame; we deliberately do not deskew here, because the crop has to be
  // expressible as a rectangle the overlay can draw and the canvas can slice.
  const left = clamp(Math.min(tl.x, bl.x), 0, w);
  const right = clamp(Math.max(tr.x, br.x), 0, w);
  const top = clamp(Math.min(tl.y, tr.y), 0, h);
  const bottom = clamp(Math.max(bl.y, br.y), 0, h);

  const pageWidth = Math.max(0, right - left);
  const pageHeight = Math.max(0, bottom - top);

  if (pageWidth === 0 || pageHeight === 0) {
    return {
      x: 0,
      y: 0,
      width: w,
      height: Math.max(1, Math.round(h * UNDETECTED_KEEP_TOP_FRACTION)),
      fromDetectedQuad: false,
    };
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(pageWidth),
    height: Math.max(1, Math.round(pageHeight * KEEP_TOP_FRACTION)),
    fromDetectedQuad: true,
  };
}

/**
 * Slice an ImageData down to a keep-region.
 *
 * Pure pixel arithmetic rather than a canvas, so it runs identically in the
 * browser and in jsdom — the crop is the guarantee this whole issue rests on,
 * and it needs to be testable without a rendering surface.
 */
export function cropImageData(
  source: ImageData,
  region: KeepRegion,
): ImageData {
  const width = Math.max(1, Math.min(region.width, source.width - region.x));
  const height = Math.max(1, Math.min(region.height, source.height - region.y));

  const out = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    const from = ((region.y + row) * source.width + region.x) * 4;
    const to = row * width * 4;
    out.data.set(source.data.subarray(from, from + width * 4), to);
  }
  return out;
}

/**
 * The same region expressed as percentages of the frame, for SVG overlays that
 * work in a `0 0 100 100` viewBox.
 *
 * Derived from `getKeepRegion` rather than recomputed, so the band the user
 * sees cannot drift from the crop that is applied.
 */
export function getKeepRegionPercent(input: KeepRegionInput): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fromDetectedQuad: boolean;
} {
  const region = getKeepRegion(input);
  const w = Math.max(1, input.frameWidth);
  const h = Math.max(1, input.frameHeight);

  return {
    x: (region.x / w) * 100,
    y: (region.y / h) * 100,
    width: (region.width / w) * 100,
    height: (region.height / h) * 100,
    fromDetectedQuad: region.fromDetectedQuad,
  };
}
