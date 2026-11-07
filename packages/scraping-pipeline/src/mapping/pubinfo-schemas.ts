/**
 * Schemas for the California Legislature's pubinfo tables
 * (`docs/plans/bills-phase-b.md`, D9/D10): what a mapped export row must hold
 * to be mirrored. Pinned with the mapper (`bulk-import-key.spec.ts`), because
 * a change here changes what a skipped row would have been written as.
 */

import { z } from "zod";
import type { PubinfoRow, PubinfoTable } from "@opuspopuli/common";

/** `z.object` strips undeclared keys, so the stamped hash must be declared. */
const base = {
  externalId: z.string().min(1),
  sourceRecordHash: z.string().length(64).optional(),
};

const text = z.string().min(1).optional();
const int = z.coerce.number().int();

/**
 * pubinfo prints `2024-12-02 00:00:00`: Pacific wall-clock with no zone. The
 * calendar date is all any reader uses, and keeping it as text avoids a
 * timezone guess turning one day into the day before.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform((v) => v.slice(0, 10));

export const PUBINFO_SCHEMAS: Record<PubinfoTable, z.ZodType<PubinfoRow>> = {
  BILL_TBL: z.object({
    ...base,
    table: z.literal("BILL_TBL"),
    sessionYear: z.string().min(1),
    measureType: z.string().min(1),
    measureNum: int,
    measureState: text,
    chapterYear: text,
    chapterNum: text,
    latestBillVersionId: text,
    currentLocation: text,
    currentHouse: text,
    currentStatus: text,
  }),
  BILL_VERSION_TBL: z.object({
    ...base,
    table: z.literal("BILL_VERSION_TBL"),
    billId: z.string().min(1),
    versionNum: int,
    billVersionActionDate: calendarDate,
    billVersionAction: text,
    subject: text,
    voteRequired: text,
    appropriation: text,
    fiscalCommittee: text,
    localProgram: text,
    urgency: text,
    taxlevy: text,
    billXml: text,
  }),
  BILL_VERSION_AUTHORS_TBL: z.object({
    ...base,
    table: z.literal("BILL_VERSION_AUTHORS_TBL"),
    billVersionId: z.string().min(1),
    type: z.string().min(1),
    house: text,
    name: text,
    contribution: text,
    primaryAuthorFlg: text,
  }),
  BILL_HISTORY_TBL: z.object({
    ...base,
    table: z.literal("BILL_HISTORY_TBL"),
    billId: z.string().min(1),
    actionDate: calendarDate.optional(),
    action: text,
    actionSequence: int.optional(),
    actionCode: text,
    actionStatus: text,
  }),
  BILL_SUMMARY_VOTE_TBL: z.object({
    ...base,
    table: z.literal("BILL_SUMMARY_VOTE_TBL"),
    billId: z.string().min(1),
    locationCode: z.string().min(1),
    voteDateTime: z.string().min(1),
    voteDateSeq: int,
    motionId: int,
    ayes: int.optional(),
    noes: int.optional(),
    abstain: int.optional(),
    voteResult: text,
  }),
  BILL_DETAIL_VOTE_TBL: z.object({
    ...base,
    table: z.literal("BILL_DETAIL_VOTE_TBL"),
    billId: z.string().min(1),
    locationCode: z.string().min(1),
    legislatorName: z.string().min(1),
    voteDateTime: z.string().min(1),
    voteDateSeq: int,
    voteCode: text,
    motionId: int,
  }),
  BILL_MOTION_TBL: z.object({
    ...base,
    table: z.literal("BILL_MOTION_TBL"),
    motionText: text,
  }),
  LEGISLATOR_TBL: z.object({
    ...base,
    table: z.literal("LEGISLATOR_TBL"),
    district: z.string().min(1),
    sessionYear: z.string().min(1),
    legislatorName: z.string().min(1),
    houseType: z.string().min(1),
    authorName: text,
    firstName: text,
    lastName: text,
    party: text,
  }),
  LOCATION_CODE_TBL: z.object({
    ...base,
    table: z.literal("LOCATION_CODE_TBL"),
    sessionYear: z.string().min(1),
    locationCode: z.string().min(1),
    locationType: text,
    description: text,
    longDescription: text,
  }),
};
