/**
 * Integration test for row → producing-run linkage (#1280).
 *
 * The acceptance criterion is a query: "given a `PipelineExecution`, the rows
 * it produced can be listed." That is a claim about the database — the
 * columns exist, the migration applied, the foreign keys point where they
 * should, and deleting a run does not take the civic rows with it. A mocked
 * DbService would agree with any of those whether or not they were true.
 *
 * Covers all four row families named in the issue, because each is written by
 * a different path: propositions and minutes through html_scrape/pdf_archive,
 * bills through their own sync, contributions through the streamed batch
 * callback that never appears in a returned result.
 */

import type { DbService } from '@opuspopuli/relationaldb-provider';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('row → producing run (#1280)', () => {
  let db: DbService;
  let executionId: string;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const execution = await db.pipelineExecution.create({
      data: {
        regionId: 'us-ca',
        sourceUrl: 'https://oag.ca.gov/initiatives',
        dataType: 'propositions',
      },
    });
    executionId = execution.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('lists the propositions a run produced', async () => {
    await db.proposition.create({
      data: {
        externalId: 'prop-a',
        title: 'Measure A',
        summary: 'A summary',
        status: 'QUALIFIED',
        pipelineExecutionId: executionId,
        manifestVersion: 11,
      },
    });
    await db.proposition.create({
      data: {
        externalId: 'prop-untracked',
        title: 'Measure B',
        summary: 'Another',
        status: 'QUALIFIED',
      },
    });

    const produced = await db.proposition.findMany({
      where: { pipelineExecutionId: executionId },
      select: { externalId: true, manifestVersion: true },
    });

    expect(produced).toHaveLength(1);
    expect(produced[0].externalId).toBe('prop-a');
    expect(produced[0].manifestVersion).toBe(11);
  });

  it('lists minutes, bills and contributions a run produced', async () => {
    await db.minutes.create({
      data: {
        externalId: 'minutes-a',
        body: 'Board of Supervisors',
        date: new Date('2026-09-01'),
        sourceUrl: 'https://example.gov/minutes/a.pdf',
        pipelineExecutionId: executionId,
      },
    });
    await db.bill.create({
      data: {
        regionId: 'us-ca',
        externalId: 'bill-a',
        billNumber: 'AB 1',
        title: 'An Act',
        sessionYear: '2025-2026',
        measureTypeCode: 'AB',
        sourceUrl: 'https://leginfo.ca.gov/ab1',
        pipelineExecutionId: executionId,
      },
    });
    await db.contribution.create({
      data: {
        externalId: 'contrib-a',
        amount: 100,
        donorName: 'A Donor',
        donorType: 'IND',
        date: new Date('2026-09-01'),
        sourceSystem: 'netfile',
        pipelineExecutionId: executionId,
      },
    });

    // Each family is written by a different path, so each is asserted rather
    // than inferred from propositions working.
    expect(
      await db.minutes.count({ where: { pipelineExecutionId: executionId } }),
    ).toBe(1);
    expect(
      await db.bill.count({ where: { pipelineExecutionId: executionId } }),
    ).toBe(1);
    expect(
      await db.contribution.count({
        where: { pipelineExecutionId: executionId },
      }),
    ).toBe(1);
  });

  it('keeps civic rows when the run that produced them is deleted', async () => {
    await db.proposition.create({
      data: {
        externalId: 'prop-a',
        title: 'Measure A',
        summary: 'A summary',
        status: 'QUALIFIED',
        pipelineExecutionId: executionId,
      },
    });

    await db.pipelineExecution.delete({ where: { id: executionId } });

    // ON DELETE SET NULL, never CASCADE. Losing the pointer is recoverable;
    // losing the civic row to a bookkeeping cleanup is not.
    const survived = await db.proposition.findFirst({
      where: { externalId: 'prop-a' },
      select: { pipelineExecutionId: true },
    });
    expect(survived).not.toBeNull();
    expect(survived!.pipelineExecutionId).toBeNull();
  });

  it('rejects a reference to a run that does not exist', async () => {
    // The FK is what makes the reference trustworthy — without it a typo or a
    // stale id would be indistinguishable from a real link.
    await expect(
      db.proposition.create({
        data: {
          externalId: 'prop-bad',
          title: 'Measure A',
          summary: 'A summary',
          status: 'QUALIFIED',
          pipelineExecutionId: 'no-such-execution',
        },
      }),
    ).rejects.toThrow();
  });

  it('leaves rows from untracked runs null rather than guessing', async () => {
    await db.proposition.create({
      data: {
        externalId: 'prop-legacy',
        title: 'Measure A',
        summary: 'A summary',
        status: 'QUALIFIED',
      },
    });

    const legacy = await db.proposition.findFirst({
      where: { externalId: 'prop-legacy' },
      select: { pipelineExecutionId: true, manifestId: true },
    });

    // No backfill, deliberately: a null says "we do not know", while a
    // back-dated guess would be indistinguishable from a real link.
    expect(legacy!.pipelineExecutionId).toBeNull();
    expect(legacy!.manifestId).toBeNull();
  });
});
