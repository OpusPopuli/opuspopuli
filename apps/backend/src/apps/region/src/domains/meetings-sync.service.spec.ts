import { Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { QueueService } from '@opuspopuli/queue-provider';
import type { Meeting, MinutesWithActions } from '@opuspopuli/common';
import {
  MeetingsSyncService,
  meetingAttribution,
} from './meetings-sync.service';
import type { MinutesSummaryService } from './minutes-summary.service';
import type { UpsertByExternalId } from './propositions-sync.service';

interface Built {
  svc: MeetingsSyncService;
  enqueue: jest.Mock;
  findMany: jest.Mock;
}

function build(rows: { id: string }[] = [{ id: 'a' }, { id: 'b' }]): Built {
  const findMany = jest.fn().mockResolvedValue(rows);
  const enqueue = jest.fn().mockResolvedValue('job');
  const db = { minutes: { findMany } } as unknown as DbService;
  const queue = { enqueue } as unknown as QueueService;
  const svc = new MeetingsSyncService(db, undefined, queue);
  return { svc, enqueue, findMany };
}

describe('MeetingsSyncService.regenerateSummaries (#813)', () => {
  it('enqueues a force job per matching minutes row (no deduped id, no colon)', async () => {
    const { svc, enqueue } = build();
    const n = await svc.regenerateSummaries();
    expect(n).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    // (queueName, data, opts)
    expect(enqueue.mock.calls[0][1]).toEqual({ minutesId: 'a', force: true });
    // force gets a one-off id so a re-run isn't deduped against a retained job.
    const ids = enqueue.mock.calls.map((c) => c[2].jobId as string);
    expect(ids[0]).toMatch(/^minutes-summary-/);
    expect(new Set(ids).size).toBe(2);
    expect(enqueue.mock.calls.every((c) => c[2].removeOnFinish)).toBe(true);
    // Any custom job id must never contain ':' (BullMQ rejects it).
    for (const call of enqueue.mock.calls) {
      const jobId = call[2]?.jobId as string | undefined;
      if (jobId) expect(jobId).not.toContain(':');
    }
  });

  it('applies the body + limit filters to the query', async () => {
    const { svc, findMany } = build([{ id: 'a' }]);
    await svc.regenerateSummaries('Assembly', 5);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.body).toBe('Assembly');
    expect(arg.where.isActive).toBe(true);
    expect(arg.take).toBe(5);
  });

  it('is a no-op returning 0 when no QueueService is wired', async () => {
    const db = {
      minutes: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }]) },
    } as unknown as DbService;
    const svc = new MeetingsSyncService(db);
    await expect(svc.regenerateSummaries()).resolves.toBe(0);
  });
});

const MEETING: Meeting = {
  externalId: 'ca-assembly-budget-2026-11-04',
  title: 'Budget',
  body: 'Assembly',
  scheduledAt: new Date('2026-11-04T17:00:00Z'),
  sourceUrl: 'https://example.test/hearings',
  pipelineExecutionId: 'exec-1',
  manifestId: 'manifest-1',
  manifestVersion: 3,
};

describe('meetingAttribution (meetings-phase-b.md §3)', () => {
  it('maps the run, the manifest and the page onto the columns', () => {
    expect(meetingAttribution(MEETING)).toEqual({
      pipelineExecutionId: 'exec-1',
      manifestId: 'manifest-1',
      manifestVersion: 3,
      sourceUrl: 'https://example.test/hearings',
    });
  });

  it('writes explicit nulls for an untracked run, never omits a column', () => {
    // An omitted field leaves the last tracked run's pointer in place.
    expect(
      meetingAttribution({
        externalId: 'x',
        title: 't',
        body: 'b',
        scheduledAt: new Date(),
      }),
    ).toEqual({
      pipelineExecutionId: null,
      manifestId: null,
      manifestVersion: null,
      sourceUrl: null,
    });
  });
});

