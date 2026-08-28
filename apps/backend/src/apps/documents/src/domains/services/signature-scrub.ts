/**
 * Strip a petition's signature block out of OCR text (#1075).
 *
 * Second layer. The client already crops the block away before the image
 * leaves the device, so in the normal case this finds nothing. It exists for
 * the cases the crop cannot cover — an unusually tall signature block, a page
 * photographed at an angle the crop under-estimated, a document that is not
 * laid out the way the Secretary of State's template expects.
 *
 * ── On the matching rule ──────────────────────────────────────────────────
 *
 * The plan for this issue originally said "truncate at the LAST label
 * occurrence in the lower portion". Working it through, that is wrong in the
 * exact case it was meant to protect against.
 *
 * The block repeats its labels once per signature row. The last occurrence is
 * therefore near the very END of the block — truncating there would keep
 * almost all of it, which is the opposite of the goal. Truncating at the first
 * occurrence of a WEAK label is wrong too: "residence address" and "city" can
 * legitimately appear in a measure's own text, and cutting there would discard
 * the measure.
 *
 * So the rule is: match only on markers strong enough that they cannot
 * plausibly occur in legislative prose, and truncate at the first of those.
 * "Print Your Name" and "Sign As Registered To Vote" are form-field labels; no
 * initiative text contains them. Weak labels are deliberately NOT used.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * Markers that only ever appear as signature-block furniture.
 *
 * Taken verbatim from the Secretary of State's sample petition and from a real
 * circulating petition (25-0007A1). Deliberately excludes "City", "Zip" and
 * "Residence Address" — those appear in measure text often enough that
 * matching them would truncate real content.
 */
export const SIGNATURE_BLOCK_MARKERS: readonly string[] = [
  'DECLARATION OF CIRCULATOR',
  'Print Your Name',
  'Sign As Registered To Vote',
  'DO NOT SIGN UNLESS',
  'REGISTERED VOTERS ONLY',
];

export interface ScrubResult {
  readonly text: string;
  /** True when a marker was found and text after it was dropped. */
  readonly scrubbed: boolean;
}

/**
 * Truncate at the first signature-block marker.
 *
 * Returns the text unchanged when no marker is present, which is the expected
 * outcome once the client-side crop has done its job.
 *
 * If a marker appears at the very start — a rotated capture that read the
 * block first — this returns empty text. That is deliberate and safe: the
 * minimum-text pre-gate in AnalysisService then records an `unreadable`
 * verdict rather than analysing anything, which is the correct outcome for a
 * photograph we could not read the measure from.
 */
export function scrubSignatureBlock(text: string): ScrubResult {
  if (!text) return { text, scrubbed: false };

  const haystack = text.toLowerCase();
  let cut = -1;

  for (const marker of SIGNATURE_BLOCK_MARKERS) {
    const at = haystack.indexOf(marker.toLowerCase());
    if (at !== -1 && (cut === -1 || at < cut)) cut = at;
  }

  if (cut === -1) return { text, scrubbed: false };

  return { text: text.slice(0, cut).trimEnd(), scrubbed: true };
}
