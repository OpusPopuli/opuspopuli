/**
 * Civics K1 — skip a page whose extraction inputs are unchanged, against a
 * real database (`docs/plans/civics-phase-b.md`).
 *
 * The claim spans runs, so it is a database claim: what one sync records is
 * what the next one compares against. A run of the real `CivicsSyncService`
 * with a fake LLM and prompt client, twice, is the test — the second must
 * make no LLM call for an unchanged page, and any change to the text, the
 * prompt, the model or the source's config must bring the call back.
 *
 * Empty pages are the half that matters most: a page with no civic content
 * writes no block (#874), so a key kept only on the block would never skip
 * them — 13 of 24 pages in the 2026-10-23 baseline.
 *
 * Civics S3 runs every test twice: extraction inline, and through a real
 * `civics-extract` queue with a consumer (real Redis, real BullMQ). S3 moves
 * where the work runs, never what it produces, so both must pass the same
 * assertions.
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { htmlToReadableText } from '@opuspopuli/common';
import {
  CIVICS_EXTRACT_QUEUE,
  QueueService,
  type CivicsExtractJobData,
} from '@opuspopuli/queue-provider';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { createHash } from 'node:crypto';
import {
  CivicsSyncService,
  civicsConfigHash,
  civicsSourceFields,
} from '../../../src/apps/region/src/domains/civics-sync.service';
import { ChildJobQueues } from '../../../src/common/child-jobs/child-job-queues';
import { SourceVersionService } from '../../../src/apps/region/src/domains/source-version.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const REGION = 'california';
const CONTENT_PAGE =
  'https://www.senate.ca.gov/citizens-guide/legislative-process';
const EMPTY_PAGE = 'https://www.senate.ca.gov/dining-services';

const BLOCK = JSON.stringify({
  chambers: [{ name: 'Senate' }],
  measureTypes: [],
  lifecycleStages: [],
  sessionScheme: null,
  glossary: [
    {
      term: 'Daily File',
      slug: 'daily-file',
      definition: { verbatim: 'The agenda.', plainLanguage: 'The agenda.' },
    },
  ],
});
const EMPTY = JSON.stringify({
  chambers: [],
  measureTypes: [],
  lifecycleStages: [],
  glossary: [],
  sessionScheme: null,
});

/**
 * A `civics-extract` queue and its consumer, on a prefix of their own.
 * The consumer calls `extract` — the service under test's `extractPage`.
 */
