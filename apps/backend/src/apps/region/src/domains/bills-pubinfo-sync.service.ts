import { Injectable, Logger } from '@nestjs/common';
import {
  batchTransaction,
  type BulkBatchContext,
  type PubinfoRow,
  type PubinfoTable,
} from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { OfficialLifecycle } from './bill-lifecycle';
import { upsertOfficialBill } from './bill-lifecycle-writer';
import {
  authorHouse,
  billNumber,
  camlTitle,
  lastAction,
  latestVersion,
  legislatorKey,
  seatKey,
  sessionLabel,
  voteChamber,
  voteHouse,
  votePosition,
} from './bills-pubinfo-derive';
import { pubinfoWriteValues } from './bills-pubinfo-write-shape';
import { withoutUnchanged } from './bulk-row-skip';

/**
 * Minimal provider contract: a region with a bulk bills source streams its
 * tables (`bills-phase-b.md`, D9).
 */
export interface BillsBulkProvider {
  fetchBillsBulk?(
    onBatch: (rows: PubinfoRow[], context?: BulkBatchContext) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<void>;
}

export interface BillsPubinfoSyncResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  /** Bills rewritten from the mirrors. */
  derived: number;
}

/** The two calls a mirror delegate is used for. */
interface MirrorDelegate {
  findMany(
    args: object,
  ): Promise<{ externalId: string; sourceRecordHash: string | null }[]>;
  upsert(args: object): unknown;
}

/** Bills derived per round trip: one read of each mirror per chunk. */
const DERIVE_CHUNK = 100;

/** Tables whose rows name one bill directly. */
const BILL_KEYED: Partial<Record<PubinfoTable, 'externalId' | 'billId'>> = {
  BILL_TBL: 'externalId',
  BILL_VERSION_TBL: 'billId',
  BILL_HISTORY_TBL: 'billId',
  BILL_SUMMARY_VOTE_TBL: 'billId',
  BILL_DETAIL_VOTE_TBL: 'billId',
};

/** Lookup tables: a change can touch any bill, so every bill is derived. */
const LOOKUPS: ReadonlySet<PubinfoTable> = new Set([
  'BILL_MOTION_TBL',
  'LEGISLATOR_TBL',
  'LOCATION_CODE_TBL',
]);

/** Which bills this sync's written rows touch. */
interface Touched {
  billIds: Set<string>;
  versionIds: Set<string>;
  everything: boolean;
}

/** Lookups loaded once per derive. */
interface DeriveIndex {
  /** legislatorKey → representative id, through the legislator's seat (D15). */
  repByLegislator: Map<string, string>;
  /** `session|code` → location description. */
  locations: Map<string, string>;
}

/**
 * Bills from a legislature's published database export (`bills-phase-b.md`,
 * D9/D10). Each export table is mirrored row for row, skipping lines that
 * are unchanged since the last completed import (K4); then every bill a
 * written row touched is derived from the mirrors: its status and lifecycle
 * (D11), last action, title, author, co-authors and votes (D15–D17). No
 * fetch beyond the one download, and no LLM.
 */
@Injectable()
export class BillsPubinfoSyncService {
  private readonly logger = new Logger(BillsPubinfoSyncService.name);

  constructor(private readonly db: DbService) {}

  async sync(
    provider: BillsBulkProvider,
    opts: {
      regionId: string;
      statusLifecycle: Readonly<Record<string, OfficialLifecycle>>;
      pipelineJobId?: string;
      today?: Date;
    },
  ): Promise<BillsPubinfoSyncResult> {
    const result: BillsPubinfoSyncResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      derived: 0,
    };
    if (!provider.fetchBillsBulk) return result;

    const touched: Touched = {
      billIds: new Set(),
      versionIds: new Set(),
      everything: false,
    };
    await provider.fetchBillsBulk(async (rows, context) => {
      for (const [table, group] of groupByTable(rows)) {
        const counts = await this.upsertMirror(
          table,
          group,
          context?.skipUnchanged ?? false,
        );
        result.processed += group.length;
        result.created += counts.created;
        result.updated += counts.written.length - counts.created;
        result.skipped += group.length - counts.written.length;
        noteTouched(touched, table, counts.written);
      }
    }, opts.pipelineJobId);

