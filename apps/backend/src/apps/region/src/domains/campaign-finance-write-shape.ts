/**
 * What the campaign-finance sync writes for a mapped record: the columns per
 * table, the per-table rules, and the values sent to Prisma
 * (`docs/plans/campaign-finance-phase-b.md`, D2).
 *
 * Its own file because `campaign-finance-write-shape.spec.ts` pins it whole. A
 * row the sync skips as unchanged (K4) keeps what its last write gave it, so
 * any change here that alters a written row (a field added, a field made
 * clearable, a table made amendable) must bump `BULK_MAPPING_VERSION`, or
 * every skipped row keeps the old shape.
 */

/**
 * The columns the sync writes, per table. `writeValues` copies only what is
 * named here, so an unlisted column is silently dropped whatever the stream
 * carries.
 */
export const FINANCE_WRITE_FIELDS = {
  contributions: [
    'committeeId',
    'filingId',
    'amendId',
    'scheduleCode',
    'donorName',
    'donorType',
    'donorEmployer',
    'donorOccupation',
    'donorCity',
    'donorState',
    'donorZip',
    'amount',
    'date',
    'electionType',
    'contributionType',
    'sourceSystem',
    // Which run produced this row (#1280).
    'pipelineExecutionId',
    'sourceRecordHash',
  ],
  expenditures: [
    'committeeId',
    'filingId',
    'amendId',
    'scheduleCode',
    'payeeName',
    'amount',
    'date',
    'purposeDescription',
    'expenditureCode',
    'candidateName',
    'propositionTitle',
    'supportOrOppose',
    'sourceSystem',
    'sourceRecordHash',
    // Which run wrote this row (D5).
    'pipelineExecutionId',
  ],
  independentExpenditures: [
    'committeeId',
    'filingId',
    'amendId',
    'committeeName',
    'candidateName',
    'propositionTitle',
    'supportOrOppose',
    'amount',
    'date',
    'electionDate',
    'description',
    'sourceSystem',
    'sourceRecordHash',
    // Which run wrote this row (D5).
    'pipelineExecutionId',
  ],
  committeeMeasureFilings: [
    'filingId',
    'amendId',
    'ballotName',
    'ballotNumber',
    'ballotJurisdiction',
    'supportOrOppose',
    'sourceSystem',
    'sourceRecordHash',
    // Which run wrote this row (D5).
    'pipelineExecutionId',
  ],
  cvrFilings: [
    'filingId',
    'filerId',
    'candidateName',
    'candidateOffice',
    'propositionTitle',
    'supportOrOppose',
    'sourceSystem',
    'sourceRecordHash',
    // Which run wrote this row (D5).
    'pipelineExecutionId',
  ],
  filingSummaries: [
    'filingId',
    'amendId',
    'formType',
    'lineItem',
    'amountA',
    'amountB',
    'amountC',
    'sourceSystem',
    'sourceRecordHash',
    // Which run wrote this row (D5).
    'pipelineExecutionId',
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * Per-table write rules. See `UpsertConfig` in the sync service for what each
 * one does.
 */
export const FINANCE_WRITE_RULES: Record<
  keyof typeof FINANCE_WRITE_FIELDS,
  { amendable?: true; clearableFields?: readonly string[] }
> = {
  contributions: { amendable: true },
  expenditures: {
    amendable: true,
    // Both became nullable in #991, and an amendment that blanks either
    // must clear it rather than leave the superseded value standing.
    clearableFields: ['date', 'payeeName'],
  },
  // Amendable since regions#97 keyed them like RCPT/EXPN: an amendment
  // restates S496 and CVR2 lines too.
  independentExpenditures: { amendable: true },
  committeeMeasureFilings: { amendable: true },
  cvrFilings: {},
  // Deliberately NOT `amendable`: AMEND_ID is part of this table's identity,
  // so each amendment's summary is its own row and nothing supersedes
  // anything. Reconciliation reads the latest one (#992).
  filingSummaries: {},
};

/**
 * The values one upsert sends for `row`. `undefined` means "leave unchanged"
 * to Prisma and `null` means "clear", so an absent clearable field is sent as
 * null (see `clearableFields`).
 */
export function writeValues(
  row: Record<string, unknown>,
  fields: readonly string[],
  clearable: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [
      f,
      row[f] === undefined && clearable.has(f) ? null : row[f],
    ]),
  );
}
