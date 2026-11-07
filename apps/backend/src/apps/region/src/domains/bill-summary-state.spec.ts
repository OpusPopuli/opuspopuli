import {
  BillSummaryState,
  type SummaryProvenance,
  summaryStateOf,
} from './bill-summary-state';

const LIVE = { promptHash: 'h', modelDigest: 'd', currentVersion: 'V98' };
const written = (over: Partial<SummaryProvenance> = {}): SummaryProvenance => ({
  aiSummary: { plainEnglishSummary: 'x' },
  aiSummaryPromptHash: 'h',
  aiSummaryLlmDigest: 'd',
  aiSummarySourceVersion: 'V98',
  statusSource: 'official',
  ...over,
});

describe('summaryStateOf (bills-phase-b.md K6, D7)', () => {
  it('is current when written under the live template, model and version', () => {
    expect(summaryStateOf(written(), LIVE)).toBe(BillSummaryState.CURRENT);
  });

  it('is missing with no summary', () => {
    expect(summaryStateOf(written({ aiSummary: null }), LIVE)).toBe(
      BillSummaryState.MISSING,
    );
  });

  it.each([
    ['another template', { aiSummaryPromptHash: 'old' }],
    ['no recorded template', { aiSummaryPromptHash: null }],
    ['another model build', { aiSummaryLlmDigest: 'old' }],
    ['no recorded build', { aiSummaryLlmDigest: null }],
    ['an older version', { aiSummarySourceVersion: 'V99' }],
  ])('is stale when written under %s', (_why, over) => {
    expect(summaryStateOf(written(over), LIVE)).toBe(BillSummaryState.STALE);
  });

  it('does not judge the build when the live one is unknown', () => {
    expect(
      summaryStateOf(written({ aiSummaryLlmDigest: null }), {
        ...LIVE,
        modelDigest: undefined,
      }),
    ).toBe(BillSummaryState.CURRENT);
  });

  it('does not judge the version of a page bill, or one with no text', () => {
    expect(
      summaryStateOf(
        written({ statusSource: 'page', aiSummarySourceVersion: null }),
        LIVE,
      ),
    ).toBe(BillSummaryState.CURRENT);
    expect(
      summaryStateOf(written({ aiSummarySourceVersion: 'V99' }), {
        ...LIVE,
        currentVersion: undefined,
      }),
    ).toBe(BillSummaryState.CURRENT);
  });

  it('retries a skip sentinel only on a new version', () => {
    const skip = { aiSummary: { skip: true }, aiSummaryPromptHash: 'old' };
    expect(summaryStateOf(written(skip), LIVE)).toBe(BillSummaryState.CURRENT);
    expect(
      summaryStateOf(written({ ...skip, aiSummarySourceVersion: 'V99' }), LIVE),
    ).toBe(BillSummaryState.STALE);
  });
});