    const billIds = await this.billsToDerive(touched);
    result.derived = await this.derive(billIds, {
      regionId: opts.regionId,
      statusLifecycle: opts.statusLifecycle,
      today: opts.today ?? new Date(),
    });
    this.logger.log(
      `pubinfo: ${result.processed} rows (${result.created} created, ${result.updated} updated, ${result.skipped} unchanged); ${result.derived} bills derived`,
    );
    return result;
  }

  /** One table's rows: those whose line changed, written in one pass. */
  private async upsertMirror(
    table: PubinfoTable,
    rows: PubinfoRow[],
    skipUnchanged: boolean,
  ): Promise<{ written: PubinfoRow[]; created: number }> {
    const model = this.mirror(table);
    const existing = await model.findMany({
      where: { externalId: { in: rows.map((r) => r.externalId) } },
      select: { externalId: true, sourceRecordHash: true },
    });
    const written = (
      skipUnchanged
        ? withoutUnchanged(
            rows as unknown as Record<string, unknown>[],
            existing,
          )
        : rows
    ) as PubinfoRow[];
    await batchTransaction(
      this.db,
      written.map((row) => {
        const values = pubinfoWriteValues(row);
        return model.upsert({
          where: { externalId: row.externalId },
          create: { externalId: row.externalId, ...values },
          update: values,
        });
      }),
    );
    const stored = new Set(existing.map((r) => r.externalId));
    return {
      written,
      created: written.filter((r) => !stored.has(r.externalId)).length,
    };
  }

  private mirror(table: PubinfoTable): MirrorDelegate {
    const delegates: Record<PubinfoTable, unknown> = {
      BILL_TBL: this.db.pubinfoBill,
      BILL_VERSION_TBL: this.db.pubinfoBillVersion,
      BILL_VERSION_AUTHORS_TBL: this.db.pubinfoBillVersionAuthor,
      BILL_HISTORY_TBL: this.db.pubinfoBillHistory,
      BILL_SUMMARY_VOTE_TBL: this.db.pubinfoBillSummaryVote,
      BILL_DETAIL_VOTE_TBL: this.db.pubinfoBillDetailVote,
      BILL_MOTION_TBL: this.db.pubinfoBillMotion,
      LEGISLATOR_TBL: this.db.pubinfoLegislator,
      LOCATION_CODE_TBL: this.db.pubinfoLocationCode,
    };
    return delegates[table] as MirrorDelegate;
  }

  /** Bill ids to derive: those a written row named, or all of them. */
  private async billsToDerive(touched: Touched): Promise<string[]> {
    if (touched.everything) {
      const all = await this.db.pubinfoBill.findMany({
        select: { externalId: true },
      });
      return all.map((b) => b.externalId);
    }
    if (touched.versionIds.size > 0) {
      const versions = await this.db.pubinfoBillVersion.findMany({
        where: { externalId: { in: [...touched.versionIds] } },
        select: { billId: true },
      });
      for (const v of versions) touched.billIds.add(v.billId);
    }
    return [...touched.billIds];
  }

  private async derive(
    billIds: string[],
    opts: {
      regionId: string;
      statusLifecycle: Readonly<Record<string, OfficialLifecycle>>;
      today: Date;
    },
  ): Promise<number> {
    if (billIds.length === 0) return 0;
    const index = await this.deriveIndex();
    let derived = 0;
    for (let i = 0; i < billIds.length; i += DERIVE_CHUNK) {
      derived += await this.deriveChunk(
        billIds.slice(i, i + DERIVE_CHUNK),
        index,
        opts,
      );
    }
    return derived;
  }

  private async deriveIndex(): Promise<DeriveIndex> {
    const [legislators, reps, locations] = await Promise.all([
      this.db.pubinfoLegislator.findMany({
        select: {
          sessionYear: true,
          houseType: true,
          authorName: true,
          district: true,
        },
      }),
      this.db.representative.findMany({
        where: { deletedAt: null, chamber: { in: ['Assembly', 'Senate'] } },
        select: { id: true, chamber: true, district: true },
      }),
      this.db.pubinfoLocationCode.findMany({
        select: { sessionYear: true, locationCode: true, description: true },
      }),
    ]);
    const repBySeat = new Map(
      reps.map((r) => [`${r.chamber}|${r.district}`, r.id]),
    );
    const repByLegislator = new Map<string, string>();
    for (const l of legislators) {
      const seat = seatKey(l.district);
      const repId = seat ? repBySeat.get(seat) : undefined;
      if (repId && l.authorName) {
        repByLegislator.set(
          legislatorKey(l.sessionYear, l.houseType, l.authorName),
          repId,
        );
      }
    }
    return {
      repByLegislator,
      locations: new Map(
        locations
          .filter((l) => l.description)
          .map((l) => [`${l.sessionYear}|${l.locationCode}`, l.description!]),
      ),
    };
  }

  private async deriveChunk(
    billIds: string[],
    index: DeriveIndex,
    opts: {
      regionId: string;
      statusLifecycle: Readonly<Record<string, OfficialLifecycle>>;
      today: Date;
    },
  ): Promise<number> {
    const data = await this.loadChunk(billIds);
    let derived = 0;
    for (const pb of data.bills) {
      const versions = data.versionsByBill.get(pb.externalId) ?? [];
      const latest = latestVersion(versions);
      const authors = latest
        ? (data.authorsByVersion.get(latest.externalId) ?? [])
        : [];
      const action = lastAction(data.historyByBill.get(pb.externalId) ?? []);
      const lead = authors.find((a) => a.contribution === 'LEAD_AUTHOR');
      const session = sessionLabel(pb.sessionYear);
      const { id } = await upsertOfficialBill(
        this.db,
        pb.externalId,
        {
          regionId: opts.regionId,
          billNumber: billNumber(pb.measureType, pb.measureNum),
          sessionYear: session,
          measureTypeCode: pb.measureType,
          title:
            camlTitle(
              latest ? data.xmlByVersion.get(latest.externalId) : null,
            ) ??
            latest?.subject ??
            billNumber(pb.measureType, pb.measureNum),
          subject: latest?.subject ?? null,
          status: pb.currentStatus,
          lastAction: action?.action ?? null,
          lastActionDate: action?.actionDate ?? null,
          authorName: lead?.name ?? null,
          authorId: lead
            ? this.repFor(
                index,
                pb.sessionYear,
                authorHouse(lead.house),
                lead.name,
              )
            : null,
          sourceUrl: leginfoUrl('billStatusClient', pb.externalId),
          fullTextUrl: leginfoUrl('billTextClient', pb.externalId),
          needsStatusRecheck: false,
          pipelineExecutionId: pb.pipelineExecutionId,
          extractedAt: opts.today,
        },
        {
          statusLifecycle: opts.statusLifecycle,
          today: opts.today,
          stored: data.storedFlags.get(pb.externalId),
        },
      );
      await this.replaceLinks(
        { id, externalId: pb.externalId, sessionYear: pb.sessionYear },
        authors,
        data,
        index,
      );
      derived++;
    }
    return derived;
  }

  /** Co-authors and votes, replaced together so a bill never shows half a set. */
  private async replaceLinks(
    bill: BillRef,
    authors: AuthorRow[],
    data: ChunkData,
    index: DeriveIndex,
  ): Promise<void> {
    const billId = bill.id;
    const coAuthors = this.coAuthorRows(bill, authors, index);
    const votes = this.voteRows(bill, data, index);
    await this.db.$transaction([
      this.db.billCoAuthor.deleteMany({ where: { billId } }),
      this.db.billCoAuthor.createMany({
        data: coAuthors,
        skipDuplicates: true,
      }),
      this.db.billVote.deleteMany({ where: { billId } }),
      this.db.billVote.createMany({ data: votes, skipDuplicates: true }),
    ]);
  }

  private coAuthorRows(
    bill: BillRef,
    authors: AuthorRow[],
    index: DeriveIndex,
  ) {
    return authors
      .filter(
        (a) =>
          a.type === 'Legislator' &&
          (a.contribution === 'COAUTHOR' ||
            a.contribution === 'PRINCIPAL_COAUTHOR'),
      )
      .map((a) => ({
        billId: bill.id,
        representativeId: this.repFor(
          index,
          bill.sessionYear,
          authorHouse(a.house),
          a.name,
        ),
        coAuthorType: a.contribution!.toLowerCase(),
      }))
      .filter(
        (r): r is typeof r & { representativeId: string } =>
          r.representativeId !== null,
      );
  }

  private voteRows(bill: BillRef, data: ChunkData, index: DeriveIndex) {
    return (data.votesByBill.get(bill.externalId) ?? []).flatMap((v) => {
      const position = votePosition(v.voteCode);
      if (!position) return [];
      return [
        {
          billId: bill.id,
          representativeId: this.repFor(
            index,
            bill.sessionYear,
            voteHouse(v.locationCode),
            v.legislatorName,
          ),
          representativeName: v.legislatorName,
          chamber: voteChamber(
            v.locationCode,
            index.locations.get(`${bill.sessionYear}|${v.locationCode}`),
          ),
          voteDate: new Date(`${v.voteDateTime.slice(0, 10)}T00:00:00Z`),
          position,
          motionText: data.motions.get(v.motionId) ?? null,
          sourceUrl: leginfoUrl('billVotesClient', bill.externalId),
        },
      ];
    });
  }

  private repFor(
    index: DeriveIndex,
    sessionYear: string,
    house: string | undefined,
    name: string | null,
  ): string | null {
    if (!house || !name) return null;
    return (
      index.repByLegislator.get(legislatorKey(sessionYear, house, name)) ?? null
    );
  }

  private async loadChunk(billIds: string[]): Promise<ChunkData> {
    const [bills, versions, history, votes, stored] = await Promise.all([
      this.db.pubinfoBill.findMany({ where: { externalId: { in: billIds } } }),
      this.db.pubinfoBillVersion.findMany({
        where: { billId: { in: billIds } },
        select: {
          externalId: true,
          billId: true,
          versionNum: true,
          subject: true,
        },
      }),
      this.db.pubinfoBillHistory.findMany({
        where: { billId: { in: billIds } },
        select: {
          billId: true,
          actionDate: true,
          action: true,
          actionSequence: true,
        },
      }),
      this.db.pubinfoBillDetailVote.findMany({
        where: { billId: { in: billIds } },
        select: {
          billId: true,
          locationCode: true,
          legislatorName: true,
          voteDateTime: true,
          voteCode: true,
          motionId: true,
        },
      }),
      this.db.bill.findMany({
        where: { externalId: { in: billIds } },
        select: { externalId: true, isDead: true, isActive: true },
      }),
    ]);
    const versionsByBill = groupBy(versions, (v) => v.billId);
    const latestIds = [...versionsByBill.values()]
      .map((vs) => latestVersion(vs)?.externalId)
      .filter((id): id is string => !!id);
    const [xmls, authors, motions] = await Promise.all([
      this.db.pubinfoBillVersion.findMany({
        where: { externalId: { in: latestIds } },
        select: { externalId: true, billXml: true },
      }),
      this.db.pubinfoBillVersionAuthor.findMany({
        where: { billVersionId: { in: latestIds } },
        select: {
          billVersionId: true,
          type: true,
          house: true,
          name: true,
          contribution: true,
        },
      }),
      this.db.pubinfoBillMotion.findMany({
        where: {
          externalId: {
            in: [...new Set(votes.map((v) => String(v.motionId)))],
          },
        },
        select: { externalId: true, motionText: true },
      }),
    ]);
    return {
      bills,
      versionsByBill,
      xmlByVersion: new Map(xmls.map((x) => [x.externalId, x.billXml])),
      authorsByVersion: groupBy(authors, (a) => a.billVersionId),
      historyByBill: groupBy(history, (h) => h.billId),
      votesByBill: groupBy(votes, (v) => v.billId),
      motions: new Map(
        motions.map((m) => [Number(m.externalId), m.motionText]),
      ),
      storedFlags: new Map(
        stored.map((b) => [
          b.externalId,
          { isDead: b.isDead, isActive: b.isActive },
        ]),
      ),
    };
  }
}

