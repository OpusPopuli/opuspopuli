/**
 * Integration coverage for #1150 AC4 — the half that cannot be mocked.
 *
 * The unit specs
 * (`apps/backend/src/apps/knowledge/src/domains/knowledge.service.spec.ts`)
 * already cover the error-vs-empty distinction and the boot assertion's
 * logic. What they cannot cover is the reason #1150's two defects existed
 * in the first place: **both are invisible against a mocked database.**
 *
 *   - an IVFFlat index built on an empty table is a real index that a real
 *     Postgres accepts and then serves badly — no error, no mock can see it
 *   - a provider/store width disagreement only manifests as a `vector(N)`
 *     column rejecting an M-length array, which needs real pgvector
 *
 * That is the same lesson as the vector(1536)-vs-384 incident (#1074) that
 * prompted the assertion being tested here. So these run against the real
 * `postgres_test` database, per the repo's integration convention.
 *
 * Covers:
 *   1. after `initialize()`, the embeddings table carries an **HNSW** index
 *      and NOT the degenerate IVFFlat one
 *   2. `initialize()` is idempotent, and retires a pre-existing IVFFlat
 *      index from installs that predate the switch (the upgrade path)
 *   3. a width mismatch aborts at boot rather than failing per-row later
 */

import type { DbService } from '@opuspopuli/relationaldb-provider';
import { PgVectorProvider } from '@opuspopuli/vectordb-provider';
import { KnowledgeService } from '../../../src/apps/knowledge/src/domains/knowledge.service';
import { disconnectDatabase, getDbService } from '../utils';

const COLLECTION = 'itest_1150';
const TABLE = `${COLLECTION}_vectors`;

interface IndexRow {
  indexname: string;
  indexdef: string;
}

describe('pgvector index strategy + width assertion (#1150)', () => {
  let db: DbService;

  const indexesOnTable = (): Promise<IndexRow[]> =>
    db.$queryRawUnsafe<IndexRow[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
      TABLE,
    );

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    // This table is created by the provider at runtime, not by a Prisma
    // migration, so cleanDatabase() does not know about it.
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
  });

  afterAll(async () => {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
    await disconnectDatabase();
  });

  it('creates an HNSW index, not IVFFlat, on a freshly created table', async () => {
    await new PgVectorProvider(db, COLLECTION, 384).initialize();

    const indexes = await indexesOnTable();
    const hnsw = indexes.find((i) =>
      i.indexname.endsWith('_embedding_hnsw_idx'),
    );

    expect(hnsw).toBeDefined();
    expect(hnsw?.indexdef).toMatch(/USING hnsw/i);
    expect(hnsw?.indexdef).toMatch(/vector_cosine_ops/i);
    // The whole point: no IVFFlat anywhere on this table.
    expect(indexes.filter((i) => /ivfflat/i.test(i.indexdef))).toHaveLength(0);
  });

  it('retires a pre-existing IVFFlat index left by an older install', async () => {
    // Reconstruct the pre-#1150 world: the old provider's table + its
    // degenerate index, built on zero rows exactly as it used to be.
    await db.$executeRawUnsafe(`
      CREATE TABLE "${TABLE}" (
        id VARCHAR(255) PRIMARY KEY,
        document_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        embedding vector(384) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX "${TABLE}_embedding_idx" ON "${TABLE}"
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
    `);

    expect(
      (await indexesOnTable()).filter((i) => /ivfflat/i.test(i.indexdef)),
    ).toHaveLength(1);

    await new PgVectorProvider(db, COLLECTION, 384).initialize();

    const after = await indexesOnTable();
    expect(
      after.find((i) => i.indexname.endsWith('_embedding_hnsw_idx')),
    ).toBeDefined();
    expect(after.filter((i) => /ivfflat/i.test(i.indexdef))).toHaveLength(0);
  });

  it('is idempotent — a second initialize leaves one HNSW index', async () => {
    const provider = new PgVectorProvider(db, COLLECTION, 384);
    await provider.initialize();
    await provider.initialize();

    const hnsw = (await indexesOnTable()).filter((i) =>
      /USING hnsw/i.test(i.indexdef),
    );
    expect(hnsw).toHaveLength(1);
  });

  it('aborts at boot when provider width disagrees with the store', async () => {
    const service = new KnowledgeService(
      {
        getProviderInfo: () => ({ dimensions: 768 }),
        // Startup also verifies the model is actually pulled (#1156). This
        // stub is the real provider's shape: an in-process provider has
        // nothing to check, so readiness resolves immediately.
        assertProviderReady: async () => undefined,
      } as unknown as ConstructorParameters<typeof KnowledgeService>[0],
      new PgVectorProvider(db, COLLECTION, 384),
      {
        getName: () => 'test',
        getModelName: () => 'test-model',
      } as unknown as ConstructorParameters<typeof KnowledgeService>[2],
      {} as unknown as ConstructorParameters<typeof KnowledgeService>[3],
    );

    // Boot, not per-row: a mismatch means every vector written from here on
    // is unusable and nothing downstream can detect it.
    //
    // Awaited, not `expect(() => ...).toThrow`: onModuleInit became async when
    // it gained the model-readiness check, and a synchronous matcher against an
    // async function does not fail — it leaves an unhandled rejection that
    // kills the jest worker, which is how this surfaced (E2E shard 1, #1156).
    await expect(service.onModuleInit()).rejects.toThrow(
      /768-dimension vectors but the vector store expects 384/,
    );
  });

  it('accepts a real 384-vector insert when the widths agree', async () => {
    const provider = new PgVectorProvider(db, COLLECTION, 384);
    await provider.initialize();

    const vector = `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`;
    await db.$executeRawUnsafe(
      `INSERT INTO "${TABLE}" (id, document_id, user_id, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      'row-1',
      'doc-1',
      'user-1',
      'hello',
      vector,
    );

    const rows = await db.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM "${TABLE}"`,
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});