describe('MeetingsSyncService.sync — attribution and summary jobs', () => {
  const upsertByExternalId: UpsertByExternalId = async (
    items,
    _find,
    upsert,
  ) => {
    await Promise.all(upsert(items));
    return { processed: items.length, created: items.length, updated: 0 };
  };

  function bundle(id: string): MinutesWithActions {
    return {
      minutes: {
        externalId: id,
        body: 'Assembly',
        date: new Date('2026-10-30'),
        revisionSeq: 0,
        sourceUrl: `https://example.test/${id}.pdf`,
        rawText: 'journal text',
      },
      actions: [],
    } as unknown as MinutesWithActions;
  }

  function buildSync(selectStale?: jest.Mock, bundles = ['m-a', 'm-b']) {
    const meetingUpsert = jest.fn().mockResolvedValue({});
    const enqueue = jest.fn().mockResolvedValue('job');
    const db = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: meetingUpsert,
      },
      minutes: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ where }) => ({
          id: `row-${where.externalId}`,
        })),
        updateMany: jest.fn(),
      },
    } as unknown as DbService;
    const summary = selectStale
      ? ({
          selectStale,
          configHash: () => 'sel-config',
        } as unknown as MinutesSummaryService)
      : undefined;
    const svc = new MeetingsSyncService(
      db,
      undefined,
      { enqueue } as unknown as QueueService,
      undefined,
      undefined,
      summary,
    );
    const provider = {
      getName: () => 'california',
      fetchMeetings: jest.fn().mockResolvedValue([MEETING]),
      fetchMeetingMinutes: jest.fn().mockResolvedValue(bundles.map(bundle)),
    };
    return { svc, provider, meetingUpsert, enqueue };
  }

  it('writes the attribution on both halves of the meeting upsert', async () => {
    const { svc, provider, meetingUpsert } = buildSync();

    await svc.sync(provider, undefined, upsertByExternalId);

    const { create, update } = meetingUpsert.mock.calls[0][0];
    for (const data of [create, update]) {
      expect(data).toMatchObject({
        sourceUrl: 'https://example.test/hearings',
        pipelineExecutionId: 'exec-1',
        manifestId: 'manifest-1',
        manifestVersion: 3,
      });
      // The table has no such column; Prisma would reject the write.
      expect(data).not.toHaveProperty('sourceVersionId');
    }
  });

  it('queues only the stale summaries, under their skip-key job ids', async () => {
    const selectStale = jest.fn().mockResolvedValue({
      pending: [{ id: 'row-m-b', key: 'k1', externalId: 'ext-m-b' }],
      current: 1,
    });
    const { svc, provider, enqueue } = buildSync(selectStale);

    await svc.sync(provider, undefined, upsertByExternalId);

    expect(selectStale).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toEqual({
      minutesId: 'row-m-b',
      // Carried so the worker's outcome line names the document (§4).
      externalId: 'ext-m-b',
      force: false,
      // The worker checks its own config against this (§4d).
      selectedUnderConfigHash: 'sel-config',
    });
    // Not the bare row id, which collided with the completed job BullMQ keeps
    // for a week: a new key is a new job.
    const jobId = enqueue.mock.calls[0][2].jobId as string;
    expect(jobId).not.toBe('row-m-b');
    expect(jobId).toContain('k1');
    // Not retained: a failed job's id must not block the next sync's retry.
    expect(enqueue.mock.calls[0][2].removeOnFinish).toBe(true);
  });

  it('books selection skips to the phase totals', async () => {
    const selectStale = jest.fn().mockResolvedValue({
      pending: [],
      current: 2,
      failedBefore: 1,
    });
    const { svc, provider } = buildSync(selectStale);
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await svc.sync(provider, undefined, upsertByExternalId);

    const lines = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('2 skipped (summary_current)');
    expect(lines).toContain('1 skipped (summary_failed_same_key)');
    log.mockRestore();
  });

  it('still queues stale summaries when no new minutes were found', async () => {
    // The usual sync. A prompt or model change stales a summary without any
    // new PDF, and the early return used to skip the phase entirely.
    const selectStale = jest.fn().mockResolvedValue({
      pending: [{ id: 'row-old', key: 'k2' }],
      current: 0,
    });
    const { svc, provider, enqueue } = buildSync(selectStale, []);

    await svc.sync(provider, undefined, upsertByExternalId);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toEqual({
      minutesId: 'row-old',
      force: false,
      selectedUnderConfigHash: 'sel-config',
    });
  });

  it('keeps the sync, and queues its own rows, when selection fails', async () => {
    // Meetings and minutes are already written by then; a failed currency
    // read must not fail the sync, and this sync's rows still get a job (each
    // re-checks currency).
    const selectStale = jest
      .fn()
      .mockRejectedValue(new Error('db timeout: the selected text'));
    const { svc, provider, enqueue } = buildSync(selectStale);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      svc.sync(provider, undefined, upsertByExternalId),
    ).resolves.toMatchObject({ processed: 3 });
    expect(enqueue.mock.calls.map((c) => c[1].minutesId)).toEqual([
      'row-m-a',
      'row-m-b',
    ]);
    // The error's kind, never its message: a Prisma validation error prints
    // the call's arguments, and those can carry minutes text.
    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('selection failed');
    expect(lines).not.toContain('the selected text');
    warn.mockRestore();
  });

  it('falls back to the upserted rows when the summarizer is unconfigured', async () => {
    // Bound, but missing its LLM or prompt client: "nothing stale" would
    // queue nothing, silently. The job decides instead, as unbound.
    const selectStale = jest.fn().mockResolvedValue(undefined);
    const { svc, provider, enqueue } = buildSync(selectStale);

    await svc.sync(provider, undefined, upsertByExternalId);

    expect(enqueue.mock.calls.map((c) => c[1].minutesId)).toEqual([
      'row-m-a',
      'row-m-b',
    ]);
  });

  it('queues every row under a one-off id when no summarizer is bound', async () => {
    const { svc, provider, enqueue } = buildSync();

    await svc.sync(provider, undefined, upsertByExternalId);

    const ids = enqueue.mock.calls.map((c) => c[2].jobId as string);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith('minutes-summary-'))).toBe(true);
  });
});