interface AuthorRow {
  billVersionId: string;
  type: string;
  house: string | null;
  name: string | null;
  contribution: string | null;
}

interface ChunkData {
  bills: {
    externalId: string;
    sessionYear: string;
    measureType: string;
    measureNum: number;
    currentStatus: string | null;
    pipelineExecutionId: string | null;
  }[];
  versionsByBill: Map<
    string,
    {
      externalId: string;
      billId: string;
      versionNum: number;
      subject: string | null;
    }[]
  >;
  xmlByVersion: Map<string, string | null>;
  authorsByVersion: Map<string, AuthorRow[]>;
  historyByBill: Map<
    string,
    {
      actionDate: Date | null;
      action: string | null;
      actionSequence: number | null;
    }[]
  >;
  votesByBill: Map<
    string,
    {
      locationCode: string;
      legislatorName: string;
      voteDateTime: string;
      voteCode: string | null;
      motionId: number;
    }[]
  >;
  motions: Map<number, string | null>;
  storedFlags: Map<string, { isDead: boolean; isActive: boolean }>;
}

/** A derived bill: its row id, and the pubinfo id and session it came from. */
interface BillRef {
  id: string;
  externalId: string;
  sessionYear: string;
}

function groupByTable(rows: PubinfoRow[]): Map<PubinfoTable, PubinfoRow[]> {
  return groupBy(rows, (r) => r.table);
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function noteTouched(
  touched: Touched,
  table: PubinfoTable,
  written: PubinfoRow[],
): void {
  if (written.length === 0) return;
  if (LOOKUPS.has(table)) {
    touched.everything = true;
    return;
  }
  if (table === 'BILL_VERSION_AUTHORS_TBL') {
    for (const row of written) {
      touched.versionIds.add((row as { billVersionId: string }).billVersionId);
    }
    return;
  }
  const field = BILL_KEYED[table];
  if (!field) return;
  for (const row of written) {
    touched.billIds.add((row as unknown as Record<string, string>)[field]);
  }
}

/**
 * The bill's public page on leginfo, for readers: the pages a person opens in
 * a browser, which robots.txt does not govern. Nothing here fetches them.
 */
function leginfoUrl(page: string, billId: string): string {
  return `https://leginfo.legislature.ca.gov/faces/${page}.xhtml?bill_id=${billId}`;
}
