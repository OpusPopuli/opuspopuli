/**
 * Locate a model-supplied quote in its source text and derive char offsets.
 *
 * The #1212 contract asks the model for a verbatim quote instead of character
 * offsets, because offsets are arithmetic over tokens and no model tested does
 * it — measured anchoring was 2% for `olmo-3:7b-instruct` under the offsets
 * contract. Locating is code's job, and code is exact at it.
 *
 * Lives in @opuspopuli/common because BOTH the eval harness and the region
 * service must locate identically. If they diverge, the harness stops
 * measuring what production does and the gate's number becomes a fiction —
 * the same failure the duplicated redaction patterns would have caused.
 */

/** Shortest fragment worth treating as evidence of a location. */
const MIN_FRAGMENT_CHARS = 20;

export interface LocatedQuote {
  /** Inclusive char offset into the ORIGINAL (un-normalised) source text. */
  start: number;
  /** Exclusive char offset into the ORIGINAL source text. */
  end: number;
  /** The text actually quoted — fragments joined, with any elision removed. */
  quoted: string;
  /** True when the quote was reassembled across an ellipsis. */
  elided: boolean;
}

/** Collapse runs of whitespace so a reflowed line break is not a miscitation. */
export const normaliseForLocate = (text: string): string =>
  text.replace(/\s+/g, " ");

/**
 * Normalise while recording where each normalised character came from.
 *
 * `map[i]` is the index in `raw` of the character that produced `normalised[i]`,
 * plus one final entry for the end position, so a located span can be mapped
 * back to offsets the caller can slice the raw text with.
 */
function normaliseWithMap(raw: string): { normalised: string; map: number[] } {
  let normalised = "";
  const map: number[] = [];
  let inRun = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inRun) {
        normalised += " ";
        map.push(i);
        inRun = true;
      }
      continue;
    }
    inRun = false;
    normalised += ch;
    map.push(i);
  }
  map.push(raw.length);
  return { normalised, map };
}

/**
 * Locate a quote the model elided with an ellipsis.
 *
 * Models abbreviate mid-quote despite being told not to — 48% of quotes from
 * a 7B and 25% from a 32B did. An elided quote is not a miscitation: the model
 * is pointing at real, contiguous spans and dropping the middle.
 *
 * Deliberately strict, so this cannot become a way to locate anything: every
 * fragment must be present AND in order (each search resumes where the last
 * ended), fragments under MIN_FRAGMENT_CHARS are discarded rather than
 * matched, and fewer than two surviving fragments is not an elision.
 */
function locateElided(needle: string, haystack: string): LocatedQuote | null {
  const fragments = needle
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((f) => f.trim())
    .filter((f) => f.length >= MIN_FRAGMENT_CHARS);

  if (fragments.length < 2) return null;

  let cursor = 0;
  let start = -1;
  let end = -1;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, cursor);
    if (at === -1) return null;
    if (start === -1) start = at;
    end = at + fragment.length;
    cursor = end;
  }

  return { start, end, quoted: fragments.join(" "), elided: true };
}

/**
 * Locate `quote` in `fullText`, exactly if possible and across an ellipsis
 * otherwise. Returns null when the quote cannot be found, which callers must
 * treat as unverified rather than guessing — an unlocatable quote is the
 * signal that the model paraphrased instead of citing.
 *
 * Offsets are into the ORIGINAL text, not the normalised form used for
 * searching. Matching must tolerate reflowed whitespace, but the offsets are
 * consumed by callers that slice the raw text — the frontend renders
 * `fullText.slice(sourceStart, sourceEnd)` — so returning normalised
 * positions would silently mis-highlight wherever the two differ.
 */
export function locateQuote(
  quote: string | undefined,
  fullText: string,
): LocatedQuote | null {
  const trimmed = quote?.trim();
  if (!trimmed || !fullText) return null;

  const needle = normaliseForLocate(trimmed);
  const { normalised: haystack, map } = normaliseWithMap(fullText);

  // Map a normalised span back onto the original text. Clamped defensively:
  // a span that cannot be mapped is a bug, not something to paper over with
  // a plausible-looking offset — that is the failure #1212 exists to end.
  const toRaw = (hit: LocatedQuote): LocatedQuote => ({
    ...hit,
    start: map[hit.start] ?? 0,
    end: map[hit.end] ?? fullText.length,
  });

  const at = haystack.indexOf(needle);
  if (at !== -1) {
    return toRaw({
      start: at,
      end: at + needle.length,
      quoted: needle,
      elided: false,
    });
  }

  const elided = locateElided(needle, haystack);
  return elided ? toRaw(elided) : null;
}
