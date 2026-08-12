import type { CampaignFinanceResult } from "./types.js";

/**
 * Field-presence rules routing each streamed CAL-ACCESS record to its table.
 * The bulk downloads carry no wire-format type tag, so shape is the only
 * discriminator available.
 *
 * **Order is significant — first match wins.** Several shapes overlap, and the
 * sequence below encodes which reading takes precedence:
 *
 *   - Summaries lead. SMRY_CD is the only shape carrying a form type *and* a
 *     line number, and it holds no amount/donor/payee (#992).
 *   - Cover pages precede measure filings: both carry `filingId`, and only the
 *     cover page carries `filerId` (#955).
 *   - Committees come last. Their rule is the loosest, so anything more
 *     specific must have had its chance first.
 *
 * A table rather than an if/else chain: the chain reached the
 * cognitive-complexity gate at seven branches, and every future table would
 * have pushed it further.
 */
const FINANCE_ROUTES: ReadonlyArray<{
  bucket: keyof CampaignFinanceResult;
  matches: (rec: Record<string, unknown>) => boolean;
}> = [
  {
    bucket: "filingSummaries",
    matches: (r) => "formType" in r && "lineItem" in r,
  },
  {
    bucket: "contributions",
    matches: (r) => "donorName" in r && "amount" in r,
  },
  { bucket: "expenditures", matches: (r) => "payeeName" in r && "amount" in r },
  {
    bucket: "independentExpenditures",
    matches: (r) => "supportOrOppose" in r && "committeeName" in r,
  },
  // Form 496 cover page — filerId + filingId, no committeeName/ballot fields.
  // Feeds the IE linker's FILING_ID -> committee join (#955).
  { bucket: "cvrFilings", matches: (r) => "filerId" in r && "filingId" in r },
  {
    bucket: "committeeMeasureFilings",
    matches: (r) =>
      "filingId" in r && ("ballotName" in r || "ballotNumber" in r),
  },
  { bucket: "committees", matches: (r) => "sourceSystem" in r && "type" in r },
];

/** An empty result — every bucket present, so callers can push without checks. */
export function emptyCampaignFinanceResult(): CampaignFinanceResult {
  return {
    committees: [],
    contributions: [],
    expenditures: [],
    independentExpenditures: [],
    committeeMeasureFilings: [],
    cvrFilings: [],
    filingSummaries: [],
  };
}

/**
 * Sort a heterogeneous batch of CAL-ACCESS records into the typed shape
 * `CampaignFinanceResult` expects.
 *
 * Lives here rather than at either call site because it had been implemented
 * twice — once in the region plugin, once in the backend sync service — and the
 * two had to be edited in lockstep. A table added to one and missed in the
 * other drops that table's rows silently, which is the failure mode this whole
 * issue exists to eliminate. One table, one loop, both callers (#992).
 */
export function sortCampaignFinanceItems(
  items: Record<string, unknown>[],
): CampaignFinanceResult {
  const sorted = emptyCampaignFinanceResult();

  for (const rec of items) {
    const route = FINANCE_ROUTES.find(({ matches }) => matches(rec));
    // Unroutable records are dropped, as they always have been: the stream
    // carries shapes no table claims.
    if (route) (sorted[route.bucket] as unknown[]).push(rec);
  }

  return sorted;
}