async function startQueue(
  extract: (job: CivicsExtractJobData) => Promise<string>,
): Promise<{ queue: ChildJobQueues; stop: () => Promise<void> }> {
  const prefix = `civics-s3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const workerConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  const queueService = new QueueService(connection, { prefix } as never);
  const worker = new Worker<CivicsExtractJobData>(
    CIVICS_EXTRACT_QUEUE,
    (job) => extract(job.data),
    { connection: workerConnection, prefix },
  );
  const queue = new ChildJobQueues(queueService, connection, {
    get: () => prefix,
  } as never);
  return {
    queue,
    stop: async () => {
      await worker.close();
      await workerConnection.quit();
      await queueService.close();
    },
  };
}

describe.each(['inline', 'queued'] as const)(
  'civics: skip unchanged pages (K1) — %s',
  (mode) => {
    let db: DbService;
    let queued: Awaited<ReturnType<typeof startQueue>> | undefined;
    let generate: jest.Mock;
    let digest: string | undefined;
    let promptHash: string;
    let texts: Record<string, string>;
    let hints: string[];
    let truncated: boolean;
    let observer: { observe: jest.Mock; increment: jest.Mock };

    const service = (): CivicsSyncService =>
      new CivicsSyncService(
        db,
        {
          getCivicsExtractionPrompt: async ({
            sourceUrl,
          }: {
            sourceUrl: string;
          }) => ({
            promptText: `extract ${sourceUrl}`,
            promptHash,
            promptVersion: 'v6',
          }),
        } as never,
        {
          generate,
          getModelName: () => 'nemotron-test',
          getModelDigest: async () => digest,
        } as never,
        observer as never,
        new SourceVersionService(db),
        queued?.queue,
      );
    const source = () => ({
      url: 'https://www.senate.ca.gov/citizens-guide',
      dataType: 'civics',
      contentGoal: 'how a bill becomes law',
      category: 'Senate',
      hints,
    });
    /** The pages the last sync sent to the model. */
    const sentPages = () =>
      generate.mock.calls
        .map(([prompt]) => (prompt as string).replace('extract ', ''))
        .sort();

    const sync = (options: { reextract?: boolean } = {}) =>
      service().sync(
        {
          getName: () => REGION,
          getDataSources: () => [source()],
        } as never,
        {
          crawlCivicsUrls: async () => [CONTENT_PAGE, EMPTY_PAGE],
          fetchUrlBytes: async (url: string) => ({
            body: Buffer.from(texts[url], 'utf8'),
            contentType: 'text/html',
            fetchedAt: new Date().toISOString(),
          }),
        },
        options,
      );

    beforeAll(async () => {
      db = await getDbService();
      // One attempt, as inline: a retried failure would succeed within the
      // run and make the two modes disagree. Retry has its own test below.
      process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_ATTEMPTS = '1';
      if (mode === 'queued') {
        queued = await startQueue((job) => service().extractPage(job));
      }
    });

    beforeEach(async () => {
      await cleanDatabase();
      truncated = false;
      observer = { observe: jest.fn(), increment: jest.fn() };
      generate = jest.fn(async (prompt: string) => ({
        text: prompt.includes(EMPTY_PAGE) ? EMPTY : BLOCK,
        promptTruncated: truncated,
      }));
      digest = 'sha256:weights-a';
      promptHash = 'template-v6';
      texts = {
        [CONTENT_PAGE]: 'A bill is introduced, read three times…',
        [EMPTY_PAGE]: 'Lunch is served from noon.',
      };
      hints = ['Senate rules'];
    });

    afterAll(async () => {
      await queued?.stop();
      delete process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_ATTEMPTS;
      await disconnectDatabase();
    });

    it('makes no LLM call for unchanged pages — content and empty alike', async () => {
      await sync();
      expect(generate).toHaveBeenCalledTimes(2);

      generate.mockClear();
      const second = await sync();

      expect(generate).not.toHaveBeenCalled();
      // Reported, so a run that skipped everything does not read as one that
      // did nothing.
      expect(second.skipped).toBe(2);
      const recorded = await db.civicsPageExtraction.findMany({
        orderBy: { sourceUrl: 'asc' },
      });
      expect(recorded.map((r) => [r.sourceUrl, r.outcome])).toEqual([
        [CONTENT_PAGE, 'block'],
        [EMPTY_PAGE, 'empty'],
      ]);
    });

    it.each([
      // A text change re-extracts only that page; the rest touch every page.
      [
        'the page text',
        () => (texts[CONTENT_PAGE] += ' Amended.'),
        [CONTENT_PAGE],
      ],
      [
        'the prompt template',
        () => (promptHash = 'template-v7'),
        [CONTENT_PAGE, EMPTY_PAGE],
      ],
      [
        'the model weights',
        () => (digest = 'sha256:weights-b'),
        [CONTENT_PAGE, EMPTY_PAGE],
      ],
      [
        'the source config (a hint)',
        () => hints.push('Assembly rules'),
        [CONTENT_PAGE, EMPTY_PAGE],
      ],
    ])(
      're-extracts exactly the affected pages after a change to %s',
      async (_what, change, expected) => {
        await sync();
        generate.mockClear();

        change();
        await sync();

        expect(sentPages()).toEqual([...expected].sort());
      },
    );

    it('re-extracts a page whose block was deleted — a skip would leave it gone', async () => {
      // The documented way to force a fresh analysis is a scoped clear; after
      // K1 the clear must not be met by a skip and then a glossary prune.
      await sync();
      await db.civicsBlock.deleteMany({ where: { sourceUrl: CONTENT_PAGE } });
      generate.mockClear();

      await sync();

      expect(sentPages()).toEqual([CONTENT_PAGE]);
      expect(
        await db.civicsBlock.count({ where: { sourceUrl: CONTENT_PAGE } }),
      ).toBe(1);
    });

    it('does not pin an extraction whose prompt was truncated', async () => {
      // Its answer came from part of the page; raising the context window
      // must reach it, and the window is not in the key.
      truncated = true;
      await sync();
      truncated = false;
      generate.mockClear();

      await sync();

      expect(sentPages()).toEqual([CONTENT_PAGE, EMPTY_PAGE].sort());
    });

    it('retries next run a page a FORCED run found empty over its block', async () => {
      // The forced run's old record still matches the key; the stale path
      // clears it, or the next normal run would skip the page.
      await sync();
      generate.mockImplementation(async () => ({ text: EMPTY }));
      await sync({ reextract: true });
      generate.mockImplementation(async (prompt: string) => ({
        text: prompt.includes(EMPTY_PAGE) ? EMPTY : BLOCK,
      }));
      generate.mockClear();

      await sync();

      expect(sentPages()).toEqual([CONTENT_PAGE]);
    });

    it("extracts every page again when asked to (the sync's resetWatermark)", async () => {
      await sync();
      generate.mockClear();

      await sync({ reextract: true });

      expect(sentPages()).toEqual([CONTENT_PAGE, EMPTY_PAGE].sort());
    });

    it('counts a skip as skipped:unchanged and stamps when it was checked', async () => {
      await sync();
      const before = await db.civicsPageExtraction.findFirstOrThrow({
        where: { sourceUrl: CONTENT_PAGE },
      });
      observer.increment.mockClear();

      await sync();

      const items = observer.increment.mock.calls.filter(
        ([, , labels]) => labels?.phase === 'extract_and_upsert',
      );
      expect(items.map(([, , l]) => [l.outcome, l.reason])).toEqual([
        ['skipped', 'unchanged'],
        ['skipped', 'unchanged'],
      ]);
      const after = await db.civicsPageExtraction.findFirstOrThrow({
        where: { sourceUrl: CONTENT_PAGE },
      });
      expect(after.checkedAt.getTime()).toBeGreaterThan(
        before.checkedAt.getTime(),
      );
    });

    it('never skips when the model digest is unknown', async () => {
      // An unresolved digest cannot prove the weights are the same.
      digest = undefined;
      await sync();
      generate.mockClear();

      await sync();

      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('records what produced a block, and which model wrote its glossary', async () => {
      await sync();

      const block = await db.civicsBlock.findUniqueOrThrow({
        where: {
          regionId_sourceUrl: { regionId: REGION, sourceUrl: CONTENT_PAGE },
        },
      });
      expect(block.sourceTextHash).toBe(
        createHash('sha256')
          .update(htmlToReadableText(texts[CONTENT_PAGE]))
          .digest('hex'),
      );
      expect(block.configHash).toBe(
        civicsConfigHash(civicsSourceFields(source() as never)),
      );
      expect(block.llmDigest).toBe('sha256:weights-a');
      const term = await db.glossaryEntry.findFirstOrThrow({
        where: { regionId: REGION, slug: 'daily-file' },
      });
      expect([term.llmModel, term.llmDigest]).toEqual([
        'nemotron-test',
        'sha256:weights-a',
      ]);
    });

    it('retries a page that failed, rather than remembering the failure', async () => {
      generate.mockImplementationOnce(async () => {
        throw new Error('runner died');
      });
      await sync();
      generate.mockClear();

      await sync();

      expect(
        generate.mock.calls.some(([p]) => (p as string).includes(CONTENT_PAGE)),
      ).toBe(true);
    });

    it('retries a page that extracted empty over an existing block (#1335)', async () => {
      await sync();
      // The text changes (so the page runs), and this time the model returns
      // nothing for a page that has a block — kept, marked stale, and NOT
      // recorded, so the next sync tries it again.
      texts[CONTENT_PAGE] += ' Changed.';
      generate.mockImplementation(async () => ({ text: EMPTY }));
      await sync();
      generate.mockClear();

      await sync();

      expect(
        generate.mock.calls.some(([p]) => (p as string).includes(CONTENT_PAGE)),
      ).toBe(true);
    });

    it('links each block to the archived bytes it came from, with their text', async () => {
      await sync();

      const block = await db.civicsBlock.findUniqueOrThrow({
        where: {
          regionId_sourceUrl: { regionId: REGION, sourceUrl: CONTENT_PAGE },
        },
      });
      const version = await db.sourceVersion.findUniqueOrThrow({
        where: { id: block.sourceVersionId! },
      });
      expect(Buffer.from(version.content).toString('utf8')).toBe(
        texts[CONTENT_PAGE],
      );
      expect([version.sourceUrl, version.dataType]).toEqual([
        CONTENT_PAGE,
        'civics',
      ]);
      // What the block's text hash is a hash of, kept beside the bytes.
      expect(version.derivedTextHash).toBe(block.sourceTextHash);
    });

    it('archives an unchanged page once, however many runs fetch it', async () => {
      await sync();
      await sync();

      expect(
        await db.sourceVersion.count({ where: { sourceUrl: CONTENT_PAGE } }),
      ).toBe(1);
    });
  },
);

describe('civics: queued extraction (S3)', () => {
  let db: DbService;
  let queued: Awaited<ReturnType<typeof startQueue>>;
  let generate: jest.Mock;

  const service = (): CivicsSyncService =>
    new CivicsSyncService(
      db,
      {
        getCivicsExtractionPrompt: async ({
          sourceUrl,
        }: {
          sourceUrl: string;
        }) => ({
          promptText: `extract ${sourceUrl}`,
          promptHash: 'template-v6',
          promptVersion: 'v6',
        }),
      } as never,
      {
        generate,
        getModelName: () => 'nemotron-test',
        getModelDigest: async () => 'sha256:weights-a',
      } as never,
      { observe: jest.fn(), increment: jest.fn() } as never,
      new SourceVersionService(db),
      queued.queue,
    );
  const sync = () =>
    service().sync(
      {
        getName: () => REGION,
        getDataSources: () => [
          {
            url: 'https://www.senate.ca.gov/citizens-guide',
            dataType: 'civics',
            contentGoal: 'how a bill becomes law',
          },
        ],
      } as never,
      {
        crawlCivicsUrls: async () => [CONTENT_PAGE],
        fetchUrlBytes: async () => ({
          body: Buffer.from('A bill is introduced.', 'utf8'),
          contentType: 'text/html',
          fetchedAt: new Date().toISOString(),
        }),
      },
    );

  beforeAll(async () => {
    db = await getDbService();
    process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_ATTEMPTS = '2';
    process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_BACKOFF_MS = '10';
    queued = await startQueue((job) => service().extractPage(job));
  });

  beforeEach(async () => {
    await cleanDatabase();
    generate = jest.fn(async () => ({ text: BLOCK }));
  });

  afterAll(async () => {
    await queued.stop();
    delete process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_ATTEMPTS;
    delete process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_BACKOFF_MS;
    await disconnectDatabase();
  });

  it('retries a page whose runner died, within the same run', async () => {
    // A thrown error is the transient kind — the baseline's runner killed
    // under memory pressure — and the queue gives it another attempt.
    generate.mockImplementationOnce(async () => {
      throw new Error('unexpected EOF');
    });

    const result = await sync();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(1);
  });

  it('does not retry a deterministic failure — greedy decoding would repeat it', async () => {
    generate.mockImplementation(async () => ({ text: 'no JSON here' }));

    const result = await sync();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(0);
  });
});
