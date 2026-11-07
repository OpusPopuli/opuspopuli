import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  batchTransaction,
  type BulkBatchContext,
  type PubinfoRow,
  type PubinfoTable,
} from '@opuspopuli/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { OfficialLifecycle } from './bill-lifecycle';
import { upsertOfficialBill } from './bill-lifecycle-writer';
import {
  authorHouse,
  billNumber,
  camlTitle,
  isSeatHolder,
  lastAction,
  latestVersion,
  legislatorKey,
  rollCallKey,
  seatKey,
  sessionLabel,
  voteChamber,
  voteHouse,
  votePosition,
  type HistoryAction,
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

/** Long enough for a bill with a thousand votes; Prisma's default is 5 s. */
const DERIVE_TX_TIMEOUT_MS = 30_000;

/** Lookups loaded once per derive. */
interface DeriveIndex {
  /** legislatorKey → representative id, through the legislator's seat (D15). */
  repByLegislator: Map<string, string>;
  /**
   * Fingerprint of `repByLegislator`. Representatives are keyed by seat and
   * renamed in place when it changes hands, which no timestamp shows, so a
   * bill derived under other links is derived again.
   */
  linksHash: string;
  /** `session|code` → location description. */
  locations: Map<string, string>;
}

/**
 * Bills from a legislature's published database export (`bills-phase-b.md`,
 * D9/D10). Each export table is mirrored row for row, skipping lines that
 * are unchanged since the last completed import (K4); then every bill whose
 * mirror rows changed since it was last derived is derived from the mirrors:
 * its status and lifecycle (D11), last action, title, author, co-authors and
 * votes (D15–D17). No fetch beyond the one download, and no LLM.
 *
 * What to derive is read from the database, not carried from the import: the
 * ledger records an import complete before the derive runs, so a derive that
 * died would otherwise leave its bills stale until a line changed again.
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
      }
    }, opts.pipelineJobId);

    const index = await this.deriveIndex();
    const billIds = await this.billsToDerive(index.linksHash);
    result.derived = await this.derive(billIds, index, {
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

  /**
   * Bills to derive: never derived, derived under other legislator links, or
   * with a mirror row written since. A changed location code can change any
   * bill; a changed motion only the bills whose votes use it. Each mirror is
   * read once, for rows written since the oldest derive, rather than probed
   * per bill.
   */
  private async billsToDerive(linksHash: string): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ external_id: string }[]>`
      WITH since AS (SELECT min(derived_at) AS at FROM pubinfo_bills),
      lookups AS (
        SELECT max(updated_at) AS changed_at FROM pubinfo_location_codes
      ),
      changed AS (
        SELECT bill_id, max(updated_at) AS at FROM (
          SELECT v.bill_id, v.updated_at FROM pubinfo_bill_versions v, since
            WHERE v.updated_at > since.at
          UNION ALL
          SELECT v.bill_id, a.updated_at FROM pubinfo_bill_version_authors a
            JOIN pubinfo_bill_versions v ON v.external_id = a.bill_version_id,
            since WHERE a.updated_at > since.at
          UNION ALL
          SELECT h.bill_id, h.updated_at FROM pubinfo_bill_history h, since
            WHERE h.updated_at > since.at
          UNION ALL
          SELECT s.bill_id, s.updated_at FROM pubinfo_bill_summary_votes s,
            since WHERE s.updated_at > since.at
          UNION ALL
          SELECT d.bill_id, d.updated_at FROM pubinfo_bill_detail_votes d,
            since WHERE d.updated_at > since.at
          UNION ALL
          SELECT d.bill_id, m.updated_at FROM pubinfo_bill_motions m
            JOIN pubinfo_bill_detail_votes d ON d.motion_id = CASE
              WHEN m.external_id ~ '^[0-9]+$' THEN m.external_id::int END,
            since WHERE m.updated_at > since.at
        ) written GROUP BY bill_id
      )
      SELECT b.external_id FROM pubinfo_bills b
        CROSS JOIN lookups l
        LEFT JOIN changed c ON c.bill_id = b.external_id
      WHERE b.derived_at IS NULL
        OR b.derived_links_hash IS DISTINCT FROM ${linksHash}
        OR b.updated_at > b.derived_at
        OR l.changed_at > b.derived_at
        OR c.at > b.derived_at
      ORDER BY b.external_id`;
    return rows.map((r) => r.external_id);
  }

  private async derive(
    billIds: string[],
    index: DeriveIndex,
    opts: {
      regionId: string;
      statusLifecycle: Readonly<Record<string, OfficialLifecycle>>;
      today: Date;
    },
  ): Promise<number> {
    if (billIds.length === 0) return 0;
    // Stamped on each bill derived: a mirror row written after this moment
    // is newer than what the bill was derived from.
    const run = { ...opts, derivedAt: new Date(), linksHash: index.linksHash };
    const tally = { derived: 0, failed: 0 };
    for (let i = 0; i < billIds.length; i += DERIVE_CHUNK) {
      await this.deriveChunk(
        billIds.slice(i, i + DERIVE_CHUNK),
        index,
        run,
        tally,
      );
    }
    if (tally.failed > 0) {
      // The failed bills keep their old `derived_at`, so the next sync
      // derives them again; the job is recorded failed meanwhile (B7).
      throw new Error(
        `pubinfo: ${tally.failed} of ${billIds.length} bills failed to derive (${tally.derived} derived); they are retried next sync`,
      );
    }
    return tally.derived;
  }

  private async deriveIndex(): Promise<DeriveIndex> {
    const [legislators, reps, locations] = await Promise.all([
      this.db.pubinfoLegislator.findMany({
        select: {
          sessionYear: true,
          houseType: true,
          authorName: true,
          lastName: true,
          district: true,
        },
      }),
      this.db.representative.findMany({
        where: { deletedAt: null, chamber: { in: ['Assembly', 'Senate'] } },
        select: { id: true, chamber: true, district: true, name: true },
      }),
      this.db.pubinfoLocationCode.findMany({
        select: { sessionYear: true, locationCode: true, description: true },
      }),
    ]);
    const repBySeat = new Map(
      reps.map((r) => [`${r.chamber}|${r.district}`, r]),
    );
    const repByLegislator = new Map<string, string>();
    for (const l of legislators) {
      const seat = seatKey(l.district);
      const rep = seat ? repBySeat.get(seat) : undefined;
      if (rep && l.authorName && isSeatHolder(rep.name, l.lastName)) {
        repByLegislator.set(
          legislatorKey(l.sessionYear, l.houseType, l.authorName),
          rep.id,
        );
      }
    }
    return {
      repByLegislator,
      linksHash: createHash('sha256')
        .update(JSON.stringify([...repByLegislator].sort()))
        .digest('hex'),
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
    run: DeriveRun,
    tally: { derived: number; failed: number },
  ): Promise<void> {
    const data = await this.loadChunk(billIds);
    for (const pb of data.bills) {
      try {
        await this.db.$transaction(
          (tx) => this.deriveBill(tx, pb, data, index, run),
          { timeout: DERIVE_TX_TIMEOUT_MS },
        );
        tally.derived++;
      } catch (e) {
        // One bad bill must not stop the rest; it stays underived.
        tally.failed++;
        this.logger.warn(
          `pubinfo: deriving ${pb.externalId} failed: ${shortError(e)}`,
        );
      }
    }
  }

  /**
   * One bill, its co-authors, its votes and its `derived_at`, in one
   * transaction: a crash leaves either all of it or none, never new status
   * beside old votes.
   */
  private async deriveBill(
    tx: Prisma.TransactionClient,
    pb: ChunkData['bills'][number],
    data: ChunkData,
    index: DeriveIndex,
    run: DeriveRun,
  ): Promise<void> {
    const versions = data.versionsByBill.get(pb.externalId) ?? [];
    const latest = latestVersion(versions);
    const authors = latest
      ? (data.authorsByVersion.get(latest.externalId) ?? [])
      : [];
    const action = lastAction(data.historyByBill.get(pb.externalId) ?? []);
    const lead = authors.find((a) => a.contribution === 'LEAD_AUTHOR');
    const number = billNumber(pb.measureType, pb.measureNum);
    const { id } = await upsertOfficialBill(
      tx,
      pb.externalId,
      {
        regionId: run.regionId,
        billNumber: number,
        sessionYear: sessionLabel(pb.sessionYear),
        measureTypeCode: pb.measureType,
        title:
          camlTitle(latest ? data.xmlByVersion.get(latest.externalId) : null) ??
          latest?.subject ??
          number,
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
        extractedAt: run.today,
      },
      {
        statusLifecycle: run.statusLifecycle,
        today: run.today,
        stored: data.storedFlags.get(pb.externalId),
      },
    );
    await this.replaceLinks(
      tx,
      { id, externalId: pb.externalId, sessionYear: pb.sessionYear },
      authors,
      data,
      index,
    );
    // Raw, so Prisma's @updatedAt does not move past it and mark the bill
    // changed again.
    await tx.$executeRaw`UPDATE pubinfo_bills SET derived_at = ${run.derivedAt}, derived_links_hash = ${run.linksHash} WHERE external_id = ${pb.externalId}`;
  }

  /** Co-authors and votes, replaced inside the bill's transaction. */
  private async replaceLinks(
    tx: Prisma.TransactionClient,
    bill: BillRef,
    authors: AuthorRow[],
    data: ChunkData,
    index: DeriveIndex,
  ): Promise<void> {
    const billId = bill.id;
    await tx.billCoAuthor.deleteMany({ where: { billId } });
    await tx.billCoAuthor.createMany({
      data: this.coAuthorRows(bill, authors, index),
      skipDuplicates: true,
    });
    await tx.billVote.deleteMany({ where: { billId } });
    await tx.billVote.createMany({
      data: this.voteRows(bill, data, index),
      skipDuplicates: true,
    });
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
          rollCall: rollCallKey(v.locationCode, v.voteDateTime, v.voteDateSeq),
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
          externalId: true,
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
          voteDateSeq: true,
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
  historyByBill: Map<string, HistoryAction[]>;
  votesByBill: Map<
    string,
    {
      locationCode: string;
      legislatorName: string;
      voteDateTime: string;
      voteDateSeq: number;
      voteCode: string | null;
      motionId: number;
    }[]
  >;
  motions: Map<number, string | null>;
  storedFlags: Map<string, { isDead: boolean; isActive: boolean }>;
}

/** One derive pass: the region's settings and the moment it started. */
interface DeriveRun {
  regionId: string;
  statusLifecycle: Readonly<Record<string, OfficialLifecycle>>;
  today: Date;
  derivedAt: Date;
  linksHash: string;
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

/**
 * A Prisma error's code, or the first line of a message cut short: a Prisma
 * message can quote the whole call, every vote of the bill included.
 */
function shortError(e: unknown): string {
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return String((e as Error).message ?? e)
    .split('\n')[0]
    .slice(0, 200);
}

/**
 * The bill's public page on leginfo, for readers: the pages a person opens in
 * a browser, which robots.txt does not govern. Nothing here fetches them.
 */
function leginfoUrl(page: string, billId: string): string {
  return `https://leginfo.legislature.ca.gov/faces/${page}.xhtml?bill_id=${encodeURIComponent(billId)}`;
}
