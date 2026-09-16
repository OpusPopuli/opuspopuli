import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PropositionsSyncService } from './propositions-sync.service';
import { RegionCacheService } from './region-cache.service';
import { PropositionEmbeddingService } from './proposition-embedding.service';

/**
 * Backfilling summaries from stored digest text (#1261).
 *
 * The sync path only repairs a measure its source still lists. Five Secretary
 * of State measures were dropped from the qualified-ballot-measures page when
 * it rolled to the next election cycle, and after a full local re-sync they
 * were the entire remaining echo tail — 5 of 52 rows, 9.6%. Their `fullText`
 * still holds the Legislative Counsel's Digest, so this repairs them from the
 * database rather than the network.
 */
describe('PropositionsSyncService — digest summary backfill (#1261)', () => {
  /** Shaped like the real ACA 20 row: citation header, then substance. */
  const DIGEST_TEXT =
    "Assembly Constitutional Amendment No. 20 LEGISLATIVE COUNSEL'S DIGEST " +
    "ACA 20, Gabriel. Save for California's Future Act. The California " +
    'Constitution establishes the Budget Stabilization Account and requires ' +
    'the Controller to transfer from the General Fund to the account a sum ' +
    'equal to 1.5% of estimated General Fund revenues for that fiscal year, ' +
    'as specified. This measure would revise that calculation and would ' +
    'require repayment of outstanding budgetary obligations, as specified. ' +
    'Resolved by the Assembly, the Senate concurring';

  async function build(rows: unknown[]) {
    const update = jest.fn().mockResolvedValue({});
    const invalidateCache = jest.fn().mockResolvedValue(undefined);
    const embedMissing = jest.fn().mockResolvedValue({
      scanned: 0,
      embedded: 0,
      unchanged: 0,
      failed: 0,
      duplicateSources: 0,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropositionsSyncService,
        {
          provide: DbService,
          useValue: {
            proposition: {
              findMany: jest.fn().mockResolvedValue(rows),
              // The second pass reads `fullText` only for rows that need it.
              findUnique: jest.fn(({ where }: { where: { id: string } }) =>
                Promise.resolve(
                  (rows as { id: string; fullText?: string }[]).find(
                    (r) => r.id === where.id,
                  ) ?? null,
                ),
              ),
              update,
            },
          },
        },
        { provide: RegionCacheService, useValue: { invalidateCache } },
        { provide: PropositionEmbeddingService, useValue: { embedMissing } },
      ] as never[],
    }).compile();
    return {
      service: moduleRef.get(PropositionsSyncService),
      update,
      invalidateCache,
      embedMissing,
    };
  }

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'row-1',
    externalId: 'ACA 20',
    title: "Save for California's Future Act",
    summary: null,
    fullText: DIGEST_TEXT,
    ...over,
  });

  it('writes a digest over a blank summary', async () => {
    const { service, update } = await build([row()]);

    await expect(service.backfillSummariesFromDigest()).resolves.toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.summary).toContain(
      'Budget Stabilization Account',
    );
  });

  /**
   * The exact shape of the five stuck rows: `summary` is the title repeated.
   */
  it('replaces a title-echo summary', async () => {
    const { service, update } = await build([
      row({ summary: "Save for California's Future Act" }),
    ]);

    await expect(service.backfillSummariesFromDigest()).resolves.toBe(1);
    expect(update.mock.calls[0][0].data.summary).toContain(
      'would revise that calculation',
    );
  });

  /**
   * The Sonoma shape — summary is the title minus its "Measure X:" prefix, so
   * `startsWith` cannot see it. Caught by the containment rule.
   */
  it('replaces a de-prefixed title summary', async () => {
    const { service, update } = await build([
      row({
        title: 'Measure E: Waugh School District Bond',
        summary: 'Waugh School District Bond',
      }),
    ]);

    await expect(service.backfillSummariesFromDigest()).resolves.toBe(1);
    expect(update).toHaveBeenCalled();
  });

  /**
   * The regression that would make this a downgrade rather than a repair. The
   * AG title-and-summary is written for the ballot; the digest is written for
   * legislators. Where both exist the AG text is the better summary.
   */
  it('never overwrites a genuine summary', async () => {
    const { service, update } = await build([
      row({
        summary:
          'Requires the state to deposit a portion of General Fund revenues ' +
          'into a reserve account, limits withdrawals to declared budget ' +
          'emergencies, and requires repayment of designated obligations ' +
          'before other spending increases may take effect, as specified.',
      }),
    ]);

    await expect(service.backfillSummariesFromDigest()).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves a row whose fullText carries no digest', async () => {
    const { service, update } = await build([
      row({
        fullText: 'COUNTY OF SONOMA STATEMENT OF ACCURACY ARGUMENT IN FAVOR',
      }),
    ]);

    await expect(service.backfillSummariesFromDigest()).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * Idempotence is what makes this safe to re-run after a deploy: a repaired
   * row is no longer blank and no longer an echo, so it is not a candidate.
   */
  it('is idempotent — a repaired row is not repaired again', async () => {
    const first = await build([row()]);
    await first.service.backfillSummariesFromDigest();
    const written = first.update.mock.calls[0][0].data.summary as string;

    const second = await build([row({ summary: written })]);
    await expect(second.service.backfillSummariesFromDigest()).resolves.toBe(0);
    expect(second.update).not.toHaveBeenCalled();
  });

  it('invalidates the propositions cache only when it wrote something', async () => {
    const wrote = await build([row()]);
    await wrote.service.backfillSummariesFromDigest();
    expect(wrote.invalidateCache).toHaveBeenCalledWith('propositions:');

    const nothing = await build([row({ fullText: 'no digest here' })]);
    await nothing.service.backfillSummariesFromDigest();
    expect(nothing.invalidateCache).not.toHaveBeenCalled();
  });

  it('passes a positive limit to the query and ignores a non-positive one', async () => {
    const { service } = await build([]);
    const db = (
      service as unknown as { db: { proposition: { findMany: jest.Mock } } }
    ).db;

    await service.backfillSummariesFromDigest(5);
    expect(db.proposition.findMany.mock.calls[0][0].take).toBe(5);

    await service.backfillSummariesFromDigest(0);
    expect(db.proposition.findMany.mock.calls[1][0].take).toBeUndefined();
  });

  /**
   * The defect this caught in review: the backfill rewrote `summary` and left
   * the vector alone, so 22 rows held embeddings for text that was no longer
   * there. A stale vector is worse than a missing one — retrieval still
   * returns a confident score against wording the row does not have (#1074).
   */
  it('re-embeds the rows it rewrote', async () => {
    const { service, embedMissing } = await build([row()]);

    await service.backfillSummariesFromDigest();

    expect(embedMissing).toHaveBeenCalledTimes(1);
  });

  it('does not re-embed when it wrote nothing', async () => {
    const { service, embedMissing } = await build([
      row({ fullText: 'no digest here' }),
    ]);

    await service.backfillSummariesFromDigest();

    expect(embedMissing).not.toHaveBeenCalled();
  });
});
