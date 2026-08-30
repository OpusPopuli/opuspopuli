/**
 * Integration tests for the filed-measure corpus embedding (#1074, subtask 2).
 *
 * Complements the unit tests at
 * `apps/backend/src/apps/region/src/domains/proposition-embedding.service.spec.ts`,
 * which mock `DbService` and therefore never execute a single line of the SQL
 * that matters here.
 *
 * The whole risk in this subtask is the write itself. Prisma models
 * `propositions.embedding` as `Unsupported("vector(1536)")`, so the typed
 * client cannot write it and the service falls back to `$executeRaw` with a
 * hand-built pgvector literal. Nothing about that path is type-checked: a wrong
 * literal format, a wrong cast, or a dimension mismatch all compile cleanly and
 * fail only against a real pgvector column. These tests use the real
 * `postgres_test` database to assert the vector actually lands, reads back at
 * full width, and is queryable by cosine distance.
 *
 * The embeddings provider is mocked. The assertion is about the storage path,
 * not about model output, and running a real embedding model per test would
 * trade minutes of CI for no additional coverage.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { EMBEDDING_DIMENSIONS } from '@opuspopuli/common';
import { PropositionEmbeddingService } from '../../../src/apps/region/src/domains/proposition-embedding.service';
import { assertTestDatabase } from '../utils/db-cleanup';

/** A deterministic unit-ish vector, distinct per seed so cosine ordering is meaningful. */
function vectorFor(seed: number): number[] {
  const v = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[seed % EMBEDDING_DIMENSIONS] = 1;
  return v;
}

describe('Proposition embeddings (#1074)', () => {
  let moduleRef: TestingModule;
  let db: DbService;
  let service: PropositionEmbeddingService;
  const embeddings = {
    getEmbeddingsForQuery: jest.fn(),
    getProviderInfo: jest.fn(() => ({ dimensions: EMBEDDING_DIMENSIONS })),
  };

  const EXTERNAL_IDS = ['TEST-1074-A', 'TEST-1074-B'];

  beforeAll(async () => {
    assertTestDatabase();

    moduleRef = await Test.createTestingModule({
      providers: [
        PropositionEmbeddingService,
        DbService,
        { provide: EmbeddingsService, useValue: embeddings },
      ],
    }).compile();

    db = moduleRef.get(DbService);
    service = moduleRef.get(PropositionEmbeddingService);
  });

  afterAll(async () => {
    await db.proposition.deleteMany({
      where: { externalId: { in: EXTERNAL_IDS } },
    });
    await moduleRef.close();
  });

  beforeEach(async () => {
    embeddings.getEmbeddingsForQuery.mockReset();
    await db.proposition.deleteMany({
      where: { externalId: { in: EXTERNAL_IDS } },
    });
  });

  async function seed(externalId: string, title: string, summary: string) {
    return db.proposition.create({
      data: { externalId, title, summary, status: 'circulating' },
    });
  }

  /** Reads the raw column back — the typed client cannot select it. */
  async function readVector(id: string): Promise<number[] | null> {
    const rows = await db.$queryRaw<{ v: string | null }[]>`
      SELECT embedding::text AS v FROM propositions WHERE id = ${id}
    `;
    const raw = rows[0]?.v;
    return raw ? (JSON.parse(raw) as number[]) : null;
  }

  it('writes a full-width vector that reads back intact', async () => {
    const p = await seed(
      EXTERNAL_IDS[0],
      'ESTABLISHES VOTER IDENTIFICATION REQUIREMENTS',
      'Requires voters to present identification.',
    );
    embeddings.getEmbeddingsForQuery.mockResolvedValue(vectorFor(7));

    const result = await service.embedMissing();
    expect(result.embedded).toBeGreaterThanOrEqual(1);

    const stored = await readVector(p.id);
    expect(stored).not.toBeNull();
    // The failure this guards: a malformed literal that pgvector accepts but
    // silently pads or truncates.
    expect(stored).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(stored![7]).toBeCloseTo(1, 6);
  });

  it('records the hash of exactly what it embedded', async () => {
    const title = 'A CIRCULATING MEASURE';
    const summary = 'Does a thing.';
    const p = await seed(EXTERNAL_IDS[0], title, summary);
    embeddings.getEmbeddingsForQuery.mockResolvedValue(vectorFor(3));

    await service.embedMissing();

    const row = await db.proposition.findUnique({
      where: { id: p.id },
      select: { embeddingSourceHash: true },
    });
    expect(row?.embeddingSourceHash).toBe(
      PropositionEmbeddingService.sourceHash(
        PropositionEmbeddingService.embeddingSource({ title, summary }),
      ),
    );
  });

  /**
   * Idempotence is the property that makes this safe to hang off proposition
   * sync, which runs often. A second pass must cost nothing.
   */
  it('embeds nothing on a second run with unchanged text', async () => {
    await seed(EXTERNAL_IDS[0], 'UNCHANGED MEASURE', 'Stable summary.');
    embeddings.getEmbeddingsForQuery.mockResolvedValue(vectorFor(11));

    await service.embedMissing();
    const callsAfterFirst = embeddings.getEmbeddingsForQuery.mock.calls.length;

    const second = await service.embedMissing();

    expect(embeddings.getEmbeddingsForQuery).toHaveBeenCalledTimes(
      callsAfterFirst,
    );
    expect(second.embedded).toBe(0);
  });

  it('re-embeds when the summary changes', async () => {
    const p = await seed(EXTERNAL_IDS[0], 'DRIFTING MEASURE', 'First summary.');
    embeddings.getEmbeddingsForQuery.mockResolvedValue(vectorFor(5));
    await service.embedMissing();

    await db.proposition.update({
      where: { id: p.id },
      data: { summary: 'Amended summary, materially different.' },
    });
    embeddings.getEmbeddingsForQuery.mockResolvedValue(vectorFor(9));

    await service.embedMissing();

    const stored = await readVector(p.id);
    expect(stored![9]).toBeCloseTo(1, 6);
    expect(stored![5]).toBeCloseTo(0, 6);
  });

  /**
   * The point of the column. If cosine ordering does not work against the
   * stored vectors, retrieval cannot be built on them — and that would not
   * surface from any write-path assertion.
   */
  it('supports cosine-distance ranking over the stored vectors', async () => {
    const a = await seed(EXTERNAL_IDS[0], 'MEASURE A', 'First.');
    const b = await seed(EXTERNAL_IDS[1], 'MEASURE B', 'Second.');
    embeddings.getEmbeddingsForQuery
      .mockResolvedValueOnce(vectorFor(1))
      .mockResolvedValueOnce(vectorFor(2));

    await service.embedMissing();

    const query = `[${vectorFor(2).join(',')}]`;
    const ranked = await db.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (embedding <=> ${query}::vector) AS distance
      FROM propositions
      WHERE embedding IS NOT NULL AND external_id IN (${EXTERNAL_IDS[0]}, ${EXTERNAL_IDS[1]})
      ORDER BY distance ASC
    `;

    expect(ranked[0].id).toBe(b.id);
    expect(Number(ranked[0].distance)).toBeLessThan(Number(ranked[1].distance));
    expect(ranked[1].id).toBe(a.id);
  });
});
