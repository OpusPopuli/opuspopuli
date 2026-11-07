/**
 * Whether a bill's summary is current, for one bill (`bills-phase-b.md`, K6,
 * D7). The batch selects stale summaries in SQL (`hotSummaryCandidates`,
 * `liveSummaryInputs`); this is the same rule for the bill a reader is
 * looking at. `bill-summary-state.spec.ts` pins the two together.
 */

export enum BillSummaryState {
  /** Written under the live template, model and text version. */
  CURRENT = 'CURRENT',
  /** Written, but under another template, model or text version. */
  STALE = 'STALE',
  /** No summary yet. */
  MISSING = 'MISSING',
}

/** The provenance a stored summary carries. */
export interface SummaryProvenance {
  aiSummary: unknown;
  aiSummaryPromptHash: string | null;
  aiSummaryLlmDigest: string | null;
  aiSummarySourceVersion: string | null;
  statusSource: string | null;
}

/** What a summary written now would carry. */
export interface LiveSummary {
  promptHash: string;
  /** Unknown when the model cannot be asked; the build is then not judged. */
  modelDigest?: string;
  /**
   * An export bill's current version, when it has text. Absent for a page
   * bill, or when the current version has none: there is nothing to chase.
   */
  currentVersion?: string;
}

const isSkipSentinel = (summary: unknown): boolean =>
  typeof summary === 'object' &&
  summary !== null &&
  (summary as { skip?: unknown }).skip === true &&
  Object.keys(summary).length === 1;

export function summaryStateOf(
  row: SummaryProvenance,
  live: LiveSummary,
): BillSummaryState {
  if (typeof row.aiSummary !== 'object' || row.aiSummary === null) {
    return BillSummaryState.MISSING;
  }
  const newVersion =
    row.statusSource === 'official' &&
    live.currentVersion !== undefined &&
    row.aiSummarySourceVersion !== live.currentVersion;
  // The model found nothing to summarize: only new text can change that.
  if (isSkipSentinel(row.aiSummary)) {
    return newVersion ? BillSummaryState.STALE : BillSummaryState.CURRENT;
  }
  const otherTemplate = row.aiSummaryPromptHash !== live.promptHash;
  const otherModel =
    live.modelDigest !== undefined &&
    row.aiSummaryLlmDigest !== live.modelDigest;
  return otherTemplate || otherModel || newVersion
    ? BillSummaryState.STALE
    : BillSummaryState.CURRENT;
}
