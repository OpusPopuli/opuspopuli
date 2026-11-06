/**
 * Rows of the California Legislature's pubinfo export, as the bulk path
 * mirrors them (`docs/plans/bills-phase-b.md`, D9/D10). One type per table;
 * `table` says which, taken from the source's `pubinfo:<TABLE>` category.
 *
 * Field names are the region config's `columnMappings` targets. Dates are kept
 * as the `YYYY-MM-DD` the export prints: pubinfo writes Pacific wall-clock
 * times with no zone, and a calendar date is all any reader needs.
 */

export const PUBINFO_TABLES = [
  "BILL_TBL",
  "BILL_VERSION_TBL",
  "BILL_VERSION_AUTHORS_TBL",
  "BILL_HISTORY_TBL",
  "BILL_SUMMARY_VOTE_TBL",
  "BILL_DETAIL_VOTE_TBL",
  "BILL_MOTION_TBL",
  "LEGISLATOR_TBL",
  "LOCATION_CODE_TBL",
] as const;

export type PubinfoTable = (typeof PUBINFO_TABLES)[number];

/** The `category` prefix that marks a bills source as a pubinfo table. */
export const PUBINFO_CATEGORY_PREFIX = "pubinfo:";

/** The table a source category names, or undefined if it names none. */
export function pubinfoTableOf(
  category: string | undefined,
): PubinfoTable | undefined {
  if (!category?.startsWith(PUBINFO_CATEGORY_PREFIX)) return undefined;
  const table = category.slice(PUBINFO_CATEGORY_PREFIX.length);
  return (PUBINFO_TABLES as readonly string[]).includes(table)
    ? (table as PubinfoTable)
    : undefined;
}

interface PubinfoRowBase {
  externalId: string;
  sourceRecordHash?: string;
  pipelineExecutionId?: string | null;
}

export interface PubinfoBillRow extends PubinfoRowBase {
  table: "BILL_TBL";
  sessionYear: string;
  measureType: string;
  measureNum: number;
  measureState?: string;
  chapterYear?: string;
  chapterNum?: string;
  latestBillVersionId?: string;
  currentLocation?: string;
  currentHouse?: string;
  currentStatus?: string;
}

export interface PubinfoBillVersionRow extends PubinfoRowBase {
  table: "BILL_VERSION_TBL";
  billId: string;
  versionNum: number;
  billVersionActionDate: string;
  billVersionAction?: string;
  subject?: string;
  voteRequired?: string;
  appropriation?: string;
  fiscalCommittee?: string;
  localProgram?: string;
  urgency?: string;
  taxlevy?: string;
  billXml?: string;
}

export interface PubinfoBillVersionAuthorRow extends PubinfoRowBase {
  table: "BILL_VERSION_AUTHORS_TBL";
  billVersionId: string;
  type: string;
  house?: string;
  name?: string;
  contribution?: string;
  primaryAuthorFlg?: string;
}

export interface PubinfoBillHistoryRow extends PubinfoRowBase {
  table: "BILL_HISTORY_TBL";
  billId: string;
  actionDate?: string;
  action?: string;
  actionSequence?: number;
  actionCode?: string;
  actionStatus?: string;
}

export interface PubinfoBillSummaryVoteRow extends PubinfoRowBase {
  table: "BILL_SUMMARY_VOTE_TBL";
  billId: string;
  locationCode: string;
  voteDateTime: string;
  voteDateSeq: number;
  motionId: number;
  ayes?: number;
  noes?: number;
  abstain?: number;
  voteResult?: string;
}

export interface PubinfoBillDetailVoteRow extends PubinfoRowBase {
  table: "BILL_DETAIL_VOTE_TBL";
  billId: string;
  locationCode: string;
  legislatorName: string;
  voteDateTime: string;
  voteDateSeq: number;
  voteCode?: string;
  motionId: number;
}

export interface PubinfoBillMotionRow extends PubinfoRowBase {
  table: "BILL_MOTION_TBL";
  motionText?: string;
}

export interface PubinfoLegislatorRow extends PubinfoRowBase {
  table: "LEGISLATOR_TBL";
  district: string;
  sessionYear: string;
  legislatorName: string;
  houseType: string;
  authorName?: string;
  firstName?: string;
  lastName?: string;
  party?: string;
}

export interface PubinfoLocationCodeRow extends PubinfoRowBase {
  table: "LOCATION_CODE_TBL";
  sessionYear: string;
  locationCode: string;
  locationType?: string;
  description?: string;
  longDescription?: string;
}

export type PubinfoRow =
  | PubinfoBillRow
  | PubinfoBillVersionRow
  | PubinfoBillVersionAuthorRow
  | PubinfoBillHistoryRow
  | PubinfoBillSummaryVoteRow
  | PubinfoBillDetailVoteRow
  | PubinfoBillMotionRow
  | PubinfoLegislatorRow
  | PubinfoLocationCodeRow;
