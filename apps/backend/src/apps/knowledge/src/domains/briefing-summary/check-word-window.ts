/**
 * Outcome of `checkWordWindow` — a pure helper that's the shared
 * structural shape between `BriefingSummaryValidatorService` and the
 * older `ExplanationValidatorService`. Pulled out so the two
 * validators don't trip the 0% jscpd duplication gate while still
 * sharing the same basic "non-empty + word-count window" pre-check.
 *
 * Each validator owns its own MIN/MAX bounds and its own logging /
 * rejection-reason vocab — only this pre-check structure is shared.
 */
export type WordWindowOutcome =
  | { kind: 'ok'; trimmed: string; wordCount: number }
  | { kind: 'empty' }
  | { kind: 'out_of_window'; wordCount: number };

/**
 * Trim the input, fail-fast on empty, count words by whitespace, and
 * return whether the count lands inside `[min, max]`. The caller
 * branches on the outcome and emits its own rejection-reason vocab
 * (`'empty'` / `'word-count'` for explanations,
 * `'empty'` / `'word-count'` for briefing summaries — same labels
 * here but the consequence differs per validator).
 */
export function checkWordWindow(
  input: string,
  min: number,
  max: number,
): WordWindowOutcome {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  const wordCount = trimmed.split(/\s+/u).filter((w) => w.length > 0).length;
  if (wordCount < min || wordCount > max) {
    return { kind: 'out_of_window', wordCount };
  }
  return { kind: 'ok', trimmed, wordCount };
}
