/**
 * What the bills sync writes to each pubinfo mirror for a mapped row
 * (`docs/plans/bills-phase-b.md`, D10).
 *
 * Its own file because `campaign-finance-write-shape.spec.ts` pins it with the
 * finance write shape: a row the sync skips as unchanged (K4) keeps what its
 * last write gave it, so a change here that alters a written row must bump
 * `BULK_MAPPING_VERSION`.
 */

import type { PubinfoRow, PubinfoTable } from '@opuspopuli/common';

/** Columns written per mirror, besides `externalId`. */
export const PUBINFO_WRITE_FIELDS = {
  BILL_TBL: [
    'sessionYear',
    'measureType',
    'measureNum',
    'measureState',
    'chapterYear',
    'chapterNum',
    'latestBillVersionId',
    'currentLocation',
    'currentHouse',
    'currentStatus',
  ],
  BILL_VERSION_TBL: [
    'billId',
    'versionNum',
    'billVersionActionDate',
    'billVersionAction',
    'subject',
    'voteRequired',
    'appropriation',
    'fiscalCommittee',
    'localProgram',
    'urgency',
    'taxlevy',
    'billXml',
  ],
  BILL_VERSION_AUTHORS_TBL: [
    'billVersionId',
    'type',
    'house',
    'name',
    'contribution',
    'primaryAuthorFlg',
  ],
  BILL_HISTORY_TBL: [
    'billId',
    'actionDate',
    'action',
    'actionSequence',
    'actionCode',
    'actionStatus',
  ],
  BILL_SUMMARY_VOTE_TBL: [
    'billId',
    'locationCode',
    'voteDateTime',
    'voteDateSeq',
    'motionId',
    'ayes',
    'noes',
    'abstain',
    'voteResult',
  ],
  BILL_DETAIL_VOTE_TBL: [
    'billId',
    'locationCode',
    'legislatorName',
    'voteDateTime',
    'voteDateSeq',
    'voteCode',
    'motionId',
  ],
  BILL_MOTION_TBL: ['motionText'],
  LEGISLATOR_TBL: [
    'district',
    'sessionYear',
    'legislatorName',
    'houseType',
    'authorName',
    'firstName',
    'lastName',
    'party',
  ],
  COMMITTEE_HEARING_TBL: [
    'billId',
    'committeeType',
    'committeeNr',
    'hearingDate',
    'locationCode',
    'transUpdateDate',
  ],
  LOCATION_CODE_TBL: [
    'sessionYear',
    'locationCode',
    'locationType',
    'description',
    'longDescription',
  ],
} as const satisfies Record<PubinfoTable, readonly string[]>;

/** Calendar dates the mapper keeps as `YYYY-MM-DD`, written to DATE columns. */
const DATE_FIELDS: ReadonlySet<string> = new Set([
  'billVersionActionDate',
  'actionDate',
  'hearingDate',
]);

/** Provenance written on every mirror row (#1277, #1280). */
const PROVENANCE_FIELDS = ['sourceRecordHash', 'pipelineExecutionId'] as const;

/**
 * The values one upsert sends for `row`. A mirror holds exactly what its line
 * says, so every field is clearable: a cell that became NULL is written as
 * null rather than left standing.
 */
export function pubinfoWriteValues(row: PubinfoRow): Record<string, unknown> {
  const record = row as unknown as Record<string, unknown>;
  const fields = [...PUBINFO_WRITE_FIELDS[row.table], ...PROVENANCE_FIELDS];
  return Object.fromEntries(
    fields.map((field) => {
      const value = record[field];
      if (value === undefined) return [field, null];
      if (DATE_FIELDS.has(field)) {
        return [field, new Date(`${value as string}T00:00:00Z`)];
      }
      return [field, value];
    }),
  );
}
