/**
 * Propositions S4 against real Redis, BullMQ and Postgres
 * (`docs/plans/propositions-phase-b.md` §3): the sync's analysis phase queues
 * one `proposition-analysis` job per stale measure and waits for them.
 *
 * What only the real stack can show: the retry split — a transport failure
 * thrown by the worker is retried by the queue within the run, a parse
 * failure is returned and is not — and that an unchanged corpus queues
 * nothing at all.
 */
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import {
  PROPOSITION_ANALYSIS_QUEUE,
  QueueService,
  type PropositionAnalysisJobData,
} from '@opuspopuli/queue-provider';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { PropositionAnalysisService } from '../../../src/apps/region/src/domains/proposition-analysis.service';
import { PropositionsSyncService } from '../../../src/apps/region/src/domains/propositions-sync.service';
import { ChildJobQueues } from '../../../src/common/child-jobs/child-job-queues';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PROMPT_HASH = 'p'.repeat(64);
const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

const VALID_ANALYSIS = JSON.stringify({
  analysisSummary: 'Raises the transfer tax.',
  keyProvisions: ['Raises the tax'],
  fiscalImpact: 'Increases revenue.',
  yesOutcome: 'A yes vote raises the tax.',
  noOutcome: 'A no vote keeps the current rate.',
  existingVsProposed: { current: 'Current rate', proposed: 'Higher rate' },
  analysisSections: [],
  analysisClaims: [],
});

describe('propositions S4: analysis on its own queue (real Redis + DB)', () => {
  let db: DbService;
  let generate: jest.Mock;
  let analysis: PropositionAnalysisService;
  let stop: () => Promise<void>;
  let queues: ChildJobQueues;

  beforeAll(async () => {
    db = await getDbService();
    process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_ATTEMPTS = '2';
    process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_BACKOFF_MS = '10';
    analysis = new PropositionAnalysisService(
      { get: () => undefined } as unknown as ConfigService,
      {
        getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
          promptText: 'rendered prompt',
          promptHash: PROMPT_HASH,
          promptVersion: 'v4',
        }),
        getPromptHash: jest.fn().mockResolvedValue(PROMPT_HASH),
      } as unknown as PromptClientService,
      {
        getModelName: () => 'nemotron-it',
        getModelDigest: async () => 'weights-a',
        generate: (...args: unknown[]) => generate(...args),
      } as unknown as ILLMProvider,
      db,
    );

    const prefix = `prop-s4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    const workerConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    const queueService = new QueueService(connection, { prefix } as never);
    const worker = new Worker<PropositionAnalysisJobData>(
      PROPOSITION_ANALYSIS_QUEUE,
      (job) => analysis.analyseOne(job.data.propositionId),
      { connection: workerConnection, prefix },
    );
    queues = new ChildJobQueues(queueService, connection, {
      get: () => prefix,
    } as never);
    stop = async () => {
      await worker.close();
      await workerConnection.quit();
      await queueService.close();
    };
  });

  beforeEach(async () => {
    await cleanDatabase();
    generate = jest.fn(async () => ({ text: VALID_ANALYSIS }));
  });

  afterAll(async () => {
    await stop();
    delete process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_ATTEMPTS;
    delete process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_BACKOFF_MS;
    await disconnectDatabase();
  });

  const FULL_TEXT = 'SECTION 1. The documentary transfer tax is raised.';
  const seed = (externalId: string, analysed = false) =>
    db.proposition.create({
      data: {
        externalId,
        title: `Measure ${externalId}`,
        summary: 'A measure.',
        status: 'qualified',
        fullText: FULL_TEXT,
        ...(analysed && {
          analysisSummary: 'existing analysis',
          analysisGeneratedAt: new Date('2026-10-20T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          analysisLlmDigest: 'weights-a',
          analysisSourceTextHash: sha256(FULL_TEXT),
        }),
      },
    });

  /** The sync's analysis phase, on the real queue. */
  const analysePhase = () =>
    (
      new PropositionsSyncService(
        db,
        analysis,
        undefined,
        undefined,
        undefined,
        undefined,
        queues,
      ) as unknown as { analyseStale: (r: string) => Promise<void> }
    ).analyseStale('california');

  const analysedSummary = async (externalId: string) =>
    (await db.proposition.findFirstOrThrow({ where: { externalId } }))
      .analysisSummary;

  it('analyses each stale measure through the queue, and queues nothing for a current one', async () => {
    await seed('stale');
    await seed('current', true);

    await analysePhase();

    expect(await analysedSummary('stale')).toBe('Raises the transfer tax.');
    expect(await analysedSummary('current')).toBe('existing analysis');
    // The current one was stamped (legacy config hash), not analysed.
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries a transport failure within the run', async () => {
    // A runner killed under memory pressure: thrown, so the queue retries.
    generate.mockImplementationOnce(async () => {
      throw new Error('unexpected EOF');
    });
    await seed('flaky');

    await analysePhase();

    expect(generate).toHaveBeenCalledTimes(2);
    const row = await db.proposition.findFirstOrThrow({
      where: { externalId: 'flaky' },
    });
    expect(row.analysisSummary).toBe('Raises the transfer tax.');
    // The success cleared the failure the first attempt recorded.
    expect(row.analysisFailureReason).toBeNull();
  });

  it('does not retry a parse failure — it records it and moves on', async () => {
    generate.mockImplementation(async () => ({ text: 'no JSON here' }));
    await seed('unparseable');

    await analysePhase();

    expect(generate).toHaveBeenCalledTimes(1);
    const row = await db.proposition.findFirstOrThrow({
      where: { externalId: 'unparseable' },
    });
    expect(row.analysisFailureReason).toBe('no_json');
  });

  it('queues nothing on a second run over an unchanged corpus', async () => {
    await seed('stale');
    await analysePhase();
    generate.mockClear();

    await analysePhase();

    expect(generate).not.toHaveBeenCalled();
  });
});
