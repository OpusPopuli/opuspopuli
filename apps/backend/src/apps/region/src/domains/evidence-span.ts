/**
 * Largest slice returned for a single citation.
 *
 * Matches the cap `LegislativeAction` passage resolution already applies. A
 * citation is meant to show the reader the sentence a claim rests on, not to
 * republish the document — and an unbounded span turns a bad offset into a
 * page-sized quote that looks authoritative.
 */
export const MAX_SPAN_CHARS = 1024;

/** Context shown either side of the slice, so a passage reads in situ. */
export const CONTEXT_HALF_CHARS = 500;

/** Why a span could not be resolved, or how it was. */
export type SpanResolution =
  | {
      status: 'resolved';
      text: string;
      context: string;
      start: number;
      end: number;
    }
  /**
   * The derived text changed after the claim was made. Not an error — it is
   * the answer, and the reason `sourceTextHash` exists (#1279, #1291).
   */
  | { status: 'stale'; expectedHash: string; actualHash: string }
  /** The span does not fit the text it claims to index into. */
  | { status: 'out-of-range'; length: number; start: number; end: number }
  /** The evidence carries no span — a citation hint, or no citation at all. */
  | { status: 'no-span' };

/**
 * Re-derive a cited passage from the source text at read time (#1291).
 *
 * Deliberately takes the *current* text and re-slices it rather than returning
 * a stored copy: a denormalised quote cannot tell you it has gone out of date,
 * and this architecture exists to make that detectable. `LegislativeAction`
 * already resolves passages this way against `Minutes.rawText`
 * (`region-query.service.ts`) — this generalises that one entity's read model
 * rather than adding a second shape beside it.
 *
 * The hash is checked before the slice, not after. Slicing first and comparing
 * afterwards would still produce a passage from text the claim never saw, and
 * the tempting thing to do with a passage is show it.
 *
 * @param text - Current derived text the span indexes into
 * @param actualHash - Hash of that text, as it is now
 * @param evidence - Stored span and the hash it was measured against
 * @returns How the span resolved, including the two failure modes
 */
export function resolveEvidenceSpan(
  text: string | null,
  actualHash: string | null,
  evidence: {
    sourceTextHash: string | null;
    spanStart: number | null;
    spanEnd: number | null;
  },
): SpanResolution {
  const { sourceTextHash, spanStart, spanEnd } = evidence;

  if (spanStart === null || spanEnd === null || text === null) {
    return { status: 'no-span' };
  }

  // Checked first. A claim measured against different text has no valid span
  // into this one, whatever the offsets happen to address.
  if (
    sourceTextHash !== null &&
    actualHash !== null &&
    sourceTextHash !== actualHash
  ) {
    return { status: 'stale', expectedHash: sourceTextHash, actualHash };
  }

  if (spanStart < 0 || spanEnd <= spanStart || spanEnd > text.length) {
    return {
      status: 'out-of-range',
      length: text.length,
      start: spanStart,
      end: spanEnd,
    };
  }

  const start = spanStart;
  const end = Math.min(spanEnd, start + MAX_SPAN_CHARS);

  return {
    status: 'resolved',
    text: text.slice(start, end),
    context: text.slice(
      snapToWhitespace(text, Math.max(0, start - CONTEXT_HALF_CHARS), 'back'),
      snapToWhitespace(
        text,
        Math.min(text.length, end + CONTEXT_HALF_CHARS),
        'forward',
      ),
    ),
    start,
    end,
  };
}

/**
 * Move an index to the nearest whitespace so context does not begin or end
 * mid-word. Gives up after 50 characters rather than walking the document.
 *
 * Lifted from `region-query.service.ts`'s passage resolution so both paths snap
 * identically; a context window that differs between two citation surfaces
 * reads as a bug in the data.
 */
function snapToWhitespace(
  text: string,
  idx: number,
  direction: 'back' | 'forward',
): number {
  if (direction === 'back') {
    const probe = Math.max(0, idx);
    if (probe === 0) return 0;
    for (let i = probe; i > Math.max(0, probe - 50); i--) {
      if (/\s/.test(text[i])) return i + 1;
    }
    return probe;
  }

  const probe = Math.min(text.length, idx);
  if (probe === text.length) return probe;
  for (let i = probe; i < Math.min(text.length, probe + 50); i++) {
    if (/\s/.test(text[i])) return i;
  }
  return probe;
}
